/**
 * @module shared/scoring/reference-mismatch
 * @description Detects a one-index question (single / scale) whose «Веса опций» scoring
 * disagrees with its marked correct answer. Under weighted scoring the score is
 * `weights[chosen]` and `correctIndex` takes no part in it, yet the answer review and the
 * analytics still call the `correctIndex` option «верный». When the marked option is not
 * among the top-weight ones, the author's reference and the scoring point at different
 * options — and nothing used to say so. The rule only speaks: the publication warns about
 * it, nothing is refused.
 *
 * Shared so every reader of the rule agrees; the debug player's «Эталон» overlay carries a
 * plain-JS twin of the top-weight selection (`singleReference` in `inspector-compute.js`).
 */
import type { QuestionScoring } from "../schema";

/** One mismatch: the marked option and the options the weights actually reward most. */
export interface ReferenceMismatch {
  /** 0-based index of the option marked correct in the question. */
  correctIndex: number;
  /** 0-based indices of the options carrying the largest weight, ascending. */
  topIndices: number[];
}

/**
 * One publication warning built from a {@link ReferenceMismatch}: what the publish response
 * carries and the client words. Declared here, next to the rule, so the server that fills it
 * and the client that reads it share one shape instead of two copies.
 */
export interface ScoringWarning extends ReferenceMismatch {
  code: "weighted_reference_mismatch";
  topicId: string;
  topicName: string;
  questionId: string;
  /** Plain-text start of the question prompt, so the author can find the question. */
  questionExcerpt: string;
}

/**
 * Compare the marked correct option of a single/scale question with its weights.
 *
 * @param type question type
 * @param correct the question's answer key (`correctJson`)
 * @param scoring the effective scoring of the question inside a test
 * @returns the mismatch, or `null` when there is none — another type or scoring method,
 *   no marked option (a measurement-only scale), all-zero weights (nothing is rewarded),
 *   or the marked option already carries the largest weight
 */
export function weightedReferenceMismatch(
  type: string,
  correct: { correctIndex?: unknown } | null | undefined,
  scoring: QuestionScoring | null | undefined,
): ReferenceMismatch | null {
  if (type !== "single" && type !== "scale") return null;
  if (!scoring || scoring.kind !== "weighted" || !Array.isArray(scoring.weights)) return null;
  const correctIndex = correct?.correctIndex;
  if (typeof correctIndex !== "number") return null;
  const top = Math.max(0, ...scoring.weights);
  if (top <= 0) return null;
  if ((scoring.weights[correctIndex] ?? 0) === top) return null;
  const topIndices = scoring.weights.flatMap((w, i) => (w === top ? [i] : []));
  return { correctIndex, topIndices };
}
