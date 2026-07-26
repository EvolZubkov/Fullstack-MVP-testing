/**
 * @module shared/flow/review-gate.test
 * @description The truth table both hosts must obey when a section (or a flat
 * test) ends: when is the обзор worth showing, and when does it merely stand
 * between the learner and the results they already earned.
 */
import { describe, it, expect } from "vitest";
import { shouldShowReview } from "./review-gate";

describe("shouldShowReview", () => {
  it("shows it when questions were skipped and returning is allowed", () => {
    expect(shouldShowReview({ allowReturnToUnanswered: true, allowAnswerChange: false, hasUnanswered: true })).toBe(true);
  });

  it("shows it whenever answers may still be edited — skips or not", () => {
    expect(shouldShowReview({ allowReturnToUnanswered: false, allowAnswerChange: true, hasUnanswered: false })).toBe(true);
    expect(shouldShowReview({ allowReturnToUnanswered: true, allowAnswerChange: true, hasUnanswered: false })).toBe(true);
  });

  it("skips it when every question is answered and nothing can be changed", () => {
    expect(shouldShowReview({ allowReturnToUnanswered: true, allowAnswerChange: false, hasUnanswered: false })).toBe(false);
  });

  it("skips it when returning is forbidden — the list would be read-only regret", () => {
    expect(shouldShowReview({ allowReturnToUnanswered: false, allowAnswerChange: false, hasUnanswered: true })).toBe(false);
  });

  it("skips it when nothing at all can be acted on", () => {
    expect(shouldShowReview({ allowReturnToUnanswered: false, allowAnswerChange: false, hasUnanswered: false })).toBe(false);
  });

  it("treats missing flags as their defaults (return on, edit off)", () => {
    expect(shouldShowReview({ hasUnanswered: true })).toBe(true);
    expect(shouldShowReview({ hasUnanswered: false })).toBe(false);
  });
});
