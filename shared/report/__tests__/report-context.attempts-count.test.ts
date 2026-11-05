/**
 * @module shared/report/__tests__/report-context.attempts-count
 * @description Переключатель «Показывать число попыток» в ОТЧЁТЕ: `showAttemptsCount: false`
 * гасит строку «Лучший результат за N попыток» в шапке документа обоих режимов, остальная
 * шапка остаётся на месте.
 */
import { describe, it, expect } from "vitest";
import { buildAdaptiveReportContext, buildReportContext } from "../report-context";

const standardResult = {
  passed: true, percent: 100, totalQuestions: 2, correct: 2, earnedPoints: 2, possiblePoints: 2,
  topicResults: [
    { topicName: "Право", correct: 2, total: 2, percent: 100, earnedPoints: 2, possiblePoints: 2, passed: true },
  ],
};

const adaptiveResult = {
  passed: true,
  topicResults: [
    { topicName: "Право", achievedLevelIndex: 1, achievedLevelName: "Уверенный", totalQuestionsAnswered: 3, totalCorrect: 2 },
  ],
};

describe("строка числа попыток в отчёте: обычный режим", () => {
  it("по умолчанию печатается", () => {
    const ctx = buildReportContext({ testName: "Тест", attemptsCount: 3, result: standardResult } as never);
    expect(ctx.report.attemptsCountLabel).toBe("Лучший результат за 3 попытки");
  });

  it("`showAttemptsCount: false` гасит строку, вердикт и дата на месте", () => {
    const ctx = buildReportContext({
      testName: "Тест", attemptsCount: 3, showAttemptsCount: false,
      timestamp: "2026-10-31T10:00:00.000Z", result: standardResult,
    } as never);
    expect(ctx.report.attemptsCountLabel).toBe("");
    expect(ctx.report.verdictBadge).toBe("пройден");
    expect(ctx.report.attemptDateLabel).not.toBe("");
  });
});

describe("строка числа попыток в отчёте: адаптивный режим", () => {
  it("по умолчанию печатается", () => {
    const ctx = buildAdaptiveReportContext({
      adaptive: true, testName: "Тест", attemptsCount: 2, result: adaptiveResult,
    } as never);
    expect(ctx.report.attemptsCountLabel).toBe("Лучший результат за 2 попытки");
  });

  it("`showAttemptsCount: false` гасит строку", () => {
    const ctx = buildAdaptiveReportContext({
      adaptive: true, testName: "Тест", attemptsCount: 2, showAttemptsCount: false, result: adaptiveResult,
    } as never);
    expect(ctx.report.attemptsCountLabel).toBe("");
  });
});
