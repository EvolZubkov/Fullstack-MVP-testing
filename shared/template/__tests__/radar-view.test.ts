import { describe, expect, it } from "vitest";
import { buildRadarChart, type RadarAxisInput } from "../radar-view";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { ScaleInterpretation } from "../../scales/interpretation";

const ramp = LEVEL_SCHEMES.traffic;

/** Шкала с домеными 0..max и интервалами, начинающимися в указанных точках. */
function scale(
  domainMax: number,
  bandsAt: number[],
  valence: ScaleInterpretation["valence"] = "higher_is_better",
): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax,
    valence,
    bands: bandsAt.map((min, i) => ({
      min,
      max: i + 1 < bandsAt.length ? bandsAt[i + 1] : domainMax,
      level: `l${i}`,
      label: `Уровень ${i}`,
    })),
  };
}

function axis(key: string, value: number, interpretation: ScaleInterpretation): RadarAxisInput {
  return { key, name: key, value, visibility: "level_and_value", interpretation };
}

describe("buildRadarChart", () => {
  it("строит три оси, первая — сверху", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 45, scale(45, [0, 15, 25])),
        axis("b", 0, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    expect(chart).not.toBeNull();
    expect(chart!.axes).toHaveLength(3);
    const top = chart!.axes[0];
    expect(top.x).toBeCloseTo(top.cx, 1);
    expect(top.y).toBeLessThan(top.cy);
    expect(top.y).toBeCloseTo(top.axisY, 1);
    expect(top.radiusPercent).toBe(100);
    expect(chart!.axes[1].radiusPercent).toBe(0);
    expect(chart!.rings).toHaveLength(4);
    expect(chart!.rings[0].cx).toBe(top.cx);
  });

  it("не печатает числовых значений: подпись — название и уровень", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 40, scale(45, [0, 15, 25])),
        axis("b", 3, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    const strings = Object.values(chart!.axes[0]).filter((v) => typeof v === "string");
    expect(chart!.axes[0].levelText).toBe("Уровень 2");
    expect(strings.some((v) => (v as string).includes("из"))).toBe(false);
  });

  it("возвращает null при менее чем трёх видимых шкалах", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [axis("a", 10, scale(45, [0, 15, 25])), axis("b", 3, scale(25, [0, 5, 10]))],
    });
    expect(chart).toBeNull();
  });

  it("исключает скрытые шкалы и падает до null, когда видимых осталось меньше трёх", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        { ...axis("a", 10, scale(45, [0, 15, 25])), visibility: "hidden" },
        axis("b", 3, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    expect(chart).toBeNull();
  });

  it("квантует луч по середине зоны при видимости level", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        { ...axis("a", 16, scale(40, [0, 10, 20, 30])), visibility: "level" },
        axis("b", 3, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    // Зона 10..20 из домена 0..40 — середина 15, то есть 37.5 % радиуса.
    expect(chart!.axes[0].radiusPercent).toBe(37.5);
    expect(chart!.axes[0].quantizedClass).toBe("tb-radar__dot--quantized");
    expect(chart!.axes[1].quantizedClass).toBe("");
  });

  it("не рисует радар, когда у видимой шкалы нет ни домена, ни интервалов", () => {
    const noDomain: ScaleInterpretation = {
      domainMin: null,
      domainMax: null,
      valence: "none",
      bands: [],
    };
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 10, noDomain),
        axis("b", 3, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    expect(chart).toBeNull();
  });

  it("красит ось обратной шкалы с другого конца рампы", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("up", 40, scale(40, [0, 28, 33], "higher_is_better")),
        axis("down", 40, scale(40, [0, 28, 33], "lower_is_better")),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    expect(chart!.axes[0].color).not.toBe(chart!.axes[1].color);
    expect(chart!.axes[0].tone).toBe("favorable");
    expect(chart!.axes[1].tone).toBe("critical");
  });

  it("отдаёт строку polygonPoints по числу осей", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 45, scale(45, [0, 15, 25])),
        axis("b", 5, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    expect(chart!.polygonPoints.split(" ")).toHaveLength(3);
    expect(chart!.polygonPoints).toMatch(/^[\d.,\s-]+$/);
  });
});
