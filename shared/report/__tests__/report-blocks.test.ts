/**
 * @module shared/report/__tests__/report-blocks
 *
 * PRD-51, задача 2 — ЗАКРЫТЫЙ РЕЕСТР блоков документа отчёта.
 *
 * Проверяется не «что перечислено», а два свойства, ради которых реестр закрыт:
 * порядок системных блоков совпадает с сегодняшним порядком печати отчёта (иначе
 * документ по умолчанию сменил бы вид у каждого уже собранного теста), и природа
 * блока выводится ОДНОЙ функцией — редактор и движок обязаны отвечать на вопрос
 * «системный это блок или страница» одинаково.
 */
import { describe, expect, it } from "vitest";
import {
  REPORT_SYSTEM_BLOCKS,
  REPORT_BLOCK_KEYS,
  isReportBlockKey,
  reportBlockNature,
  MINIMUM_REPORT_DOCUMENT,
} from "../report-blocks";

describe("реестр блоков отчёта", () => {
  it("перечисляет десять системных блоков в порядке печати сегодняшнего отчёта", () => {
    expect(REPORT_SYSTEM_BLOCKS.map((b) => b.key)).toEqual([
      "header",
      "intro",
      "summary",
      "topics",
      "breakdown",
      "scales",
      "indicators",
      "recommendations",
      "courses",
      "events",
    ]);
  });

  it("знает служебные ключи страницы и разрыва", () => {
    expect(REPORT_BLOCK_KEYS).toContain("page");
    expect(REPORT_BLOCK_KEYS).toContain("page-break");
  });

  it("различает природу блока", () => {
    expect(reportBlockNature("topics")).toBe("system");
    expect(reportBlockNature("page")).toBe("page");
    expect(reportBlockNature("page-break")).toBe("page-break");
  });

  it("отвергает неизвестный ключ", () => {
    expect(isReportBlockKey("summary")).toBe(true);
    expect(isReportBlockKey("нет-такого")).toBe(false);
  });

  it("у каждого системного блока есть подпись для редактора", () => {
    for (const block of REPORT_SYSTEM_BLOCKS) {
      expect(block.label.length).toBeGreaterThan(0);
    }
  });
});

describe("минимальный документ", () => {
  it("начинается с титула и вердикта — пустого отчёта не бывает", () => {
    expect(MINIMUM_REPORT_DOCUMENT).toEqual(["header"]);
  });
});
