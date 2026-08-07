import { describe, expect, it } from "vitest";
import { buildRoseChart } from "../rose-view";
import { type RadarAxisInput } from "../radar-view";
import { LEVEL_SCHEMES, zoneColors } from "../level-ramp";
import { CATEGORICAL_HUES } from "../categorical-palette";
import { round1 } from "../chart-frame";
import type { LearnerVisibility, ScaleInterpretation } from "../../scales/interpretation";

const ramp = LEVEL_SCHEMES.traffic;

/** Шкала типологии: домен 0..98, направления нет, три уровня. */
function styleScale(): ScaleInterpretation {
  return {
    domainMin: 0,
    domainMax: 98,
    valence: "none",
    bands: [
      { min: 0, max: 20, level: "low", label: "Слабо выражен" },
      { min: 20, max: 40, level: "mid", label: "Выражен" },
      { min: 40, max: 98, level: "high", label: "Доминирующий" },
    ],
  };
}

function axis(name: string, value: number, visibility: LearnerVisibility = "level_and_value"): RadarAxisInput {
  return { key: name, name, value, visibility, interpretation: styleScale() };
}

/** Контрольная выкладка ЧИЛ: 34 / 16 / 14 / 34, сумма 98 (PRD-44 A-02). */
const CHIL = [
  axis("Целеустремленный", 34),
  axis("Вдохновляющий", 16),
  axis("Командный", 14),
  axis("Процессный", 34),
];

describe("buildRoseChart", () => {
  it("считает радиус как корень доли от суммы — контрольные числа ЧИЛ", () => {
    const chart = buildRoseChart({ axes: CHIL, ramp });
    expect(chart).not.toBeNull();
    expect(chart!.sectors.map((s) => s.radius)).toEqual([58.9, 40.4, 37.8, 58.9]);
    expect(chart!.sectors.map((s) => s.sharePercent)).toEqual([34.7, 16.3, 14.3, 34.7]);
  });

  it("держит кольца сетки по равным долям целого", () => {
    expect(buildRoseChart({ axes: CHIL, ramp })!.rings.map((r) => r.radius)).toEqual([50, 70.7, 86.6, 100]);
  });

  it("чертит оси по границам секторов и выпускает концы за внешнее кольцо", () => {
    const chart = buildRoseChart({ axes: CHIL, ramp })!;
    expect(chart.spokes.map((s) => [s.x, s.y])).toEqual([
      [180, 44],
      [286, 150],
      [180, 256],
      [74, 150],
    ]);
    expect(chart.spokes[0].cx).toBe(180);
    expect(chart.spokes[0].cy).toBe(150);
  });

  it("выносит подписи за внешнее кольцо, а не внутрь сетки", () => {
    // Кольца доходят до края поля, поэтому кольцо подписей — 100 + 30. Внутри сетки
    // внешняя окружность прошла бы прямо через строки подписей.
    const chart = buildRoseChart({ axes: CHIL, ramp })!;
    const top = chart.labels.find((l) => l.text === "Целеустремленный")!;
    expect(top.x).toBe(round1(180 + Math.cos(-Math.PI / 4) * 130));
  });

  it("не выпускает сектор за поле даже когда одна шкала забрала всё", () => {
    const skewed = [axis("a", 98), axis("b", 0), axis("c", 0)];
    const chart = buildRoseChart({ axes: skewed, ramp })!;
    expect(chart.sectors[0].radius).toBe(100);
    expect(chart.sectors[1].radius).toBe(0);
  });

  it("режет круг на равные секторы, первый — сверху, дальше по часовой", () => {
    const chart = buildRoseChart({ axes: CHIL, ramp })!;
    expect(chart.sectors[0].d).toBe("M 180,150 L 180,91.1 A 58.9,58.9 0 0,1 238.9,150 Z");
  });

  it("ставит пиктограмму шкалы над подписью и сдвигает текст на строку", () => {
    const withIcon = CHIL.map((a, i) => (i === 0 ? { ...a, iconPaths: ["M0 0h24"] } : a));
    const chart = buildRoseChart({ axes: withIcon, ramp })!;
    expect(chart.icons).toHaveLength(1);
    expect(chart.icons[0].paths).toEqual(["M0 0h24"]);
    // Блок вырос на строку, поэтому над кругом он поднимается выше, а имя уезжает под иконку.
    expect(chart.icons[0].transform).toBe("translate(263.9, 12.1) scale(0.667)");
    expect(chart.labels.find((l) => l.text === "Целеустремленный")!.y).toBe(43.1);
  });

  it("не заводит пиктограмм, когда шкалы их не объявили", () => {
    expect(buildRoseChart({ axes: CHIL, ramp })!.icons).toEqual([]);
  });

  it("подписывает сектор названием шкалы и меткой уровня, без чисел", () => {
    const chart = buildRoseChart({ axes: CHIL, ramp })!;
    const texts = chart.labels.map((l) => l.text);
    expect(texts).toContain("Командный");
    expect(texts).toContain("Выражен");
    expect(texts.join(" ")).not.toMatch(/\d/);
  });

  it("отказывается строиться, когда сумма значений равна нулю", () => {
    expect(buildRoseChart({ axes: [axis("a", 0), axis("b", 0), axis("c", 0)], ramp })).toBeNull();
  });

  it("отказывается строиться меньше чем на трёх видимых шкалах", () => {
    expect(buildRoseChart({ axes: CHIL.slice(0, 2), ramp })).toBeNull();
  });

  it("строится на шести шкалах и отказывается на семи", () => {
    const six = Array.from({ length: 6 }, (_, i) => axis(`s${i}`, 10));
    expect(buildRoseChart({ axes: six, ramp })).not.toBeNull();
    expect(buildRoseChart({ axes: [...six, axis("s6", 10)], ramp })).toBeNull();
  });

  it("красит типологию по идентичности: свой оттенок каждой шкале", () => {
    const chart = buildRoseChart({ axes: CHIL, ramp })!;
    expect(chart.sectors.map((s) => s.color)).toEqual(CATEGORICAL_HUES.slice(0, 4));
  });

  it("красит по уровню, когда у шкалы объявлено направление", () => {
    const directed = ["a", "b", "c"].map((name) => ({
      ...axis(name, 90),
      interpretation: { ...styleScale(), valence: "higher_is_better" as const },
    }));
    const chart = buildRoseChart({ axes: directed, ramp })!;
    expect(chart.sectors[0].color).toBe(zoneColors(ramp, 3, "higher_is_better")[2]);
  });

  it("отказывается строиться, когда хотя бы у одной шкалы скрыт балл", () => {
    const hidden = [axis("a", 34), axis("b", 16, "level"), axis("c", 14)];
    expect(buildRoseChart({ axes: hidden, ramp })).toBeNull();
  });

  it("не берёт в расклад шкалы, скрытые от ученика", () => {
    const withHidden = [...CHIL, axis("Служебная", 50, "hidden")];
    const chart = buildRoseChart({ axes: withHidden, ramp })!;
    expect(chart.sectors).toHaveLength(4);
    expect(chart.sectors[0].sharePercent).toBe(34.7);
  });
});
