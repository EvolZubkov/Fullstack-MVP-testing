import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chartKindSetting } from "@shared/template/scales-chart";

interface Field {
  key: string;
  type: string;
  default?: unknown;
}

interface ContentTemplate {
  key: string;
  kind: string;
  settings?: Field[];
}

const manifest = JSON.parse(
  readFileSync(resolve("server/scorm/templates/default/manifest.json"), "utf-8"),
) as { contentTemplates: ContentTemplate[] };

/**
 * Галочка радара PRD-35 УБРАНА ИЗ ИНТЕРФЕЙСА: поле объявляет манифест, и пока оно там
 * стояло, автор видел в «Оформлении» переключатель, который сам себя называл устаревшим и
 * ничего не менял у теста с заданным видом диаграммы.
 *
 * Убрано именно ОБЪЯВЛЕНИЕ, а не чтение: значение, сохранённое до PRD-46, лежит в
 * `settings_json` теста, и читается оно оттуда напрямую — ни `chartKindSetting`, ни
 * `legacyChartKind` в манифест не смотрят. Поэтому у старого теста диаграмма остаётся на
 * месте, хотя переключателя больше нет. Эти два факта и держит файл.
 */
describe("манифест «Стандартного»: галочка радара убрана из интерфейса", () => {
  it("не объявлена ни одним вариантом", () => {
    const withField = manifest.contentTemplates.filter((c) =>
      c.settings?.some((s) => s.key === "showCompetencyRadar"),
    );
    expect(withField.map((c) => c.key)).toEqual([]);
  });

  it("вид диаграммы остался и объявлен там, где стояла галочка", () => {
    const withKind = manifest.contentTemplates.filter((c) =>
      c.settings?.some((s) => s.key === "scalesChartKind"),
    );
    expect(withKind.map((c) => c.key)).toEqual([
      "results.standard",
      "report.standard",
      "report.adaptive.standard",
    ]);
  });
});

describe("сохранённое значение галочки продолжает читаться", () => {
  it("тест, настроенный до выбора вида, по-прежнему получает радар", () => {
    expect(chartKindSetting({ showCompetencyRadar: true })).toBe("radar");
  });

  it("заданный вид старше галочки", () => {
    expect(chartKindSetting({ scalesChartKind: "rose", showCompetencyRadar: true })).toBe("rose");
  });

  it("без того и другого диаграммы нет", () => {
    expect(chartKindSetting({})).toBe("none");
  });
});
