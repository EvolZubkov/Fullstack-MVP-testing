/**
 * @module shared/answer-check/rules
 *
 * The SET of comparison rules an open answer is checked against (PRD-57 §6.1) — the
 * single engine behind the short answer (§6.5) and, from Э8 on, every blank (FR-24c).
 *
 * Shape decisions, all taken by the owner on 2026-09-18 and recorded as requirements:
 * the answer KIND is a property of the question, not of a rule (FR-28d) — text and
 * number never stand side by side, because a rule of the other kind could not fire once;
 * the JOIN is one per set (FR-28c) — mixing «и» with «или» would need brackets, and
 * brackets turn a list into an expression builder the track walks away from.
 *
 * An EMPTY set is not an error: it means the author has not written the check yet. It
 * matches nothing, and {@link hasRules} is what callers ask before treating the question
 * as graded at all — the same way a keyless scale is measurement-only.
 *
 * `match: "regex"` runs since Э7, and it never runs UNBUDGETED where a budget is possible:
 * a host that owns a killable executor (the server's worker thread, the package's web
 * worker) checks the expressions first and passes the results in as `verdicts`, so this
 * module stays synchronous and identical on both hosts (FR-28q, FR-28s).
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */
import { normalizeForCompare } from "./normalize";
import { matchExpression } from "./regex";
import { matchWildcard } from "./wildcard";
import { matchNumber, parseNumericAnswer, type NumericRule } from "./number";

/** A textual rule: ordinary comparison today, a regular expression from Э7. */
export interface TextRule {
  kind: "text";
  match: "wildcard" | "regex";
  value: string;
  /**
   * PRD-57 Э7: the save-time measurement (FR-28o) found this expression slow.
   *
   * It is stored WITH the rule because it is the only protection the SCORM package has.
   * The package grades in the main thread — nothing there can interrupt a running regular
   * expression — so a rule the editor already timed as catastrophic is not executed at
   * all: the answer comes out unchecked (FR-28r) instead of freezing the learner's tab.
   * The web host ignores the flag: it has a real budget in a worker thread.
   */
  slow?: boolean;
}

/** One rule of either kind. */
export type AnswerRule = TextRule | NumericRule;

/** The whole check of one question (or, from Э8, of one blank). */
export interface AnswerRuleSet {
  answerKind: "text" | "number";
  join: "any" | "all";
  rules: AnswerRule[];
  /** Display unit shown beside the learner's field, e.g. `°C`; never typed by them. */
  unit?: string;
}

/** The verdict plus which rules fired — the list drives the Э6 probe marks. */
export interface RuleSetOutcome {
  passed: boolean;
  perRule: boolean[];
  /**
   * PRD-57 FR-28r: a rule ran out of its time budget, and no other rule settled the
   * question. The answer is NOT wrong — nobody checked it — so it travels the same road as
   * an open answer: neutral outcome, «ждёт проверки», outside both sides of the fraction.
   */
  pending?: boolean;
}

/**
 * What a host that OWNS a killable executor already knows about each rule (Э7).
 *
 * `"budget"` means the rule did not finish in time. The verdicts arrive in the authored
 * order, one per rule; a host without such an executor passes nothing and the rules run
 * where they are checked.
 */
export type RuleVerdict = boolean | "budget";
/**
 * `undefined` in a slot means «этот хост его не считал» — a wildcard or numeric rule costs
 * nothing and is checked in place, so only the expression slots are filled.
 */
export type RuleVerdicts = readonly (RuleVerdict | undefined)[];

/** Does this set actually check anything? */
export function hasRules(set: AnswerRuleSet | null | undefined): boolean {
  return !!set && Array.isArray(set.rules) && set.rules.length > 0;
}

/** Apply one rule to an answer that has already been prepared for its kind. */
function matchOne(rule: AnswerRule, text: string, numeric: number | null, raw: string): boolean {
  if (rule.kind === "number") {
    return numeric === null ? false : matchNumber(rule, numeric);
  }
  // A regular expression works on what the learner WROTE, not on its comparison form: the
  // author's expression decides what counts as a difference (§6.2).
  if (rule.match === "regex") return matchExpression(rule.value, raw);
  return matchWildcard(normalizeForCompare(rule.value), text);
}

/**
 * Check a learner's answer against the whole set.
 *
 * An empty answer never passes: a set whose pattern is a bare `*` would otherwise award
 * the question to someone who typed nothing.
 *
 * @param set    The author's rules.
 * @param answer The learner's raw input.
 * @returns The verdict and the per-rule outcomes, in the authored order.
 */
/** How a host without a killable executor wants slow expressions handled. */
export interface CheckOptions {
  /**
   * Do not run an expression the save-time measurement flagged as slow — report it as
   * unchecked instead. The SCORM package sets this; the server never does.
   */
  skipSlow?: boolean;
}

export function checkRuleSet(
  set: AnswerRuleSet,
  answer: string | null | undefined,
  verdicts?: RuleVerdicts,
  options?: CheckOptions,
): RuleSetOutcome {
  const rules = Array.isArray(set?.rules) ? set.rules : [];
  const text = normalizeForCompare(answer);
  const raw = typeof answer === "string" ? answer : "";
  if (rules.length === 0 || text === "") {
    return { passed: false, perRule: rules.map(() => false) };
  }
  const numeric = set.answerKind === "number" ? parseNumericAnswer(answer) : null;
  const skipped = (rule: AnswerRule): boolean =>
    options?.skipSlow === true && rule.kind === "text" && rule.match === "regex" && rule.slow === true;
  const given = (index: number): RuleVerdict | undefined => {
    const ready = verdicts?.[index];
    if (ready !== undefined) return ready;
    return skipped(rules[index]) ? "budget" : undefined;
  };
  const perRule = rules.map((rule, index) => {
    const ready = given(index);
    if (ready === true) return true;
    if (ready === false || ready === "budget") return false;
    return matchOne(rule, text, numeric, raw);
  });
  const passed = set.join === "all" ? perRule.every(Boolean) : perRule.some(Boolean);
  // Неопределённость остаётся только тогда, когда её НЕ снял исход остальных правил: при
  // «любом» — если не сработало ничего, при «всех» — если всё прочее выполнено. Иначе
  // ответ известен и без того правила, которое не успело досчитаться.
  const outOfBudget = rules.some((_, index) => given(index) === "budget");
  const pending =
    !passed &&
    outOfBudget &&
    rules.every((_, index) => given(index) === "budget" || perRule[index] || set.join === "any");
  return pending ? { passed, perRule, pending: true } : { passed, perRule };
}
