// shared/template/__tests__/measure-view.test.ts
import { describe, it, expect } from "vitest";
import { buildMeasureView, resolveRenderKind } from "../measure-view";
import { LEVEL_SCHEMES } from "../level-ramp";

const EE_BANDS = [
  { min: 0, max: 14, level: "low", label: "Низкий" },
  { min: 15, max: 24, level: "moderate", label: "Умеренный" },
  { min: 25, max: 45, level: "high", label: "Высокий", text: "Ресурс расходуется быстрее." },
];

function ee(overrides: Partial<Parameters<typeof buildMeasureView>[0]> = {}) {
  return buildMeasureView({
    key: "emotional_exhaustion",
    name: "Эмоциональное истощение",
    value: 27,
    visibility: "level_and_value",
    interpretation: { domainMin: 0, domainMax: 45, valence: "lower_is_better", bands: EE_BANDS },
    requestedKind: "band_ruler",
    ramp: LEVEL_SCHEMES.traffic,
    ...overrides,
  });
}

describe("resolveRenderKind", () => {
  it("оставляет запрошенный вид, когда он выполним", () => {
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: true, isNumeric: true }))
      .toBe("band_ruler");
  });

  it("откатывает линейку до значения из максимума без интервалов", () => {
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: false, isNumeric: true }))
      .toBe("value_of_max");
  });

  it("откатывает кольцо до значения без домена", () => {
    expect(resolveRenderKind("ring", { hasDomain: false, hasBands: false, isNumeric: true }))
      .toBe("value");
  });

  it("НИКОГДА не подставляет кольцо автоматически вместо линейки", () => {
    // Кольцо печатает процент, а при normalization: none процент не определён.
    // Как явный выбор автора оно допустимо, как автозамена — нет.
    expect(resolveRenderKind("band_ruler", { hasDomain: true, hasBands: false, isNumeric: true }))
      .not.toBe("ring");
  });

  it("для нечислового значения всегда метка", () => {
    expect(resolveRenderKind("ring", { hasDomain: true, hasBands: true, isNumeric: false }))
      .toBe("label");
  });

  it("градиент требует домена и отсутствия интервалов", () => {
    expect(resolveRenderKind("gradient_bar", { hasDomain: true, hasBands: false, isNumeric: true }))
      .toBe("gradient_bar");
    expect(resolveRenderKind("gradient_bar", { hasDomain: true, hasBands: true, isNumeric: true }))
      .toBe("band_ruler");
  });
});

describe("buildMeasureView", () => {
  it("подставляет метку и текст сработавшего интервала", () => {
    const v = ee();
    expect(v.levelLabel).toBe("Высокий");
    expect(v.text).toBe("Ресурс расходуется быстрее.");
  });

  it("подписывает значение как «X из Y»", () => {
    expect(ee().valueLabel).toBe("27 из 45");
  });

  it("отдаёт число и максимум порознь для ou-slider__val", () => {
    expect(ee().valueText).toBe("27");
    expect(ee().maxText).toBe("45");
  });

  it("ставит засечки на края домена и начала интервалов", () => {
    expect(ee().marks).toEqual([
      { percent: 0, label: "0" },
      { percent: 33.3, label: "15" },
      { percent: 55.6, label: "25" },
      { percent: 100, label: "45" },
    ]);
  });

  it("готовит класс плашки и вариант баннера по тону", () => {
    const v = ee();
    expect(v.tone).toBe("critical");
    expect(v.toneClass).toBe("tb-tone--critical");
    expect(v.bannerVariant).toBe("error");
  });

  it("скрывает значение при видимости level", () => {
    const v = ee({ visibility: "level" });
    expect(v.showValue).toBe(false);
    expect(v.levelLabel).toBe("Высокий");
  });

  it("строит смежные зоны, покрывающие домен целиком", () => {
    const zones = ee().zones;
    expect(zones).toHaveLength(3);
    expect(zones[0].leftPercent).toBeCloseTo(0);
    // Ширины округлены до десятых, поэтому сумма 99.9 — сверяем с точностью до единиц.
    const total = zones.reduce((sum, z) => sum + z.widthPercent, 0);
    expect(total).toBeCloseTo(100, 0);
  });

  it("помечает текущую зону", () => {
    expect(ee().zones.map((z) => z.current)).toEqual([false, false, true]);
  });

  it("ставит маркер по сырому значению", () => {
    expect(ee().markerPercent).toBeCloseTo(60);
  });

  it("при lower_is_better первая зона благоприятна", () => {
    expect(ee().zones[0].color).toBe(LEVEL_SCHEMES.traffic.favorable);
  });

  it("при higher_is_better первая зона неблагоприятна", () => {
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "higher_is_better", bands: EE_BANDS },
    });
    expect(v.zones[0].color).toBe(LEVEL_SCHEMES.traffic.unfavorable);
  });

  it("средний интервал получает тон «внимание», а не «нейтральный»", () => {
    // Тон обязан совпадать с цветом своей зоны: середина рампы жёлтая, значит и
    // плашка уровня жёлтая. Нейтральный тон остаётся только за valence: none.
    const v = ee({ value: 20 });
    expect(v.levelLabel).toBe("Умеренный");
    expect(v.tone).toBe("attention");
  });

  it("при valence none тон нейтральный на любом интервале", () => {
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "none", bands: EE_BANDS },
    });
    expect(v.tone).toBe("neutral");
  });

  it("переопределение тона на интервале побеждает вычисленный", () => {
    const bands = [{ ...EE_BANDS[0] }, { ...EE_BANDS[1] }, { ...EE_BANDS[2], tone: "critical" as const }];
    const v = ee({
      interpretation: { domainMin: 0, domainMax: 45, valence: "lower_is_better", bands },
    });
    expect(v.tone).toBe("critical");
  });

  it("строковое значение отдаёт метку исхода и пустые зоны", () => {
    const v = buildMeasureView({
      key: "burnout_level",
      name: "Состояние",
      value: "growing",
      visibility: "level",
      interpretation: {
        domainMin: null,
        domainMax: null,
        valence: "none",
        bands: [],
        outcomes: [{ code: "growing", label: "Возрастающее истощение", tone: "attention" }],
      },
      requestedKind: "band_ruler",
      ramp: LEVEL_SCHEMES.traffic,
    });
    expect(v.renderKind).toBe("label");
    expect(v.levelLabel).toBe("Возрастающее истощение");
    expect(v.tone).toBe("attention");
    expect(v.zones).toEqual([]);
  });

  it("считает смещение кольца для вида ring", () => {
    const v = ee({ requestedKind: "ring" });
    expect(v.renderKind).toBe("ring");
    expect(v.percent).toBe(60);
    expect(v.ringDashoffset).toBeCloseTo(158.3, 0);
  });

  it("значение вне интервалов даёт пустую метку без падения", () => {
    const v = ee({ value: 99 });
    expect(v.levelLabel).toBe("");
    expect(v.tone).toBe("neutral");
  });
});
