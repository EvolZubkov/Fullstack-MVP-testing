/**
 * @module features/analytics/test/__tests__/question-analytics-link.test
 * @description Unit tests for the deep link «Открыть в аналитике»: building the address of a
 * question's breakdown and reading it back on the test analytics page.
 */
import { describe, expect, it } from "vitest";
import { questionAnalyticsHref, readQuestionAnalyticsLink } from "../question-analytics-link";

describe("questionAnalyticsHref", () => {
  it("points at the question level of the test (E2)", () => {
    expect(questionAnalyticsHref("t 1", "q/2")).toBe("/author/analytics/tests/t%201/questions/q%2F2");
  });
});

describe("readQuestionAnalyticsLink", () => {

  it("accepts a known tab without a question", () => {
    expect(readQuestionAnalyticsLink("?tab=questions")).toEqual({ tab: "questions", questionId: null });
  });

  it("falls back to the overview for an unknown or absent tab", () => {
    expect(readQuestionAnalyticsLink("?tab=nope")).toEqual({ tab: "overview", questionId: null });
    expect(readQuestionAnalyticsLink("")).toEqual({ tab: "overview", questionId: null });
  });

  it("opens a question breakdown only on the quality tab", () => {
    // Breakdown cards live on «Качество вопросов»; elsewhere the id would be a dangling choice.
    expect(readQuestionAnalyticsLink("?tab=questions&questionId=q2").questionId).toBeNull();
    expect(readQuestionAnalyticsLink("?questionId=q2").questionId).toBeNull();
  });

  it("ignores the registry filter that shares the address", () => {
    expect(readQuestionAnalyticsLink("?groupId=g1&tab=quality&questionId=q2&from=2026-01-01")).toEqual({
      tab: "quality",
      questionId: "q2",
    });
  });
});
