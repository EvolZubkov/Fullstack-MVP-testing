// @vitest-environment jsdom
/**
 * @module tests/results-report-action
 *
 * Guards «Скачать отчёт» (the in-package PDF report) on the SCORM results screens.
 *
 * The report has ONE producer — `app/utils/pdfExport.js` behind the global
 * `downloadPDF()` — and four entry points: the finish results screen, «Мой результат»
 * (a saved attempt), the cooldown start screen (PRD-19 FR-19/20) and the adaptive
 * results screen. When the results screens moved onto the shared design templates the
 * report was left behind on «Мой результат»:
 *
 * 1. `assets/app.js` still declared its own `viewSavedResults`/`renderSavedResults`.
 *    The package's `app.js` is a FLAT concatenation (see `joinJsParts`) with
 *    `assets/app.js` last, so that legacy declaration SHADOWED the templated one in
 *    `app/render/startPage.js` — «Мой результат» rendered the pre-revision
 *    `results-page` markup, whose classes the revised stylesheet no longer carries.
 * 2. The templated screen that replaced it never filled `result.nav`, so the layout's
 *    `{{#if result.nav.showReport}}` stayed false and offered no report at all.
 *
 * These tests pin both: no duplicate runtime declarations, and a saved-attempt screen
 * whose footer carries a wired «Скачать отчёт».
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { renderScreenInto } from "../shared/template/render-screen";
import { buildResultContext } from "../shared/template/result-context";
import { buildResultsNav } from "../shared/template/results-nav";
import { buildScreenInputs, type PreviewManifest } from "../shared/template/preview-context";

const src = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");

const appJsSrc = src("server/scorm/assets/app.js");
const viewResultsSrc = src("server/scorm/template/app/render/viewResults.js");
const startPageSrc = src("server/scorm/template/app/render/startPage.js");
const resultsLayout = src("server/scorm/templates/default/layouts/results.html");

describe("SCORM runtime — no duplicate saved-results declarations", () => {
  // `joinJsParts` concatenates the runtime parts into ONE script, so a function
  // declared in two parts resolves to the LAST one (assets/app.js). Keeping a legacy
  // copy there silently overrides the templated screen.
  const declares = (source: string, name: string) =>
    new RegExp(`^function ${name}\\s*\\(`, "m").test(source);

  it("«Мой результат» is declared only by the templated renderer", () => {
    expect(declares(startPageSrc, "viewSavedResults")).toBe(true);
    expect(declares(appJsSrc, "viewSavedResults")).toBe(false);
  });

  it("the pre-revision `results-page` saved-results markup is gone", () => {
    expect(declares(appJsSrc, "renderSavedResults")).toBe(false);
  });

  it("`backToStart` is declared only by the templated renderer", () => {
    // The legacy copy in assets/app.js left `state.viewedAttempt` set on the way out.
    expect(declares(viewResultsSrc, "backToStart")).toBe(true);
    expect(declares(appJsSrc, "backToStart")).toBe(false);
  });
});

/** A saved attempt as `suspend_data.attempts[]` stores it (see suspendAttempts.js). */
const savedAttempt = {
  attemptNumber: 1,
  completedAt: "2026-07-29T20:00:00.000Z",
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
      passed: false,
      topicFeedback: "Повторите материал",
    },
  ],
};

interface Runtime {
  renderViewResultsTemplated: (app: HTMLElement, results: unknown) => void;
  renderResultsTemplated: (app: HTMLElement, results: unknown) => void;
}

/**
 * Run the runtime source with injected globals — the SCORM runtime ships as
 * hand-maintained plain JS, not importable modules (same approach as the *-port tests).
 */
function makeRuntime(opts: { hasAttemptsLeft?: boolean; postResultsPages?: unknown[] } = {}) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById("app") as HTMLElement;
  (window as unknown as { TBTemplate: unknown }).TBTemplate = {
    renderScreenInto,
    buildResultContext,
    buildResultsNav,
  };
  const spies = {
    downloadPDF: vi.fn(),
    restart: vi.fn(),
    enterPostResults: vi.fn(),
    finishAndClose: vi.fn(),
    render: vi.fn(),
  };
  const state = {
    phase: "viewResults",
    viewedAttempt: savedAttempt,
    templateLayouts: { results: resultsLayout },
    postResultsPages: opts.postResultsPages || [],
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
    // PRD-34: с тех пор рантайм спрашивает у пакета настройки защиты экрана. Без
    // подстановки этой глобали обе экранные функции падают на ReferenceError.
    "buildScormProtection",
    `${viewResultsSrc}\nreturn { renderViewResultsTemplated: renderViewResultsTemplated, renderResultsTemplated: renderResultsTemplated };`,
  );
  const rt = factory(
    { title: "Демо-тест", sections: [] },
    state,
    () => resultsLayout,
    () => undefined,
    () => ({}),
    spies.downloadPDF,
    spies.restart,
    spies.enterPostResults,
    spies.finishAndClose,
    () => !!opts.hasAttemptsLeft,
    spies.render,
    () => ({}),
  ) as Runtime;
  return { rt, app, state, spies };
}

const footActions = (app: HTMLElement) =>
  Array.from(app.querySelectorAll(".tb-scene__foot button[data-action]")).map((b) =>
    b.getAttribute("data-action"),
  );

describe("«Мой результат» (saved attempt) — footer", () => {
  it("renders the shared scene, not the pre-revision markup", () => {
    const { rt, app } = makeRuntime();
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(app.querySelector(".tb-scene")).not.toBeNull();
    expect(app.querySelector(".results-page")).toBeNull();
  });

  it("offers «Скачать отчёт» plus the closing action", () => {
    const { rt, app } = makeRuntime();
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(footActions(app)).toEqual(["download-report", "results-finish"]);
    expect(app.querySelector('[data-action="results-finish"]')?.textContent).toBe(
      "Вернуться к тесту",
    );
  });

  it("never offers «Пройти заново» — the screen shows a PAST attempt", () => {
    const { rt, app } = makeRuntime({ hasAttemptsLeft: true });
    rt.renderViewResultsTemplated(app, savedAttempt);
    expect(app.querySelector('[data-action="restart"]')).toBeNull();
  });

  it("«Скачать отчёт» exports the BEST attempt — the one on screen", () => {
    const { rt, app, spies } = makeRuntime();
    rt.renderViewResultsTemplated(app, savedAttempt);
    (app.querySelector('[data-action="download-report"]') as HTMLButtonElement).click();
    expect(spies.downloadPDF).toHaveBeenCalledWith(true);
  });

  it("the closing action returns to the start screen and drops the viewed attempt", () => {
    const { rt, app, state, spies } = makeRuntime();
    rt.renderViewResultsTemplated(app, savedAttempt);
    (app.querySelector('[data-action="results-finish"]') as HTMLButtonElement).click();
    expect(spies.finishAndClose).not.toHaveBeenCalled();
    expect(state.phase).toBe("start");
    expect(state.viewedAttempt).toBeNull();
    expect(spies.render).toHaveBeenCalled();
  });
});

describe("finish results screen — footer stays intact", () => {
  it("report + retry + «Далее» when post-test pages follow and attempts remain", () => {
    const { rt, app, spies } = makeRuntime({ hasAttemptsLeft: true, postResultsPages: [{}] });
    rt.renderResultsTemplated(app, savedAttempt);
    expect(footActions(app)).toEqual(["download-report", "restart", "results-next"]);
    (app.querySelector('[data-action="download-report"]') as HTMLButtonElement).click();
    expect(spies.downloadPDF).toHaveBeenCalled();
  });

  it("report + «Завершить» when the attempt is spent", () => {
    const { rt, app, spies } = makeRuntime({ hasAttemptsLeft: false });
    rt.renderResultsTemplated(app, savedAttempt);
    expect(footActions(app)).toEqual(["download-report", "results-finish"]);
    (app.querySelector('[data-action="results-finish"]') as HTMLButtonElement).click();
    expect(spies.finishAndClose).toHaveBeenCalled();
  });
});

describe("template preview — the results footer an author approves", () => {
  // The PRD-3 preview is the surface an author signs a template off on. It used to
  // build the results context WITHOUT `result.nav`, so it rendered the layout's legacy
  // single-button branch: a template could ship with no «Скачать отчёт» and the preview
  // still looked right. The preview must exercise the whole row.
  const defaultDir = path.resolve(process.cwd(), "server", "scorm", "templates", "default");
  const manifest = JSON.parse(
    fs.readFileSync(path.join(defaultDir, "manifest.json"), "utf8"),
  ) as PreviewManifest;
  const demo = JSON.parse(fs.readFileSync(path.join(defaultDir, "demo", "course.json"), "utf8"));

  it("offers «Скачать отчёт» alongside retry and the closing action", () => {
    const spec = buildScreenInputs(demo, manifest).find((s) => s.route === "results");
    expect(spec).toBeDefined();
    const root = document.createElement("div");
    renderScreenInto(root, { layout: resultsLayout, context: spec!.input.context });
    expect(footActions(root)).toEqual(["download-report", "restart", "results-finish"]);
  });
});
