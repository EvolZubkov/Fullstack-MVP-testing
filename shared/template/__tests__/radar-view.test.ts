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

  it("переносит длинное название по словам и ставит уровень последней строкой", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        { ...axis("a", 30, scale(40, [0, 28, 33])), name: "Обесценивание достижений" },
        axis("b", 3, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    const own = chart!.labels.filter((l) => l.x === chart!.labels[0].x);
    const names = chart!.labels.filter((l) => l.className === "tb-radar__label");
    expect(names.some((l) => l.text === "Обесценивание")).toBe(true);
    expect(names.some((l) => l.text === "достижений")).toBe(true);
    // Ни одна строка не длиннее мягкого предела, иначе подпись уедет за поле.
    expect(names.every((l) => l.text.length <= 16)).toBe(true);
    // Уровень идёт ПОСЛЕ строк названия того же луча.
    const level = own.find((l) => l.className === "tb-radar__level");
    expect(level).toBeDefined();
    expect(level!.y).toBeGreaterThan(Math.max(...own.filter((l) => l !== level).map((l) => l.y)));
  });

  it("держит верхнюю подпись выше кольца, растя вверх", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        { ...axis("a", 20, scale(45, [0, 15, 25])), name: "Эмоциональное истощение" },
        axis("b", 3, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    const top = chart!.axes[0];
    const topLabels = chart!.labels.filter((l) => l.x === top.cx);
    expect(topLabels.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...topLabels.map((l) => l.y))).toBeLessThan(top.axisY);
  });

  it("держит все подписи внутри поля виджета", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        { ...axis("a", 20, scale(45, [0, 15, 25])), name: "Ответственность за результат команды" },
        { ...axis("b", 3, scale(25, [0, 5, 10])), name: "Ориентация на внутреннего заказчика" },
        { ...axis("c", 20, scale(40, [0, 28, 33])), name: "Системное мышление" },
      ],
    });
    for (const label of chart!.labels) {
      expect(label.y).toBeGreaterThan(0);
      expect(label.y).toBeLessThan(chart!.height);
    }
  });

  it("держит поле 360×300 с центром 180: подписи боковых осей рассчитаны на этот запас", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        axis("a", 45, scale(45, [0, 15, 25])),
        axis("b", 5, scale(25, [0, 5, 10])),
        axis("c", 20, scale(40, [0, 28, 33])),
      ],
    });
    expect(chart!.width).toBe(360);
    expect(chart!.height).toBe(300);
    expect(chart!.axes[0].cx).toBe(180);
    expect(chart!.axes[0].cy).toBe(150);
  });

  it("центрирует подпись горизонтальной оси, а не якорит её наружу", () => {
    const chart = buildRadarChart({
      ramp,
      axes: [
        { ...axis("top", 20, scale(45, [0, 15, 25])), name: "Верх" },
        { ...axis("right", 30, scale(40, [0, 28, 33])), name: "Вдохновляющий" },
        { ...axis("bottom", 3, scale(25, [0, 5, 10])), name: "Низ" },
        { ...axis("left", 30, scale(40, [0, 28, 33])), name: "Процессный" },
      ],
    });
    // Четыре оси: вторая — строго справа, четвёртая — строго слева.
    const right = chart!.axes[1];
    const left = chart!.axes[3];
    expect(right.axisY).toBeCloseTo(right.cy, 1);
    expect(left.axisY).toBeCloseTo(left.cy, 1);

    // Ни одна подпись не якорится наружу — иначе боковая уезжает за край поля.
    expect(chart!.labels.every((l) => l.anchor === "middle")).toBe(true);

    // Подпись боковой оси центрируется по вертикали относительно луча: имя выше
    // линии оси, уровень ниже — блок из двух строк симметричен CENTER_Y.
    const rightLabels = chart!.labels.filter((l) => l.x > chart!.axes[0].cx);
    expect(rightLabels.map((l) => l.text)).toEqual(["Вдохновляющий", "Уровень 1"]);
    expect(rightLabels[0].y).toBeLessThan(right.cy);
    expect(rightLabels[1].y).toBeGreaterThan(right.cy);
    const middle = (rightLabels[0].y + rightLabels[1].y) / 2;
    expect(middle).toBeCloseTo(right.cy, 1);

    // Та же симметрия слева: обе стороны считаются одним правилом.
    const leftLabels = chart!.labels.filter((l) => l.x < chart!.axes[0].cx);
    expect(leftLabels.map((l) => l.text)).toEqual(["Процессный", "Уровень 1"]);
    expect((leftLabels[0].y + leftLabels[1].y) / 2).toBeCloseTo(left.cy, 1);
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
