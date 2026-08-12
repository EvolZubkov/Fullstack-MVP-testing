/**
 * @module shared/scales/composition
 *
 * Decides whether a test's scales form a DISTRIBUTION of one whole — the precondition the
 * rose chart needs (PRD-46 §5).
 *
 * The question is not editorial. A method is ipsative when its arithmetic makes the sum
 * across scales independent of the answers: the ЧИЛ questionnaire (PRD-44) hands the
 * respondent a fixed budget per block and asks them to split it between four styles, so the
 * four totals always add up to 98. Only then does «доля от целого» exist as a quantity, and
 * only then may a diagram claim the circle is that whole.
 *
 * The condition checked here is the general form of that arithmetic: every contribution to
 * the scales comes from an allocation question, and inside one question EVERY statement
 * contributes the same amount across the scales taken together. The sum is then
 * `constant × budget × question count` — a number the learner cannot move.
 *
 * Why the per-statement equality and not just «all questions are allocations»: an author can
 * weight one statement twice, or leave a statement feeding nothing. Both break the invariant
 * silently, and both draw a rose whose sectors no longer add up to the circle.
 *
 * Pure — no DOM, no Node — because both hosts must reach the same verdict (PRD-29 §9).
 */

import type { MeasurementSpec } from "./engine";
import type { QuestionType } from "../questions/question-type";
import type { AllocationSpec } from "../questions/allocation";

export interface IpsativeInput {
  /** Every contribution row of the test; rows of other scales are ignored. */
  measurements: readonly MeasurementSpec[];
  /** Keys of the scales the diagram would draw. */
  scaleKeys: readonly string[];
  /** Question types by id, as the scale engine already receives them. */
  questionTypes: Record<string, QuestionType | undefined>;
  /** Allocation specs by question id — `allocationBudgets()` output, reused verbatim. */
  budgets: Record<string, AllocationSpec>;
}

/** Contributions are integers times weights; compare them with a float-noise guard. */
const EPSILON = 1e-9;

/**
 * Does the model guarantee a constant sum across `scaleKeys`?
 *
 * Refuses on anything it cannot prove. A false negative costs a radar instead of a rose,
 * which is merely a weaker statement about the data; a false positive costs a diagram that
 * claims a whole which does not exist.
 */
export function isIpsativeModel(input: IpsativeInput): boolean {
  const keys = new Set(input.scaleKeys);
  // One scale is not a distribution: there is nothing to split.
  if (keys.size < 2) return false;

  const byQuestion = new Map<string, MeasurementSpec[]>();
  for (const m of input.measurements) {
    if (!keys.has(m.scaleKey)) continue;
    // A single contribution from any other source breaks the invariant: it adds an amount
    // the budget does not bound.
    if (m.sourceType !== "option_allocation") return false;
    if (input.questionTypes[m.questionId] !== "allocation") return false;
    const rows = byQuestion.get(m.questionId);
    if (rows) rows.push(m);
    else byQuestion.set(m.questionId, [m]);
  }
  if (byQuestion.size === 0) return false;

  for (const [questionId, rows] of byQuestion) {
    const spec = input.budgets[questionId];
    if (!spec || spec.options.length < 2) return false;

    let constant: number | null = null;
    for (let index = 0; index < spec.options.length; index += 1) {
      let sum = 0;
      for (const row of rows) {
        if (Number(row.sourceKey) === index) sum += row.value * row.weight;
      }
      // Zero means this statement feeds nothing: points spent on it leave the profile, so
      // the total depends on the answer after all.
      if (!(sum > 0)) return false;
      if (constant === null) constant = sum;
      else if (Math.abs(sum - constant) > EPSILON) return false;
    }
  }
  return true;
}
