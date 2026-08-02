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
 * Попытка, как её хранит `suspend_data.attempts[]`. Тема НЕ ПРОЙДЕНА намеренно: по
 * согласованному решению владельца всё, что автор повесил на тему — текст, курсы,
 * мероприятия, вложения, — ученик получает только при провале темы. Значит провал и есть
 * тот случай, в котором проверяется доставка; вердикты `true` и `null` проверяет
 * отдельный блок про гейт.
 */
function attemptWithTopic(topicPassed: boolean | null) {
  return {
    attemptNumber: 1,
    percent: 60,
    correct: 3,
    totalCorrect: 3,
    totalQuestions: 5,
    earnedPoints: 3,
    possiblePoints: 5,
    passed: false,
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

interface Runtime {
  renderViewResultsTemplated: (app: HTMLElement, results: unknown) => void;
  renderResultsTemplated: (app: HTMLElement, results: unknown) => void;
}

function makeRuntime(sections: unknown[], testFeedbackJson?: unknown) {
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
    `${viewResultsSrc}\nreturn { renderViewResultsTemplated: renderViewResultsTemplated, renderResultsTemplated: renderResultsTemplated };`,
  );
  const rt = factory(
    { title: "Демо-тест", sections, ...(testFeedbackJson ? { testFeedbackJson } : {}) },
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

describe("SCORM: гейт по вердикту темы", () => {
  // Пакет обязан вести себя ровно как веб: гейт живёт в общем сборщике, через который
  // ходят оба хоста, и эти проверки караулят, что рантайм не начал докладывать материалы
  // темы в обход него.
  const sectionWithBoth = [
    { topicId: "t1", topicName: "Тема 1", recommendedAssets: [TOPIC_PDF], feedbackTexts: ["Текст темы"] },
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

  it("тема БЕЗ вердикта (passed: null) молчит — как молчат курсы в vrRecommended", () => {
    const { rt, app } = makeRuntime(sectionWithBoth);
    rt.renderViewResultsTemplated(app, attemptWithTopic(null));
    expect(materials(app)).toEqual([]);
    expect(recTexts(app)).toEqual([]);
  });

  it("финишный экран гейтит так же, как «Мой результат»", () => {
    const { rt, app } = makeRuntime(sectionWithBoth);
    rt.renderResultsTemplated(app, attemptWithTopic(true));
    expect(materials(app)).toEqual([]);
    expect(recTexts(app)).toEqual([]);
  });
});
