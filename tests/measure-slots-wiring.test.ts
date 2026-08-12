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

import { describe, it, expect } from "vitest";
import { buildMeasuresInput, buildResultContext } from "../server/services/result-context";
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
