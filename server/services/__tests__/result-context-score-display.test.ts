// @vitest-environment node
/**
 * @module server/services/__tests__/result-context-score-display
 * @description Доставка переключателей «Сводка баллов» и «Полоса балла» веб-хостом.
 *
 * Само правило проверено там, где оно живёт, — `shared/template/__tests__/results-blocks` и
 * `result-context-measures`. Здесь только то, что настройки страницы итогов доезжают до
 * построителя у КОНТРОЛЬНОГО теста, который не передаёт `measures` вовсе.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext, type MeasuresSource } from "../result-context";
import type { AttemptResult } from "@shared/schema";

/** Оценивающая попытка без тем. */
const result = {
  overallPassed: false,
  overallPercent: 13,
  totalQuestions: 4,
  totalCorrect: 1,
  totalEarnedPoints: 1,
  totalPossiblePoints: 4,
  topicResults: [],
} as unknown as AttemptResult;

/** Материал контрольного теста: ни шкал, ни показателей. */
function material(blockSettings: MeasuresSource["blockSettings"]): MeasuresSource {
  return { scales: [], variables: [], hasPassThreshold: true, blockSettings } as MeasuresSource;
}

describe("веб-хост: переключатели сводки и полосы балла", () => {
  it("скрытая сводка контрольного теста гасит и полосу", () => {
    const screen = buildResultContext(result, "Контрольный", material({ scoreSummary: "hide" }));
    expect(screen.result.hideScoreSummary).toBe(true);
    expect(screen.result.hideScoreBar).toBe(true);
  });

  it("полоса управляется отдельно от сводки", () => {
    const screen = buildResultContext(result, "Контрольный", material({ scoreSummary: "hide", scoreBar: "show" }));
    expect(screen.result.hideScoreSummary).toBe(true);
    expect(screen.result.hideScoreBar).toBeUndefined();
  });

  it("нетронутые настройки оставляют сводку и полосу", () => {
    const screen = buildResultContext(result, "Контрольный", material({}));
    expect(screen.result.hideScoreSummary).toBeUndefined();
    expect(screen.result.hideScoreBar).toBeUndefined();
  });
});
