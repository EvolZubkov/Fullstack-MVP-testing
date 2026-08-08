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
import { chartKindSetting, type ChartKindSettings } from "@shared/template/scales-chart";
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
 * Guard this by what the caller pays. On a HOST rendering results, call it only when the chart
 * setting is `auto`: with an explicit `radar`, `rose` or `none` the answer changes nothing, and
 * the reads it costs would be spent on every screen for nothing. That guard is what makes
 * «compute on the fly» cheap — the price is paid by exactly those tests whose authors asked the
 * system to decide.
 *
 * The SCORM bake calls it unconditionally (`scorm/build-export-data`): a build happens once, and
 * the answer has to be in the package before anyone knows which setting it will be read under.
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

/**
 * Keys of the scales a diagram would DRAW.
 *
 * A hidden scale is not part of the figure, and a share of a whole the learner is not shown is
 * a share of a DIFFERENT whole — so the verdict has to be reached on the same set the renderer
 * draws (`visibleScales` in `shared/template/result-context` filters by the very same rule).
 */
export function drawnScaleKeys(scales: readonly Scale[]): string[] {
  return scales.filter((s) => s.learnerVisibility !== "hidden").map((s) => s.key);
}

/** The reads {@link ipsativeScalesForDelivery} needs — a subset of `TestDataSource`. */
export interface CompositionSource {
  getQuestionMeasurements(testId: string): Promise<QuestionMeasurement[]>;
  getTestSections(testId: string): Promise<{ topicId: string }[]>;
  getQuestionsByTopic(topicId: string): Promise<CompositionQuestion[]>;
}

/**
 * The verdict for a test being DELIVERED to a learner, read through the attempt's data source
 * (live, or the snapshot the attempt is pinned to — the caller decides, so a finished attempt
 * keeps answering from the content it was taken on).
 *
 * Ordered so that nothing is read until it can change the answer: an author who named the
 * diagram gets no reads at all, and neither does a test with fewer than two shown scales. That
 * is the whole reason the flag is computed rather than stored — the results screen renders on
 * every visit, and only the tests whose author asked the system to decide pay for it.
 *
 * KNOWN LIMIT of that guard: the REPORT carries its own switch (PRD-35 §9), and the answer it
 * receives is the one computed for the SCREEN. A test whose screen names a diagram while its
 * report says `auto` therefore gets a radar in the report. That is the safe direction — a false
 * negative states less about the data, never more — but it is a divergence, and closing it
 * means knowing the report variant's fields here, where only the screen's settings are read.
 */
export async function ipsativeScalesForDelivery(
  src: CompositionSource,
  testId: string,
  scales: Scale[],
  settings: ChartKindSettings,
): Promise<boolean> {
  if (chartKindSetting(settings) !== "auto") return false;
  const scaleKeys = drawnScaleKeys(scales);
  if (scaleKeys.length < 2) return false;

  const measurements = await src.getQuestionMeasurements(testId);
  if (measurements.length === 0) return false;

  const sections = await src.getTestSections(testId);
  const byTopic = await Promise.all(sections.map((s) => src.getQuestionsByTopic(s.topicId)));
  return isTestIpsative({ scales, scaleKeys, measurements, questions: byTopic.flat() });
}
