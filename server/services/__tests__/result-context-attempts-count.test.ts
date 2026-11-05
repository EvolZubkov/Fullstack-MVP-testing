/**
 * @module server/services/__tests__/result-context-attempts-count
 * @description Веб-хост довозит переключатель «Показывать число попыток»
 * (`tests.show_attempts_count`) до входа отчёта: только явное `false` уходит в документ,
 * отсутствие оставляет вход прежним.
 */
import { describe, it, expect } from "vitest";
import { buildReportInput, type MeasuresSource } from "../result-context";
import type { AttemptResult } from "@shared/schema";

/** Оценивающая попытка без тем: строке попыток больше ничего не нужно. */
const result = {
  overallPassed: true,
  overallPercent: 100,
  totalQuestions: 2,
  totalCorrect: 2,
  totalEarnedPoints: 2,
  totalPossiblePoints: 2,
  topicResults: [],
} as unknown as AttemptResult;

/** Материал экрана в том виде, в каком его собирает маршрут итогов. */
function material(over: Partial<MeasuresSource> = {}): MeasuresSource {
  return { scales: [], variables: [], hasPassThreshold: true, ...over } as MeasuresSource;
}

describe("веб-хост: строка числа попыток в отчёте", () => {
  it("выключенный переключатель доезжает до входа отчёта", () => {
    const input = buildReportInput(result, "Тест", { attemptsCount: 2 }, material({ showAttemptsCount: false }));
    expect(input.showAttemptsCount).toBe(false);
  });

  it("включённый или отсутствующий во вход не попадает", () => {
    expect("showAttemptsCount" in buildReportInput(result, "Тест", {}, material({ showAttemptsCount: true }))).toBe(false);
    expect("showAttemptsCount" in buildReportInput(result, "Тест", {}, material())).toBe(false);
  });
});
