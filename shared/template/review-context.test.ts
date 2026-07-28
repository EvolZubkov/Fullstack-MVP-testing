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

  it("omits NOT-yet-delivered questions from both the pills and the unanswered list", () => {
    // Learner reached a1/a2 only; b1/b2 not delivered → must not appear in the обзор.
    const { questionsProgress, review } = buildReviewContext({
      questions: [
        { id: "a1", topicId: "A", prompt: "A one", delivered: true },
        { id: "a2", topicId: "A", prompt: "A two", delivered: true },
        { id: "b1", topicId: "A", prompt: "B one", delivered: false },
        { id: "b2", topicId: "A", prompt: "B two", delivered: false },
      ],
      statuses: { a1: "answered" },
      commitScope: "section",
      scopeTopicId: "A",
      isTest: false,
      scopeLabel: "Раздел «A»",
      finishLabel: "Завершить раздел",
    });
    expect(questionsProgress!.total).toBe(2); // only the two delivered
    expect(review.total).toBe(2);
    expect(review.unansweredCount).toBe(1); // a2 only; b1/b2 not listed
    expect(review.unanswered.map((u) => u.prompt)).toEqual(["A two"]);
  });

  it("mid-flow entry (currentIndex + canReturn): highlights the current pill and offers «Назад»", () => {
    const { questionsProgress, review } = buildReviewContext({
      questions: sectioned,
      statuses: { a1: "answered" },
      commitScope: "section",
      scopeTopicId: "A",
      isTest: false,
      scopeLabel: "Раздел «A»",
      finishLabel: "Завершить раздел",
      currentIndex: 1, // a2
      canReturn: true,
    });
    expect(questionsProgress!.states.find((s) => s.index === 1)!.statusClass).toBe("is-current");
    expect(review.canReturn).toBe(true);
    expect(review.backLabel).toBe("Назад");
  });

  it("end-of-flow entry: no current pill, no «Назад» (finish is the primary action)", () => {
    const { questionsProgress, review } = buildReviewContext({
      questions: sectioned,
      statuses: { a1: "answered", a2: "answered" },
      commitScope: "section",
      scopeTopicId: "A",
      isTest: false,
      scopeLabel: "Раздел «A»",
      finishLabel: "Завершить раздел",
    });
    expect(questionsProgress!.states.some((s) => s.statusClass === "is-current")).toBe(false);
    expect(review.canReturn).toBe(false);
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
