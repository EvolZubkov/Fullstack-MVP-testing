/**
 * @module shared/scoring/engine
 *
 * Pure graded-answer-scoring core (PRD-10, Stage 2; scoring-model §11). Given a
 * question's type, its correct answer, the learner's answer and the optional
 * `scoring` config, it returns the earned score `s`, the maximum `sMax` and the
 * ratio `s / sMax` consumed by the runtime (`checkAnswer`) and by the
 * preview/tests. It is the authoritative implementation; a plain-JS twin
 * (server/scorm/template/app/scoring/engine.js) runs in the SCORM package and is
 * kept in parity by a golden test (tests/scoring-engine-port.test.ts).
 *
 * Modes (scoring-model §11; PRD-10 FR-01..FR-07):
 * - `exact` / absent — exact match, 0 or 1, `sMax = 1` (legacy behaviour,
 *   bit-identical to the pre-PRD-10 checkAnswer).
 * - `weighted` (single) — `s = weights[chosen]` (additive); `sMax = max(weights)`.
 * - `tiered` (multiple/matching/ranking) — first matching tier wins, else 0
 *   (non-additive step table over the answer counters); `sMax = max(tier.score)`.
 *
 * Counters (scoring-model §11.2): `c` correctly selected units, `x` wrongly
 * selected units, and the per-type total `T`/`P`/`N` (correct options / pairs /
 * items). Unit identity is index-based, consistent with PRD-5 (no durable ids).
 */

import type { QuestionScoring, ScoringPredicate } from "../schema";

export type QuestionType = "single" | "multiple" | "matching" | "ranking";

/** Learner answer shapes by question type (runtime encoding). */
export type Answer = number | number[] | Record<string, number> | null | undefined;

/** correct_json fields by type (a permissive superset for easy access). */
export interface CorrectData {
  correctIndex?: number;
  correctIndices?: number[];
  pairs?: Array<{ left: number; right: number }>;
  correctOrder?: number[];
}

export interface ScoreInput {
  type: QuestionType;
  correct: CorrectData;
  answer: Answer;
  scoring?: QuestionScoring | null;
}

export interface ScoreResult {
  /** Earned score `s`, floored at 0. */
  score: number;
  /** Maximum attainable score for this question (>= 0). */
  sMax: number;
  /** `s / sMax` clamped to [0, 1]; 0 when `sMax <= 0`. */
  ratio: number;
}

/** Answer tallies; `total` is the per-type T (options) / P (pairs) / N (items). */
interface Counters {
  c: number;
  x: number;
  total: number;
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function maxOf(nums: number[]): number {
  return nums.reduce((m, v) => (v > m ? v : m), 0);
}

/** Exact correctness (0 or 1) — the pre-PRD-10 checkAnswer logic. */
function exactCorrect(type: QuestionType, correct: CorrectData, answer: Answer): number {
  if (answer === null || answer === undefined) return 0;

  if (type === "single") {
    return answer === correct.correctIndex ? 1 : 0;
  }
  if (type === "multiple") {
    const want = Array.isArray(correct.correctIndices) ? correct.correctIndices.slice() : [];
    const got = Array.isArray(answer) ? answer.slice() : [];
    if (want.length === 0) return 0;
    if (got.length !== want.length) return 0;
    want.sort((a, b) => a - b);
    got.sort((a, b) => a - b);
    for (let i = 0; i < want.length; i++) if (want[i] !== got[i]) return 0;
    return 1;
  }
  if (type === "matching") {
    const pairs = answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {};
    const want = Array.isArray(correct.pairs) ? correct.pairs : [];
    if (Object.keys(pairs).length !== want.length) return 0;
    for (const p of want) if ((pairs as Record<string, number>)[p.left] !== p.right) return 0;
    return 1;
  }
  if (type === "ranking") {
    const order = Array.isArray(answer) ? answer : [];
    const want = Array.isArray(correct.correctOrder) ? correct.correctOrder : [];
    if (order.length !== want.length) return 0;
    for (let i = 0; i < want.length; i++) if (order[i] !== want[i]) return 0;
    return 1;
  }
  return 0;
}

/** Compute the (c, x, total) tallies for a tiered question. */
function countTallies(type: QuestionType, correct: CorrectData, answer: Answer): Counters {
  if (type === "multiple") {
    const want = Array.isArray(correct.correctIndices) ? correct.correctIndices : [];
    const got = Array.isArray(answer) ? answer : [];
    let c = 0;
    let x = 0;
    for (const i of got) (want.indexOf(i) !== -1 ? (c += 1) : (x += 1));
    return { c, x, total: want.length };
  }
  if (type === "matching") {
    const want = Array.isArray(correct.pairs) ? correct.pairs : [];
    const map = answer && typeof answer === "object" && !Array.isArray(answer) ? (answer as Record<string, number>) : {};
    let c = 0;
    let x = 0;
    for (const p of want) {
      const got = map[p.left];
      if (got === undefined || got === null) continue;
      got === p.right ? (c += 1) : (x += 1);
    }
    return { c, x, total: want.length };
  }
  if (type === "ranking") {
    const want = Array.isArray(correct.correctOrder) ? correct.correctOrder : [];
    const order = Array.isArray(answer) ? answer : [];
    let c = 0;
    let x = 0;
    for (let i = 0; i < want.length; i++) {
      const got = order[i];
      if (got === undefined || got === null) continue;
      got === want[i] ? (c += 1) : (x += 1);
    }
    return { c, x, total: want.length };
  }
  // single: one correct option.
  const c = exactCorrect("single", correct, answer);
  return { c, x: answer !== null && answer !== undefined ? 1 - c : 0, total: 1 };
}

/** Evaluate a tier predicate (conjunction) against the counters. */
function evalPredicate(pred: ScoringPredicate, t: Counters): boolean {
  return pred.all.every((cond) => {
    const lhs = cond.lhs === "c" ? t.c : t.x;
    // Counter tokens (T/P/N) all resolve to the per-type total.
    const rhs = typeof cond.rhs === "number" ? cond.rhs : t.total;
    switch (cond.op) {
      case "==": return lhs === rhs;
      case ">=": return lhs >= rhs;
      case "<=": return lhs <= rhs;
      case "<": return lhs < rhs;
      case ">": return lhs > rhs;
      default: return false;
    }
  });
}

/**
 * Score one answer. Absent/`exact` scoring keeps the legacy 0/1 result so old
 * tests stay bit-identical (FR-02). `answer == null` always scores 0.
 */
export function scoreAnswer(input: ScoreInput): ScoreResult {
  const { type, correct, answer, scoring } = input;
  const kind = scoring?.kind ?? "exact";

  if (kind === "weighted") {
    const weights = scoring && scoring.kind === "weighted" ? scoring.weights : [];
    const sMax = (scoring && scoring.kind === "weighted" && scoring.sMax) || maxOf(weights);
    let score = 0;
    if (typeof answer === "number" && answer >= 0 && answer < weights.length) {
      score = weights[answer];
    }
    score = Math.max(0, score);
    return { score, sMax, ratio: sMax > 0 ? clamp01(score / sMax) : 0 };
  }

  if (kind === "tiered") {
    const tiers = scoring && scoring.kind === "tiered" ? scoring.tiers : [];
    const sMax = (scoring && scoring.kind === "tiered" && scoring.sMax) || maxOf(tiers.map((t) => t.score));
    let score = 0;
    if (answer !== null && answer !== undefined) {
      const counters = countTallies(type, correct, answer);
      const hit = tiers.find((tier) => evalPredicate(tier.when, counters));
      if (hit) score = hit.score;
    }
    score = Math.max(0, score);
    return { score, sMax, ratio: sMax > 0 ? clamp01(score / sMax) : 0 };
  }

  // exact / absent.
  const score = exactCorrect(type, correct, answer);
  return { score, sMax: 1, ratio: score };
}
