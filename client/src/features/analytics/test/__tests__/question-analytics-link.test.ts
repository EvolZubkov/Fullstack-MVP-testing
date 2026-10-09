/**
 * @module features/analytics/test/__tests__/question-analytics-link.test
 * @description Unit tests for the deep link «Открыть в аналитике»: the address of a question's
 * breakdown is the question level of the test (E2).
 */
import { describe, expect, it } from "vitest";
import { questionAnalyticsHref, TEST_ANALYTICS_TABS } from "../question-analytics-link";

describe("questionAnalyticsHref", () => {
  it("points at the question level of the test (E2)", () => {
    expect(questionAnalyticsHref("t 1", "q/2")).toBe("/author/analytics/tests/t%201/questions/q%2F2");
  });
});

describe("TEST_ANALYTICS_TABS", () => {
  it("starts with the overview — the tab of a bare test address", () => {
    expect(TEST_ANALYTICS_TABS[0]).toBe("overview");
  });
});
