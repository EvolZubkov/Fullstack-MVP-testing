/**
 * @module server/services/analytics/__tests__/review-inputs
 * @description PRD-70 FR-03: входы эвристик ревизии — одна сборка для таблицы теста и фонового
 * пересчёта.
 */
import { describe, expect, it } from "vitest";

import { heuristicOf, reviewOf } from "../review-inputs";

const DELIVERY = {
  attemptsInWindow: 100,
  exposureOwn: new Map([["q1", 80], ["q2", 30]]),
  latency: new Map([["q1", { medianMs: 40_000, sampleSize: 50 }], ["q2", { medianMs: 3_000, sampleSize: 20 }]]),
};

describe("reviewOf", () => {
  it("частый и трудный — эвристика с долей выдачи", () => {
    const answers = { questionId: "q1", gradedAnswers: 80, correctPercent: 30 };
    const outcome = reviewOf(answers, DELIVERY);

    expect(outcome).toMatchObject({ exposureCount: 80, exposurePercent: 80, latencyMedianMs: 40_000, latencySampleSize: 50 });
    expect(outcome.reviewFlags.map(flag => flag.kind)).toEqual(["hard-and-frequent"]);
    expect(heuristicOf(answers, outcome)).toEqual({
      kinds: ["hard-and-frequent"], exposurePercent: 80, correctPercent: 30, latencyMedianMs: 40_000,
    });
  });

  it("быстро и мимо — эвристика по медиане времени", () => {
    const answers = { questionId: "q2", gradedAnswers: 30, correctPercent: 20 };
    expect(reviewOf(answers, DELIVERY).reviewFlags.map(flag => flag.kind)).toEqual(["fast-and-wrong"]);
  });

  it("невыданный вопрос и ноль попыток — доли нет, эвристика молчит", () => {
    const answers = { questionId: "q3", gradedAnswers: 50, correctPercent: 10 };
    const outcome = reviewOf(answers, { ...DELIVERY, attemptsInWindow: 0 });

    expect(outcome.exposurePercent).toBeNull();
    expect(outcome.reviewFlags).toEqual([]);
    expect(heuristicOf(answers, outcome)).toBeUndefined();
  });
});
