/**
 * @module shared/template/__tests__/scales-chart
 *
 * PRD-46 §4. The rule that turns the author's setting plus two properties of the data into a
 * decision about WHICH diagram is drawn — or none.
 *
 * The two refusals of an explicitly chosen rose are deliberately different, and the tests here
 * pin that difference: non-ipsative scales still draw (the author may know something about the
 * method the system does not), hidden values do not (an honest figure cannot be built).
 */
import { describe, expect, it } from "vitest";
import { buildScalesChart, chartKindSetting, resolveChartKind } from "../scales-chart";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { RadarAxisInput } from "../radar-view";
import type { LearnerVisibility, ScaleInterpretation } from "../../scales/interpretation";

describe("resolveChartKind", () => {
  const ipsative = { ipsative: true, hasHiddenValue: false };
  const plain = { ipsative: false, hasHiddenValue: false };

  it("«нет» не рисует ничего", () => {
    expect(resolveChartKind({ setting: "none", ...ipsative })).toBeNull();
  });

  it("«радар» рисует радар при любых данных", () => {
    expect(resolveChartKind({ setting: "radar", ...ipsative })).toBe("radar");
    expect(resolveChartKind({ setting: "radar", ...plain })).toBe("radar");
  });

  it("«роза» рисуется и на неипсативных шкалах: автор мог знать о методике больше", () => {
    expect(resolveChartKind({ setting: "rose", ...plain })).toBe("rose");
  });

  it("«роза» не рисуется при скрытом балле: честной фигуры не построить", () => {
    expect(resolveChartKind({ setting: "rose", ipsative: true, hasHiddenValue: true })).toBeNull();
  });

  it("«авто» выбирает розу только для ипсативных шкал с показанными значениями", () => {
    expect(resolveChartKind({ setting: "auto", ...ipsative })).toBe("rose");
    expect(resolveChartKind({ setting: "auto", ...plain })).toBe("radar");
    expect(resolveChartKind({ setting: "auto", ipsative: true, hasHiddenValue: true })).toBe("radar");
  });
});

describe("buildScalesChart", () => {
  const ramp = LEVEL_SCHEMES.traffic;

  function scale(valence: ScaleInterpretation["valence"]): ScaleInterpretation {
    return {
      domainMin: 0,
      domainMax: 98,
      valence,
      bands: [
        { min: 0, max: 40, level: "low", label: "Слабо" },
        { min: 40, max: 98, level: "high", label: "Сильно" },
      ],
    };
  }

  function axes(count: number, visibility: LearnerVisibility = "level_and_value"): RadarAxisInput[] {
    return Array.from({ length: count }, (_, i) => ({
      key: `s${i}`,
      name: `Шкала ${i}`,
      value: 20 + i * 5,
      visibility,
      interpretation: scale("none"),
    }));
  }

  it("отдаёт единый контракт: роза заполняет свои поля, радарные пусты", () => {
    const chart = buildScalesChart({
      axes: axes(4),
      ramp,
      settings: { scalesChartKind: "rose" },
      ipsative: true,
    })!;
    expect(chart.kind).toBe("rose");
    expect(chart.isRose).toBe(true);
    expect(chart.isRadar).toBe(false);
    expect(chart.sectors).toHaveLength(4);
    expect(chart.axes).toEqual([]);
    expect(chart.polygonPoints).toBe("");
  });

  it("отдаёт единый контракт: радар заполняет свои поля, розовые пусты", () => {
    const chart = buildScalesChart({
      axes: axes(4),
      ramp,
      settings: { scalesChartKind: "radar" },
      ipsative: true,
    })!;
    expect(chart.kind).toBe("radar");
    expect(chart.isRadar).toBe(true);
    expect(chart.axes).toHaveLength(4);
    expect(chart.polygonPoints.split(" ")).toHaveLength(4);
    expect(chart.sectors).toEqual([]);
    expect(chart.spokes).toEqual([]);
  });

  it("скрытый балл уводит «авто» на радар, а не убирает диаграмму", () => {
    const chart = buildScalesChart({
      axes: axes(4, "level"),
      ramp,
      settings: { scalesChartKind: "auto" },
      ipsative: true,
    })!;
    expect(chart.kind).toBe("radar");
  });

  it("отказ построителя гасит диаграмму целиком", () => {
    // Две видимые шкалы: фигуры не возникает ни у розы, ни у радара.
    expect(
      buildScalesChart({ axes: axes(2), ramp, settings: { scalesChartKind: "radar" }, ipsative: false }),
    ).toBeNull();
  });

  it("настройка «нет» не строит ничего, не трогая построители", () => {
    expect(buildScalesChart({ axes: axes(4), ramp, settings: {}, ipsative: true })).toBeNull();
  });
});

describe("chartKindSetting", () => {
  it("читает новый ключ", () => {
    expect(chartKindSetting({ scalesChartKind: "rose" })).toBe("rose");
  });

  it("переносит включённую галочку PRD-35 в явный радар", () => {
    expect(chartKindSetting({ showCompetencyRadar: true })).toBe("radar");
  });

  it("умалчивает в «нет»: диаграмма не появляется у теста задним числом", () => {
    expect(chartKindSetting({})).toBe("none");
    expect(chartKindSetting({ showCompetencyRadar: false })).toBe("none");
  });

  it("новый ключ старше легаси, когда заданы оба", () => {
    expect(chartKindSetting({ scalesChartKind: "none", showCompetencyRadar: true })).toBe("none");
  });

  it("незнакомое значение падает в «нет», а не в случайный вид", () => {
    expect(chartKindSetting({ scalesChartKind: "spiral" as never })).toBe("none");
  });
});
