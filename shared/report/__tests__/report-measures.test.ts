/**
 * @module shared/report/__tests__/report-measures
 *
 * PRD-47 §5.1: вход отчёта делается ИЗ входа экрана, а не собирается заново. Правило:
 * вид, предел оси и переключатель радара берутся из полей варианта ОТЧЁТА, всё
 * остальное в `chartSettings` — с экрана. Облик шкал колонки в отчёте не имеет и обязан
 * приехать оттуда, иначе профиль в двух документах окажется разного цвета.
 */
import { describe, expect, it } from "vitest";

import { buildReportMeasures } from "../report-measures";
import type { MeasuresInput } from "../../template/result-context";

const SCREEN: MeasuresInput = {
  ramp: { favorable: "142 76% 36%", mid: "38 92% 50%", unfavorable: "0 84% 60%" },
  scaleKind: "band_ruler",
  indicatorKind: "label",
  scales: [],
  indicators: [],
  chartSettings: {
    scalesChartKind: "rose",
    radarAxisLimit: "attempt",
    scaleAppearance: { cel: { color: "210 60% 50%", icon: "target" } },
  },
  ipsativeScales: true,
};

describe("buildReportMeasures", () => {
  it("берёт вид, предел оси и переключатель радара из полей отчёта", () => {
    const out = buildReportMeasures(SCREEN, {
      scalesChartKind: "radar",
      radarAxisLimit: "domain",
      showCompetencyRadar: true,
    });

    expect(out.chartSettings?.scalesChartKind).toBe("radar");
    expect(out.chartSettings?.radarAxisLimit).toBe("domain");
    expect(out.chartSettings?.showCompetencyRadar).toBe(true);
  });

  it("переносит облик шкал с экрана — своей колонки у отчёта нет", () => {
    const out = buildReportMeasures(SCREEN, { scalesChartKind: "radar" });

    expect(out.chartSettings?.scaleAppearance).toEqual({
      cel: { color: "210 60% 50%", icon: "target" },
    });
  });

  it("не трогает измерения и признак ипсативности", () => {
    const out = buildReportMeasures(SCREEN, { scalesChartKind: "none" });

    expect(out.scales).toBe(SCREEN.scales);
    expect(out.indicators).toBe(SCREEN.indicators);
    expect(out.ipsativeScales).toBe(true);
  });

  it("пустые поля отчёта не подменяются экранными: отчёт задаёт вид сам", () => {
    // Иначе тест, где автор сознательно выключил диаграмму в отчёте, начал бы её печатать.
    const out = buildReportMeasures(SCREEN, {});

    expect(out.chartSettings?.scalesChartKind).toBeUndefined();
    expect(out.chartSettings?.showCompetencyRadar).toBe(false);
    // …а облик всё равно приезжает: он не про выбор вида.
    expect(out.chartSettings?.scaleAppearance).toBeTruthy();
  });

  it("экранный вход не мутируется", () => {
    const before = JSON.stringify(SCREEN);
    buildReportMeasures(SCREEN, { scalesChartKind: "radar" });
    expect(JSON.stringify(SCREEN)).toBe(before);
  });
});
