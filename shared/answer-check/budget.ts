/**
 * @module shared/answer-check/budget
 *
 * The TIME budget of a comparison (PRD-57 FR-28o — FR-28s). One module, three hosts: the
 * question drawer, the server and the SCORM package must measure the same way and agree on
 * what «too long» means — a second implementation would mean the author saves a rule the
 * editor called fast and the runtime refuses to run (FR-28s).
 *
 * What lives here is the ARITHMETIC: the numbers, one measured run, and the strings that
 * provoke backtracking. What does NOT live here is the killing: only the host knows what it
 * can terminate — a worker thread on the server, a web worker in the browser, nothing at
 * all in an LMS that forbids them.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */

/**
 * How long ONE comparison may take at run time before the answer is left unchecked.
 *
 * A second is generous for a comparison that normally takes a fraction of a millisecond;
 * it is deliberately not tighter, because the cost of being wrong here falls on the
 * learner, whose answer stops being graded. The installation overrides it through
 * `limits.answerCheckBudgetMs`, so the stand measurement (#51) changes a setting rather
 * than the code.
 */
export const DEFAULT_BUDGET_MS = 1000;

/**
 * When the author is told their expression is slow.
 *
 * Two hundred milliseconds is already far outside «доли секунды» (§6.4), and the warning
 * is only a warning — the rule saves either way (FR-28p1).
 */
export const DEFAULT_WARN_MS = 200;

/** A measured run: what it produced and how long it took. */
export interface Measured<T> {
  value: T;
  ms: number;
}

/**
 * Run and time one comparison.
 *
 * @param run The comparison itself; it must be synchronous — the point is to measure how
 *   long the engine is BLOCKED, and an async wrapper would measure the wrong thing.
 */
export function measure<T>(run: () => T): Measured<T> {
  const started = Date.now();
  const value = run();
  return { value, ms: Date.now() - started };
}

/**
 * Strings that provoke catastrophic backtracking (FR-28o, the save-time run).
 *
 * The shape is what matters, and §6.4 explains why: the blow-up lives on an answer that
 * does NOT match, because a matching answer stops the engine at the first success. So each
 * string is a run of repeated, separator-joined chunks — many ways to split the same text
 * between repetitions — with a tail that fits nothing.
 *
 * The lengths are MEASURED, not guessed. On this engine (2026-09-19, Node 24) the pattern
 * `^(\S+\s?)+ надзору$` takes 0 ms up to 40 characters of such a string, 125 ms at 52,
 * 904 ms at 70 and 4,2 s at 76 — the curve only lifts off the floor past sixty. A set that
 * stopped at thirty characters, as the first draft of this function did, would have called
 * the worst expression in the requirements FAST and told the author so.
 *
 * The longest string here is deliberately past the point where a bad expression is already
 * unbearable: the run is itself budgeted, so a string that never finishes costs the author
 * one budget, not a frozen tab.
 */
export function provocations(): string[] {
  const repeats = [8, 14, 20, 24, 28];
  return repeats.map((times) => `${"аб ".repeat(times)}абв!`);
}
