/**
 * @module client/src/pages/learner/__tests__/content-pages-between
 *
 * The web host's zone slicing: which author pages are due before a given question,
 * between two questions, and after the last one. The sequence itself is built by
 * the shared builder (covered in tests/shared.page-sequence); this locks how the
 * web walks it.
 */
import { describe, it, expect } from "vitest";
import { buildPageSequence } from "@shared/flow/page-sequence";
import { contentPagesBetween, splitZoneAtBoundary } from "../take-test";

const CONTENT = [
  { id: "before-1", kind: "info", type: "info", topicId: null, position: "before", sortOrder: 0 },
  { id: "t1-pre", kind: "info", type: "info", topicId: "t1", position: "before_topic", sortOrder: 0 },
  { id: "t1-post", kind: "info", type: "info", topicId: "t1", position: "after_topic", sortOrder: 0 },
  { id: "t2-pre", kind: "info", type: "info", topicId: "t2", position: "before_topic", sortOrder: 0 },
  { id: "after-1", kind: "info", type: "info", topicId: null, position: "after", sortOrder: 0 },
];

const SEQUENCE = buildPageSequence({
  flowMode: "linear_by_topics",
  sections: [{ topicId: "t1" }, { topicId: "t2" }],
  contentPages: CONTENT,
  flatQuestions: [{ topicId: "t1" }, { topicId: "t2" }],
}).sequence;

const ids = (pages: { id?: string }[]) => pages.map((p) => p.id);

describe("contentPagesBetween", () => {
  it("returns the «До теста» zone before the first question", () => {
    expect(ids(contentPagesBetween(SEQUENCE, null, 0))).toEqual(["before-1", "t1-pre"]);
  });

  it("returns the pages sitting between two questions", () => {
    expect(ids(contentPagesBetween(SEQUENCE, 0, 1))).toEqual(["t1-post", "t2-pre"]);
  });

  it("returns the «После теста» pre-results zone after the last question", () => {
    expect(ids(contentPagesBetween(SEQUENCE, 1, null))).toEqual(["after-1"]);
  });

  it("returns nothing between adjacent questions with no pages between them", () => {
    const seq = buildPageSequence({
      flowMode: "linear_flat",
      contentPages: [],
      flatQuestions: [{ topicId: "t1" }, { topicId: "t1" }],
    }).sequence;
    expect(contentPagesBetween(seq, 0, 1)).toEqual([]);
  });

  // The hub is a navigation screen, not a content page. Until the web host renders
  // it, emitting it here would show a dead «Далее» page instead of the router.
  it("skips the router hub", () => {
    const seq = buildPageSequence({
      flowMode: "router_by_topics",
      contentPages: [
        { id: "before-1", kind: "info", type: "info", topicId: null, position: "before", sortOrder: 0 },
        { id: "hub", kind: "router", topicId: null, position: "before", sortOrder: 0 },
      ],
      flatQuestions: [{ topicId: "t1" }],
    }).sequence;
    expect(ids(contentPagesBetween(seq, null, null))).toEqual(["before-1"]);
  });

  it("treats an unknown question index as an open bound rather than dropping pages", () => {
    expect(ids(contentPagesBetween(SEQUENCE, null, 99))).toEqual([
      "before-1", "t1-pre", "t1-post", "t2-pre", "after-1",
    ]);
  });
});

describe("splitZoneAtBoundary", () => {
  const topicOf = (i: number) => (i === 0 ? "t1" : "t2");

  // Regression (found in the browser): played whole, the gap put the NEXT section's
  // «Введение раздела» ahead of the previous section's «Итоги раздела». The pages of
  // the section being left must precede the boundary screens; the entered section's
  // must follow them.
  it("puts the leaving section's pages before the boundary and the entered section's after", () => {
    const { departure, arrival } = splitZoneAtBoundary(SEQUENCE, 0, 1, topicOf);
    expect(ids(departure)).toEqual(["t1-post"]);
    expect(ids(arrival)).toEqual(["t2-pre"]);
  });

  it("keeps the whole gap on departure when both questions are in one section", () => {
    const seq = buildPageSequence({
      flowMode: "linear_by_topics",
      sections: [{ topicId: "t1" }],
      contentPages: [
        { id: "mid", kind: "info", type: "info", topicId: "t1", position: "after_topic", sortOrder: 0 },
      ],
      flatQuestions: [{ topicId: "t1" }, { topicId: "t1" }],
    }).sequence;
    const { departure, arrival } = splitZoneAtBoundary(seq, 0, 1, () => "t1");
    expect(ids(departure)).toEqual([]);
    expect(arrival).toEqual([]);
    // The page trails the section, so it belongs to the end-of-run departure.
    expect(ids(splitZoneAtBoundary(seq, 1, null, () => "t1").departure)).toEqual(["mid"]);
  });

  // The «После теста» zone is test-scope (topicId null) and precedes the results
  // screen, so it rides with the departure rather than waiting on an arrival.
  it("sends the test-scope «После теста» zone out with the departure", () => {
    const { departure, arrival } = splitZoneAtBoundary(SEQUENCE, 1, null, topicOf);
    expect(ids(departure)).toEqual(["after-1"]);
    expect(arrival).toEqual([]);
  });

  // Regression (found in the browser): a section that drew NO questions and sits
  // last has its pages held for an arrival that never comes — the learner reached
  // the results without ever seeing them.
  it("delivers a trailing empty section's pages instead of holding them for an arrival", () => {
    const seq = buildPageSequence({
      flowMode: "linear_by_topics",
      sections: [{ topicId: "t1" }, { topicId: "empty" }],
      contentPages: [
        { id: "t1-post", kind: "info", type: "info", topicId: "t1", position: "after_topic", sortOrder: 0 },
        { id: "empty-pre", kind: "info", type: "info", topicId: "empty", position: "before_topic", sortOrder: 0 },
        { id: "empty-post", kind: "info", type: "info", topicId: "empty", position: "after_topic", sortOrder: 0 },
        { id: "after-1", kind: "info", type: "info", topicId: null, position: "after", sortOrder: 0 },
      ],
      flatQuestions: [{ topicId: "t1" }],
    }).sequence;
    const { departure, arrival } = splitZoneAtBoundary(seq, 0, null, () => "t1");
    expect(ids(departure)).toEqual(["t1-post", "empty-pre", "empty-post", "after-1"]);
    expect(arrival).toEqual([]);
  });
});

describe("contentPagesBetween — bounds", () => {
  it("keeps an unknown bound open", () => {
    expect(ids(contentPagesBetween(SEQUENCE, null, 99))).toEqual([
      "before-1", "t1-pre", "t1-post", "t2-pre", "after-1",
    ]);
  });
});
