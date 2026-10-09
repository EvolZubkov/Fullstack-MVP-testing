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
import { scoreAnswer as tsScore, explainAnswer as tsExplain, type ScoreInput } from "../shared/scoring/engine";
import type { QuestionScoring } from "../shared/schema";
import { checkRuleSet, hasRules } from "../shared/answer-check/rules";

const portSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/scoring/engine.js"),
  "utf8",
);
// The question-type traits (`TBQType`, PRD-26) are prepended the way the package build
// concatenates them, so the port sees the same trait table the shipped runtime does.
const qTypeSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/qtype.js"),
  "utf8",
);
// PRD-57 FR-28s: the port does NOT reimplement answer comparison — it delegates to the
// shared runtime bundle, which `server/scorm/index.ts` prepends to the package as the
// `TBTemplate` global. The sandbox is handed the very same functions, so these scenarios
// prove the port DELEGATES instead of growing a second, divergent implementation.
const sharedRuntimeStub = { checkRuleSet, hasRules };
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const ScoringEnginePort = new Function(
  "TBTemplate",
  `${qTypeSrc}\n${portSrc}\n;return ScoringEngine;`,
)(sharedRuntimeStub) as {
  scoreAnswer: (input: unknown) => { score: number; sMax: number; ratio: number };
  explainAnswer: (input: unknown) => Record<string, unknown>;
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
const SHORT_RULES = {
  answerKind: "text" as const,
  join: "any" as const,
  rules: [
    { kind: "text" as const, match: "wildcard" as const, value: "Федеральная служба по * надзору" },
    { kind: "text" as const, match: "wildcard" as const, value: "РТН" },
  ],
};
const SHORT_NUMBER = {
  answerKind: "number" as const,
  join: "any" as const,
  rules: [{ kind: "number" as const, op: "eq" as const, value: 3.14, tolerance: { unit: "abs" as const, value: 0.01 } }],
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

  // scale (PRD-26): checked and priced exactly like single choice
  { name: "exact scale correct", input: { type: "scale", correct: { correctIndex: 3 }, answer: 3 } },
  { name: "exact scale wrong", input: { type: "scale", correct: { correctIndex: 3 }, answer: 1 } },
  { name: "exact scale null", input: { type: "scale", correct: { correctIndex: 3 }, answer: null } },
  { name: "exact scale first graduation", input: { type: "scale", correct: { correctIndex: 0 }, answer: 0 } },
  // Measurement-only: no correctIndex at all, so nothing can be right. The aggregate
  // keeps such a question out of the totals (FR-08); the engine just scores 0.
  { name: "measurement scale scores nothing", input: { type: "scale", correct: {}, answer: 2 } },
  { name: "weighted scale graduations", input: { type: "scale", correct: {}, answer: 3, scoring: { kind: "weighted", weights: [0, 1, 2, 3, 4, 5] } } },
  { name: "weighted scale first graduation", input: { type: "scale", correct: {}, answer: 0, scoring: { kind: "weighted", weights: [0, 1, 2, 3, 4, 5] } } },
  { name: "weighted scale top graduation", input: { type: "scale", correct: {}, answer: 5, scoring: { kind: "weighted", weights: [0, 1, 2, 3, 4, 5] } } },
  { name: "weighted scale unanswered", input: { type: "scale", correct: {}, answer: null, scoring: { kind: "weighted", weights: [0, 1, 2, 3, 4, 5] } } },

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

  // PRD-57 §6.5: короткий ответ — сравнение по набору правил
  { name: "короткий ответ — подстановочный знак", input: { type: "short", correct: SHORT_RULES, answer: "федеральная служба по атомному надзору" } },
  { name: "короткий ответ — точное совпадение", input: { type: "short", correct: SHORT_RULES, answer: "РТН" } },
  { name: "короткий ответ — мимо", input: { type: "short", correct: SHORT_RULES, answer: "минэнерго" } },
  { name: "короткий ответ — пусто", input: { type: "short", correct: SHORT_RULES, answer: "" } },
  { name: "короткий ответ — не строка", input: { type: "short", correct: SHORT_RULES, answer: 3 } },
  { name: "короткий ответ — правил нет", input: { type: "short", correct: { answerKind: "text", join: "any", rules: [] }, answer: "что угодно" } },
  { name: "короткий ответ — число с допуском", input: { type: "short", correct: SHORT_NUMBER, answer: "3,1416" } },
  { name: "короткий ответ — число вне допуска", input: { type: "short", correct: SHORT_NUMBER, answer: "3,2" } },
];

describe("scoring engine — TS ↔ JS port parity", () => {
  it.each(scenarios)("$name", ({ input }) => {
    const ts = tsScore(input);
    const port = ScoringEnginePort.scoreAnswer(input);
    expect(port).toEqual(ts);
  });

  // explainAnswer (PRD-18 «цена» breakdown) must also stay bit-identical.
  it.each(scenarios)("explain · $name", ({ input }) => {
    const ts = tsExplain(input);
    const port = ScoringEnginePort.explainAnswer(input);
    expect(port).toEqual(ts);
  });
});
