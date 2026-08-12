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
export const QUESTION_TYPES = ["single", "multiple", "matching", "ranking", "scale", "allocation"] as const;

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

/**
 * Carries an answer list in `dataJson.options` — `single`, `multiple`, `scale` and
 * `allocation`. The allocation's STATEMENTS live in that same field on purpose
 * (PRD-44 FR-02), so every existing reader of `dataJson.options` — the option editor,
 * the workbook column, the font-fitting pass, the preview — keeps working unchanged.
 */
export function hasOptionList(type: string): boolean {
  return type === "single" || type === "multiple" || type === "scale" || type === "allocation";
}

/**
 * The learner splits a fixed BUDGET of points across the options (PRD-44). Two things
 * follow, and both are why this is a trait rather than a `type === "allocation"` test:
 * the answer is a per-option amount (`Record<index, points>`), and the SIZE of that
 * amount — not the bare fact of choosing — is what a measurement reads, which makes
 * this the first source whose contribution the learner sets rather than the author.
 */
export function distributesBudget(type: string): boolean {
  return type === "allocation";
}

/**
 * Option order is CONTENT, not presentation, so it must never be shuffled: the
 * graduations of a scale run from one pole to the other, and reordering them destroys
 * the meaning of the answer.
 */
export function hasFixedOptionOrder(type: string): boolean {
  return type === "scale";
}

/**
 * The question shape these predicates read — every consumer passes its own object.
 * The answer key travels under two different names: `correctJson` on the server (the
 * DB column) and `correct` in the baked SCORM payload and the aggregate input. Both
 * are accepted so no caller has to reshape its question first.
 */
export interface TypedQuestion {
  type: string;
  correctJson?: unknown;
  correct?: unknown;
}

/**
 * True for a MEASUREMENT-ONLY question: never checked, earns no points, adds nothing
 * to the possible total (PRD-26 FR-08); its only result is the contribution it makes
 * to the PRD-5 scales.
 *
 * Two ways in, and they differ in KIND. A scale is measurement-only by the author's
 * choice — the absence of `correctIndex` IS the switch, there is no separate flag.
 * An allocation is measurement-only by TYPE (PRD-44 FR-09/FR-11): the method has no
 * reference distribution at all, so a stray `correctIndex` left behind by a type
 * switch in the editor must not make the question checkable.
 *
 * `questions.correct_json` is `NOT NULL`, so the measurement state is an empty object,
 * never `null`; both are accepted here for robustness against legacy rows.
 */
export function isMeasurementOnly(question: TypedQuestion): boolean {
  if (distributesBudget(question.type)) return true;
  if (question.type !== "scale") return false;
  const key = (question.correctJson ?? question.correct) as
    | { correctIndex?: unknown }
    | null
    | undefined;
  return !key || typeof key.correctIndex !== "number";
}

/**
 * Does this SET of questions grade anything at all? False for a measurement method —
 * a questionnaire built entirely of allocations and keyless scales, where no answer
 * is right or wrong and no points exist to compare against a threshold.
 *
 * The question is asked BEFORE an attempt exists (the start screen's «проходной
 * балл»), which is why it reads the content rather than the earned/possible points
 * PRD-29 §6.7 uses on the results screen: at that moment there is nothing scored yet.
 * A MIXED test — one graded question among measurements — grades, and keeps its
 * threshold: the rule answers «is there anything to grade», not «is everything
 * graded».
 *
 * An empty set counts as not grading: a test with no questions has nothing to
 * threshold either.
 */
export function hasGradedContent(questions: readonly TypedQuestion[]): boolean {
  return questions.some((q) => !isMeasurementOnly(q));
}
