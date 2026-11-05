/**
 * @module shared/report/__tests__/report-context.topic-cards
 * @description Переключатель «Показывать результаты по темам» в ОТЧЁТЕ (PRD-51 §5.2): документ
 * не печатает карточки там, где экран, с которого его скачали, их не печатает.
 */
import { describe, it, expect } from "vitest";
import { buildAdaptiveReportContext, buildReportContext } from "../report-context";

const standardResult = {
  passed: true, percent: 100, totalQuestions: 2, correct: 2, earnedPoints: 2, possiblePoints: 2,
  topicResults: [
    { topicName: "Право", correct: 1, total: 1, percent: 100, earnedPoints: 1, possiblePoints: 1, passed: true },
    { topicName: "Кадры", correct: 1, total: 1, percent: 100, earnedPoints: 1, possiblePoints: 1, passed: true },
  ],
};

const adaptiveResult = {
  passed: true,
  topicResults: [
    { topicName: "Право", achievedLevelIndex: 1, achievedLevelName: "Уверенный", totalQuestionsAnswered: 3, totalCorrect: 2 },
  ],
};

describe("карточки тем в отчёте: обычный режим", () => {
  it("по умолчанию печатает карточки и признак `hasTopics`", () => {
    const ctx = buildReportContext({ testName: "Тест", result: standardResult } as never);
    expect(ctx.result.topicResults).toHaveLength(2);
    expect(ctx.report.hasTopics).toBe(true);
  });

  it("`showTopicResults: false` убирает карточки и гасит `hasTopics`, шапка и счёт на месте", () => {
    const ctx = buildReportContext({ testName: "Тест", showTopicResults: false, result: standardResult } as never);
    expect(ctx.result.topicResults).toEqual([]);
    expect(ctx.report.hasTopics).toBe(false);
    expect(ctx.report.correctLabel).toBe("2/2");
    expect(ctx.report.verdictBadge).toBe("пройден");
  });
});

describe("карточки тем в отчёте: адаптивный режим", () => {
  it("по умолчанию печатает карточки уровней", () => {
    const ctx = buildAdaptiveReportContext({ adaptive: true, testName: "Тест", result: adaptiveResult } as never);
    expect(ctx.result.topicResults).toHaveLength(1);
    expect(ctx.report.hasTopics).toBe(true);
  });

  it("`showTopicResults: false` убирает карточки и гасит `hasTopics`", () => {
    const ctx = buildAdaptiveReportContext({
      adaptive: true, testName: "Тест", showTopicResults: false, result: adaptiveResult,
    } as never);
    expect(ctx.result.topicResults).toEqual([]);
    expect(ctx.report.hasTopics).toBe(false);
  });
});
