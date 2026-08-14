// @vitest-environment jsdom
/**
 * @module tests/results-feedback-adaptive-scorm
 *
 * Консолидированный блок рекомендаций на АДАПТИВНОМ экране итогов пакета. Разметка
 * блока в `results.adaptive.html` уже есть, общий сборщик его уже собирает — проверяется
 * последнее звено: подаёт ли адаптивный рендер пакета источники (обратную связь теста и
 * материалы тем) в общий сборщик, и ровно ли те же, что подаёт веб-хост.
 *
 * Рантайм пакета — рукописный плоский JS, не модуль, поэтому источник исполняется с
 * подставленными глобалями. Склеиваются ДВА файла (`viewResults.js` + `adaptiveRender.js`)
 * — так же, как их склеивает сборка пакета: чтения `vrTopicAssets` /
 * `vrTopicFeedbackTexts` / `vrTestFeedback` живут в первом, и адаптивный рендер обязан
 * переиспользовать именно их, а не заводить третью копию логики.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildAdaptiveResultContext, normalizeFeedback } from "../shared/template/result-context";
import { buildResultsNav } from "../shared/template/results-nav";

const src = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
const viewResultsSrc = src("server/scorm/template/app/render/viewResults.js");
const adaptiveRenderSrc = src("server/scorm/template/app/render/adaptiveRender.js");
const adaptiveLayout = src("server/scorm/templates/default/layouts/results.adaptive.html");

const TOPIC_PDF = { title: "Разбор темы", url: "assets/media/aaaa.pdf" };
const SECTION_PDF = { title: "Памятка раздела", url: "assets/media/bbbb.pdf" };

/**
 * Результат адаптивной попытки, как его строит `buildAdaptiveResult` в пакете.
 * `achievedLevelIndex: null` — ни один уровень не подтверждён, то есть провал темы:
 * именно в этой ветке автор и рассчитывает, что материалы дойдут.
 */
function adaptiveResult(achievedLevelIndex: number | null, overallPassed = false) {
  return {
    overallPassed,
    topicResults: [
      {
        topicId: "t1",
        topicName: "Тема 1",
        achievedLevelIndex,
        achievedLevelName: achievedLevelIndex === null ? null : "Средний",
        feedback: null,
        recommendedLinks: [],
      },
    ],
  };
}

interface Runtime {
  renderAdaptiveResultsTemplated: (app: HTMLElement, result: unknown) => void;
}

function makeRuntime(sections: unknown[], testFeedbackJson?: unknown) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById("app") as HTMLElement;
  (window as unknown as { TBTemplate: unknown }).TBTemplate = {
    renderScreenInto,
    buildAdaptiveResultContext,
    buildResultsNav,
    normalizeFeedback,
  };
  const factory = new Function(
    "TEST_DATA",
    "state",
    "systemLayout",
    "scormDesignContext",
    "downloadPDF",
    "finishAndClose",
    "hasAttemptsLeft",
    "buildScormProtection",
    `${viewResultsSrc}\n${adaptiveRenderSrc}\nreturn { renderAdaptiveResultsTemplated: renderAdaptiveResultsTemplated };`,
  );
  const rt = factory(
    {
      title: "Демо-тест",
      sections,
      ...(testFeedbackJson ? { testFeedbackJson } : {}),
    },
    { templateLayouts: { "results.adaptive": adaptiveLayout } },
    () => adaptiveLayout,
    () => ({}),
    vi.fn(),
    vi.fn(),
    () => true,
    () => ({}),
  ) as Runtime;
  return { rt, app };
}

/**
 * Ссылки группы «Материалы» консолидированного блока.
 *
 * PRD-49 task 8: caption берётся из `labels.recommendations.assets`, а надписи в пакет
 * ещё не проведены (это задача 10 плана) — рантайм зовёт `buildAdaptiveResultContext`
 * без `labels`, поэтому подпись группы пуста. Ни один из тестов этого файла не заводит
 * группу «курсы» (`recommendedCourses`/`links` везде пустые), поэтому единственная
 * реально рендерящаяся группа ссылок здесь и есть материалы — фильтр по подписи убран,
 * проверяется структура (`a.tb-rec` внутри `.tb-recs-group`), а не текст заголовка.
 */
function materials(app: HTMLElement): Array<{ title: string; href: string }> {
  return Array.from(app.querySelectorAll(".tb-recs-group"))
    .flatMap((g) => Array.from(g.querySelectorAll("a.tb-rec")))
    .map((a) => ({ title: a.textContent?.trim() ?? "", href: a.getAttribute("href") ?? "" }));
}

/** Тексты консолидированного блока в порядке показа. */
function recTexts(app: HTMLElement): string[] {
  return Array.from(app.querySelectorAll("p.tb-recs-group__text")).map((p) => p.textContent?.trim() ?? "");
}

const sectionWithBoth = [
  {
    topicId: "t1",
    topicName: "Тема 1",
    feedbackTexts: ["Текст темы", "Текст раздела"],
    recommendedAssets: [TOPIC_PDF, SECTION_PDF],
  },
];

describe("SCORM (адаптивный): консолидированный блок рекомендаций", () => {
  it("тема без подтверждённого уровня отдаёт свои тексты и вложения", () => {
    const { rt, app } = makeRuntime(sectionWithBoth);
    rt.renderAdaptiveResultsTemplated(app, adaptiveResult(null));
    expect(recTexts(app)).toEqual(["Текст темы", "Текст раздела"]);
    expect(materials(app)).toEqual([
      { title: TOPIC_PDF.title, href: TOPIC_PDF.url },
      { title: SECTION_PDF.title, href: SECTION_PDF.url },
    ]);
  });

  it("обратная связь ТЕСТА доезжает и идёт впереди материалов темы", () => {
    const { rt, app } = makeRuntime(sectionWithBoth, {
      text: "Разберите ошибки.",
      links: [],
      events: [],
      assets: [{ title: "Памятка теста", fileName: "p.pdf", mimeType: "application/pdf", url: "assets/media/cccc.pdf" }],
    });
    rt.renderAdaptiveResultsTemplated(app, adaptiveResult(null));
    expect(recTexts(app)).toEqual(["Разберите ошибки.", "Текст темы", "Текст раздела"]);
    expect(materials(app)).toEqual([
      { title: "Памятка теста", href: "assets/media/cccc.pdf" },
      { title: TOPIC_PDF.title, href: TOPIC_PDF.url },
      { title: SECTION_PDF.title, href: SECTION_PDF.url },
    ]);
  });

  it("текст, совпадающий с обратной связью теста, показывается один раз", () => {
    const { rt, app } = makeRuntime(
      [{ topicId: "t1", topicName: "Тема 1", feedbackTexts: ["Разберите ошибки.", "Текст раздела"] }],
      { text: "Разберите ошибки.", links: [], events: [], assets: [] },
    );
    rt.renderAdaptiveResultsTemplated(app, adaptiveResult(null));
    expect(recTexts(app)).toEqual(["Разберите ошибки.", "Текст раздела"]);
  });

  it("тема с ПОДТВЕРЖДЁННЫМ уровнем молчит", () => {
    // Гейт живёт в общем сборщике; проверка караулит, что рантайм не докладывает
    // материалы темы в обход него — иначе пакет и веб разойдутся составом блока.
    const { rt, app } = makeRuntime(sectionWithBoth, { text: "Разберите ошибки.", links: [], events: [], assets: [] });
    rt.renderAdaptiveResultsTemplated(app, adaptiveResult(1));
    expect(recTexts(app)).toEqual(["Разберите ошибки."]);
    expect(materials(app)).toEqual([]);
  });

  it("пройденный адаптивный тест не показывает и своей обратной связи", () => {
    const { rt, app } = makeRuntime(sectionWithBoth, { text: "Разберите ошибки.", links: [], events: [], assets: [] });
    rt.renderAdaptiveResultsTemplated(app, adaptiveResult(1, true));
    expect(recTexts(app)).toEqual([]);
    expect(app.querySelector(".tb-recs-block")).toBeNull();
  });

  it("без материалов пустого блока не возникает", () => {
    const { rt, app } = makeRuntime([{ topicId: "t1", topicName: "Тема 1" }]);
    rt.renderAdaptiveResultsTemplated(app, adaptiveResult(null));
    expect(recTexts(app)).toEqual([]);
    expect(materials(app)).toEqual([]);
    expect(app.querySelector(".tb-recs-block")).toBeNull();
  });
});
