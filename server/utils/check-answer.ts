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
 * When a question has no `scoringJson` the result is the legacy exact 0/1
 * (bit-identical to the pre-PRD-10 behaviour, FR-02); when it carries
 * weighted/tiered scoring the returned ratio reflects partial credit
 * ("цена ответа"). The standard finish route multiplies this ratio by the
 * question's points, so graded scoring now flows through the web result.
 */

import { scoreAnswer, type QuestionType, type CorrectData, type Answer } from "@shared/scoring/engine";
import type { Question } from "@shared/schema";

/**
 * Scores a learner's answer to a question.
 *
 * @param question The question (its `correctJson` and optional `scoringJson`).
 * @param answer   The learner's answer in the runtime encoding for the type.
 * @returns Earned ratio in [0, 1] (0 = wrong / unanswered, 1 = full credit).
 */
export function checkAnswer(question: Question, answer: unknown): number {
  return scoreAnswer({
    type: question.type as QuestionType,
    correct: (question.correctJson ?? {}) as CorrectData,
    answer: answer as Answer,
    scoring: question.scoringJson ?? null,
  }).ratio;
}
