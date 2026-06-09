/**
 * @module tests/scoring-engine
 * @description Unit tests for the PRD-10 graded-answer-scoring engine
 * (shared/scoring/engine.ts). Covers exact (legacy 0/1), weighted (option
 * weights) and tiered (non-additive step table over the answer counters), the
 * sMax derivation and the s/sMax ratio (scoring-model §11; FR-01..FR-07).
 *
 * The РТК scenario is the load-bearing case: a multiple-choice answer with an
 * extra wrong option drops a tier (ABD over AB -> 1, not 2) — the behaviour the
 * external pandas post-processor encoded.
 */
import { describe, it, expect } from "vitest";
import { scoreAnswer, type ScoreInput } from "../shared/scoring/engine";
import type { QuestionScoring } from "../shared/schema";

// ─── exact (absent / kind:'exact') ───────────────────────────────────────────

describe("scoreAnswer — exact (default)", () => {
  const single: ScoreInput = { type: "single", correct: { correctIndex: 2 }, answer: 2 };

  it("absent scoring scores 1/1 for a correct answer (FR-02)", () => {
    expect(scoreAnswer(single)).toEqual({ score: 1, sMax: 1, ratio: 1 });
  });

  it("absent scoring scores 0 for a wrong answer", () => {
    expect(scoreAnswer({ ...single, answer: 0 })).toEqual({ score: 0, sMax: 1, ratio: 0 });
  });

  it("null answer scores 0", () => {
    expect(scoreAnswer({ ...single, answer: null }).ratio).toBe(0);
  });

  it("explicit kind:'exact' matches absent scoring", () => {
    expect(scoreAnswer({ ...single, scoring: { kind: "exact" } })).toEqual({ score: 1, sMax: 1, ratio: 1 });
  });

  it("multiple set-equality (exact) stays 0/1", () => {
    const m: ScoreInput = { type: "multiple", correct: { correctIndices: [0, 2] }, answer: [2, 0] };
    expect(scoreAnswer(m).ratio).toBe(1);
    expect(scoreAnswer({ ...m, answer: [0, 1, 2] }).ratio).toBe(0);
  });
});

// ─── weighted (single) ───────────────────────────────────────────────────────

describe("scoreAnswer — weighted", () => {
  const weighted: QuestionScoring = { kind: "weighted", weights: [2, 1, 1, 0] };
  const base: ScoreInput = { type: "single", correct: { correctIndex: 0 }, answer: 0, scoring: weighted };

  it("scores the weight of the chosen option; sMax = max(weights)", () => {
    expect(scoreAnswer(base)).toEqual({ score: 2, sMax: 2, ratio: 1 });
    expect(scoreAnswer({ ...base, answer: 1 })).toEqual({ score: 1, sMax: 2, ratio: 0.5 });
    expect(scoreAnswer({ ...base, answer: 3 })).toEqual({ score: 0, sMax: 2, ratio: 0 });
  });

  it("out-of-range answer scores 0", () => {
    expect(scoreAnswer({ ...base, answer: 9 }).score).toBe(0);
  });

  it("honours an explicit sMax override", () => {
    const s: QuestionScoring = { kind: "weighted", weights: [2, 1, 1, 0], sMax: 4 };
    expect(scoreAnswer({ ...base, scoring: s })).toEqual({ score: 2, sMax: 4, ratio: 0.5 });
  });
});

// ─── tiered (multiple) — the РТК non-additivity case ─────────────────────────

describe("scoreAnswer — tiered multiple (РТК)", () => {
  // Эталон A,B (correctIndices [0,1], T = 2). Tiers (эскиз s-tiered-multiple):
  //   c == T & x == 0 -> 2 ; c >= 1 & x <= 1 -> 1 ; else 0.
  const tiered: QuestionScoring = {
    kind: "tiered",
    tiers: [
      { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
      { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }, { lhs: "x", op: "<=", rhs: 1 }] }, score: 1 },
    ],
  };
  const base: ScoreInput = { type: "multiple", correct: { correctIndices: [0, 1] }, answer: [0, 1], scoring: tiered };

  it("A,B (c=2,x=0) -> full 2/2", () => {
    expect(scoreAnswer(base)).toEqual({ score: 2, sMax: 2, ratio: 1 });
  });

  it("A,B,C (c=2,x=1) -> 1, NOT 2 (extra wrong drops a tier)", () => {
    expect(scoreAnswer({ ...base, answer: [0, 1, 2] })).toEqual({ score: 1, sMax: 2, ratio: 0.5 });
  });

  it("A only (c=1,x=0) -> partial 1/2", () => {
    expect(scoreAnswer({ ...base, answer: [0] })).toEqual({ score: 1, sMax: 2, ratio: 0.5 });
  });

  it("C,D (c=0,x=2) -> 0 (no tier matches)", () => {
    expect(scoreAnswer({ ...base, answer: [2, 3] })).toEqual({ score: 0, sMax: 2, ratio: 0 });
  });

  it("null answer scores 0 (tiers not evaluated)", () => {
    expect(scoreAnswer({ ...base, answer: null }).score).toBe(0);
  });
});

// ─── tiered (matching) — counter P ───────────────────────────────────────────

describe("scoreAnswer — tiered matching", () => {
  // 4 pairs (P = 4). Tiers: c == P -> 3 ; c >= 2 -> 2 ; c == 1 -> 1 ; else 0.
  const tiered: QuestionScoring = {
    kind: "tiered",
    tiers: [
      { when: { all: [{ lhs: "c", op: "==", rhs: "P" }] }, score: 3 },
      { when: { all: [{ lhs: "c", op: ">=", rhs: 2 }] }, score: 2 },
      { when: { all: [{ lhs: "c", op: "==", rhs: 1 }] }, score: 1 },
    ],
  };
  const correct = { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }, { left: 3, right: 3 }] };
  const base: ScoreInput = { type: "matching", correct, answer: { 0: 0, 1: 1, 2: 2, 3: 3 }, scoring: tiered };

  it("all 4 pairs (c=4) -> 3/3", () => {
    expect(scoreAnswer(base)).toEqual({ score: 3, sMax: 3, ratio: 1 });
  });

  it("3 of 4 (c=3) -> 2", () => {
    expect(scoreAnswer({ ...base, answer: { 0: 0, 1: 1, 2: 2, 3: 9 } }).score).toBe(2);
  });

  it("1 of 4 (c=1) -> 1", () => {
    expect(scoreAnswer({ ...base, answer: { 0: 0, 1: 9, 2: 9, 3: 9 } }).score).toBe(1);
  });

  it("0 of 4 (c=0) -> 0", () => {
    expect(scoreAnswer({ ...base, answer: { 0: 9, 1: 9, 2: 9, 3: 9 } }).score).toBe(0);
  });
});

// ─── tiered (ranking) — counter N ────────────────────────────────────────────

describe("scoreAnswer — tiered ranking", () => {
  // 3 items (N = 3). Tiers: c == N -> 2 ; c >= 1 -> 1 ; else 0.
  const tiered: QuestionScoring = {
    kind: "tiered",
    tiers: [
      { when: { all: [{ lhs: "c", op: "==", rhs: "N" }] }, score: 2 },
      { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }] }, score: 1 },
    ],
  };
  const base: ScoreInput = { type: "ranking", correct: { correctOrder: [0, 1, 2] }, answer: [0, 1, 2], scoring: tiered };

  it("perfect order (c=3) -> 2/2", () => {
    expect(scoreAnswer(base)).toEqual({ score: 2, sMax: 2, ratio: 1 });
  });

  it("one in place (c=1) -> 1", () => {
    expect(scoreAnswer({ ...base, answer: [0, 2, 1] }).score).toBe(1);
  });

  it("none in place (c=0) -> 0", () => {
    expect(scoreAnswer({ ...base, answer: [2, 0, 1] }).score).toBe(0);
  });
});

// ─── sMax edge ───────────────────────────────────────────────────────────────

describe("scoreAnswer — sMax / ratio edges", () => {
  it("all-zero weights give sMax 0 and ratio 0", () => {
    const s: QuestionScoring = { kind: "weighted", weights: [0, 0, 0] };
    expect(scoreAnswer({ type: "single", correct: { correctIndex: 0 }, answer: 0, scoring: s })).toEqual({
      score: 0, sMax: 0, ratio: 0,
    });
  });

  it("ratio is clamped to [0,1]", () => {
    const r = scoreAnswer({ type: "single", correct: { correctIndex: 0 }, answer: 0, scoring: { kind: "weighted", weights: [5], sMax: 2 } });
    expect(r.ratio).toBe(1);
    expect(r.score).toBe(5);
  });
});
