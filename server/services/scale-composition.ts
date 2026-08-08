/**
 * @module server/services/scale-composition
 *
 * Answers one question about a test: do its scales divide ONE WHOLE (PRD-46 §5)?
 *
 * The verdict decides which diagram the `auto` setting draws, so it must be reproducible for a
 * finished attempt. It is NOT stored for that: the attempt is pinned to a publication snapshot
 * (PRD-15), and the snapshot already carries scales, measurements and questions. Computing
 * from the snapshot is reproducible BY CONSTRUCTION, while a stored flag would be a second
 * copy of a fact the snapshot already holds — and second copies drift. The domain is stored
 * for the opposite reason: it is an author-editable value with an override, so there is
 * something to preserve; here there is only something to recompute.
 *
 * Cost is paid only where it buys something — see {@link isTestIpsative}.
 */

import { isIpsativeModel } from "@shared/scales/composition";
import { allocationBudgets, type BudgetQuestion } from "@shared/questions/allocation";
import type { QuestionType } from "@shared/scales/engine";
import type { QuestionMeasurement, Scale } from "@shared/schema";
import { toMeasurementSpecs } from "./scale-domain";

/** Question shape this module reads: the type and the `dataJson` a budget lives in. */
export type CompositionQuestion = BudgetQuestion & { type: string };

export interface CompositionInput {
  /** Scales the diagram would DRAW — hidden ones excluded by the caller. */
  scales: Scale[];
  /** Keys of those scales; passed separately because the caller already knows which are shown. */
  scaleKeys: string[];
  measurements: QuestionMeasurement[];
  questions: CompositionQuestion[];
}

/**
 * Do the given scales divide one whole?
 *
 * Call this ONLY when the chart setting is `auto`: with an explicit `radar`, `rose` or `none`
 * the answer changes nothing, and the reads it costs would be spent for nothing. That guard is
 * what makes «compute on the fly» cheap — the price is paid by exactly those tests whose
 * authors asked the system to decide.
 */
export function isTestIpsative(input: CompositionInput): boolean {
  if (input.scaleKeys.length < 2 || input.measurements.length === 0) return false;

  const types: Record<string, QuestionType> = {};
  for (const q of input.questions) types[q.id] = q.type as QuestionType;

  return isIpsativeModel({
    measurements: toMeasurementSpecs(input.measurements, input.scales),
    scaleKeys: input.scaleKeys,
    questionTypes: types,
    budgets: allocationBudgets(input.questions),
  });
}
