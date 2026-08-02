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

/** Links rendered in the «Материалы» group of the recommendations block. */
function materials(app: HTMLElement): Array<{ title: string; href: string }> {
  return Array.from(app.querySelectorAll(".tb-recs-group"))
    .filter((g) => (g.querySelector(".tb-eyebrow")?.textContent ?? "").trim() === "Материалы")
    .flatMap((g) => Array.from(g.querySelectorAll("a.tb-rec")))
    .map((a) => ({ title: a.textContent?.trim() ?? "", href: a.getAttribute("href") ?? "" }));
}

/** Тексты, напечатанные в общем блоке рекомендаций, в порядке показа. */
function recTexts(app: HTMLElement): string[] {
  return Array.from(app.querySelectorAll("p.tb-recs-group__text")).map((p) => p.textContent?.trim() ?? "");
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

  it("обратная связь ТЕСТА доезжает и без шкал и показателей (дефект Д-3)", () => {
    // `buildResultsMeasures` возвращает null у теста без измерений, поэтому обратная
    // связь теста читается ОТДЕЛЬНО от него — иначе самый массовый тест продукта
    // остаётся без блока рекомендаций.
    const feedback = {
      text: "Спасибо за участие.",
      links: [],
      events: [],
      assets: [{ title: "Памятка теста", fileName: "p.pdf", mimeType: "application/pdf", url: "assets/media/cccc.pdf" }],
    };
    const { rt, app } = makeRuntime(sectionWithAssets, feedback);
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(app.querySelector(".tb-recs-group__text")?.textContent).toBe("Спасибо за участие.");
    // Обратная связь теста — общий источник, поэтому впереди вложений темы и раздела.
    expect(materials(app)).toEqual([
      { title: "Памятка теста", href: "assets/media/cccc.pdf" },
      { title: TOPIC_PDF.title, href: TOPIC_PDF.url },
      { title: SECTION_PDF.title, href: SECTION_PDF.url },
    ]);
  });

  it("финишный экран показывает обратную связь теста так же", () => {
    const { rt, app } = makeRuntime([], { text: "Спасибо за участие.", links: [], events: [], assets: [] });
    rt.renderResultsTemplated(app, savedAttempt);
    expect(app.querySelector(".tb-recs-group__text")?.textContent).toBe("Спасибо за участие.");
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

  it("текст теста идёт впереди текста темы, а повтор показывается один раз", () => {
    // Тест — самый общий источник, поэтому его экземпляр переживает дедупликацию; тот же
    // порядок держит веб-хост, иначе экраны двух хостов разошлись бы составом блока.
    const { rt, app } = makeRuntime(
      [{ topicId: "t1", topicName: "Тема 1", feedbackTexts: ["Спасибо за участие.", "Текст раздела"] }],
      { text: "Спасибо за участие.", links: [], events: [], assets: [] },
    );
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(recTexts(app)).toEqual(["Спасибо за участие.", "Текст раздела"]);
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

describe("SCORM: гейт по вердикту ТЕСТА", () => {
  const TEST_FEEDBACK = { text: "Разберите ошибки.", links: [], events: [], assets: [] };

  it("явно пройденный тест свою обратную связь не показывает", () => {
    // «Явно» = у теста есть порог (`TEST_DATA.overallPassRule`), есть что оценивать и
    // вердикт «пройден».
    const { rt, app } = makeRuntime([], TEST_FEEDBACK, PERCENT_RULE);
    rt.renderViewResultsTemplated(app, attemptWithTopic(true, true));
    expect(recTexts(app)).toEqual([]);
    expect(app.querySelector(".tb-recs")).toBeNull();
  });

  it("провалённый — показывает", () => {
    const { rt, app } = makeRuntime([], TEST_FEEDBACK, PERCENT_RULE);
    rt.renderViewResultsTemplated(app, attemptWithTopic(null, false));
    expect(recTexts(app)).toEqual(["Разберите ошибки."]);
  });

  it("измерительный БЕЗ порога показывает свою обратную связь и при passed: true", () => {
    // Край PRD-29 на стороне пакета: `overallPassRule.type === 'none'` — вердикт не
    // выносился, и обратная связь теста и есть его результат.
    const { rt, app } = makeRuntime([], TEST_FEEDBACK, { type: "none", value: 0 });
    rt.renderViewResultsTemplated(app, attemptWithTopic(null, true));
    expect(recTexts(app)).toEqual(["Разберите ошибки."]);
  });

  it("финишный экран гейтит тест так же", () => {
    const { rt, app } = makeRuntime([], TEST_FEEDBACK, PERCENT_RULE);
    rt.renderResultsTemplated(app, attemptWithTopic(true, true));
    expect(recTexts(app)).toEqual([]);
  });
});
