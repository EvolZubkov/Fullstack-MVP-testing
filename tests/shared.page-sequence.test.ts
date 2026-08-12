/**
 * @module tests/shared.page-sequence
 *
 * The placement matrix: every content-page placement («До теста», «После теста»,
 * перед темой, после темы) against every flow mode. These rules are shared by the
 * SCORM runtime and the web host, so a regression here breaks both at once —
 * which is exactly why they live in one module.
 */
import { describe, it, expect } from "vitest";
import {
  buildPageSequence,
  buildAfterZone,
  buildBeforeZone,
  buildTopicChunk,
  contentPagesFor,
  isFlowContentPage,
  type FlowContentPage,
  type FlowItem,
} from "../shared/flow/page-sequence";

/** Compact view of a sequence: page ids for content, `q<index>` for questions. */
function ids(sequence: FlowItem[]): string[] {
  return sequence.map((item) => {
    if (item.kind === "content") return item.page.id;
    if (item.kind === "adaptive-session") return `adaptive:${item.topicId}`;
    return `q${item.questionIndex}`;
  });
}

function page(over: Partial<FlowContentPage> & { id: string }): FlowContentPage {
  return { kind: "info", type: "info", topicId: null, position: "before", sortOrder: 0, ...over };
}

/** One page in each of the four placements, plus every system kind. */
const ALL_PLACEMENTS: FlowContentPage[] = [
  page({ id: "before-1", position: "before", sortOrder: 0 }),
  page({ id: "before-2", position: "before", sortOrder: 1 }),
  page({ id: "t1-pre", position: "before_topic", topicId: "t1", sortOrder: 0 }),
  page({ id: "t1-post", position: "after_topic", topicId: "t1", sortOrder: 0 }),
  page({ id: "t2-pre", position: "before_topic", topicId: "t2", sortOrder: 0 }),
  page({ id: "t2-post", position: "after_topic", topicId: "t2", sortOrder: 0 }),
  page({ id: "after-1", position: "after", sortOrder: 0 }),
];

const SECTIONS = [{ topicId: "t1" }, { topicId: "t2" }];
const QUESTIONS = [
  { topicId: "t1" },
  { topicId: "t1" },
  { topicId: "t2" },
];

describe("page-sequence — system kinds never flow as pages", () => {
  it.each(["start", "results", "questions", "review", "section-results"])(
    "excludes kind '%s' from every zone",
    (kind) => {
      const pages = [
        page({ id: "sys", kind, position: "before" }),
        page({ id: "author", kind: "info", position: "before" }),
      ];
      expect(ids(buildBeforeZone(pages, "linear_flat"))).toEqual(["author"]);
      expect(isFlowContentPage(pages[0])).toBe(false);
    },
  );

  it("treats the router hub as a flowable page in the before zone, but not an author page", () => {
    const hub = page({ id: "hub", kind: "router" });
    expect(contentPagesFor([hub], null, "before").map((p) => p.id)).toEqual(["hub"]);
    expect(isFlowContentPage(hub)).toBe(false);
  });
});

describe("page-sequence — linear_flat", () => {
  it("delivers all four placements around the question stream", () => {
    const { sequence } = buildPageSequence({
      flowMode: "linear_flat",
      sections: SECTIONS,
      contentPages: ALL_PLACEMENTS,
      flatQuestions: QUESTIONS,
    });
    expect(ids(sequence)).toEqual([
      "before-1", "before-2",
      "t1-pre", "q0", "q1", "t1-post",
      "t2-pre", "q2", "t2-post",
      "after-1",
    ]);
  });

  it("brackets a topic's pages around its first and last question when topics interleave", () => {
    const { sequence } = buildPageSequence({
      flowMode: "linear_flat",
      sections: SECTIONS,
      contentPages: [
        page({ id: "t1-pre", position: "before_topic", topicId: "t1" }),
        page({ id: "t1-post", position: "after_topic", topicId: "t1" }),
      ],
      flatQuestions: [{ topicId: "t1" }, { topicId: "t2" }, { topicId: "t1" }],
    });
    expect(ids(sequence)).toEqual(["t1-pre", "q0", "q1", "q2", "t1-post"]);
  });
});

describe("page-sequence — linear_by_topics", () => {
  it("delivers all four placements, sections in structure order", () => {
    const { sequence } = buildPageSequence({
      flowMode: "linear_by_topics",
      sections: SECTIONS,
      contentPages: ALL_PLACEMENTS,
      flatQuestions: QUESTIONS,
    });
    expect(ids(sequence)).toEqual([
      "before-1", "before-2",
      "t1-pre", "q0", "q1", "t1-post",
      "t2-pre", "q2", "t2-post",
      "after-1",
    ]);
  });

  // Regression: pages used to be anchored on a topic's first / last DRAWN
  // question, so a section that drew nothing lost both of them silently.
  it("keeps a section's pages when its draw came back empty", () => {
    const { sequence } = buildPageSequence({
      flowMode: "linear_by_topics",
      sections: SECTIONS,
      contentPages: ALL_PLACEMENTS,
      flatQuestions: [{ topicId: "t1" }],
    });
    expect(ids(sequence)).toEqual([
      "before-1", "before-2",
      "t1-pre", "q0", "t1-post",
      "t2-pre", "t2-post",
      "after-1",
    ]);
  });

  it("replaces each section's questions with an adaptive marker in adaptive mode", () => {
    const { sequence } = buildPageSequence({
      flowMode: "linear_by_topics",
      testMode: "adaptive",
      sections: SECTIONS,
      contentPages: ALL_PLACEMENTS,
      flatQuestions: [],
    });
    expect(ids(sequence)).toEqual([
      "before-1", "before-2",
      "t1-pre", "adaptive:t1", "t1-post",
      "t2-pre", "adaptive:t2", "t2-post",
      "after-1",
    ]);
  });

  it("still delivers questions whose topic is absent from the sections", () => {
    const { sequence } = buildPageSequence({
      flowMode: "linear_by_topics",
      sections: [{ topicId: "t1" }],
      contentPages: [],
      flatQuestions: [{ topicId: "t1" }, { topicId: "ghost" }],
    });
    expect(ids(sequence)).toEqual(["q0", "q1"]);
  });

  it("falls back to the flat build when the test declares no sections", () => {
    const { sequence } = buildPageSequence({
      flowMode: "linear_by_topics",
      sections: [],
      contentPages: [page({ id: "t1-pre", position: "before_topic", topicId: "t1" })],
      flatQuestions: [{ topicId: "t1" }],
    });
    expect(ids(sequence)).toEqual(["t1-pre", "q0"]);
  });
});

describe("page-sequence — router_by_topics", () => {
  const withHub = [...ALL_PLACEMENTS, page({ id: "hub", kind: "router", position: "before", sortOrder: 0 })];

  // Regression: the hub and the author pages of «До теста» share one sortOrder
  // numbering space and both start at 0. Sorting alone put the hub first, and
  // everything behind it was unreachable — picking a topic REPLACES the sequence.
  it("puts the hub last in the before zone despite a colliding sortOrder", () => {
    const { sequence } = buildPageSequence({
      flowMode: "router_by_topics",
      sections: SECTIONS,
      contentPages: withHub,
      flatQuestions: QUESTIONS,
    });
    expect(ids(sequence)).toEqual(["before-1", "before-2", "hub"]);
    expect(sequence[2]).toMatchObject({ isRouter: true });
    expect(sequence[0]).toMatchObject({ isRouter: false });
  });

  it("keeps the hub last even when its sortOrder sorts after the author pages", () => {
    const { sequence } = buildPageSequence({
      flowMode: "router_by_topics",
      contentPages: [
        page({ id: "hub", kind: "router", sortOrder: 99 }),
        page({ id: "before-1", sortOrder: 5 }),
      ],
    });
    expect(ids(sequence)).toEqual(["before-1", "hub"]);
  });

  it("defers the after zone — it is built only when the learner finishes at the hub", () => {
    const { sequence, postResultsPages } = buildPageSequence({
      flowMode: "router_by_topics",
      contentPages: withHub,
    });
    expect(ids(sequence)).not.toContain("after-1");
    expect(postResultsPages).toEqual([]);
    expect(buildAfterZone(withHub).preResults.map((i) => (i as any).page.id)).toEqual(["after-1"]);
  });

  it("builds a topic chunk with both per-topic placements around its questions", () => {
    expect(ids(buildTopicChunk(ALL_PLACEMENTS, "t1", [0, 1]))).toEqual(["t1-pre", "q0", "q1", "t1-post"]);
  });

  it("keeps a topic's pages in its chunk even with no questions drawn", () => {
    expect(ids(buildTopicChunk(ALL_PLACEMENTS, "t2", []))).toEqual(["t2-pre", "t2-post"]);
  });
});

describe("page-sequence — «После теста» summary boundary", () => {
  const afterPages = [
    page({ id: "pre-results", position: "after", sortOrder: 0 }),
    page({ id: "boundary", position: "after", type: "summary", sortOrder: 1 }),
    page({ id: "post-results", position: "after", sortOrder: 2 }),
  ];

  it("splits the zone at the summary page, which is not itself rendered", () => {
    const { sequence, postResultsPages } = buildPageSequence({
      flowMode: "linear_flat",
      contentPages: afterPages,
      flatQuestions: [],
    });
    expect(ids(sequence)).toEqual(["pre-results"]);
    expect(postResultsPages.map((p) => p.id)).toEqual(["post-results"]);
  });

  it("keeps the whole zone pre-results when no summary boundary exists", () => {
    const { sequence, postResultsPages } = buildPageSequence({
      flowMode: "linear_flat",
      contentPages: [afterPages[0], afterPages[2]],
      flatQuestions: [],
    });
    expect(ids(sequence)).toEqual(["pre-results", "post-results"]);
    expect(postResultsPages).toEqual([]);
  });
});

describe("page-sequence — ordering and defaults", () => {
  it("orders each zone by sortOrder, not by array order", () => {
    const pages = [
      page({ id: "third", sortOrder: 3 }),
      page({ id: "first", sortOrder: 1 }),
      page({ id: "second", sortOrder: 2 }),
    ];
    expect(ids(buildBeforeZone(pages, "linear_flat"))).toEqual(["first", "second", "third"]);
  });

  it("treats a missing flow mode as linear_flat and tolerates empty input", () => {
    expect(buildPageSequence({})).toEqual({ sequence: [], postResultsPages: [] });
  });

  it("does not mutate the caller's content-page array", () => {
    const pages = [page({ id: "b", sortOrder: 2 }), page({ id: "a", sortOrder: 1 })];
    buildBeforeZone(pages, "linear_flat");
    expect(pages.map((p) => p.id)).toEqual(["b", "a"]);
  });
});
