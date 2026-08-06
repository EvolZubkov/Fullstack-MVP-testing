/**
 * @module shared/questions/allocation
 *
 * The arithmetic of the budget-allocation question (PRD-44): the learner splits a fixed
 * BUDGET of points across several statements, and the amounts they assign are the answer.
 *
 * This module is the SINGLE source of those rules. They are read by four consumers that
 * would otherwise each grow their own copy — the learner renderer and its live input, the
 * submit gate (`hasAnswer`), the editor's save validation, and the workbook import — and a
 * rule that drifts between them is not a cosmetic bug: a ceiling computed differently in
 * the renderer than in the gate lets a learner build a distribution the gate then refuses.
 *
 * Two invariants shape every function here:
 *
 *  - Overshoot is impossible BY CONSTRUCTION (FR-29). The ceiling of one statement is not
 *    its own maximum but `min(maxPerOption, current + remaining)`, so the budget cannot be
 *    exceeded by the slider, by typing, or by a paste. There is no «too much» state and no
 *    error message for one — only «not yet distributed».
 *  - A touched answer carries an entry for EVERY statement, zeros included (FR-06):
 *    analytics must tell «assigned nothing» apart from «never reached this statement».
 *
 * Pure and framework-free — no DOM, no Node — so the SCORM runtime can bundle it.
 */

/** The author's configuration of one allocation question, already sanitised. */
export interface AllocationSpec {
  /** Statement texts; they live in `dataJson.options` like any other option list (FR-02). */
  options: unknown[];
  /** Total points the learner must distribute in full. */
  budget: number;
  /** Floor for ONE statement. */
  minPerOption: number;
  /** Ceiling for ONE statement, before the remaining budget bounds it further. */
  maxPerOption: number;
}

/**
 * The learner's answer: statement index (in the AUTHOR's order, not the delivery order)
 * to assigned points. Same encoding as matching, so storage, snapshots and analytics
 * carry it along the existing path (FR-06).
 */
export type AllocationAnswer = Record<string, number>;

/** Why a configuration cannot be filled in, with the numbers to show the author (FR-05). */
export type AllocationFeasibility =
  | { ok: true }
  | {
      ok: false;
      /** `min` — the floors already exceed the budget; `max` — the ceilings cannot reach it. */
      kind: "min" | "max";
      required: number;
      available: number;
    };

/** Bounds of the author's fields (FR-04). */
export const ALLOCATION_LIMITS = {
  minBudget: 1,
  maxBudget: 1000,
  minOptions: 2,
  maxOptions: 10,
} as const;

/** A non-negative integer, or the fallback: `dataJson` is `unknown` and may hold anything. */
function intOrNull(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.trunc(n));
}

/**
 * Read a question's `dataJson` into a spec, defensively: the column reaches every host as
 * `unknown`, so a malformed row must degrade to an empty budget rather than throw in the
 * middle of an attempt.
 *
 * `maxPerOption` defaults to the whole budget and `minPerOption` to zero (FR-04) — the
 * reference questionnaire's own configuration, so its rows may leave both cells empty.
 */
export function allocationSpec(dataJson: unknown): AllocationSpec {
  const d = (dataJson ?? {}) as { options?: unknown; budget?: unknown; minPerOption?: unknown; maxPerOption?: unknown };
  const options = Array.isArray(d.options) ? d.options : [];
  const budget = intOrNull(d.budget) ?? 0;
  const minPerOption = intOrNull(d.minPerOption) ?? 0;
  const maxPerOption = intOrNull(d.maxPerOption) ?? budget;
  return { options, budget, minPerOption, maxPerOption };
}

/**
 * Can this configuration be filled in at all (FR-05)? Both directions have to hold: the
 * floors must fit inside the budget, and the ceilings must be able to reach it. Without
 * the check an author saves a question no learner can complete — the reference discussion
 * asked for «at least 2 points per option» across four options on a budget of 7, i.e. a
 * minimum of 8 points out of 7 available.
 *
 * The numbers come back with the verdict so the message can name them; «невыполнимо» on
 * its own leaves the author guessing which of the three fields to change.
 */
export function isAllocationFeasible(spec: AllocationSpec): AllocationFeasibility {
  const count = spec.options.length;
  const required = count * spec.minPerOption;
  if (required > spec.budget) return { ok: false, kind: "min", required, available: spec.budget };
  const available = count * spec.maxPerOption;
  if (available < spec.budget) return { ok: false, kind: "max", required: spec.budget, available };
  return { ok: true };
}

/**
 * The answer a fresh question starts from (FR-30). With a floor above zero every statement
 * starts AT the floor — the lower bound is provided, never enforced by refusal, because a
 * learner who spends the whole budget and leaves one statement at zero would otherwise be
 * stuck with no legal move. With the default floor of zero there is no pre-fill at all, so
 * an untouched question stays visibly untouched.
 */
export function seedAllocation(spec: AllocationSpec): AllocationAnswer {
  if (spec.minPerOption <= 0) return {};
  const out: AllocationAnswer = {};
  for (let i = 0; i < spec.options.length; i++) out[i] = spec.minPerOption;
  return out;
}

/**
 * The answer with an entry for every statement and nothing else: missing statements take
 * the floor, foreign keys are dropped, and a non-object answer (a legacy row, a type
 * switched in the editor) degrades to the seed rather than throwing.
 */
export function normalizeAllocation(spec: AllocationSpec, answer: unknown): AllocationAnswer {
  const src = (answer && typeof answer === "object" && !Array.isArray(answer) ? answer : {}) as Record<string, unknown>;
  const out: AllocationAnswer = {};
  for (let i = 0; i < spec.options.length; i++) {
    const raw = intOrNull(src[String(i)]);
    out[i] = raw === null ? spec.minPerOption : raw;
  }
  return out;
}

/** Points assigned so far. Reads the answer as given — no spec needed. */
export function allocationTotal(answer: unknown): number {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return 0;
  let sum = 0;
  for (const value of Object.values(answer as Record<string, unknown>)) {
    const n = intOrNull(value);
    if (n !== null) sum += n;
  }
  return sum;
}

/** Points still to distribute; never negative, since no input can overshoot (FR-29). */
export function allocationRemaining(spec: AllocationSpec, answer: unknown): number {
  return Math.max(0, spec.budget - allocationTotal(answer));
}

/**
 * The highest value statement `index` may take RIGHT NOW: its own ceiling, bounded by what
 * is still unspent plus what it already holds (FR-29). This is the number the slider and
 * the number field both publish as their maximum, which is what makes overshoot impossible
 * rather than merely rejected.
 */
export function optionCeiling(spec: AllocationSpec, answer: unknown, index: number): number {
  const normalized = normalizeAllocation(spec, answer);
  const current = normalized[index] ?? spec.minPerOption;
  return Math.min(spec.maxPerOption, current + Math.max(0, spec.budget - allocationTotal(normalized)));
}

/**
 * Assign `value` points to statement `index`, clamped into `[minPerOption, ceiling]`.
 * Returns a COMPLETE answer (every statement present, zeros included — FR-06), so the
 * first interaction with any statement is what fills the record for all of them.
 *
 * An index outside the statement list leaves the answer untouched: a stale delivery order
 * or a hand-edited payload must not create a phantom statement the scales would then read.
 */
export function setAllocationValue(
  spec: AllocationSpec,
  answer: unknown,
  index: number,
  value: unknown,
): AllocationAnswer {
  const next = normalizeAllocation(spec, answer);
  if (!Number.isInteger(index) || index < 0 || index >= spec.options.length) return next;
  const requested = intOrNull(value) ?? spec.minPerOption;
  // The ceiling is computed with this statement's own contribution taken out, so raising a
  // statement from 1 to 4 is bounded by «remaining + 1», not by «remaining».
  const ceiling = optionCeiling(spec, next, index);
  next[index] = Math.min(Math.max(requested, spec.minPerOption), ceiling);
  return next;
}

/**
 * Is the question answered (FR-31)? Only a distribution that spends the budget EXACTLY
 * counts. A partial distribution is a skipped question, so the submit button stays
 * disabled and the PRD-19 «вернуться к незавершённым» counter picks the question up.
 *
 * A zero budget never counts as answered: a broken configuration must not let the question
 * pass as complete without the learner touching it.
 */
export function isAllocationComplete(spec: AllocationSpec, answer: unknown): boolean {
  if (spec.budget <= 0) return false;
  return allocationTotal(normalizeAllocation(spec, answer)) === spec.budget;
}
