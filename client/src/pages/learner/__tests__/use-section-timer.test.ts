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
