// @vitest-environment jsdom
/**
 * @module tests/scorm-runtime-labels
 *
 * PRD-49 debt closed by this file: the SCORM PACKAGE runtime used to hand the resolved
 * labels + sub-block order (`TEST_DATA.designSettings.labels` / `resultsBlockOrder` /
 * `templateBlockOrder`) to the shared context builder ONLY on the plain results screen
 * (`viewResults.js`'s `vrLabelOptions`/`vrApplyLabelOptions`). The adaptive results
 * screen (`adaptiveRender.js`) and the section-results screen (`mainRender.js`) built
 * their contexts with no `labels`/`blockOrder`/`templateBlockOrder` at all, so a package
 * built from a template with reworded headings printed the SHIPPED wording there instead
 * — a package/web drift for exactly the two screens `results` itself does not cover.
 *
 * This file checks the ONE thing that changed: do the three screens' render entry
 * points hand the resolved options to their SHARED builder (`window.TBTemplate.build*
 * ResultContext`), and does the ADAPTIVE screen take its OWN `templateBlockOrder`
 * entry (`results.adaptive`), never the standard screen's list (which carries a score
 * summary the adaptive layout has never had). It does not re-assert how the shared
 * builder turns those options into markup — that is `shared/template/result-context`'s
 * own test suite's job (`shared/template/__tests__/result-context.blocks.test.ts`).
 *
 * The runtime ships as hand-maintained flat JS (server/scorm/template/app/*), not as
 * importable modules, so — like `results-feedback-adaptive-scorm.test.ts` — the three
 * render files are concatenated and executed with injected globals, exactly as the
 * package's own build (`server/scorm/index.ts`) concatenates them into one `app.js`.
 * `window.TBTemplate.build*ResultContext` are `vi.fn()` stand-ins here: this file cares
 * about what REACHES the builder, not what the builder returns.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

const src = (rel: string) => fs.readFileSync(path.resolve(process.cwd(), rel), "utf8");
const viewResultsSrc = src("server/scorm/template/app/render/viewResults.js");
const adaptiveRenderSrc = src("server/scorm/template/app/render/adaptiveRender.js");
const mainRenderSrc = src("server/scorm/template/app/render/mainRender.js");

interface Runtime {
  renderResultsTemplated: (app: HTMLElement, results: unknown) => void;
  renderAdaptiveResultsTemplated: (app: HTMLElement, result: unknown) => void;
  renderSectionResults: (topicId: string, isLast: boolean) => void;
}

interface Mocks {
  buildResultContext: ReturnType<typeof vi.fn>;
  buildAdaptiveResultContext: ReturnType<typeof vi.fn>;
  buildSectionResultContext: ReturnType<typeof vi.fn>;
  renderScreenInto: ReturnType<typeof vi.fn>;
}

/**
 * Assembles the runtime the same way `server/scorm/index.ts` concatenates the package's
 * `app.js` — `viewResults.js` first (it defines `vrLabelOptions`/`vrApplyLabelOptions`,
 * PRD-49's single reader of `designSettings`), then `adaptiveRender.js`, then
 * `mainRender.js` (real order: results(464) < adaptive(472) < main(475) in `index.ts`).
 * Plain top-level `function` declarations hoist across the WHOLE concatenated script
 * regardless of that order, exactly as they do in the shipped bundle.
 */
function makeRuntime(testData: Record<string, unknown>) {
  document.body.innerHTML = '<div id="app"></div>';
  const app = document.getElementById("app") as HTMLElement;

  const mocks: Mocks = {
    buildResultContext: vi.fn(() => ({ course: { title: "" }, result: {} })),
    buildAdaptiveResultContext: vi.fn(() => ({ course: { title: "" }, result: {} })),
    buildSectionResultContext: vi.fn(() => ({
      course: {},
      sectionResult: {},
      labels: { section: { eyebrow: "Итоги раздела" } },
    })),
    renderScreenInto: vi.fn(),
  };

  (window as unknown as { TBTemplate: unknown }).TBTemplate = {
    renderScreenInto: mocks.renderScreenInto,
    buildResultContext: mocks.buildResultContext,
    buildAdaptiveResultContext: mocks.buildAdaptiveResultContext,
    buildSectionResultContext: mocks.buildSectionResultContext,
    buildResultsNav: vi.fn(() => ({})),
  };

  const state = { templateLayouts: { results: "<div></div>", "results.adaptive": "<div></div>", "section-results": "<div></div>" } };

  const factory = new Function(
    "TEST_DATA",
    "state",
    "buildScormProtection",
    "hasAttemptsLeft",
    "computeSectionResult",
    `${viewResultsSrc}\n${adaptiveRenderSrc}\n${mainRenderSrc}\nreturn {
      renderResultsTemplated: renderResultsTemplated,
      renderAdaptiveResultsTemplated: renderAdaptiveResultsTemplated,
      renderSectionResults: renderSectionResults
    };`,
  );

  const rt = factory(
    testData,
    state,
    () => ({}), // buildScormProtection
    () => true, // hasAttemptsLeft
    (topicId: string) => ({ topicId, topicName: "Раздел", correct: 1, total: 2, percent: 50, passed: null }),
  ) as Runtime;

  return { rt, app, mocks };
}

/** `designSettings` a package with PRD-49 wording resolved would carry. */
const DESIGN_SETTINGS = {
  labels: { "results.scales": "По шкалам", "recommendations.assets": "Материалы" },
  resultsBlockOrder: ["topics", "scales", "indicators"],
  templateBlockOrder: {
    results: ["summary", "topics", "scales", "indicators"],
    // Deliberately a DIFFERENT, shorter list — no `summary`, ordered differently —
    // exactly what the manifest declares for the screen that never had a score ring.
    "results.adaptive": ["topics", "indicators", "scales"],
  },
};

const EMPTY_RESULT_INPUT = {
  passed: true,
  percent: 80,
  totalQuestions: 2,
  totalCorrect: 2,
  earnedPoints: 2,
  possiblePoints: 2,
  topicResults: [],
};

describe("PRD-49 SCORM runtime — labels reach every results screen's builder", () => {
  it("results: labels + resultsBlockOrder + templateBlockOrder['results'] reach buildResultContext", () => {
    const { rt, mocks, app } = makeRuntime({ title: "Тест", designSettings: DESIGN_SETTINGS });
    rt.renderResultsTemplated(app, EMPTY_RESULT_INPUT);

    expect(mocks.buildResultContext).toHaveBeenCalledTimes(1);
    const opts = mocks.buildResultContext.mock.calls[0][2];
    expect(opts.labels).toBe(DESIGN_SETTINGS.labels);
    expect(opts.blockOrder).toBe(DESIGN_SETTINGS.resultsBlockOrder);
    expect(opts.templateBlockOrder).toBe(DESIGN_SETTINGS.templateBlockOrder.results);
  });

  it("results.adaptive: takes its OWN templateBlockOrder entry, not the standard screen's list", () => {
    const { rt, mocks, app } = makeRuntime({ title: "Тест", designSettings: DESIGN_SETTINGS });
    rt.renderAdaptiveResultsTemplated(app, { overallPassed: true, topicResults: [] });

    expect(mocks.buildAdaptiveResultContext).toHaveBeenCalledTimes(1);
    const opts = mocks.buildAdaptiveResultContext.mock.calls[0][2];
    expect(opts.labels).toBe(DESIGN_SETTINGS.labels);
    expect(opts.blockOrder).toBe(DESIGN_SETTINGS.resultsBlockOrder);
    // The load-bearing assertion: the adaptive screen's OWN list, and specifically
    // NOT the standard screen's (which carries `summary`, a block this screen has
    // never rendered — passing the wrong list would be the exact regression PRD-49
    // must not reintroduce).
    expect(opts.templateBlockOrder).toBe(DESIGN_SETTINGS.templateBlockOrder["results.adaptive"]);
    expect(opts.templateBlockOrder).not.toBe(DESIGN_SETTINGS.templateBlockOrder.results);
    expect(opts.templateBlockOrder).not.toContain("summary");
  });

  it("section-results: only labels reach buildSectionResultContext (no sub-block order for this screen)", () => {
    const { rt, mocks, app } = makeRuntime({
      title: "Тест",
      sections: [{ topicId: "t1" }],
      designSettings: DESIGN_SETTINGS,
    });
    rt.renderSectionResults("t1", false);

    expect(mocks.buildSectionResultContext).toHaveBeenCalledTimes(1);
    const [, opts] = mocks.buildSectionResultContext.mock.calls[0];
    expect(opts.labels).toBe(DESIGN_SETTINGS.labels);
    // `templateBlockOrder['section-results']` is never baked (build-export-data.ts
    // resolves order for `results`/`results.adaptive` only) — the section screen has
    // no sub-blocks to order, so `vrLabelOptions` leaves the key off entirely.
    expect(opts.templateBlockOrder).toBeUndefined();
    expect(opts.blockOrder).toBe(DESIGN_SETTINGS.resultsBlockOrder);
  });

  it("section-results: the resolved labels tree the builder returns reaches the mounted context", () => {
    const { rt, mocks, app } = makeRuntime({
      title: "Тест",
      sections: [{ topicId: "t1" }],
      designSettings: DESIGN_SETTINGS,
    });
    rt.renderSectionResults("t1", false);

    expect(mocks.renderScreenInto).toHaveBeenCalledTimes(1);
    const mountArgs = mocks.renderScreenInto.mock.calls[0][1];
    expect(mountArgs.context.labels).toEqual({ section: { eyebrow: "Итоги раздела" } });
  });

  it("a package built before PRD-49 (no designSettings) sends no labels/order to any of the three builders", () => {
    const { rt, mocks, app } = makeRuntime({ title: "Тест", sections: [{ topicId: "t1" }] });

    rt.renderResultsTemplated(app, EMPTY_RESULT_INPUT);
    const resultsOpts = mocks.buildResultContext.mock.calls[0][2];
    expect(resultsOpts.labels).toBeUndefined();
    expect(resultsOpts.blockOrder).toBeUndefined();
    expect(resultsOpts.templateBlockOrder).toBeUndefined();

    rt.renderAdaptiveResultsTemplated(app, { overallPassed: true, topicResults: [] });
    const adaptiveOpts = mocks.buildAdaptiveResultContext.mock.calls[0][2];
    expect(adaptiveOpts.labels).toBeUndefined();
    expect(adaptiveOpts.blockOrder).toBeUndefined();
    expect(adaptiveOpts.templateBlockOrder).toBeUndefined();

    rt.renderSectionResults("t1", false);
    const [, sectionOpts] = mocks.buildSectionResultContext.mock.calls[0];
    expect(sectionOpts.labels).toBeUndefined();
    expect(sectionOpts.blockOrder).toBeUndefined();
    expect(sectionOpts.templateBlockOrder).toBeUndefined();
  });
});
