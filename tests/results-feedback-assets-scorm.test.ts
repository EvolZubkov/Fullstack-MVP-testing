// @vitest-environment jsdom
/**
 * @module tests/results-feedback-assets-scorm
 *
 * Приёмочные дефекты Д-2 и Д-3 — сторона ПАКЕТА. Вложение, приложенное к теме
 * (`topics.feedback_json`) или к разделу теста (`test_sections.feedback_json`),
 * запекается в `TEST_DATA.sections[].recommendedAssets`, обратная связь самого теста —
 * в `TEST_DATA.testFeedbackJson`; рантайм обязан довезти до общего блока рекомендаций и
 * то, и другое — на обоих экранах итогов (финишном и «Мой результат») и у теста БЕЗ
 * шкал и показателей.
 *
 * Рантайм пакета — рукописный плоский JS, не модуль, поэтому источник исполняется с
 * подставленными глобалями (тот же приём, что в `results-report-action.test.ts`).
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildResultContext, normalizeFeedback } from "../shared/template/result-context";
import { buildResultsNav } from "../shared/template/results-nav";

const src = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
const viewResultsSrc = src("server/scorm/template/app/render/viewResults.js");
const resultsLayout = src("server/scorm/templates/default/layouts/results.html");

const TOPIC_PDF = { title: "Разбор темы", url: "assets/media/aaaa.pdf" };
const SECTION_PDF = { title: "Памятка раздела", url: "assets/media/bbbb.pdf" };

/**
 * Попытка, как её хранит `suspend_data.attempts[]`. По умолчанию НЕ пройдена, и тема
 * тоже: по согласованному решению владельца материалы молчат только при ЯВНОМ успехе —
 * и на уровне темы, и на уровне теста. Значит провал и есть тот случай, в котором
 * проверяется доставка; вердикты `true` и `null` проверяют отдельные блоки про гейты.
 */
function attemptWithTopic(topicPassed: boolean | null, testPassed = false) {
  return {
    attemptNumber: 1,
    percent: testPassed ? 100 : 60,
    correct: testPassed ? 5 : 3,
    totalCorrect: testPassed ? 5 : 3,
    totalQuestions: 5,
    earnedPoints: testPassed ? 5 : 3,
    possiblePoints: 5,
    passed: testPassed,
    topicResults: [
      {
        topicId: "t1",
        topicName: "Тема 1",
        correct: 3,
        total: 5,
        percent: 60,
        earnedPoints: 3,
        possiblePoints: 5,
        passed: topicPassed,
      },
    ],
  };
}

const savedAttempt = attemptWithTopic(false);

/** Порог теста, как его печёт `test-json.ts` в `TEST_DATA.overallPassRule`. */
const PERCENT_RULE = { type: "percent", value: 70 };

interface Runtime {
  renderViewResultsTemplated: (app: HTMLElement, results: unknown) => void;
  renderResultsTemplated: (app: HTMLElement, results: unknown) => void;
  /** Курсы/мероприятия тем: раскладка их не печатает, поэтому проверяются на выходе. */
  vrRecommended: (results: unknown) => { courses: Array<{ title: string; url?: string }>; events: Array<{ title: string }> };
}

function makeRuntime(sections: unknown[], testFeedbackJson?: unknown, overallPassRule?: unknown) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById("app") as HTMLElement;
  (window as unknown as { TBTemplate: unknown }).TBTemplate = {
    renderScreenInto,
    buildResultContext,
    buildResultsNav,
    normalizeFeedback,
  };
  const factory = new Function(
    "TEST_DATA",
    "state",
    "systemLayout",
    "applySystemScreenStyles",
    "scormDesignContext",
    "downloadPDF",
    "restart",
    "enterPostResults",
    "finishAndClose",
    "hasAttemptsLeft",
    "render",
    // PRD-34: рантайм спрашивает у пакета настройки защиты экрана.
    "buildScormProtection",
    `${viewResultsSrc}\nreturn { renderViewResultsTemplated: renderViewResultsTemplated, renderResultsTemplated: renderResultsTemplated, vrRecommended: vrRecommended };`,
  );
  const rt = factory(
    {
      title: "Демо-тест",
      sections,
      ...(testFeedbackJson ? { testFeedbackJson } : {}),
      // Признак «тест выносит вердикт» рантайм читает отсюда — из того же поля, которое
      // печёт `test-json.ts`; ничего нового в пакет для этого не поехало.
      ...(overallPassRule ? { overallPassRule } : {}),
    },
    { phase: "viewResults", viewedAttempt: savedAttempt, templateLayouts: { results: resultsLayout }, postResultsPages: [] },
    () => resultsLayout,
    () => undefined,
    () => ({}),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    vi.fn(),
    () => false,
    vi.fn(),
    () => ({}),
  ) as Runtime;
  return { rt, app };
}

/**
 * Links rendered in the «Материалы» group of the recommendations block.
 *
 * PRD-49 moved the group eyebrows into the context (`labels.recommendations.*`), and the
 * SCORM host does not pass the labels yet, so the eyebrow is empty in this runtime's
 * output. The group is therefore taken by its FIXED place in the block — attachments are
 * printed last, after texts, courses and events — and the eyebrow is still honoured once
 * the host fills it, so this helper needs no second edit when the wiring lands.
 */
function materials(app: HTMLElement): Array<{ title: string; href: string }> {
  const groups = Array.from(app.querySelectorAll(".tb-recs-group"));
  const eyebrow = (g: Element) => (g.querySelector(".tb-eyebrow")?.textContent ?? "").trim();
  const labelled = groups.filter((g) => eyebrow(g) === "Материалы");
  const target = labelled.length ? labelled : groups.slice(-1).filter((g) => eyebrow(g) === "");
  return target
    .flatMap((g) => Array.from(g.querySelectorAll("a.tb-rec")))
    .map((a) => ({ title: a.textContent?.trim() ?? "", href: a.getAttribute("href") ?? "" }));
}

/** Тексты, напечатанные в общем блоке рекомендаций, в порядке показа. */
function recTexts(app: HTMLElement): string[] {
  // Selector is tag-free on purpose: the layout carries the author's own markup, so the
  // wrapper is a <div> since `f3833fcf` — a <p> inside a <p> was closed early by the
  // browser and the author's paragraphs escaped the block's rules.
  return Array.from(app.querySelectorAll(".tb-recs-group__text")).map((p) => p.textContent?.trim() ?? "");
}

const sectionWithAssets = [
  { topicId: "t1", topicName: "Тема 1", recommendedAssets: [TOPIC_PDF, SECTION_PDF] },
];

/** Раздел, каким его печёт `test-json.ts`: текст темы первым, текст раздела вторым. */
const sectionWithTexts = [
  { topicId: "t1", topicName: "Тема 1", feedbackTexts: ["Текст темы", "Текст раздела"] },
];

describe("SCORM: вложения темы и раздела на экранах итогов", () => {
  it("«Мой результат» показывает их в блоке «Материалы»", () => {
    const { rt, app } = makeRuntime(sectionWithAssets);
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(materials(app)).toEqual([
      { title: TOPIC_PDF.title, href: TOPIC_PDF.url },
      { title: SECTION_PDF.title, href: SECTION_PDF.url },
    ]);
  });

  it("финишный экран итогов показывает ровно то же", () => {
    const { rt, app } = makeRuntime(sectionWithAssets);
    rt.renderResultsTemplated(app, savedAttempt);
    expect(materials(app)).toEqual([
      { title: TOPIC_PDF.title, href: TOPIC_PDF.url },
      { title: SECTION_PDF.title, href: SECTION_PDF.url },
    ]);
  });

  it("обратная связь ТЕСТА в пакете не печатается (PRD-61 §10)", () => {
    // Уровень теста снят: TEST_DATA его больше не несёт, рантайм не читает. Материалы
    // ТЕМЫ и РАЗДЕЛА при этом на месте — снят ровно один уровень.
    const feedback = {
      text: "Спасибо за участие.",
      links: [],
      events: [],
      assets: [{ title: "Памятка теста", fileName: "p.pdf", mimeType: "application/pdf", url: "assets/media/cccc.pdf" }],
    };
    const { rt, app } = makeRuntime(sectionWithAssets, feedback);
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(app.querySelector(".tb-recs-group__text")).toBeNull();
    expect(materials(app)).toEqual([
      { title: TOPIC_PDF.title, href: TOPIC_PDF.url },
      { title: SECTION_PDF.title, href: SECTION_PDF.url },
    ]);
  });

  it("финишный экран молчит о ней так же", () => {
    const { rt, app } = makeRuntime([], { text: "Спасибо за участие.", links: [], events: [], assets: [] });
    rt.renderResultsTemplated(app, savedAttempt);
    expect(app.querySelector(".tb-recs-group__text")).toBeNull();
  });

  it("«Мой результат» показывает тексты темы и раздела", () => {
    const { rt, app } = makeRuntime(sectionWithTexts);
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(recTexts(app)).toEqual(["Текст темы", "Текст раздела"]);
  });

  it("финишный экран итогов показывает те же тексты", () => {
    const { rt, app } = makeRuntime(sectionWithTexts);
    rt.renderResultsTemplated(app, savedAttempt);
    expect(recTexts(app)).toEqual(["Текст темы", "Текст раздела"]);
  });

  it("повтор текста внутри темы показывается один раз", () => {
    // Дедуп проверялся на паре «тест и тема»; уровень теста снят, и оба экземпляра строки
    // теперь приходят от самой темы.
    const { rt, app } = makeRuntime(
      [{ topicId: "t1", topicName: "Тема 1", feedbackTexts: ["Текст раздела", "Текст раздела"] }],
    );
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(recTexts(app)).toEqual(["Текст раздела"]);
  });

  it("раздел без вложений не рождает пустого блока", () => {
    const { rt, app } = makeRuntime([{ topicId: "t1", topicName: "Тема 1" }]);
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(materials(app)).toEqual([]);
    expect(app.querySelector(".tb-recs")).toBeNull();
  });
});

describe("SCORM: гейт по вердикту ТЕМЫ", () => {
  // Пакет обязан вести себя ровно как веб: гейт живёт в общем сборщике, через который
  // ходят оба хоста, и эти проверки караулят, что рантайм не начал докладывать материалы
  // темы в обход него.
  const sectionWithBoth = [
    {
      topicId: "t1",
      topicName: "Тема 1",
      recommendedAssets: [TOPIC_PDF],
      feedbackTexts: ["Текст темы"],
      recommendedCourses: [{ title: "Курс по теме", url: "https://example.test/c" }],
    },
  ];

  it("у ПРОЙДЕННОЙ темы ни текст, ни вложения не показываются", () => {
    const { rt, app } = makeRuntime(sectionWithBoth);
    rt.renderViewResultsTemplated(app, attemptWithTopic(true));
    expect(materials(app)).toEqual([]);
    expect(recTexts(app)).toEqual([]);
    expect(app.querySelector(".tb-recs")).toBeNull();
  });

  it("у НЕпройденной показываются оба", () => {
    const { rt, app } = makeRuntime(sectionWithBoth);
    rt.renderViewResultsTemplated(app, attemptWithTopic(false));
    expect(materials(app)).toEqual([{ title: TOPIC_PDF.title, href: TOPIC_PDF.url }]);
    expect(recTexts(app)).toEqual(["Текст темы"]);
  });

  it("тема БЕЗ вердикта (passed: null) показывает их наравне с проваленной", () => {
    // Край, ради которого правило переписано: потемные пороги задают редко, и «не
    // судили» нельзя трактовать как успех — иначе материал автора молча пропадает.
    const { rt, app } = makeRuntime(sectionWithBoth);
    rt.renderViewResultsTemplated(app, attemptWithTopic(null));
    expect(materials(app)).toEqual([{ title: TOPIC_PDF.title, href: TOPIC_PDF.url }]);
    expect(recTexts(app)).toEqual(["Текст темы"]);
  });

  it("финишный экран гейтит так же, как «Мой результат»", () => {
    const { rt, app } = makeRuntime(sectionWithBoth);
    rt.renderResultsTemplated(app, attemptWithTopic(true));
    expect(materials(app)).toEqual([]);
    expect(recTexts(app)).toEqual([]);
  });

  it("курсы и мероприятия темы живут по тому же правилу (vrRecommended)", () => {
    // Их собирает сам рантайм, а не общий сборщик, и в раскладке «Стандартного» они не
    // печатаются, поэтому проверяются на выходе функции — иначе три ресурса одной темы
    // снова разъедутся: тексты и вложения по одному правилу, курсы по другому.
    const { rt } = makeRuntime(sectionWithBoth);
    expect(rt.vrRecommended(attemptWithTopic(true)).courses).toEqual([]);
    expect(rt.vrRecommended(attemptWithTopic(false)).courses).toEqual([
      { title: "Курс по теме", url: "https://example.test/c" },
    ]);
    expect(rt.vrRecommended(attemptWithTopic(null)).courses).toEqual([
      { title: "Курс по теме", url: "https://example.test/c" },
    ]);
  });
});

describe("SCORM: гейт вердикта теста снят вместе с его обратной связью (PRD-61 §10)", () => {
  const TEST_FEEDBACK = { text: "Разберите ошибки.", links: [], events: [], assets: [] };

  // Здесь были четыре проверки правила «своя обратная связь теста молчит при явном
  // успехе»: с порогом, без порога и на финишном экране. Правило ушло вместе с полем.
  it("не печатается ни при каком вердикте и ни на одном из двух экранов", () => {
    for (const [rule, topicPassed, overall] of [
      [PERCENT_RULE, true, true],
      [PERCENT_RULE, null, false],
      [{ type: "none", value: 0 }, null, true],
    ] as const) {
      const view = makeRuntime([], TEST_FEEDBACK, rule as never);
      view.rt.renderViewResultsTemplated(view.app, attemptWithTopic(topicPassed, overall));
      expect(recTexts(view.app)).toEqual([]);

      const finish = makeRuntime([], TEST_FEEDBACK, rule as never);
      finish.rt.renderResultsTemplated(finish.app, attemptWithTopic(topicPassed, overall));
      expect(recTexts(finish.app)).toEqual([]);
    }
  });
});
