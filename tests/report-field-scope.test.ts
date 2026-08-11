/**
 * @module tests/report-field-scope
 *
 * Назначение поля вида отчёта: содержание документа или его облик (PRD-27 §7.1).
 *
 * Правило живёт отдельно от UI, потому что по нему раскладываются ДВА экрана редактора, а
 * решает его шаблон. Здесь пиннится главное: умолчание совместимо со старыми шаблонами, а
 * поставляемые шаблоны действительно помечают содержательные поля.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_REPORT_FIELD_SCOPE,
  fieldsOfScope,
  isReportFieldScope,
  reportFieldScope,
} from "../shared/report/report-field-scope";

describe("назначение поля", () => {
  it("поле без признака остаётся оформительским", () => {
    // Совместимость: до признака все поля жили в «Оформлении», и шаблон, который о нём не
    // знает, обязан оставить их там же.
    expect(DEFAULT_REPORT_FIELD_SCOPE).toBe("appearance");
    expect(reportFieldScope({ key: "logoImage", type: "image" })).toBe("appearance");
    expect(reportFieldScope(null)).toBe("appearance");
    expect(reportFieldScope(undefined)).toBe("appearance");
  });

  it("непонятный признак трактуется как оформление, а не роняет экран", () => {
    expect(reportFieldScope({ key: "x", scope: "whatever" })).toBe("appearance");
    expect(reportFieldScope({ key: "x", scope: 7 })).toBe("appearance");
    expect(isReportFieldScope("content")).toBe(true);
    expect(isReportFieldScope("layout")).toBe(false);
  });

  it("объявленное содержание уходит в содержание", () => {
    expect(reportFieldScope({ key: "scalesChartKind", scope: "content" })).toBe("content");
  });

  it("отбор сохраняет порядок объявления", () => {
    const fields = [
      { key: "a", scope: "content" },
      { key: "b" },
      { key: "c", scope: "content" },
      { key: "d", scope: "appearance" },
    ];
    expect(fieldsOfScope(fields, "content").map((f) => f.key)).toEqual(["a", "c"]);
    expect(fieldsOfScope(fields, "appearance").map((f) => f.key)).toEqual(["b", "d"]);
  });
});

describe("поставляемые шаблоны", () => {
  const manifests: Array<[string, string]> = [
    ["default", path.resolve(process.cwd(), "server", "scorm", "templates", "default", "manifest.json")],
    ["certification", path.resolve(process.cwd(), "templates", "certification", "manifest.json")],
  ];

  for (const [name, file] of manifests) {
    it(`${name}: диаграмма объявлена содержанием, картинки — оформлением`, () => {
      const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as {
        contentTemplates?: Array<{ kind?: string; settings?: Array<Record<string, unknown>> }>;
      };
      const variants = (manifest.contentTemplates ?? []).filter((c) => String(c.kind ?? "").startsWith("report"));
      expect(variants.length, "виды отчёта объявлены").toBeGreaterThan(0);
      for (const variant of variants) {
        const byKey = new Map((variant.settings ?? []).map((f) => [String(f.key), f]));
        // Что показать в отчёте — содержание: автор ищет это рядом с обратной связью.
        // `showCompetencyRadar` здесь не проверяется: галочка радара PRD-35 убрана из
        // интерфейса (`78dcadd8`), и ни один поставляемый манифест её больше не объявляет —
        // вид диаграммы задаётся выбором `scalesChartKind`. Требовать признак у поля,
        // которого нет, значит требовать вернуть поле.
        for (const key of ["scalesChartKind", "radarAxisLimit"]) {
          expect(reportFieldScope(byKey.get(key)), `${key} в ${variant.kind}`).toBe("content");
        }
        // Как он выглядит — оформление.
        for (const key of ["backgroundImage", "logoImage"]) {
          expect(reportFieldScope(byKey.get(key)), `${key} в ${variant.kind}`).toBe("appearance");
        }
      }
    });
  }
});
