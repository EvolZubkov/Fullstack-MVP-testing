// @vitest-environment jsdom
/**
 * @module tests/results-feedback-assets-scorm
 *
 * PRD-32, приёмочный дефект Д-2 — сторона ПАКЕТА. Вложение, приложенное к теме
 * (`topics.feedback_json`) или к разделу теста (`test_sections.feedback_json`),
 * запекается в `TEST_DATA.sections[].recommendedAssets`, и рантайм обязан довезти его
 * до общего блока «Материалы» — на обоих экранах итогов: финишном и «Мой результат».
 *
 * Рантайм пакета — рукописный плоский JS, не модуль, поэтому источник исполняется с
 * подставленными глобалями (тот же приём, что в `results-report-action.test.ts`).
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildResultContext } from "../shared/template/result-context";
import { buildResultsNav } from "../shared/template/results-nav";

const src = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
const viewResultsSrc = src("server/scorm/template/app/render/viewResults.js");
const resultsLayout = src("server/scorm/templates/default/layouts/results.html");

const TOPIC_PDF = { title: "Разбор темы", url: "assets/media/aaaa.pdf" };
const SECTION_PDF = { title: "Памятка раздела", url: "assets/media/bbbb.pdf" };

/** A saved attempt as `suspend_data.attempts[]` stores it. Passed topic on purpose: */
/** the material is due for having taken the topic, not for having failed it. */
const savedAttempt = {
  attemptNumber: 1,
  percent: 100,
  correct: 5,
  totalCorrect: 5,
  totalQuestions: 5,
  earnedPoints: 5,
  possiblePoints: 5,
  passed: true,
  topicResults: [
    {
      topicId: "t1",
      topicName: "Тема 1",
      correct: 5,
      total: 5,
      percent: 100,
      earnedPoints: 5,
      possiblePoints: 5,
      passed: true,
    },
  ],
};

interface Runtime {
  renderViewResultsTemplated: (app: HTMLElement, results: unknown) => void;
  renderResultsTemplated: (app: HTMLElement, results: unknown) => void;
}

function makeRuntime(sections: unknown[]) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById("app") as HTMLElement;
  (window as unknown as { TBTemplate: unknown }).TBTemplate = {
    renderScreenInto,
    buildResultContext,
    buildResultsNav,
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
    { title: "Демо-тест", sections },
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

const sectionWithAssets = [
  { topicId: "t1", topicName: "Тема 1", recommendedAssets: [TOPIC_PDF, SECTION_PDF] },
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

  it("раздел без вложений не рождает пустого блока", () => {
    const { rt, app } = makeRuntime([{ topicId: "t1", topicName: "Тема 1" }]);
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(materials(app)).toEqual([]);
    expect(app.querySelector(".tb-recs")).toBeNull();
  });
});
