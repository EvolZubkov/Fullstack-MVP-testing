/**
 * @module tests/scoring-engine-port
 *
 * Golden parity test for the PRD-10 scoring engine. The SCORM runtime uses a
 * hand-maintained plain-JS port (server/scorm/template/app/scoring/engine.js) of
 * the authoritative TypeScript engine (shared/scoring/engine.ts). Both are run
 * over a shared set of scenarios so they can never silently diverge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreAnswer as tsScore, type ScoreInput } from "../shared/scoring/engine";
import type { QuestionScoring } from "../shared/schema";

const portSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/scoring/engine.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const ScoringEnginePort = new Function(`${portSrc}\n;return ScoringEngine;`)() as {
  scoreAnswer: (input: unknown) => { score: number; sMax: number; ratio: number };
};

const TIERED_MULTIPLE: QuestionScoring = {
  kind: "tiered",
  tiers: [
    { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
    { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }, { lhs: "x", op: "<=", rhs: 1 }] }, score: 1 },
  ],
};
const TIERED_MATCHING: QuestionScoring = {
  kind: "tiered",
  tiers: [
    { when: { all: [{ lhs: "c", op: "==", rhs: "P" }] }, score: 3 },
    { when: { all: [{ lhs: "c", op: ">=", rhs: 2 }] }, score: 2 },
    { when: { all: [{ lhs: "c", op: "==", rhs: 1 }] }, score: 1 },
  ],
};
const TIERED_RANKING: QuestionScoring = {
  kind: "tiered",
  tiers: [
    { when: { all: [{ lhs: "c", op: "==", rhs: "N" }] }, score: 2 },
    { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }] }, score: 1 },
  ],
};
const MATCH4 = { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }, { left: 2, right: 2 }, { left: 3, right: 3 }] };

const scenarios: Array<{ name: string; input: ScoreInput }> = [
  // exact (all types)
  { name: "exact single correct", input: { type: "single", correct: { correctIndex: 2 }, answer: 2 } },
  { name: "exact single wrong", input: { type: "single", correct: { correctIndex: 2 }, answer: 0 } },
  { name: "exact single null", input: { type: "single", correct: { correctIndex: 2 }, answer: null } },
  { name: "exact multiple correct", input: { type: "multiple", correct: { correctIndices: [0, 2] }, answer: [2, 0] } },
  { name: "exact multiple wrong", input: { type: "multiple", correct: { correctIndices: [0, 2] }, answer: [0, 1, 2] } },
  { name: "exact matching correct", input: { type: "matching", correct: MATCH4, answer: { 0: 0, 1: 1, 2: 2, 3: 3 } } },
  { name: "exact matching wrong-count", input: { type: "matching", correct: MATCH4, answer: { 0: 0 } } },
  { name: "exact ranking correct", input: { type: "ranking", correct: { correctOrder: [0, 1, 2] }, answer: [0, 1, 2] } },
  { name: "exact ranking wrong", input: { type: "ranking", correct: { correctOrder: [0, 1, 2] }, answer: [0, 2, 1] } },
  { name: "explicit exact", input: { type: "single", correct: { correctIndex: 1 }, answer: 1, scoring: { kind: "exact" } } },

  // weighted
  { name: "weighted full", input: { type: "single", correct: { correctIndex: 0 }, answer: 0, scoring: { kind: "weighted", weights: [2, 1, 1, 0] } } },
  { name: "weighted partial", input: { type: "single", correct: { correctIndex: 0 }, answer: 1, scoring: { kind: "weighted", weights: [2, 1, 1, 0] } } },
  { name: "weighted zero", input: { type: "single", correct: { correctIndex: 0 }, answer: 3, scoring: { kind: "weighted", weights: [2, 1, 1, 0] } } },
  { name: "weighted out-of-range", input: { type: "single", correct: { correctIndex: 0 }, answer: 9, scoring: { kind: "weighted", weights: [2, 1, 1, 0] } } },
  { name: "weighted sMax override", input: { type: "single", correct: { correctIndex: 0 }, answer: 0, scoring: { kind: "weighted", weights: [2, 1, 1, 0], sMax: 4 } } },
  { name: "weighted null", input: { type: "single", correct: { correctIndex: 0 }, answer: null, scoring: { kind: "weighted", weights: [2, 1] } } },
  { name: "weighted all-zero", input: { type: "single", correct: { correctIndex: 0 }, answer: 0, scoring: { kind: "weighted", weights: [0, 0] } } },
  { name: "weighted clamp >1", input: { type: "single", correct: { correctIndex: 0 }, answer: 0, scoring: { kind: "weighted", weights: [5], sMax: 2 } } },

  // tiered multiple
  { name: "tiered mult full", input: { type: "multiple", correct: { correctIndices: [0, 1] }, answer: [0, 1], scoring: TIERED_MULTIPLE } },
  { name: "tiered mult extra-wrong", input: { type: "multiple", correct: { correctIndices: [0, 1] }, answer: [0, 1, 2], scoring: TIERED_MULTIPLE } },
  { name: "tiered mult partial", input: { type: "multiple", correct: { correctIndices: [0, 1] }, answer: [0], scoring: TIERED_MULTIPLE } },
  { name: "tiered mult zero", input: { type: "multiple", correct: { correctIndices: [0, 1] }, answer: [2, 3], scoring: TIERED_MULTIPLE } },
  { name: "tiered mult null", input: { type: "multiple", correct: { correctIndices: [0, 1] }, answer: null, scoring: TIERED_MULTIPLE } },

  // tiered matching
  { name: "tiered match 4/4", input: { type: "matching", correct: MATCH4, answer: { 0: 0, 1: 1, 2: 2, 3: 3 }, scoring: TIERED_MATCHING } },
  { name: "tiered match 3/4", input: { type: "matching", correct: MATCH4, answer: { 0: 0, 1: 1, 2: 2, 3: 9 }, scoring: TIERED_MATCHING } },
  { name: "tiered match 1/4", input: { type: "matching", correct: MATCH4, answer: { 0: 0, 1: 9, 2: 9, 3: 9 }, scoring: TIERED_MATCHING } },
  { name: "tiered match 0/4", input: { type: "matching", correct: MATCH4, answer: { 0: 9, 1: 9, 2: 9, 3: 9 }, scoring: TIERED_MATCHING } },

  // tiered ranking
  { name: "tiered rank perfect", input: { type: "ranking", correct: { correctOrder: [0, 1, 2] }, answer: [0, 1, 2], scoring: TIERED_RANKING } },
  { name: "tiered rank partial", input: { type: "ranking", correct: { correctOrder: [0, 1, 2] }, answer: [0, 2, 1], scoring: TIERED_RANKING } },
  { name: "tiered rank zero", input: { type: "ranking", correct: { correctOrder: [0, 1, 2] }, answer: [2, 0, 1], scoring: TIERED_RANKING } },
];

describe("scoring engine — TS ↔ JS port parity", () => {
  it.each(scenarios)("$name", ({ input }) => {
    const ts = tsScore(input);
    const port = ScoringEnginePort.scoreAnswer(input);
    expect(port).toEqual(ts);
  });
});
