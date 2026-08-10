/**
 * @module tests/order-questions-port
 *
 * Golden parity test for the PRD-30 delivery ORDER. The SCORM runtime uses a
 * hand-maintained plain-JS port (server/scorm/assets/app.js `orderQuestions`)
 * of the authoritative TypeScript engine (shared/draw/order-questions.ts). Both
 * run over the same scenarios and the same deterministic shuffles, so the two
 * hosts can never silently diverge — a learner must get the same sequence in
 * the web run and in the package.
 *
 * The scenarios cover every branch of the rule: the `random` passthrough, the
 * ascending sort, the unindexed tail, groups of equal indices (shuffled INSIDE
 * the group) and the degenerate inputs.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { orderQuestions as tsOrder, type OrderableQuestion } from "../shared/draw/order-questions";
import type { ShuffleFn } from "../shared/draw/blueprint";

const src = readFileSync(resolve(process.cwd(), "server/scorm/assets/app.js"), "utf8");
const match = src.match(/function orderQuestions\([^)]*\)\s*\{[\s\S]*?\n\}/);
if (!match) throw new Error("orderQuestions not found in assets/app.js");
type PortOrder = (
  questions: OrderableQuestion[],
  mode: string,
  shuffle: ShuffleFn,
) => OrderableQuestion[];
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const portOrder = new Function(`${match[0]}\n;return orderQuestions;`)() as PortOrder;

const identity = <T,>(a: T[]): T[] => a;
const reverse = <T,>(a: T[]): T[] => a.slice().reverse();
const ids = (qs: OrderableQuestion[]) => qs.map((q) => q.id);

function q(id: string, orderIndex: number | null = null): OrderableQuestion {
  return { id, orderIndex };
}

/** Scenario = a bank plus the mode it is delivered in. */
const SCENARIOS: Array<{ name: string; questions: OrderableQuestion[]; mode: string }> = [
  { name: "random passthrough", mode: "random", questions: [q("a", 30), q("b", 10), q("c", 20)] },
  { name: "ascending sort", mode: "fixed", questions: [q("c", 30), q("a", 10), q("b", 20)] },
  { name: "zero and negative indices", mode: "fixed", questions: [q("z", 0), q("n", -5), q("p", 5)] },
  {
    name: "unindexed tail",
    mode: "fixed",
    questions: [q("none1"), q("b", 20), q("none2"), q("a", 10)],
  },
  {
    name: "missing property = null",
    mode: "fixed",
    questions: [{ id: "missing" }, q("indexed", 10), q("null", null)],
  },
  {
    name: "group of equals between neighbours",
    mode: "fixed",
    questions: [q("lead", 10), q("tieA", 20), q("tieB", 20), q("tail", 30)],
  },
  {
    name: "two independent groups",
    mode: "fixed",
    questions: [q("a1", 10), q("a2", 10), q("b1", 20), q("b2", 20)],
  },
  { name: "nothing indexed", mode: "fixed", questions: [q("x"), q("y"), q("z")] },
  { name: "empty list", mode: "fixed", questions: [] },
  { name: "single question", mode: "fixed", questions: [q("solo", 10)] },
  // An unknown mode must fall back to `random` on BOTH hosts: a package built by
  // a newer editor must not freeze the order in an older runtime.
  { name: "unknown mode", mode: "whatever", questions: [q("a", 30), q("b", 10)] },
];

describe("orderQuestions — TS engine and its app.js twin agree", () => {
  for (const shuffleName of ["identity", "reverse"] as const) {
    const shuffle: ShuffleFn = shuffleName === "identity" ? identity : reverse;

    for (const scenario of SCENARIOS) {
      it(`${scenario.name} (${shuffleName} shuffle)`, () => {
        const fromTs = tsOrder(scenario.questions, scenario.mode as never, shuffle);
        const fromPort = portOrder(scenario.questions, scenario.mode, shuffle);

        expect(ids(fromPort)).toEqual(ids(fromTs));
      });
    }
  }

  it("neither implementation mutates its input", () => {
    const original = [q("c", 30), q("a", 10), q("none")];
    const forTs = original.slice();
    const forPort = original.slice();

    tsOrder(forTs, "fixed", reverse);
    portOrder(forPort, "fixed", reverse);

    expect(ids(forTs)).toEqual(ids(original));
    expect(ids(forPort)).toEqual(ids(original));
  });
});
