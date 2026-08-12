/**
 * @module tests/runtime.content-flow
 * Smoke tests for PRD-1 mixed content/question runtime navigation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildPageSequence,
  buildTopicChunk,
  buildAfterZone,
} from "../shared/flow/page-sequence";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadContentFlow() {
  // The runtime consumes the shared builders through the `TBTemplate` global the
  // SCORM package exposes (shared/template/runtime-entry). Wiring the REAL module
  // here means these tests exercise the same rules both hosts ship, not a stub.
  (globalThis as any).TBTemplate = { buildPageSequence, buildTopicChunk, buildAfterZone };
  const src = readFileSync(
    path.resolve(__dirname, "../server/scorm/template/app/contentFlow.js"),
    "utf8",
  );
  new Function(src)();
}

describe("Runtime content flow", () => {
  beforeEach(() => {
    (globalThis as any).TEST_DATA = {
      designSettings: { params: { "progress.mode": "pages" } },
      contentPages: [
        { id: "intro", topicId: "t1", position: "before_topic", sortOrder: 0 },
        { id: "summary", topicId: "t1", position: "after_topic", sortOrder: 0 },
      ],
    };
    (globalThis as any).state = {
      currentIndex: 0,
      currentPageIndex: 0,
      phase: "start",
      flatQuestions: [
        { topicId: "t1", question: { id: "q1" } },
      ],
      pageSequence: [],
    };
    (globalThis as any).render = vi.fn();
    (globalThis as any).submit = vi.fn();
    loadContentFlow();
  });

  it("builds intro, question, summary sequence", () => {
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq.map((item: any) => item.kind)).toEqual(["content", "question", "content"]);
    expect(seq[0].page.id).toBe("intro");
    expect(seq[2].page.id).toBe("summary");
  });

  it("advances content -> question -> content without changing answers", () => {
    (globalThis as any).rebuildPageSequence();
    (globalThis as any).goToPageSequenceIndex(0);
    expect((globalThis as any).state.phase).toBe("content");

    (globalThis as any).advancePageSequence();
    expect((globalThis as any).state.phase).toBe("question");
    expect((globalThis as any).state.currentIndex).toBe(0);

    (globalThis as any).advancePageSequence();
    expect((globalThis as any).state.phase).toBe("content");
  });

  it("reports page progress separately from question progress", () => {
    (globalThis as any).rebuildPageSequence();
    (globalThis as any).goToPageSequenceIndex(1);
    expect(Math.round((globalThis as any).pageProgressPercent())).toBe(67);
    expect((globalThis as any).getProgressMode()).toBe("pages");
  });

  it("excludes system design-bindings/nodes from the sequence — no blank «Далее» page", () => {
    // The «Вопросы» row (kind: questions) and the PRD-19 review/section-results
    // nodes are design bindings rendered by their own phases, NOT flow content
    // pages. Leaking the questions binding produced a blank page with just «Далее»
    // at the section start. Only the author `info` page flows here.
    (globalThis as any).TEST_DATA.contentPages = [
      { id: "q-binding", topicId: "t1", position: "before_topic", kind: "questions", sortOrder: 0 },
      { id: "sr-node", topicId: "t1", position: "before_topic", kind: "section-results", sortOrder: 1 },
      { id: "info-1", topicId: "t1", position: "before_topic", kind: "info", sortOrder: 2 },
    ];
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq.map((i: any) => i.kind)).toEqual(["content", "question"]);
    expect(seq[0].page.id).toBe("info-1");
  });
});

describe("Runtime content flow — linear_by_topics section anchoring", () => {
  function setup(contentPages: unknown[], flatQuestions: unknown[], sections: unknown[]) {
    (globalThis as any).TEST_DATA = {
      designSettings: { params: {} },
      flowPolicy: { mode: "linear_by_topics" },
      sections,
      contentPages,
    };
    (globalThis as any).state = {
      currentIndex: 0,
      currentPageIndex: 0,
      phase: "start",
      flatQuestions,
      pageSequence: [],
    };
    (globalThis as any).render = vi.fn();
    (globalThis as any).submit = vi.fn();
    loadContentFlow();
  }

  // Regression: the pages of a section were anchored on its first / last DRAWN
  // question, so a section that drew nothing lost both — silently skipping
  // structure the author had placed.
  it("keeps a section's pages when the section drew no questions", () => {
    setup(
      [
        { id: "t1-before", topicId: "t1", position: "before_topic", kind: "info", sortOrder: 0 },
        { id: "t2-before", topicId: "t2", position: "before_topic", kind: "info", sortOrder: 0 },
        { id: "t2-after", topicId: "t2", position: "after_topic", kind: "info", sortOrder: 0 },
      ],
      [{ topicId: "t1", question: { id: "q1" } }],
      [{ topicId: "t1" }, { topicId: "t2" }],
    );
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq.map((i: any) => (i.kind === "question" ? "q" : i.page.id)))
      .toEqual(["t1-before", "q", "t2-before", "t2-after"]);
  });

  it("emits sections in structure order, not draw order", () => {
    setup(
      [{ id: "t2-before", topicId: "t2", position: "before_topic", kind: "info", sortOrder: 0 }],
      [
        { topicId: "t2", question: { id: "q2" } },
        { topicId: "t1", question: { id: "q1" } },
      ],
      [{ topicId: "t1" }, { topicId: "t2" }],
    );
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq.map((i: any) => (i.kind === "question" ? i.questionIndex : i.page.id)))
      .toEqual([1, "t2-before", 0]);
  });

  it("still delivers questions whose topic is missing from sections", () => {
    setup(
      [],
      [
        { topicId: "t1", question: { id: "q1" } },
        { topicId: "ghost", question: { id: "q2" } },
      ],
      [{ topicId: "t1" }],
    );
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq.map((i: any) => i.questionIndex)).toEqual([0, 1]);
  });

  it("falls back to the question-driven build when no sections are declared", () => {
    setup(
      [{ id: "t1-before", topicId: "t1", position: "before_topic", kind: "info", sortOrder: 0 }],
      [{ topicId: "t1", question: { id: "q1" } }],
      [],
    );
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq.map((i: any) => (i.kind === "question" ? "q" : i.page.id))).toEqual(["t1-before", "q"]);
  });
});

describe("Runtime content flow — router_by_topics hub (PRD-4 v1.1 §4.7)", () => {
  beforeEach(() => {
    // The router hub is a test-scope page (topicId = null) at position 'before'.
    // The runtime seeds the initial pageSequence from the test-scope 'before'
    // pages, so the hub MUST live there — a 'before_topic' router page (the old
    // lifecycle bug) matches no per-topic loop and the hub never renders.
    (globalThis as any).TEST_DATA = {
      designSettings: { params: {} },
      flowPolicy: { mode: "router_by_topics" },
      contentPages: [
        { id: "router", topicId: null, position: "before", kind: "router", sortOrder: 0 },
      ],
    };
    (globalThis as any).state = {
      currentIndex: 0,
      currentPageIndex: 0,
      phase: "start",
      flatQuestions: [{ topicId: "t1", question: { id: "q1" } }],
      pageSequence: [],
    };
    (globalThis as any).render = vi.fn();
    (globalThis as any).submit = vi.fn();
    loadContentFlow();
  });

  it("seeds the router page into the initial sequence with isRouter set", () => {
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq).toHaveLength(1);
    expect(seq[0].kind).toBe("content");
    expect(seq[0].page.id).toBe("router");
    expect(seq[0].isRouter).toBe(true);
  });

  it("enters the 'router' phase when the hub becomes the current page", () => {
    (globalThis as any).rebuildPageSequence();
    (globalThis as any).goToPageSequenceIndex(0);
    expect((globalThis as any).state.phase).toBe("router");
  });

  // Regression: the hub shares the (position 'before', topicId null) bucket with
  // the author pages of the «До теста» zone, and both are numbered from
  // sortOrder 0 — the editor excludes the hub from that numbering. Sorting by
  // sortOrder alone therefore put the hub FIRST, and pages behind it were lost:
  // selectRouterTopic replaces pageSequence with the topic chunk, so they never
  // rendered. The structure the author sees is «До теста» pages, THEN the hub.
  it("renders author «До теста» pages before the hub even when sortOrder collides", () => {
    (globalThis as any).TEST_DATA.contentPages = [
      { id: "router", topicId: null, position: "before", kind: "router", sortOrder: 0 },
      { id: "before-router", topicId: null, position: "before", kind: "info", sortOrder: 0 },
    ];
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq.map((item: any) => item.page.id)).toEqual(["before-router", "router"]);
    expect(seq[0].isRouter).toBe(false);
    expect(seq[1].isRouter).toBe(true);
  });

  it("keeps the hub last regardless of how the author pages are numbered", () => {
    (globalThis as any).TEST_DATA.contentPages = [
      { id: "router", topicId: null, position: "before", kind: "router", sortOrder: 7 },
      { id: "p2", topicId: null, position: "before", kind: "info", sortOrder: 2 },
      { id: "p1", topicId: null, position: "before", kind: "info", sortOrder: 1 },
    ];
    const seq = (globalThis as any).rebuildPageSequence();
    expect(seq.map((item: any) => item.page.id)).toEqual(["p1", "p2", "router"]);
  });

  it("walks the «До теста» pages linearly and lands on the hub", () => {
    (globalThis as any).TEST_DATA.contentPages = [
      { id: "router", topicId: null, position: "before", kind: "router", sortOrder: 0 },
      { id: "before-router", topicId: null, position: "before", kind: "info", sortOrder: 0 },
    ];
    (globalThis as any).rebuildPageSequence();
    (globalThis as any).goToPageSequenceIndex(0);
    expect((globalThis as any).state.phase).toBe("content");

    (globalThis as any).advancePageSequence();
    expect((globalThis as any).state.phase).toBe("router");
    expect((globalThis as any).state.currentPageIndex).toBe(1);
  });
});
