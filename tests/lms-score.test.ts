/**
 * @module tests/lms-score
 * @description What the SCORM package reports to the LMS as `cmi.score` when the run had
 * NOTHING to grade (technical debt, ROADMAP §0.3; discovered by the WebTutor export review,
 * PRD-54 §14.1).
 *
 * The verdict of a measurement run is «passed» by construction — a run with nothing to grade
 * has no threshold to fall short of (PRD-26 FR-09) — but the score was sent anyway, as a flat
 * `raw = 0 / max = 100`. In the customer's report that reads as a failure: «Пройден» next to
 * «Баллы 0», under a declared 70 % threshold. One level down the same package is already
 * careful: `buildTopicObjective` omits the score block of a measurement topic deliberately.
 * These tests hold the root score to the same rule.
 */
import { describe, it, expect } from "vitest";
import { lmsScoreFor } from "@shared/scoring/lms-score";

describe("lmsScoreFor", () => {
  it("a graded run reports its percent out of 100", () => {
    expect(lmsScoreFor({ percent: 83, possiblePoints: 12 })).toEqual({ raw: 83, max: 100 });
  });

  it("a measurement run reports NO score at all", () => {
    // SCORM 2004 allows `cmi.score` to be absent; «0 of 100» is a claim we cannot make.
    expect(lmsScoreFor({ percent: 0, possiblePoints: 0 })).toBeNull();
  });

  it("rounds the percent the same way the results screen does", () => {
    expect(lmsScoreFor({ percent: 83.4, possiblePoints: 12 })).toEqual({ raw: 83, max: 100 });
    expect(lmsScoreFor({ percent: 83.5, possiblePoints: 12 })).toEqual({ raw: 84, max: 100 });
  });

  it("shares the «nothing to grade» threshold with the rest of scoring", () => {
    // Same rounding boundary as `nothingToGrade`: points show at most one decimal.
    expect(lmsScoreFor({ percent: 0, possiblePoints: 0.04 })).toBeNull();
    expect(lmsScoreFor({ percent: 50, possiblePoints: 0.05 })).toEqual({ raw: 50, max: 100 });
  });

  it("an UNKNOWN possible-points figure keeps the score", () => {
    // An attempt saved by an older package can carry `percent` and nothing else (the same
    // legacy shape `buildTopicObjective` degrades to). Unknown is not «nothing to grade»:
    // silencing on doubt would drop the score of every graded test restored from such a
    // record. The same asymmetry `hasPronouncedVerdict` already makes for the verdict.
    expect(lmsScoreFor({ percent: 62, possiblePoints: undefined })).toEqual({ raw: 62, max: 100 });
    expect(lmsScoreFor({ percent: 62, possiblePoints: null })).toEqual({ raw: 62, max: 100 });
  });

  it("a zero score on a graded run is still a score", () => {
    // The learner who answered everything wrong DID earn zero — that is a fact, not a gap.
    expect(lmsScoreFor({ percent: 0, possiblePoints: 10 })).toEqual({ raw: 0, max: 100 });
  });
});

// WebTutor records «Пройден» / «Не пройден» by comparing the reported points with the course's
// own passing score and ignores the package's success_status and scaled (checked live on
// testuniver.rt.ru, 2026-09-30). A verdict the score alone does not express — a failed
// required topic at 90 %, a certification passed by its indicators at 60 % — reaches the
// LMS only through the points, so they are moved to the threshold exactly when, and only
// as far as, the two disagree.
describe("lmsScoreFor — the verdict carried through the points", () => {
  const graded = { possiblePoints: 64 };

  it("verdict and points agree: the real points go out", () => {
    expect(lmsScoreFor({ ...graded, percent: 46, passed: false, lmsThreshold: 80 })).toEqual({ raw: 46, max: 100 });
    expect(lmsScoreFor({ ...graded, percent: 92, passed: true, lmsThreshold: 80 })).toEqual({ raw: 92, max: 100 });
  });

  it("failed at or above the threshold: one point under it", () => {
    expect(lmsScoreFor({ ...graded, percent: 90, passed: false, lmsThreshold: 80 })).toEqual({ raw: 79, max: 100 });
    expect(lmsScoreFor({ ...graded, percent: 80, passed: false, lmsThreshold: 80 })).toEqual({ raw: 79, max: 100 });
  });

  it("passed below the threshold: exactly the threshold", () => {
    expect(lmsScoreFor({ ...graded, percent: 60, passed: true, lmsThreshold: 80 })).toEqual({ raw: 80, max: 100 });
  });

  it("threshold 0: every outcome is a pass for the LMS, the real points go out", () => {
    expect(lmsScoreFor({ ...graded, percent: 12, passed: false, lmsThreshold: 0 })).toEqual({ raw: 12, max: 100 });
  });

  it("no verdict or no threshold (adaptive, ungraded, older callers): the real points go out", () => {
    expect(lmsScoreFor({ ...graded, percent: 90, passed: null, lmsThreshold: 80 })).toEqual({ raw: 90, max: 100 });
    expect(lmsScoreFor({ ...graded, percent: 90, passed: false })).toEqual({ raw: 90, max: 100 });
    expect(lmsScoreFor({ ...graded, percent: 90, passed: false, lmsThreshold: null })).toEqual({ raw: 90, max: 100 });
  });

  it("a measurement run still reports no score, whatever the verdict", () => {
    expect(lmsScoreFor({ percent: 0, possiblePoints: 0, passed: true, lmsThreshold: 80 })).toBeNull();
  });
});
