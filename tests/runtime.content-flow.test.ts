/**
 * @module tests/runtime.content-flow
 * Smoke tests for PRD-1 mixed content/question runtime navigation.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadContentFlow() {
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
});
