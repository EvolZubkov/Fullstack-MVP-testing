/**
 * @module shared/answer-check/number
 *
 * The NUMERIC rule (PRD-57 §6.6): the learner types a number, the author compares it
 * with an operator and, for equality, a tolerance. A numeric answer is a RULE, not a
 * question type — the same short answer and the same blank carry it.
 *
 * A RANGE has no operator of its own (FR-28aa3): `12 ≤ x ≤ 15` is two rules joined by
 * «все», and «below zero or above a hundred» is the same two rules joined by «любое».
 * One way to write a thing beats two.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */

/** How the author compares. Closed list, chosen from a select — never typed (FR-28aa1). */
export type NumericOp = "eq" | "ne" | "gt" | "gte" | "lt" | "lte";

/** A numeric rule as stored in `questions.correct_json`. */
export interface NumericRule {
  kind: "number";
  op: NumericOp;
  value: number;
  /** Only `eq` and `ne` honour it: a boundary with a tolerance is just another boundary. */
  tolerance?: { unit: "abs" | "pct"; value: number };
}

/** A mixed fraction: an integer part, a space, then the fraction — `2 1/2`. */
const MIXED = /^([+-]?)(\d+) (\d+)\/(\d+)$/;

/** A vulgar fraction: `1/3`, `-3/4`. Both parts are whole — `1,5/3` is not a notation. */
const VULGAR = /^([+-]?)(\d+)\/(\d+)$/;

/** Decimal or scientific, once the spacing is gone: `3.14`, `.5`, `1e-3`. */
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Divide, refusing the one division that has no value. */
function ratio(sign: string, whole: number, numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  const magnitude = whole + numerator / denominator;
  return sign === "-" ? -magnitude : magnitude;
}

/**
 * Read the number the learner (or the author) typed.
 *
 * Forms are tried from the SPECIFIC to the general, and this order is what makes
 * `1 500` a thousand and a half while `2 1/2` is two and a half: the two differ only in
 * what stands to the right of the space, so the spacing may be collapsed only after the
 * fraction forms have had their turn. `1 500/3` therefore reads as a mixed fraction — the
 * rule «a space separates the whole part from the fraction» is simpler than «a space
 * groups digits, except when a fraction follows», and the author sees the outcome in the
 * rule's plain-words summary.
 *
 * Both decimal separators are accepted and a fraction equals its decimal twin: AC-05f
 * requires `1/2`, `0,5` and `.5` to behave identically. What the learner typed is stored
 * and reported to the LMS verbatim elsewhere — this is the comparison form only.
 *
 * @param value Raw input; anything that is not a string reads as absent.
 * @returns The finite number, or `null` when the input is not one («не число», FR-28z1).
 */
export function parseNumericAnswer(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/−/g, "-").replace(/\s+/g, " ").trim();
  if (text === "") return null;

  const mixed = MIXED.exec(text);
  if (mixed) return ratio(mixed[1], Number(mixed[2]), Number(mixed[3]), Number(mixed[4]));

  const vulgar = VULGAR.exec(text);
  if (vulgar) return ratio(vulgar[1], 0, Number(vulgar[2]), Number(vulgar[3]));

  const compact = text.replace(/ /g, "").replace(",", ".");
  if (!DECIMAL.test(compact)) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Half-width of the window around the reference value.
 *
 * A per-cent tolerance is taken from the ABSOLUTE value of the reference, so a negative
 * reference (-25 °C, and such a rule is expected — §6.6) keeps a positive window.
 */
function toleranceWindow(rule: NumericRule): number {
  const tolerance = rule.tolerance;
  if (!tolerance) return 0;
  return tolerance.unit === "pct"
    ? (Math.abs(rule.value) * tolerance.value) / 100
    : Math.abs(tolerance.value);
}

/**
 * Does the answer satisfy the rule?
 *
 * The tolerance belongs to equality alone. A stored tolerance on a boundary rule is
 * ignored rather than applied: widening `≥ 10` to `≥ 5` behind the author's back would
 * award marks nobody meant to award, and the editor never offers the field there.
 *
 * @param rule   The numeric rule.
 * @param answer The learner's number, already parsed.
 * @returns True when the answer satisfies the rule.
 */
export function matchNumber(rule: NumericRule, answer: number): boolean {
  if (!Number.isFinite(answer)) return false;
  switch (rule.op) {
    case "ne":
      return Math.abs(answer - rule.value) > toleranceWindow(rule);
    case "gt":
      return answer > rule.value;
    case "gte":
      return answer >= rule.value;
    case "lt":
      return answer < rule.value;
    case "lte":
      return answer <= rule.value;
    case "eq":
    default:
      return Math.abs(answer - rule.value) <= toleranceWindow(rule);
  }
}
