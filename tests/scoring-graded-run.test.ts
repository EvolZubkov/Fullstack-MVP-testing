/**
 * @module tests/scoring-graded-run
 * @description PRD-29 §6.7: «оценивает ли этот прогон вообще» — the two-condition
 * rule (a threshold IS declared AND there is something to grade) extracted out of
 * the results-screen builder so the AUTHOR-facing analytics answers the question
 * exactly as the learner-facing screen does. Two answers to one question is what
 * PRD-29 already paid for once (the verdict gate that lived inside the measures
 * branch and never reached a control test).
 */
import { describe, it, expect } from "vitest";
import { hasGradedScore, hasPronouncedVerdict } from "@shared/scoring/pass-rule";

describe("hasGradedScore — PRD-29 §6.7 (summary gate)", () => {
  it("a declared threshold over gradable points grades", () => {
    expect(hasGradedScore(true, 10)).toBe(true);
  });

  it("a measurement run does NOT grade even with the default 70% threshold", () => {
    // Every new test carries the default threshold, so the threshold ALONE would
    // call a questionnaire graded and paint «0 %» over a burnout inventory.
    expect(hasGradedScore(true, 0)).toBe(false);
  });

  it("an author-declared «no threshold» does not grade", () => {
    expect(hasGradedScore(false, 10)).toBe(false);
  });

  it("an UNKNOWN threshold does not grade — the summary may be silenced on doubt", () => {
    expect(hasGradedScore(undefined, 10)).toBe(false);
  });

  it("sub-0.1 possible points round to nothing to grade", () => {
    expect(hasGradedScore(true, 0.04)).toBe(false);
    expect(hasGradedScore(true, 0.05)).toBe(true);
  });
});

describe("hasPronouncedVerdict — PRD-29 §6.7 (verdict gate)", () => {
  it("keeps the verdict when the threshold flag is UNKNOWN", () => {
    // The one deliberate difference from the summary gate: a host that has not been
    // taught to send the flag must not lose the verdict of every graded test.
    expect(hasPronouncedVerdict(undefined, 10)).toBe(true);
  });

  it("silences on the author's own «no threshold»", () => {
    expect(hasPronouncedVerdict(false, 10)).toBe(false);
  });

  it("silences when there was nothing to grade, whatever the flag says", () => {
    expect(hasPronouncedVerdict(true, 0)).toBe(false);
    expect(hasPronouncedVerdict(undefined, 0)).toBe(false);
  });

  it("pronounces a verdict on a graded run", () => {
    expect(hasPronouncedVerdict(true, 10)).toBe(true);
  });
});
