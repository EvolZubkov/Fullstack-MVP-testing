/**
 * @module shared/topics/recommendations.test
 * @description Unit tests for the TD-02 r.3 feedback→recommendations mappers.
 */
import { describe, it, expect } from "vitest";
import { topicCoursesFromFeedback, topicEventsFromFeedback } from "./recommendations";
import type { Topic } from "../schema";

function topicWith(feedbackJson: unknown): Topic {
  return { id: "t1", name: "T", feedbackJson } as unknown as Topic;
}

describe("topicCoursesFromFeedback", () => {
  it("maps feedback links to courses with synthetic ids", () => {
    const courses = topicCoursesFromFeedback(
      topicWith({ format: "plain", text: "", assets: [], events: [], links: [
        { title: "A", url: "https://a.test" },
        { title: "B", url: "https://b.test" },
      ] }),
    );
    expect(courses).toEqual([
      { id: "t1:link:0", topicId: "t1", title: "A", url: "https://a.test" },
      { id: "t1:link:1", topicId: "t1", title: "B", url: "https://b.test" },
    ]);
  });

  it("returns [] for null/absent feedback and undefined topic", () => {
    expect(topicCoursesFromFeedback(topicWith(null))).toEqual([]);
    expect(topicCoursesFromFeedback(topicWith(undefined))).toEqual([]);
    expect(topicCoursesFromFeedback(undefined)).toEqual([]);
  });
});

describe("topicEventsFromFeedback", () => {
  it("maps feedback events to title-only events (url dropped)", () => {
    const events = topicEventsFromFeedback(
      topicWith({ format: "plain", text: "", assets: [], links: [], events: [
        { title: "Вебинар", url: "https://e.test" },
        { title: "Митап" },
      ] }),
    );
    expect(events).toEqual([
      { id: "t1:event:0", topicId: "t1", title: "Вебинар" },
      { id: "t1:event:1", topicId: "t1", title: "Митап" },
    ]);
  });

  it("returns [] when there are no events", () => {
    expect(topicEventsFromFeedback(topicWith({ format: "plain", text: "", links: [], assets: [], events: [] }))).toEqual([]);
    expect(topicEventsFromFeedback(null)).toEqual([]);
  });
});
