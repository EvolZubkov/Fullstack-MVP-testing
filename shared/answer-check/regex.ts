/**
 * @module shared/answer-check/regex
 *
 * The REGULAR EXPRESSION mode of a textual rule (PRD-57 §6.2). It exists for answers whose
 * shape is the knowledge — a command's syntax, an identifier's format, a date — and it is
 * deliberately not the default: for everything else the wildcard comparison of §6.1 is both
 * shorter and safer to read.
 *
 * Flags are a decision, not a detail:
 *
 *   - `i` — case is never the point of an open answer, and the author who wants it back
 *     writes the case into a character class;
 *   - NO `g` — a global `RegExp` carries `lastIndex` between calls, so the same rule would
 *     answer differently on the second check of the same answer. That reads as random
 *     grading and is impossible to reproduce on purpose;
 *   - NO `u` — it would reject legacy escapes (`\-`, `\d` inside a class and such) that
 *     authors write out of habit, and it would reject them in ALREADY SAVED questions the
 *     first time the product updates.
 *
 * Unlike the wildcard mode, the answer is NOT run through `normalizeForCompare`: the point
 * of the mode is that the author decides what counts as a difference. Only the edges are
 * trimmed, because a trailing space is a property of typing, not of the answer.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime. Time is NOT measured
 * here: the budget belongs to {@link module:shared/answer-check/budget}, because only the
 * host knows what it can kill.
 */

/** Compiled expressions by source — the same rule is checked once per answer, many times. */
const cache = new Map<string, RegExp | null>();

/**
 * Compile an author's expression.
 *
 * @param source The expression as the author typed it.
 * @returns The compiled expression, or `null` when it does not compile — a rule that says
 *   nothing must match nothing rather than throw in the middle of grading an attempt.
 */
export function compileExpression(source: string): RegExp | null {
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null;
  try {
    compiled = new RegExp(source, "i");
  } catch {
    compiled = null;
  }
  cache.set(source, compiled);
  return compiled;
}

/**
 * Does the answer satisfy the expression?
 *
 * An empty answer never matches, even against `.*`: a rule that awards the question to
 * someone who typed nothing is never what the author meant, and the wildcard mode makes
 * the same promise (see `checkRuleSet`).
 *
 * @param source The author's expression.
 * @param answer The learner's raw input.
 */
export function matchExpression(source: string, answer: string | null | undefined): boolean {
  if (typeof answer !== "string") return false;
  const text = answer.trim();
  if (text === "") return false;
  const compiled = compileExpression(source);
  return compiled === null ? false : compiled.test(text);
}
