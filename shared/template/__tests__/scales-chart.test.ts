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
import { chartKindSetting, resolveChartKind } from "../scales-chart";

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
