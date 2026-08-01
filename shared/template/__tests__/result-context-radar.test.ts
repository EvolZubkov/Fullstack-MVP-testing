import { describe, expect, it } from "vitest";
import { buildResultContext } from "../result-context";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { ScaleInterpretation } from "../../scales/interpretation";

const BASE = {
  passed: false,
  percent: 0,
  totalQuestions: 22,
  correct: 0,
  earnedPoints: 0,
  possiblePoints: 0,
  topicResults: [],
};

/** Шкала с доменом 0..max и интервалами, начинающимися в указанных точках. */
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
      { key: "a", name: "A", value: 40, visibility: "level_and_value" as const, interpretation: scale(45, [0, 15, 25]) },
      { key: "b", name: "B", value: 3, visibility: "level_and_value" as const, interpretation: scale(25, [0, 5, 10]) },
      { key: "c", name: "C", value: 20, visibility: "level_and_value" as const, interpretation: scale(40, [0, 28, 33]) },
    ],
  };
}

describe("result.scalesChart", () => {
  it("отсутствует, пока переключатель выключен", () => {
    const ctx = buildResultContext(BASE, "Тест", { measures: measures(false) });
    expect(ctx.result.scalesChart).toBeUndefined();
    expect(ctx.result.scalesBlockClass).toBe("tb-measures");
  });

  it("появляется при включённом переключателе и трёх видимых шкалах", () => {
    const ctx = buildResultContext(BASE, "Тест", { measures: measures(true) });
    expect(ctx.result.scalesChart?.axes).toHaveLength(3);
    expect(ctx.result.scalesChart?.polygonPoints.split(" ")).toHaveLength(3);
    expect(ctx.result.scalesBlockClass).toBe("tb-measures tb-measures--chart");
  });

  it("не появляется при двух видимых шкалах, но карточки остаются", () => {
    const two = measures(true);
    two.scales = two.scales.slice(0, 2);
    const ctx = buildResultContext(BASE, "Тест", { measures: two });
    expect(ctx.result.scalesChart).toBeUndefined();
    expect(ctx.result.scalesBlockClass).toBe("tb-measures");
    expect(ctx.result.scales).toHaveLength(2);
  });

  it("отсутствует, когда блок шкал скрыт настройкой", () => {
    const ctx = buildResultContext(BASE, "Тест", {
      measures: { ...measures(true), blockSettings: { scales: "hide" } },
    });
    expect(ctx.result.scalesChart).toBeUndefined();
    expect(ctx.result.scales).toBeUndefined();
  });

  it("не заводит полей у теста без измерений", () => {
    const ctx = buildResultContext(BASE, "Тест");
    expect(ctx.result.scalesChart).toBeUndefined();
    expect(ctx.result.scalesBlockClass).toBeUndefined();
  });
});
