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
  storageKey,
  loadDeadlines,
  saveDeadlines,
  expiredTopics,
  remainingSecondsFor,
  nextAccessibleIndex,
  prevAccessibleIndex,
  firstIndexAfterTopic,
  forceAdvanceTarget,
  useSectionTimer,
  useAdaptiveSectionTimer,
  type SectionTimerQuestion,
} from "../use-section-timer";

const q = (topicId: string, limit: number | null = null): SectionTimerQuestion => ({
  topicId,
  sectionTimeLimitMinutes: limit,
});

// A-A-B-B-C flat layout (two questions for A and B, one for C).
const LAYOUT: SectionTimerQuestion[] = [q("A", 1), q("A", 1), q("B", 2), q("B", 2), q("C", null)];

describe("use-section-timer — persistence helpers", () => {
  beforeEach(() => localStorage.clear());

  it("namespaces the storage key by attempt id", () => {
    expect(storageKey("att-1")).toBe("tb:section-deadlines:att-1");
  });

  it("returns {} when nothing is stored", () => {
    expect(loadDeadlines("att-1")).toEqual({});
  });

  it("round-trips a deadline map through localStorage", () => {
    saveDeadlines("att-1", { A: 1000, B: 2000 });
    expect(loadDeadlines("att-1")).toEqual({ A: 1000, B: 2000 });
  });

  it("returns {} for malformed stored JSON", () => {
    localStorage.setItem(storageKey("att-1"), "{not json");
    expect(loadDeadlines("att-1")).toEqual({});
  });
});

describe("use-section-timer — expiry/remaining helpers", () => {
  it("flags only topics whose deadline is at or before now", () => {
    const locked = expiredTopics({ A: 900, B: 1000, C: 2000 }, 1000);
    expect(locked).toEqual(new Set(["A", "B"]));
  });

  it("remainingSecondsFor rounds up and never goes negative", () => {
    expect(remainingSecondsFor("A", { A: 5500 }, 1000)).toBe(5); // 4.5s -> 5
    expect(remainingSecondsFor("A", { A: 500 }, 1000)).toBe(0); // already past
    expect(remainingSecondsFor("A", {}, 1000)).toBeNull(); // no deadline
    expect(remainingSecondsFor(null, { A: 5000 }, 1000)).toBeNull();
  });
});

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

describe("useSectionTimer — hook lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
  });
  // restore real timers after each test
  afterEach(() => vi.useRealTimers());

  it("sets a deadline on entry and counts down by wall clock", () => {
    const { result } = renderHook(() =>
      useSectionTimer({
        attemptId: "att-1",
        questions: LAYOUT,
        currentIndex: 0,
        enabled: true,
        onExpire: () => {},
      }),
    );
    // Immediate tick on mount: 1 minute = 60s remaining.
    expect(result.current.sectionRemainingSeconds).toBe(60);
    act(() => vi.advanceTimersByTime(10_000));
    expect(result.current.sectionRemainingSeconds).toBe(50);
    // Deadline persisted for resume.
    expect(loadDeadlines("att-1").A).toBeGreaterThan(0);
  });

  it("fires onExpire once and locks the topic when the budget runs out", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() =>
      useSectionTimer({
        attemptId: "att-1",
        questions: LAYOUT,
        currentIndex: 0,
        enabled: true,
        onExpire,
      }),
    );
    act(() => vi.advanceTimersByTime(61_000)); // past the 60s budget
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith("A");
    expect(result.current.lockedTopics.has("A")).toBe(true);
    // Stays at a single signal even after more ticks.
    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
  });

  it("treats an already-passed persisted deadline as expired on resume", () => {
    // Deadline 30s in the PAST relative to the faked clock.
    saveDeadlines("att-1", { A: Date.now() - 30_000 });
    const onExpire = vi.fn();
    renderHook(() =>
      useSectionTimer({
        attemptId: "att-1",
        questions: LAYOUT,
        currentIndex: 0,
        enabled: true,
        onExpire,
      }),
    );
    act(() => vi.advanceTimersByTime(1_000));
    expect(onExpire).toHaveBeenCalledWith("A");
  });

  it("does nothing for a topic without a limit", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() =>
      useSectionTimer({
        attemptId: "att-1",
        questions: LAYOUT,
        currentIndex: 4, // topic C, no limit
        enabled: true,
        onExpire,
      }),
    );
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.sectionRemainingSeconds).toBeNull();
    expect(onExpire).not.toHaveBeenCalled();
    expect(loadDeadlines("att-1")).toEqual({});
  });
});

describe("useAdaptiveSectionTimer — hook lifecycle", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 0, 0, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("counts down the active topic and fires onExpire once at zero", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() =>
      useAdaptiveSectionTimer({
        attemptId: "att-1",
        topicId: "T1",
        limitMinutes: 1,
        enabled: true,
        onExpire,
      }),
    );
    expect(result.current.sectionRemainingSeconds).toBe(60);
    act(() => vi.advanceTimersByTime(30_000));
    expect(result.current.sectionRemainingSeconds).toBe(30);
    act(() => vi.advanceTimersByTime(31_000));
    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith("T1");
    act(() => vi.advanceTimersByTime(5_000));
    expect(onExpire).toHaveBeenCalledTimes(1); // signalled once
  });

  it("is inert when the active topic has no limit", () => {
    const onExpire = vi.fn();
    const { result } = renderHook(() =>
      useAdaptiveSectionTimer({
        attemptId: "att-1",
        topicId: "T1",
        limitMinutes: null,
        enabled: true,
        onExpire,
      }),
    );
    act(() => vi.advanceTimersByTime(120_000));
    expect(result.current.sectionRemainingSeconds).toBeNull();
    expect(onExpire).not.toHaveBeenCalled();
  });
});
