/**
 * @module schema-prd10-scoring
 * @description Tests for PRD-10 graded-answer-scoring Zod schemas
 * (scoring-model §11): scoringConditionSchema, scoringPredicateSchema,
 * scoringTierSchema and the discriminated questionScoringSchema.
 *
 * Covers (PRD-10 FR-02, FR-07, FR-13):
 *   - `kind` discriminates exact | weighted | tiered; unknown/missing rejected.
 *   - weighted: weights are non-negative and non-empty; optional positive sMax.
 *   - tiered: at least one tier; tier score floored at >= 0; predicate is a
 *     non-empty conjunction over counters c/x with rhs number | T | P | N.
 *   - questionScoringSchema.nullish() accepts null/undefined (= exact default).
 */
import { describe, it, expect } from "vitest";
import {
  scoringConditionSchema,
  scoringPredicateSchema,
  scoringTierSchema,
  questionScoringSchema,
} from "../shared/schema";

// ─── scoringConditionSchema ──────────────────────────────────────────────────

describe("scoringConditionSchema", () => {
  it("accepts a numeric rhs", () => {
    expect(() => scoringConditionSchema.parse({ lhs: "c", op: ">=", rhs: 2 })).not.toThrow();
  });

  it.each(["T", "P", "N"] as const)("accepts counter token rhs %s", (rhs) => {
    expect(() => scoringConditionSchema.parse({ lhs: "x", op: "<=", rhs })).not.toThrow();
  });

  it.each(["==", ">=", "<=", "<", ">"] as const)("accepts operator %s", (op) => {
    expect(() => scoringConditionSchema.parse({ lhs: "c", op, rhs: 0 })).not.toThrow();
  });

  it("rejects an unknown lhs counter", () => {
    expect(() => scoringConditionSchema.parse({ lhs: "z", op: "==", rhs: 1 })).toThrow();
  });

  it("rejects an unknown operator", () => {
    expect(() => scoringConditionSchema.parse({ lhs: "c", op: "!=", rhs: 1 })).toThrow();
  });

  it("rejects an unknown rhs token", () => {
    expect(() => scoringConditionSchema.parse({ lhs: "c", op: "==", rhs: "Q" })).toThrow();
  });
});

// ─── scoringPredicateSchema ──────────────────────────────────────────────────

describe("scoringPredicateSchema", () => {
  it("accepts a conjunction of one or more conditions", () => {
    expect(() =>
      scoringPredicateSchema.parse({
        all: [
          { lhs: "c", op: ">=", rhs: 1 },
          { lhs: "x", op: "<=", rhs: 1 },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects an empty conjunction", () => {
    expect(() => scoringPredicateSchema.parse({ all: [] })).toThrow();
  });
});

// ─── scoringTierSchema ───────────────────────────────────────────────────────

describe("scoringTierSchema", () => {
  it("accepts a tier with a non-negative score", () => {
    expect(() =>
      scoringTierSchema.parse({ when: { all: [{ lhs: "c", op: "==", rhs: "T" }] }, score: 2 }),
    ).not.toThrow();
  });

  it("accepts a zero score", () => {
    expect(() =>
      scoringTierSchema.parse({ when: { all: [{ lhs: "c", op: "==", rhs: 0 }] }, score: 0 }),
    ).not.toThrow();
  });

  it("rejects a negative score (floor at 0, FR-07)", () => {
    expect(() =>
      scoringTierSchema.parse({ when: { all: [{ lhs: "c", op: "==", rhs: "T" }] }, score: -1 }),
    ).toThrow();
  });
});

// ─── questionScoringSchema (discriminated union) ─────────────────────────────

describe("questionScoringSchema", () => {
  it("accepts exact", () => {
    expect(() => questionScoringSchema.parse({ kind: "exact" })).not.toThrow();
  });

  it("accepts weighted with non-negative weights", () => {
    expect(() => questionScoringSchema.parse({ kind: "weighted", weights: [2, 1, 1, 0] })).not.toThrow();
  });

  it("accepts weighted with an explicit positive sMax", () => {
    expect(() =>
      questionScoringSchema.parse({ kind: "weighted", weights: [0, 1, 2], sMax: 2 }),
    ).not.toThrow();
  });

  it("rejects weighted with a negative weight (FR-13)", () => {
    expect(() => questionScoringSchema.parse({ kind: "weighted", weights: [1, -1] })).toThrow();
  });

  it("rejects weighted with no weights", () => {
    expect(() => questionScoringSchema.parse({ kind: "weighted", weights: [] })).toThrow();
  });

  it("rejects a non-positive sMax (FR-13)", () => {
    expect(() => questionScoringSchema.parse({ kind: "weighted", weights: [1], sMax: 0 })).toThrow();
  });

  it("accepts tiered with an ordered tier table", () => {
    expect(() =>
      questionScoringSchema.parse({
        kind: "tiered",
        tiers: [
          { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
          { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }, { lhs: "x", op: "<=", rhs: 1 }] }, score: 1 },
        ],
      }),
    ).not.toThrow();
  });

  it("rejects tiered with no tiers", () => {
    expect(() => questionScoringSchema.parse({ kind: "tiered", tiers: [] })).toThrow();
  });

  it("rejects an unknown kind", () => {
    expect(() => questionScoringSchema.parse({ kind: "rubric", weights: [1] })).toThrow();
  });

  it("rejects a missing kind", () => {
    expect(() => questionScoringSchema.parse({ weights: [1] })).toThrow();
  });

  it("nullish() accepts null and undefined (= exact default, FR-02)", () => {
    const nullable = questionScoringSchema.nullish();
    expect(() => nullable.parse(null)).not.toThrow();
    expect(() => nullable.parse(undefined)).not.toThrow();
  });
});
