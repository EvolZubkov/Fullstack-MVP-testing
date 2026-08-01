/**
 * @module tests/draw-order-questions
 * @description Unit tests for the PRD-30 ordering engine
 * (shared/draw/order-questions.ts). Ordering is deliberately SEPARATE from
 * selection: `drawSection` (PRD-11) and `selectForm` (PRD-17) decide WHICH
 * questions are delivered, this engine decides in WHAT ORDER (FR-03/04/05).
 *
 * Two shuffles are injected so both halves of the rule are observable:
 * `identity` keeps the input order (asserting the sort itself), `reverse`
 * flips it (asserting that groups of equal indices really are shuffled, and
 * that the shuffle stays INSIDE its group — a reversed whole list would fail
 * the position assertions).
 */
import { describe, it, expect } from "vitest";
import { orderQuestions, type OrderableQuestion } from "../shared/draw/order-questions";

const identity = <T,>(a: T[]): T[] => a;
const reverse = <T,>(a: T[]): T[] => a.slice().reverse();
const ids = (qs: OrderableQuestion[]) => qs.map((q) => q.id);

function q(id: string, orderIndex: number | null = null): OrderableQuestion {
  return { id, orderIndex };
}

describe("orderQuestions — random mode (today's behaviour, FR-02)", () => {
  it("hands the whole list to the shuffle and ignores the index", () => {
    const qs = [q("a", 30), q("b", 10), q("c", 20)];

    expect(ids(orderQuestions(qs, "random", reverse))).toEqual(["c", "b", "a"]);
  });

  it("does not mutate the input array", () => {
    const qs = [q("a", 30), q("b", 10)];

    orderQuestions(qs, "random", reverse);

    expect(ids(qs)).toEqual(["a", "b"]);
  });
});

describe("orderQuestions — fixed mode (FR-03)", () => {
  it("sorts by index ascending regardless of input order", () => {
    const qs = [q("c", 30), q("a", 10), q("b", 20)];

    expect(ids(orderQuestions(qs, "fixed", identity))).toEqual(["a", "b", "c"]);
  });

  it("negative and zero indices are ordinary values, not «unset»", () => {
    const qs = [q("zero", 0), q("neg", -5), q("pos", 5)];

    expect(ids(orderQuestions(qs, "fixed", identity))).toEqual(["neg", "zero", "pos"]);
  });

  it("does not mutate the input array", () => {
    const qs = [q("c", 30), q("a", 10)];

    orderQuestions(qs, "fixed", identity);

    expect(ids(qs)).toEqual(["c", "a"]);
  });
});

describe("orderQuestions — questions without an index (FR-04)", () => {
  it("puts them after every indexed question", () => {
    const qs = [q("none1"), q("b", 20), q("none2"), q("a", 10)];

    expect(ids(orderQuestions(qs, "fixed", identity))).toEqual(["a", "b", "none1", "none2"]);
  });

  it("treats a missing property the same as an explicit null", () => {
    const qs: OrderableQuestion[] = [{ id: "missing" }, q("indexed", 10), q("null", null)];

    expect(ids(orderQuestions(qs, "fixed", identity))[0]).toBe("indexed");
  });

  it("shuffles the unindexed tail among itself", () => {
    const qs = [q("lead", 10), q("t1"), q("t2"), q("t3")];

    // Only the tail is reversed: the leader keeps its place at the front.
    expect(ids(orderQuestions(qs, "fixed", reverse))).toEqual(["lead", "t3", "t2", "t1"]);
  });

  it("a list where nothing has an index is just a shuffle", () => {
    const qs = [q("x"), q("y"), q("z")];

    expect(ids(orderQuestions(qs, "fixed", reverse))).toEqual(["z", "y", "x"]);
  });
});

describe("orderQuestions — equal indices form a group (FR-05)", () => {
  it("shuffles inside the group, keeping the group between its neighbours", () => {
    const qs = [q("lead", 10), q("tieA", 20), q("tieB", 20), q("tail", 30)];

    // The group [tieA, tieB] is reversed; 10 and 30 stay put around it, which a
    // whole-list shuffle could not produce.
    expect(ids(orderQuestions(qs, "fixed", reverse))).toEqual(["lead", "tieB", "tieA", "tail"]);
  });

  it("every group is shuffled independently", () => {
    const qs = [q("a1", 10), q("a2", 10), q("b1", 20), q("b2", 20)];

    expect(ids(orderQuestions(qs, "fixed", reverse))).toEqual(["a2", "a1", "b2", "b1"]);
  });

  it("a single-member group is still passed through the shuffle unharmed", () => {
    const qs = [q("only", 10), q("tieA", 20), q("tieB", 20)];

    expect(ids(orderQuestions(qs, "fixed", identity))).toEqual(["only", "tieA", "tieB"]);
  });
});

describe("orderQuestions — edge cases", () => {
  it("an empty list stays empty in both modes", () => {
    expect(orderQuestions([], "fixed", identity)).toEqual([]);
    expect(orderQuestions([], "random", identity)).toEqual([]);
  });

  it("a single question is returned as is", () => {
    expect(ids(orderQuestions([q("solo", 10)], "fixed", reverse))).toEqual(["solo"]);
  });

  it("an unknown mode falls back to random — the safe, pre-PRD-30 behaviour", () => {
    const qs = [q("a", 30), q("b", 10)];

    expect(ids(orderQuestions(qs, "whatever" as never, reverse))).toEqual(["b", "a"]);
  });
});
