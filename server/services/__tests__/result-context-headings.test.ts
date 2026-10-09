// @vitest-environment node
/**
 * @module server/services/__tests__/result-context-headings
 * @description Доставка заголовков итога веб-хостом: экран и вход отчёта.
 *
 * Само правило («пусто — умолчание поверхности», тест без вердикта не переименовывается)
 * проверено там, где оно живёт, — `shared/template/__tests__/result-context-headings`.
 * Здесь только то, что материал маршрута доезжает до обоих построителей.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext, buildReportInput, type MeasuresSource } from "../result-context";
import type { AttemptResult } from "@shared/schema";

/** Оценивающая попытка без тем: заголовкам достаточно вердикта.  */
const result = {
  overallPassed: false,
  overallPercent: 50,
  totalQuestions: 4,
  totalCorrect: 2,
  totalEarnedPoints: 2,
  totalPossiblePoints: 4,
  topicResults: [],
} as unknown as AttemptResult;

/** Материал экрана в том виде, в каком его собирает маршрут итогов. */
function material(over: Partial<MeasuresSource> = {}): MeasuresSource {
  return { scales: [], variables: [], ...over } as MeasuresSource;
}

describe("веб-хост: доставка заголовков итога", () => {
  it("довозит их и до экрана, и до входа отчёта", () => {
    const headings = { document: "Отчёт о сертификации", passed: "Сертификация пройдена" };
    const measures = material({ resultHeadings: headings, hasPassThreshold: true });
    const screen = buildResultContext(result, "Сертификация руководителей", measures);
    expect(screen.course.title).toBe("Отчёт о сертификации");
    const input = buildReportInput(result, "Сертификация руководителей", {}, measures);
    expect(input.headings).toEqual(headings);
  });

  it("материал без заголовков оставляет название теста", () => {
    const screen = buildResultContext(result, "Сертификация руководителей", material());
    expect(screen.course.title).toBe("Сертификация руководителей");
    expect(buildReportInput(result, "Тест", {}, material()).headings).toBeUndefined();
  });
});
