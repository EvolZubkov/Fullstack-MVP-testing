/**
 * @module tests/measure-slots-wiring
 *
 * PRD-49 §6: the card's name/level slot toggles (`config_json.showName` /
 * `config_json.showLevel` on a scale or a result variable) are set by the editor and
 * understood by the shared card builder (`shared/template/measure-view.buildMeasureView`),
 * but nobody carried them from the DB row into the shared input. This test closes that
 * gap for the web host: `server/services/result-context.buildMeasuresInput` must read the
 * two keys off `configJson` with the same "absent key = show" rule the shared builder
 * already documents, and the toggle must be visible all the way through
 * `buildResultContext`, where each measure is turned into a card view.
 */

import { describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { buildMeasuresInput, buildResultContext } from "../server/services/result-context";
import { buildTestJson } from "../server/scorm/builders/test-json";
import type { AttemptResult, ResultVariable, Scale } from "../shared/schema";

const ATTEMPT: AttemptResult = {
  totalCorrect: 0,
  totalQuestions: 10,
  overallPercent: 0,
  totalEarnedPoints: 0,
  totalPossiblePoints: 0,
  overallPassed: false,
  topicResults: [],
};

function scaleRow(over: Partial<Scale>): Scale {
  return {
    key: "ee",
    label: "Эмоциональное истощение",
    learnerVisibility: "level_and_value",
    sortOrder: 0,
    configJson: {
      domainMin: 0,
      domainMax: 45,
      valence: "lower_is_better",
      bands: [
        { min: 0, max: 14, level: "low", label: "Низкий" },
        { min: 15, max: 45, level: "high", label: "Высокий" },
      ],
    },
    ...over,
  } as Scale;
}

function variableRow(over: Partial<ResultVariable>): ResultVariable {
  return {
    name: "burnout_level",
    label: "Состояние",
    learnerVisibility: "level",
    sortOrder: 0,
    configJson: { outcomes: [{ code: "growing", label: "Возрастающее истощение" }] },
    ...over,
  } as ResultVariable;
}

const SOURCE = {
  scales: [scaleRow({})],
  variables: [variableRow({})],
  scaleResults: { ee: { raw: 27, normalized: 27, percent: 60, level: "high", label: "Высокий", hasValue: true } },
  variableValues: { burnout_level: "growing" },
  params: {},
  blockSettings: {},
  hasPassThreshold: false,
};

describe("buildMeasuresInput кладёт тумблеры слотов", () => {
  it("отсутствие ключей в config_json даёт показ обоих слотов", () => {
    const input = buildMeasuresInput(SOURCE);
    expect(input.scales[0].showName).toBe(true);
    expect(input.scales[0].showLevel).toBe(true);
    expect(input.indicators[0].showName).toBe(true);
    expect(input.indicators[0].showLevel).toBe(true);
  });

  it("showName: false в config_json шкалы доезжает до входа как showName: false", () => {
    const input = buildMeasuresInput({
      ...SOURCE,
      scales: [scaleRow({ configJson: { ...scaleRow({}).configJson, showName: false } })],
    });
    expect(input.scales[0].showName).toBe(false);
    expect(input.scales[0].showLevel).toBe(true);
  });

  it("showLevel: false в config_json переменной результата доезжает до входа как showLevel: false", () => {
    const input = buildMeasuresInput({
      ...SOURCE,
      variables: [variableRow({ configJson: { ...variableRow({}).configJson, showLevel: false } })],
    });
    expect(input.indicators[0].showLevel).toBe(false);
    expect(input.indicators[0].showName).toBe(true);
  });

  it("значение, отличное от false (например, отсутствующий config_json), тоже читается как показ", () => {
    const input = buildMeasuresInput({
      ...SOURCE,
      scales: [scaleRow({ configJson: undefined as unknown as Record<string, unknown> })],
    });
    expect(input.scales[0].showName).toBe(true);
    expect(input.scales[0].showLevel).toBe(true);
  });
});

describe("тумблер доезжает до вида карточки через buildResultContext", () => {
  it("showName: false на шкале гасит показ названия в собранном контексте (hideName: true)", () => {
    const ctx = buildResultContext(ATTEMPT, "Маслач", {
      ...SOURCE,
      scales: [scaleRow({ configJson: { ...scaleRow({}).configJson, showName: false } })],
    });
    expect(ctx.result.scales![0].hideName).toBe(true);
    expect(ctx.result.scales![0].hideLevel).toBeUndefined();
    // The data itself is untouched — only the show flag flips.
    expect(ctx.result.scales![0].name).toBe("Эмоциональное истощение");
  });

  it("showLevel: false на переменной результата гасит показ уровня (hideLevel: true), не трогая метку в данных", () => {
    const ctx = buildResultContext(ATTEMPT, "Маслач", {
      ...SOURCE,
      variables: [variableRow({ configJson: { ...variableRow({}).configJson, showLevel: false } })],
    });
    expect(ctx.result.indicators![0].hideLevel).toBe(true);
    expect(ctx.result.indicators![0].hideName).toBeUndefined();
    expect(ctx.result.indicators![0].levelLabel).toBe("Возрастающее истощение");
  });

  it("не тронутые тумблеры не гасят ничего (обратная совместимость со старыми тестами)", () => {
    const ctx = buildResultContext(ATTEMPT, "Маслач", SOURCE);
    expect(ctx.result.scales![0].hideName).toBeUndefined();
    expect(ctx.result.scales![0].hideLevel).toBeUndefined();
    expect(ctx.result.indicators![0].hideName).toBeUndefined();
    expect(ctx.result.indicators![0].hideLevel).toBeUndefined();
  });
});

/**
 * PRD-49 §6, SCORM tail: the toggle worked for indicators (result variables) from the
 * start, because their WHOLE `config_json` already travels raw into `test.json`
 * (`server/scorm/builders/test-json.ts`, `resultVariables.map`). Scales did not — the bake
 * only spread the PARSED interpretation, never the raw config, so `showName`/`showLevel`
 * never reached the package for a scale: the same author setting worked on the web and was
 * silently ignored in the LMS. Closed by baking the two RESOLVED booleans onto `test.scales`
 * (never the raw `config_json` — the package must not leak the author's config object) and
 * reading them back in `viewResults.js` off the scale row itself.
 */
describe("выпечка переносит тумблеры шкалы в test.json, и рантайм их читает", () => {
  const bakedTest: any = {
    id: "test-49-slots",
    title: "Опросник",
    description: null,
    mode: "standard",
    overallPassRuleJson: { type: "percent", value: 70 },
    webhookUrl: null,
    feedback: null,
    timeLimitMinutes: null,
    maxAttempts: null,
    showCorrectAnswers: false,
    startPageContent: null,
    showDifficultyLevel: false,
  };

  const bakedSection: any = {
    id: "s1", testId: "test-49-slots", topicId: "t1",
    topic: { id: "t1", name: "Стили", feedback: null },
    questions: [], courses: [], events: [], drawCount: 0, topicPassRuleJson: null,
  };

  function bakedScaleRow(configJson: Record<string, unknown>): any {
    return {
      id: "sc1", testId: "test-49-slots", key: "ee", label: "Эмоциональное истощение",
      type: "number", aggregation: "sum", normalization: "none", direction: "positive",
      configJson: {
        domainMin: 0, domainMax: 45, valence: "lower_is_better",
        bands: [{ min: 0, max: 45, level: "any" }],
        ...configJson,
      },
      learnerVisibility: "level_and_value", scormTarget: "none", sortOrder: 0,
    };
  }

  /** `buildTestJson` returns `var TEST_DATA = { … };` — parse out the object literal. */
  function parseBaked(json: string): Record<string, any> {
    const start = json.indexOf("{");
    const end = json.lastIndexOf("}");
    return JSON.parse(json.slice(start, end + 1));
  }

  it("шкала с showName: false в config_json выпекается с showName: false, showLevel остаётся true", () => {
    const out = parseBaked(
      buildTestJson({
        test: bakedTest,
        sections: [bakedSection],
        scales: [bakedScaleRow({ showName: false })],
      }),
    );
    expect(out.scales[0].showName).toBe(false);
    expect(out.scales[0].showLevel).toBe(true);
    // The package carries the RESOLVED booleans, not a leak of the author's raw config object.
    expect(out.scales[0].configJson).toBeUndefined();
  });

  it("шкала без ключей в config_json выпекается с показом обоих слотов (прежние пакеты не меняются)", () => {
    const out = parseBaked(
      buildTestJson({ test: bakedTest, sections: [bakedSection], scales: [bakedScaleRow({})] }),
    );
    expect(out.scales[0].showName).toBe(true);
    expect(out.scales[0].showLevel).toBe(true);
  });

  /**
   * Runtime half: `viewResults.js` ships as hand-maintained flat ES5 (not an importable
   * module), so — exactly as `tests/scorm-runtime-labels.test.ts` does for the labels
   * wiring — the source is loaded and executed with an injected `TEST_DATA` (the OUTPUT
   * of `buildTestJson` above) and a mocked `window.TBTemplate`. This checks what REACHES
   * `buildResultContext`'s `measures` option, not how the shared builder turns it into a
   * card — that is `shared/template/__tests__/measure-view.test.ts`'s job.
   */
  function makeRuntime(testData: Record<string, unknown>) {
    document.body.innerHTML = '<div id="app"></div>';
    const app = document.getElementById("app") as HTMLElement;

    const buildResultContext = vi.fn(() => ({ course: { title: "" }, result: {} }));
    (window as unknown as { TBTemplate: unknown }).TBTemplate = {
      renderScreenInto: vi.fn(),
      buildResultContext,
      buildResultsNav: vi.fn(() => ({})),
      parseScaleInterpretation: vi.fn((s: Record<string, unknown>) => ({
        domainMin: s.domainMin, domainMax: s.domainMax, valence: s.valence, bands: s.bands ?? [],
      })),
      parseIndicatorInterpretation: vi.fn(() => ({ outcomes: [] })),
      // `resultsLevelRamp` reads the named scheme straight off this table.
      LEVEL_SCHEMES: { traffic: { favorable: "1", mid: "2", unfavorable: "3" }, neutral: { favorable: "1", mid: null, unfavorable: "1" } },
    };

    const src = fs.readFileSync(
      path.resolve(process.cwd(), "server/scorm/template/app/render/viewResults.js"),
      "utf8",
    );
    const factory = new Function(
      "TEST_DATA",
      "state",
      "buildScormProtection",
      "hasAttemptsLeft",
      `${src}\nreturn { renderResultsTemplated: renderResultsTemplated };`,
    );
    const rt = factory(testData, { templateLayouts: { results: "<div></div>" } }, () => ({}), () => true) as {
      renderResultsTemplated: (app: HTMLElement, results: unknown) => void;
    };
    return { rt, app, buildResultContext };
  }

  const RESULT_INPUT = {
    passed: true, percent: 60, totalQuestions: 4, totalCorrect: 2, earnedPoints: 2, possiblePoints: 4,
    topicResults: [],
    // `currentAttemptMeasures` reads `scaleComputation` straight off the results object
    // when present, bypassing `computeTestScales()` — exactly what a saved-attempt replay does.
    scaleComputation: { values: { ee: { raw: 27 } } },
  };

  it("тумблер шкалы доезжает от выпеченного test.json до входа общего построителя контекста", () => {
    const baked = parseBaked(
      buildTestJson({
        test: bakedTest,
        sections: [bakedSection],
        scales: [bakedScaleRow({ showName: false })],
      }),
    );
    const { rt, app, buildResultContext } = makeRuntime({ title: "Тест", scales: baked.scales });
    rt.renderResultsTemplated(app, RESULT_INPUT);

    expect(buildResultContext).toHaveBeenCalledTimes(1);
    const opts = buildResultContext.mock.calls[0][2] as { measures?: { scales: Array<{ showName: boolean; showLevel: boolean }> } };
    expect(opts.measures?.scales[0].showName).toBe(false);
    expect(opts.measures?.scales[0].showLevel).toBe(true);
  });

  it("шкала, выпеченная без тумблеров, доезжает до входа с показом обоих слотов", () => {
    const baked = parseBaked(
      buildTestJson({ test: bakedTest, sections: [bakedSection], scales: [bakedScaleRow({})] }),
    );
    const { rt, app, buildResultContext } = makeRuntime({ title: "Тест", scales: baked.scales });
    rt.renderResultsTemplated(app, RESULT_INPUT);

    const opts = buildResultContext.mock.calls[0][2] as { measures?: { scales: Array<{ showName: boolean; showLevel: boolean }> } };
    expect(opts.measures?.scales[0].showName).toBe(true);
    expect(opts.measures?.scales[0].showLevel).toBe(true);
  });
});
