/**
 * @module tests/report-font
 * @description Отчёт печатается шрифтом, выбранным у теста, и не теряет жирное выделение
 * автора. В `report.css` всех трёх шаблонов гарнитура была жёсткой (`Inter`), поэтому
 * параметр «Шрифт» (`--font-sans`) до отчёта не доходил: у теста с Rostelecom Basis отчёт
 * печатался чем придётся. А `b` / `strong` при весе текста 300 давали `bolder` = 400 —
 * обычное начертание.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { TEMPLATE_IDS, templateFile } from "./helpers/template-roots";

describe.each(TEMPLATE_IDS)("%s — шрифт отчёта", (id) => {
  const css = readFileSync(templateFile(id, "styles/report.css"), "utf8");

  it("берёт гарнитуру из параметра шаблона `--font-sans`", () => {
    const rule = css.match(/\.tb-report\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rule).toMatch(/font-family:\s*var\(--font-sans,/);
    expect(rule).not.toMatch(/font-family:\s*Inter\b/);
  });

  it("задаёт жирному в авторском тексте явный вес", () => {
    // 600 or 700: certification prints Bold (700), because weight 600 of the system
    // Rostelecom Basis set is the solid-plate MediumHighlight face.
    expect(css).toMatch(/\.tb-report b,\s*\.tb-report strong\s*\{\s*font-weight:\s*(600|700);/);
  });
});
