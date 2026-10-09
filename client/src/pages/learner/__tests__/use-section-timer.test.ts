/**
 * @module client/pages/learner/__tests__/use-section-timer.test
 *
 * Unit tests for the per-topic section timer (PRD-4 v1.1 §3.2): the pure
 * navigation/deadline helpers plus the `useSectionTimer` hook lifecycle
 * (deadline-on-entry, wall-clock expiry, locking, force-advance signal).
 */
import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import {
  nextAccessibleIndex,
  prevAccessibleIndex,
  firstIndexAfterTopic,
  forceAdvanceTarget,
  newRunId,
  useSectionTimer,
  type SectionTimerQuestion,
} from "../use-section-timer";

const q = (topicId: string, limit: number | null = null): SectionTimerQuestion => ({
  topicId,
  sectionTimeLimitMinutes: limit,
});

// A-A-B-B-C flat layout (two questions for A and B, one for C).
const LAYOUT: SectionTimerQuestion[] = [q("A", 1), q("A", 1), q("B", 2), q("B", 2), q("C", null)];

describe("use-section-timer — navigation helpers", () => {
  it("nextAccessibleIndex skips locked topics, null when none remain", () => {
    expect(nextAccessibleIndex(LAYOUT, 0, new Set())).toBe(0);
    expect(nextAccessibleIndex(LAYOUT, 0, new Set(["A"]))).toBe(2); // first B
    expect(nextAccessibleIndex(LAYOUT, 2, new Set(["A", "B"]))).toBe(4); // C
    expect(nextAccessibleIndex(LAYOUT, 0, new Set(["A", "B", "C"]))).toBeNull();
  });

  it("prevAccessibleIndex skips locked topics, null when none remain", () => {
    expect(prevAccessibleIndex(LAYOUT, 4, new Set())).toBe(4);
    expect(prevAccessibleIndex(LAYOUT, 4, new Set(["C"]))).toBe(3); // last B
    expect(prevAccessibleIndex(LAYOUT, 3, new Set(["B"]))).toBe(1); // last A
    expect(prevAccessibleIndex(LAYOUT, 1, new Set(["A"]))).toBeNull();
  });

  it("firstIndexAfterTopic returns the index past a topic's block", () => {
    expect(firstIndexAfterTopic(LAYOUT, "A", 0)).toBe(2);
    expect(firstIndexAfterTopic(LAYOUT, "B", 2)).toBe(4);
    expect(firstIndexAfterTopic(LAYOUT, "C", 4)).toBe(5); // off the end
  });

  it("forceAdvanceTarget lands on the next non-locked topic, null to finish", () => {
    // A expired -> first non-locked after A's block is B (index 2).
    expect(forceAdvanceTarget(LAYOUT, "A", 0, new Set(["A"]))).toBe(2);
    // A and B locked -> C (index 4).
    expect(forceAdvanceTarget(LAYOUT, "A", 0, new Set(["A", "B"]))).toBe(4);
    // Last topic (C) expired -> nothing left -> finish.
    expect(forceAdvanceTarget(LAYOUT, "C", 4, new Set(["C"]))).toBeNull();
  });
});

describe("use-section-timer — PRD-67 page run and stop reason", () => {
  const fetchMock = vi.fn();
  let view: Record<string, unknown>;

  beforeEach(() => {
    view = { remainingSeconds: 60, lockedTopics: [], closedTopics: [] };
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () => ({ ok: true, json: async () => view }));
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const bodyOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body);

  it("newRunId differs between runs", () => {
    expect(newRunId()).not.toBe(newRunId());
  });

  it("every ping of one mount carries the same runId", async () => {
    const { rerender } = renderHook(
      ({ index }) =>
        useSectionTimer({ attemptId: "a1", questions: LAYOUT, currentIndex: index, enabled: true, onExpire: () => {} }),
      { initialProps: { index: 0 } },
    );
    await act(async () => {});
    rerender({ index: 2 }); // A -> B: exit ping + entry ping
    await act(async () => {});
    const runIds = new Set(fetchMock.mock.calls.map((c) => bodyOf(c).runId));
    expect(runIds.size).toBe(1);
    expect([...runIds][0]).toEqual(expect.any(String));
  });

  it("a section closed by a leave is reported with reason «closed»", async () => {
    view = { remainingSeconds: 0, lockedTopics: ["A"], closedTopics: ["A"] };
    const onExpire = vi.fn();
    const { result } = renderHook(() =>
      useSectionTimer({ attemptId: "a1", questions: LAYOUT, currentIndex: 0, enabled: true, onExpire }),
    );
    await act(async () => {});
    expect(onExpire).toHaveBeenCalledWith("A", "closed");
    expect(result.current.closedTopics.has("A")).toBe(true);
    expect(result.current.synced).toBe(true);
  });

  it("a closed test without sections is reported with reason «test-closed»", async () => {
    view = { remainingSeconds: 0, lockedTopics: ["__test__"], closedTopics: ["__test__"] };
    const onExpire = vi.fn();
    renderHook(() =>
      useSectionTimer({ attemptId: "a1", questions: LAYOUT, currentIndex: 0, enabled: true, onExpire }),
    );
    await act(async () => {});
    expect(onExpire).toHaveBeenCalledWith("A", "test-closed");
  });

  it("a spent budget keeps the old reason «time»", async () => {
    view = { remainingSeconds: 0, lockedTopics: ["A"] }; // a pre-PRD-67 server answer
    const onExpire = vi.fn();
    renderHook(() =>
      useSectionTimer({ attemptId: "a1", questions: LAYOUT, currentIndex: 0, enabled: true, onExpire }),
    );
    await act(async () => {});
    expect(onExpire).toHaveBeenCalledWith("A", "time");
  });
});
