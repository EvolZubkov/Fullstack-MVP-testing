/**
 * @module server/utils/check-answer
 *
 * Server-side answer scoring for the web learner runtime. Delegates to the
 * authoritative graded-scoring engine (`@shared/scoring/engine`, PRD-10) instead
 * of keeping a private copy of the answer-checking logic — this is the single
 * scoring module shared with the SCORM runtime (PRD-12 §3.5; the SCORM package
 * runs the same logic via its compiled/ported twin, kept in parity by golden
 * tests).
 *
 * PRD-15 block D (FR-32): the graded config is a property of the TEST, so
 * grading paths pass the EFFECTIVE config (resolved via
 * server/services/effective-scoring) as `scoring`. T-40 dropped the question's
 * own `scoring_json`, so when the argument is omitted there is no config and
 * scoring falls back to exact match (the system default). Exact scoring (or
 * none) yields the legacy 0/1; weighted/tiered configs return a partial-credit
 * ratio ("цена ответа") that callers multiply by the effective points.
 */

import { scoreAnswer, type QuestionType, type CorrectData, type Answer } from "@shared/scoring/engine";
import type { Question, QuestionScoring } from "@shared/schema";

/**
 * Scores a learner's answer to a question.
 *
 * @param question The question (its `correctJson`).
 * @param answer   The learner's answer in the runtime encoding for the type.
 * @param scoring  Effective graded config for the test context (block D); omit
 *                 for exact match (the system default, post-T-40).
 * @returns Earned ratio in [0, 1] (0 = wrong / unanswered, 1 = full credit).
 */
export function checkAnswer(
  question: Question,
  answer: unknown,
  scoring?: QuestionScoring | null,
): number {
  return scoreAnswer({
    type: question.type as QuestionType,
    correct: (question.correctJson ?? {}) as CorrectData,
    answer: answer as Answer,
    scoring: scoring ?? null,
  }).ratio;
}
