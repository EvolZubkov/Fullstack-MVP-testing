// @vitest-environment node
/**
 * @module client/pages/learner/__tests__/answer-gate.test
 * Branch coverage for the pure answer-readiness + ranking-delivery helpers
 * ({@link module:client/pages/learner/answer-gate}) that gate the learner submit
 * button. The reshuffle / fallback paths are driven with an injected shuffle so
 * every branch is deterministic.
 */
import { describe, it, expect } from "vitest";
import { deliversShuffledOrder, hasAnswer, rankingDeliveryOrder, shuffleIndices } from "../answer-gate";

describe("deliversShuffledOrder (PRD-16 FR-41/FR-42)", () => {
  it("honours the author's switch for choice and matching questions", () => {
    expect(deliversShuffledOrder({ type: "single", shuffleAnswers: false })).toBe(false);
    expect(deliversShuffledOrder({ type: "multiple", shuffleAnswers: false })).toBe(false);
    expect(deliversShuffledOrder({ type: "matching", shuffleAnswers: false })).toBe(false);
    expect(deliversShuffledOrder({ type: "single", shuffleAnswers: true })).toBe(true);
  });

  it("shuffles when the flag is absent (legacy rows) or the question is missing", () => {
    expect(deliversShuffledOrder({ type: "single" })).toBe(true);
    expect(deliversShuffledOrder(null)).toBe(false);
  });

  it("always shuffles ranking — its authored order is the answer key (FR-42)", () => {
    expect(deliversShuffledOrder({ type: "ranking", shuffleAnswers: false })).toBe(true);
  });

  it("never shuffles a scale — its graduation order is content (PRD-26 FR-04)", () => {
    expect(deliversShuffledOrder({ type: "scale" })).toBe(false);
    expect(deliversShuffledOrder({ type: "scale", shuffleAnswers: true })).toBe(false);
    expect(deliversShuffledOrder({ type: "scale", shuffleAnswers: false })).toBe(false);
  });
});

describe("hasAnswer", () => {
  it("returns true when the question is missing (defensive guard)", () => {
    expect(hasAnswer(undefined, 0)).toBe(true);
    expect(hasAnswer(null, 0)).toBe(true);
  });

  it("single: a chosen index counts, nothing does not", () => {
    const q = { type: "single", dataJson: { options: ["a", "b"] } };
    expect(hasAnswer(q, 0)).toBe(true);
    expect(hasAnswer(q, undefined)).toBe(false);
  });

  it("scale: a chosen graduation counts, including the first one", () => {
    const q = { type: "scale", dataJson: { options: ["Никогда", "Редко", "Часто"] } };
    expect(hasAnswer(q, 0)).toBe(true);
    expect(hasAnswer(q, 2)).toBe(true);
    expect(hasAnswer(q, undefined)).toBe(false);
    expect(hasAnswer(q, null)).toBe(false);
  });

  it("multiple: a non-empty selection counts, an empty one does not", () => {
    const q = { type: "multiple", dataJson: { options: ["a", "b"] } };
    expect(hasAnswer(q, [1])).toBe(true);
    expect(hasAnswer(q, [])).toBe(false);
    expect(hasAnswer(q, undefined)).toBe(false);
  });

  it("matching: needs every pair set to a number", () => {
    const q = { type: "matching", dataJson: { left: ["l0", "l1"], right: ["r0", "r1"] } };
    expect(hasAnswer(q, { 0: 0, 1: 1 })).toBe(true);
    expect(hasAnswer(q, { 0: 0 })).toBe(false); // partial
    expect(hasAnswer(q, { 0: 0, 1: "x" })).toBe(false); // non-number value
    expect(hasAnswer(q, null)).toBe(false); // not an object
    expect(hasAnswer(q, "nope")).toBe(false);
  });

  it("matching: missing left data → need 0 → an empty object counts", () => {
    expect(hasAnswer({ type: "matching", dataJson: {} }, {})).toBe(true);
    expect(hasAnswer({ type: "matching" }, { 0: 0 })).toBe(false); // 1 key !== need 0
  });

  it("ranking: a full-length order counts, undefined / short does not", () => {
    const q = { type: "ranking", dataJson: { items: ["i0", "i1", "i2"] } };
    expect(hasAnswer(q, [2, 0, 1])).toBe(true);
    expect(hasAnswer(q, undefined)).toBe(false);
    expect(hasAnswer(q, [0, 1])).toBe(false); // wrong length
  });

  it("ranking: missing items data → need 0", () => {
    expect(hasAnswer({ type: "ranking" }, [])).toBe(true);
  });

  it("unknown type: any non-null answer counts (default branch)", () => {
    const q = { type: "essay", dataJson: {} };
    expect(hasAnswer(q, "text")).toBe(true);
    expect(hasAnswer(q, null)).toBe(false);
    expect(hasAnswer(q, undefined)).toBe(false);
  });
});

describe("rankingDeliveryOrder", () => {
  it("returns the shuffle unchanged when there is no correct order to avoid", () => {
    expect(rankingDeliveryOrder(3, undefined, () => [1, 0, 2])).toEqual([1, 0, 2]);
  });

  it("returns as-is for a degenerate length < 2", () => {
    expect(rankingDeliveryOrder(1, [0], () => [0])).toEqual([0]);
  });

  it("returns as-is when the correct order length mismatches", () => {
    expect(rankingDeliveryOrder(3, [0, 1], () => [1, 0, 2])).toEqual([1, 0, 2]);
  });

  it("keeps a shuffle that already differs from the correct order", () => {
    expect(rankingDeliveryOrder(3, [0, 1, 2], () => [2, 1, 0])).toEqual([2, 1, 0]);
  });

  it("reshuffles when the first shuffle equals the correct order", () => {
    const seq = [[0, 1, 2], [2, 0, 1]];
    let i = 0;
    const shuffle = () => seq[Math.min(i++, seq.length - 1)].slice();
    expect(rankingDeliveryOrder(3, [0, 1, 2], shuffle)).toEqual([2, 0, 1]);
  });

  it("falls back to a forced first-pair swap when the RNG is stuck on the correct order", () => {
    const out = rankingDeliveryOrder(3, [0, 1, 2], () => [0, 1, 2]);
    expect(out).toEqual([1, 0, 2]);
    expect(out).not.toEqual([0, 1, 2]);
  });

  it("default (Math.random) shuffle never returns the correct order", () => {
    for (let k = 0; k < 200; k++) {
      expect(rankingDeliveryOrder(2, [0, 1])).not.toEqual([0, 1]);
    }
  });
});

describe("shuffleIndices", () => {
  it("returns a permutation of 0..n-1", () => {
    expect(shuffleIndices(5).slice().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("handles length 0 and 1", () => {
    expect(shuffleIndices(0)).toEqual([]);
    expect(shuffleIndices(1)).toEqual([0]);
  });
});
