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
});
