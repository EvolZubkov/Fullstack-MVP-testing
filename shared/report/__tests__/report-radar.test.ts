/**
 * PRD-35 §11: радар в отчёте.
 *
 * До этого отчёт не получал измерений вовсе — `buildReportContext` звал
 * `buildResultContext` без `measures`, поэтому ни шкал, ни диаграммы в PDF быть не
 * могло. Тест закрепляет проброс и то, что отчёт остаётся прежним, когда измерений
 * нет или переключатель выключен.
 */
import { describe, expect, it } from "vitest";
import { buildReportContext } from "../report-context";
import { LEVEL_SCHEMES } from "../../template/level-ramp";
import type { ScaleInterpretation } from "../../scales/interpretation";

function scale(domainMax: number, bandsAt: number[]): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax,
    valence: "higher_is_better",
    bands: bandsAt.map((min, i) => ({
      min,
      max: i + 1 < bandsAt.length ? bandsAt[i + 1] : domainMax,
      level: `l${i}`,
      label: `Уровень ${i}`,
    })),
  };
}

function measures(showRadar: boolean) {
  return {
    ramp: LEVEL_SCHEMES.traffic,
    scaleKind: "band_ruler" as const,
    indicatorKind: "label" as const,
    showRadar,
    indicators: [],
    scales: [
      { key: "a", name: "Эмоциональное истощение", value: 27, visibility: "level_and_value" as const, interpretation: scale(45, [0, 15, 25]) },
      { key: "b", name: "Отстранённость", value: 6, visibility: "level_and_value" as const, interpretation: scale(25, [0, 5, 10]) },
      { key: "c", name: "Обесценивание достижений", value: 30, visibility: "level_and_value" as const, interpretation: scale(40, [0, 28, 33]) },
    ],
  };
}

const INPUT = {
  testName: "Опросник",
  result: {
    passed: false,
    percent: 0,
    totalQuestions: 22,
    correct: 0,
    earnedPoints: 0,
    possiblePoints: 0,
    topicResults: [],
  },
};

describe("отчёт: радар", () => {
  it("получает диаграмму, когда измерения переданы и переключатель включён", () => {
    const ctx = buildReportContext(INPUT, { measures: measures(true) });
    expect(ctx.result.scalesChart?.axes).toHaveLength(3);
    expect(ctx.result.scales).toHaveLength(3);
  });

  it("со своим переключателем: измерения есть, диаграммы нет", () => {
    const ctx = buildReportContext(INPUT, { measures: measures(false) });
    expect(ctx.result.scalesChart).toBeUndefined();
    expect(ctx.result.scales).toHaveLength(3);
  });

  it("остаётся прежним, когда измерений нет", () => {
    const ctx = buildReportContext(INPUT);
    expect(ctx.result.scalesChart).toBeUndefined();
    expect(ctx.result.scales).toBeUndefined();
  });
});
