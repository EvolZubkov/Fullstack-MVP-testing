/**
 * @module shared/template/dnd/matching-model.test
 *
 * Test suite for the framework-free matching state model (PRD-12 DnD unification).
 * Pins the RICH pool semantics ported from the SCORM runtime: ordered pool,
 * precise slot removal/insert, displacement of the occupant back to the dragged
 * chip's original slot, de-duplication, and pull-away return. Also guards that
 * every reducer is pure (does not mutate its input).
 */

import { describe, it, expect } from "vitest";
import {
  normalizePool,
  dropOnRight,
  dropOnPoolSlot,
  returnToPool,
  type MatchingState,
} from "./matching-model";

const leftMapping = [0, 1, 2];

describe("normalizePool", () => {
  it("seeds the pool from leftMapping order when empty", () => {
    expect(normalizePool([], {}, leftMapping)).toEqual([0, 1, 2]);
  });

  it("drops matched indices and keeps existing pool order", () => {
    expect(normalizePool([2, 0], { 1: 0 }, leftMapping)).toEqual([2, 0]);
  });

  it("appends missing unmatched indices in leftMapping order", () => {
    expect(normalizePool([2], {}, leftMapping)).toEqual([2, 0, 1]);
  });
});

describe("dropOnRight", () => {
  it("matches a pooled chip and removes it from the pool", () => {
    const state: MatchingState = { pairs: {}, pool: [0, 1, 2] };
    const next = dropOnRight(state, { leftIdx: 1, from: "pool", poolIndex: 1 }, 5);
    expect(next.pairs).toEqual({ 1: 5 });
    expect(next.pool).toEqual([0, 2]);
  });

  it("displaces the occupant back to the dragged chip's original pool slot", () => {
    // left 0 already matched to right 5; drag left 2 (pool slot 0) onto right 5.
    const state: MatchingState = { pairs: { 0: 5 }, pool: [2, 1] };
    const next = dropOnRight(state, { leftIdx: 2, from: "pool", poolIndex: 0 }, 5);
    expect(next.pairs).toEqual({ 2: 5 });
    expect(next.pool).toEqual([0, 1]); // displaced 0 took the freed slot 0
  });

  it("re-matching a chip frees its previous right slot", () => {
    const state: MatchingState = { pairs: { 0: 5 }, pool: [1, 2] };
    const next = dropOnRight(state, { leftIdx: 0, from: "match" }, 6);
    expect(next.pairs).toEqual({ 0: 6 });
    expect(next.pool).toEqual([1, 2]);
  });

  it("de-dupes any stale left mapped to the same right", () => {
    const state: MatchingState = { pairs: { 0: 5 }, pool: [1, 2] };
    // force a second left onto right 5 from the pool — old one must be displaced
    const next = dropOnRight(state, { leftIdx: 1, from: "pool", poolIndex: 0 }, 5);
    const leftsOn5 = Object.keys(next.pairs).filter((k) => next.pairs[Number(k)] === 5);
    expect(leftsOn5).toEqual(["1"]);
  });
});

describe("dropOnPoolSlot", () => {
  it("returns a matched chip into a specific pool slot", () => {
    const state: MatchingState = { pairs: { 0: 5 }, pool: [1, 2] };
    const next = dropOnPoolSlot(state, { leftIdx: 0, from: "match" }, 1);
    expect(next.pairs).toEqual({});
    expect(next.pool).toEqual([1, 0, 2]);
  });

  it("compensates the target slot when reordering within the pool", () => {
    // move pool item at slot 0 (left 0) to slot 2.
    const state: MatchingState = { pairs: {}, pool: [0, 1, 2] };
    const next = dropOnPoolSlot(state, { leftIdx: 0, from: "pool", poolIndex: 0 }, 2);
    expect(next.pool).toEqual([1, 0, 2]); // slot shifted to 1 after self-removal
  });
});

describe("returnToPool", () => {
  it("appends a matched chip to the end of the pool", () => {
    const state: MatchingState = { pairs: { 0: 5, 1: 6 }, pool: [2] };
    const next = returnToPool(state, 0);
    expect(next.pairs).toEqual({ 1: 6 });
    expect(next.pool).toEqual([2, 0]);
  });
});

describe("purity", () => {
  it("does not mutate the input state", () => {
    const state: MatchingState = { pairs: { 0: 5 }, pool: [1, 2] };
    const frozenPairs = { ...state.pairs };
    const frozenPool = state.pool.slice();
    dropOnRight(state, { leftIdx: 1, from: "pool", poolIndex: 0 }, 6);
    dropOnPoolSlot(state, { leftIdx: 0, from: "match" }, 0);
    returnToPool(state, 0);
    expect(state.pairs).toEqual(frozenPairs);
    expect(state.pool).toEqual(frozenPool);
  });
});
