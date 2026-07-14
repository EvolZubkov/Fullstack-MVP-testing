/**
 * @module shared/template/review-context.test
 * Unit tests for the PRD-19 Block D review/finish (обзор) context builder.
 */
import { describe, it, expect } from "vitest";
import { buildReviewContext, type BuildReviewContextInput } from "./review-context";

const sectioned: BuildReviewContextInput["questions"] = [
  { id: "a1", topicId: "A", prompt: "A one" },
  { id: "a2", topicId: "A", prompt: "A two" },
  { id: "b1", topicId: "B", prompt: "B one" },
  { id: "b2", topicId: "B", prompt: "B two" },
];

describe("buildReviewContext", () => {
  it("section обзор: scopes pills + unanswered list to the section, all pills clickable, none current", () => {
    const { questionsProgress, review } = buildReviewContext({
      questions: sectioned,
      statuses: { a1: "answered", a2: "skipped" },
      commitScope: "section",
      scopeTopicId: "A",
      isTest: false,
      scopeLabel: "Раздел «A»",
      finishLabel: "Завершить раздел",
    });
    expect(questionsProgress!.total).toBe(2); // only A
    expect(questionsProgress!.states.every((s) => s.clickable)).toBe(true);
    expect(questionsProgress!.states.some((s) => s.statusClass === "is-current")).toBe(false);
    expect(review.answeredCount).toBe(1);
    expect(review.unansweredCount).toBe(1);
    expect(review.unanswered[0]).toMatchObject({ index: 1, number: 2, prompt: "A two" });
    expect(review.finishLabel).toBe("Завершить раздел");
    expect(review.isTest).toBe(false);
  });

  it("test обзор: whole-test scope, hint changes when all answered", () => {
    const { questionsProgress, review } = buildReviewContext({
      questions: sectioned,
      statuses: { a1: "answered", a2: "answered", b1: "answered", b2: "answered" },
      commitScope: "test",
      isTest: true,
      scopeLabel: "Обзор теста",
      finishLabel: "Завершить тест",
    });
    expect(questionsProgress!.total).toBe(4);
    expect(review.unansweredCount).toBe(0);
    expect(review.answeredCount).toBe(4);
    expect(review.hint).toContain("Все вопросы отвечены");
    expect(review.isTest).toBe(true);
  });
});
