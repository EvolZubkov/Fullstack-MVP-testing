/**
 * @module shared/analytics/__tests__/attempt-pick.test
 * @description Attempt-pick rule of psychometrics (PRD-66 FR-51, delta 2026-10-07): one rule out
 * of four, parsed from the address with the legacy `firstAttemptOnly` as a synonym, and the
 * selection of one passage per participant — first, best or last.
 */
import { describe, it, expect } from "vitest";
import { attemptPickFromQuery, isAttemptPick, pickAttemptIds, type AttemptCandidate } from "../attempt-pick";

const day = (n: number): number => Date.UTC(2026, 9, n);

const candidates: AttemptCandidate[] = [
  { id: "a1", participantId: "u1", at: day(1), percent: 40 },
  { id: "a2", participantId: "u1", at: day(2), percent: 90 },
  { id: "a3", participantId: "u1", at: day(3), percent: 70 },
  { id: "b1", participantId: "u2", at: day(1), percent: 80 },
  { id: "x1", participantId: null, at: day(1), percent: 100 },
];

describe("attemptPickFromQuery", () => {
  it("reads `attempts` and ignores the legacy parameter beside it", () => {
    expect(attemptPickFromQuery({ attempts: "best", firstAttemptOnly: "false" }, "first")).toBe("best");
    expect(attemptPickFromQuery({ attempts: "last" }, "first")).toBe("last");
  });

  it("understands the legacy `firstAttemptOnly`", () => {
    expect(attemptPickFromQuery({ firstAttemptOnly: "false" }, "first")).toBe("all");
    expect(attemptPickFromQuery({ firstAttemptOnly: "FALSE" }, "all")).toBe("all");
    expect(attemptPickFromQuery({ firstAttemptOnly: "true" }, "all")).toBe("first");
  });

  it("falls back to the caller's default on an absent or unknown value", () => {
    expect(attemptPickFromQuery({}, "first")).toBe("first");
    expect(attemptPickFromQuery({}, "all")).toBe("all");
    expect(attemptPickFromQuery({ attempts: "worst" }, "first")).toBe("first");
  });

  it("recognises only the four rules", () => {
    expect(["all", "first", "best", "last"].every(isAttemptPick)).toBe(true);
    expect(isAttemptPick("worst")).toBe(false);
    expect(isAttemptPick(undefined)).toBe(false);
  });
});

describe("pickAttemptIds", () => {
  it("returns null for «all» — no selection at all", () => {
    expect(pickAttemptIds(candidates, "all")).toBeNull();
  });

  it("keeps the earliest passage for «first»", () => {
    expect(pickAttemptIds(candidates, "first")).toEqual(new Set(["a1", "b1"]));
  });

  it("keeps the latest passage for «last»", () => {
    expect(pickAttemptIds(candidates, "last")).toEqual(new Set(["a3", "b1"]));
  });

  it("keeps the highest percent for «best»", () => {
    expect(pickAttemptIds(candidates, "best")).toEqual(new Set(["a2", "b1"]));
  });

  it("breaks a tie of «best» towards the earlier passage", () => {
    const tie: AttemptCandidate[] = [
      { id: "late", participantId: "u1", at: day(5), percent: 90 },
      { id: "early", participantId: "u1", at: day(2), percent: 90 },
    ];
    expect(pickAttemptIds(tie, "best")).toEqual(new Set(["early"]));
  });

  it("leaves passages without a result out of «best», and a participant with none of them", () => {
    const unscored: AttemptCandidate[] = [
      { id: "open", participantId: "u1", at: day(9), percent: null },
      { id: "done", participantId: "u1", at: day(1), percent: 10 },
      { id: "only-open", participantId: "u2", at: day(1), percent: null },
    ];
    expect(pickAttemptIds(unscored, "best")).toEqual(new Set(["done"]));
  });

  it("«first» drops a participant whose earliest passage the package reported as a repeat (PRD-54, decision 13)", () => {
    const rows: AttemptCandidate[] = [
      { id: "a3", participantId: "A", at: 1, percent: 40, reportedAttempt: 3 },
      { id: "a-web", participantId: "A", at: 5, percent: 90 },
      { id: "b1", participantId: "B", at: 2, percent: 70, reportedAttempt: 1 },
    ];
    expect(pickAttemptIds(rows, "first")).toEqual(new Set(["b1"]));
    // The report row IS the attempt the package handed to the LMS — «best» and «last» keep it.
    expect(pickAttemptIds(rows, "best")).toEqual(new Set(["a-web", "b1"]));
    expect(pickAttemptIds(rows, "last")).toEqual(new Set(["a-web", "b1"]));
    expect(pickAttemptIds([{ id: "a3", participantId: "A", at: 1, percent: 40, reportedAttempt: 3 }], "best")).toEqual(new Set(["a3"]));
  });

  it("drops an unidentified participant under every narrowing rule", () => {
    for (const pick of ["first", "best", "last"] as const) {
      expect(pickAttemptIds(candidates, pick)?.has("x1")).toBe(false);
    }
  });
});
