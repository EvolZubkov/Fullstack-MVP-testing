/**
 * @module shared/questions/question-type
 *
 * The SINGLE source of question-type traits. Answer handling branches on the question
 * type in roughly forty places across the server, the web host, the SCORM runtime and
 * the author UI, and those branches are NOT exhaustive `switch`es — they are chains of
 * `if (type === '...')` falling through to a default. Adding a type therefore compiles
 * cleanly while silently skipping logic (PRD-26 risk R-1).
 *
 * The fix is to branch on a TRAIT instead of on a literal: a new type declares its
 * traits here once, and every consumer keeps working. Consumers that ask
 * «is this answered by one index?» use {@link isSingleIndexChoice} rather than
 * `type === "single"`.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime. The in-package
 * runtime mirrors these predicates in `server/scorm/template/app/utils/qtype.js`
 * (plain ES5, no imports available there); the two MUST stay in sync, and the mirror
 * carries a pointer back to this module.
 */

/** Every question type the product supports. Mirrors the `questions.type` enum. */
export const QUESTION_TYPES = ["single", "multiple", "matching", "ranking", "scale"] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

/**
 * Answered by picking exactly ONE option index — `single` and `scale`.
 *
 * This is the trait behind most historical `type === "single"` checks: answer shape
 * (a number), correctness (`correctIndex`), per-option scale contributions, graded
 * option weights, and the `choice` SCORM interaction type.
 */
export function isSingleIndexChoice(type: string): boolean {
  return type === "single" || type === "scale";
}

/** Carries an answer list in `dataJson.options` — `single`, `multiple` and `scale`. */
export function hasOptionList(type: string): boolean {
  return type === "single" || type === "multiple" || type === "scale";
}

/**
 * Option order is CONTENT, not presentation, so it must never be shuffled: the
 * graduations of a scale run from one pole to the other, and reordering them destroys
 * the meaning of the answer.
 */
export function hasFixedOptionOrder(type: string): boolean {
  return type === "scale";
}

/** The question shape these predicates read — both hosts pass their own object. */
export interface TypedQuestion {
  type: string;
  /** Answer key; `correctJson` on the server, `correct` in the SCORM payload. */
  correctJson?: unknown;
}

/**
 * True for a MEASUREMENT-ONLY question: a scale whose author did not set a correct
 * graduation. Such a question is never checked, earns no points and adds nothing to
 * the possible total (PRD-26 FR-08); its only result is the contribution it makes to
 * the PRD-5 scales.
 *
 * The absence of `correctIndex` IS the author's switch — there is no separate flag.
 * `questions.correct_json` is `NOT NULL`, so the measurement state is an empty object,
 * never `null`; both are accepted here for robustness against legacy rows.
 */
export function isMeasurementOnly(question: TypedQuestion): boolean {
  if (question.type !== "scale") return false;
  const correct = question.correctJson as { correctIndex?: unknown } | null | undefined;
  return !correct || typeof correct.correctIndex !== "number";
}
