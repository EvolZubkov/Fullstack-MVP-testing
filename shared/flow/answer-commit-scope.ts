/**
 * @module shared/flow/answer-commit-scope
 *
 * PRD-19 (Block B) — the single resolver for the answer-commit granularity
 * contract. Both runtime hosts (the SCORM package via `server/scorm/builders/
 * test-json.ts` and the web host via `client/src/pages/learner/take-test.tsx`)
 * read the SAME resolved value instead of each re-deriving it from the flow
 * mode, so the skip / return / freeze behaviour cannot drift between hosts.
 *
 * Scope values:
 * - `'test'`    — answers commit at test scope: editable until the final submit
 *                 (subject to `allowAnswerChange`). Used by the flat flow
 *                 (`linear_flat`) and by adaptive tests, where the learner sees
 *                 no sections.
 * - `'section'` — answers freeze per section on section exit. Used by the
 *                 sectional flows (`linear_by_topics` / `router_by_topics`).
 */

/** Resolved answer-commit granularity (PRD-19 Block B). */
export type AnswerCommitScope = "test" | "section";

/** Inputs for {@link resolveAnswerCommitScope}. */
export interface AnswerCommitScopeInput {
  /** Test delivery mode: `'standard'` | `'adaptive'`. */
  mode?: string | null;
  /**
   * Flow policy mode: `'linear_flat'` | `'linear_by_topics'` |
   * `'router_by_topics'`.
   */
  flowMode?: string | null;
}

/**
 * Resolve the answer-commit granularity for a test.
 *
 * Adaptive tests always commit at test scope: skip / return is conceptually
 * inapplicable because the next question depends on the current answer
 * (PRD-19 FR-22). Otherwise the sectional flows freeze per section on exit and
 * the flat flow commits at test scope.
 *
 * @param input Test mode + flow mode.
 * @returns `'test'` or `'section'`.
 */
export function resolveAnswerCommitScope(
  input: AnswerCommitScopeInput,
): AnswerCommitScope {
  if ((input.mode || "standard") === "adaptive") return "test";
  const flowMode = input.flowMode || "linear_flat";
  return flowMode === "linear_by_topics" || flowMode === "router_by_topics"
    ? "section"
    : "test";
}
