/**
 * @module tests/result-context-measures-source
 *
 * PRD-29: the web host's adapter from DB rows + computed values to the shared
 * `MeasuresInput` (server/services/result-context.buildMeasuresInput), and the
 * guard that keeps a test WITHOUT scales and indicators byte-identical.
 */

import { describe, it, expect } from "vitest";
import { buildMeasuresInput, buildResultContext } from "../server/services/result-context";
import { LEVEL_SCHEMES } from "../shared/template/level-ramp";
import type { AttemptResult, ResultVariable, Scale } from "../shared/schema";

const ATTEMPT: AttemptResult = {
  totalCorrect: 0,
  totalQuestions: 22,
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

describe("buildMeasuresInput", () => {
  it("берёт значение шкалы, подпись и видимость из строк", () => {
    const input = buildMeasuresInput(SOURCE);
    expect(input.scales).toEqual([
      expect.objectContaining({ key: "ee", name: "Эмоциональное истощение", value: 27, visibility: "level_and_value" }),
    ]);
    expect(input.indicators).toEqual([
      expect.objectContaining({ key: "burnout_level", name: "Состояние", value: "growing", visibility: "level" }),
    ]);
  });

  it("подставляет ключ и имя, когда подписи пустые", () => {
    const input = buildMeasuresInput({
      ...SOURCE,
      scales: [scaleRow({ label: "" })],
      variables: [variableRow({ label: "" })],
    });
    expect(input.scales[0].name).toBe("ee");
    expect(input.indicators[0].name).toBe("burnout_level");
  });

  it("сортирует по порядку следования, а не по порядку строк", () => {
    const input = buildMeasuresInput({
      ...SOURCE,
      scales: [scaleRow({ key: "b", sortOrder: 2 }), scaleRow({ key: "a", sortOrder: 1 })],
    });
    expect(input.scales.map((s) => s.key)).toEqual(["a", "b"]);
  });

  it("шкала без вычисленного значения приходит с null", () => {
    const input = buildMeasuresInput({ ...SOURCE, scaleResults: {} });
    expect(input.scales[0].value).toBeNull();
  });

  it("берёт виды рендера из параметров дизайна, иначе значения по умолчанию", () => {
    expect(buildMeasuresInput(SOURCE).scaleKind).toBe("band_ruler");
    expect(buildMeasuresInput(SOURCE).indicatorKind).toBe("label");
    const chosen = buildMeasuresInput({
      ...SOURCE,
      params: { scaleRenderKind: "ring", indicatorRenderKind: "value" },
    });
    expect(chosen.scaleKind).toBe("ring");
    expect(chosen.indicatorKind).toBe("value");
  });

  it("именованная схема уровней берётся целиком", () => {
    expect(buildMeasuresInput(SOURCE).ramp).toEqual(LEVEL_SCHEMES.traffic);
    expect(buildMeasuresInput({ ...SOURCE, params: { levelScheme: "neutral" } }).ramp).toEqual(LEVEL_SCHEMES.neutral);
  });

  it("своя схема берёт цвета автора, пропуски — от светофорной", () => {
    const ramp = buildMeasuresInput({
      ...SOURCE,
      params: { levelScheme: "custom", levelColorFavorable: "200 50% 50%", levelColorMid: "100 50% 50%" },
    }).ramp;
    expect(ramp).toEqual({
      favorable: "200 50% 50%",
      mid: "100 50% 50%",
      unfavorable: LEVEL_SCHEMES.traffic.unfavorable,
    });
  });

  it("своя схема без середины оставляет её пустой", () => {
    expect(buildMeasuresInput({ ...SOURCE, params: { levelScheme: "custom" } }).ramp.mid).toBeNull();
  });
});

describe("buildResultContext + measures", () => {
  it("не трогает контекст, когда у теста нет ни шкал, ни показателей", () => {
    const ctx = buildResultContext(ATTEMPT, "Контрольный", {
      ...SOURCE,
      scales: [],
      variables: [],
    });
    expect(ctx.result.scales).toBeUndefined();
    expect(ctx.result.indicators).toBeUndefined();
    expect(ctx.result.showScoreSummary).toBeUndefined();
  });

  it("кладёт измерения, когда шкалы у теста есть", () => {
    const ctx = buildResultContext(ATTEMPT, "Маслач", SOURCE);
    expect(ctx.result.scales).toHaveLength(1);
    expect(ctx.result.scales![0].levelLabel).toBe("Высокий");
    expect(ctx.result.indicators![0].levelLabel).toBe("Возрастающее истощение");
  });
});
