/**
 * @module server/services/scale-domain
 *
 * Materializes the DOMAIN of a scale — its declared `domainMin` / `domainMax` — into
 * `scales.config_json` when the author never set one (PRD-35 §5).
 *
 * Why write it instead of computing it at render time: a domain derived on every
 * draw silently shifts the moment a question is added to the test, and yesterday's
 * attempt would then render a different radar from the same answers. Published
 * attempts are pinned to a snapshot (PRD-15), so their artefacts must stay
 * reproducible (NFR-21). The same reasoning already governs the stored domain in
 * PRD-29 §4.1; this module only makes sure the value EXISTS by the time an attempt
 * is taken, for tests whose scales the author never opened.
 *
 * The value is a suggestion the author may override at any time: the editor shows
 * the computed range and writes the author's own bounds when given.
 */

import { storage } from "../storage";
import { achievableRange, type MeasurementSpec, type QuestionType } from "@shared/scales/engine";
import { allocationBudgets } from "@shared/questions/allocation";
import type { QuestionMeasurement, Scale } from "@shared/schema";

/** Bounds a scale's contributions can actually reach. */
export interface ReachableRange {
  min: number;
  max: number;
}

/**
 * The config a scale should be saved with, or `null` when nothing must change.
 *
 * Refuses a zero-width range: it would divide by zero in the radar's radius and
 * describe a "domain" where every value sits in the same point.
 */
export function domainPatch(
  config: Record<string, unknown>,
  range: ReachableRange | null,
): Record<string, unknown> | null {
  if (!range || !(range.max > range.min)) return null;
  const hasMin = typeof config.domainMin === "number";
  const hasMax = typeof config.domainMax === "number";
  if (hasMin && hasMax) return null;
  return { ...config, domainMin: range.min, domainMax: range.max };
}

/** DB measurement rows -> engine specs, with `scaleId` resolved to the scale key. */
function toMeasurementSpecs(measurements: QuestionMeasurement[], scales: Scale[]): MeasurementSpec[] {
  const scaleKeyById = new Map(scales.map((s) => [s.id, s.key]));
  const out: MeasurementSpec[] = [];
  for (const m of measurements) {
    const scaleKey = scaleKeyById.get(m.scaleId);
    if (!scaleKey) continue; // orphan row — skip
    out.push({
      questionId: m.questionId,
      scaleKey,
      sourceType: m.sourceType,
      sourceKey: m.sourceKey ?? null,
      value: m.valueJson,
      weight: m.weight ?? 1,
    });
  }
  return out;
}

/**
 * Fills in the missing domains of a test's scales and returns how many were written.
 *
 * Idempotent: a scale that already has both bounds is skipped, so calling this on
 * every save and again on publication costs one read and no writes. Silent by
 * design — this is a repair of missing data, not an author-facing operation, and it
 * never overwrites what the author set.
 */
export async function materializeScaleDomains(testId: string): Promise<number> {
  const scales = await storage.getScales(testId);
  const pending = scales.filter((s) => {
    const config = (s.configJson ?? {}) as Record<string, unknown>;
    return typeof config.domainMin !== "number" || typeof config.domainMax !== "number";
  });
  if (pending.length === 0) return 0;

  const measurements = await storage.getQuestionMeasurements(testId);
  if (measurements.length === 0) return 0;
  const questionIds = Array.from(new Set(measurements.map((m) => m.questionId)));
  const questions = await storage.getQuestionsByIds(questionIds);
  const types: Record<string, QuestionType> = {};
  for (const q of questions) types[q.id] = q.type as QuestionType;
  // PRD-44: the budget bounds an allocation question's contribution, so the stored domain
  // must be computed with it — without it the domain collapses and every band moves.
  const budgets = allocationBudgets(questions);

  const specs = toMeasurementSpecs(measurements, scales);
  let written = 0;
  for (const scale of pending) {
    const range = achievableRange(
      specs.filter((m) => m.scaleKey === scale.key),
      scale.aggregation,
      types,
      budgets,
    );
    const patch = domainPatch((scale.configJson ?? {}) as Record<string, unknown>, range);
    if (!patch) continue;
    await storage.updateScale(scale.id, { configJson: patch });
    written += 1;
  }
  return written;
}
