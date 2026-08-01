/**
 * @module server/services/scoring-config
 *
 * Loads a test's graded-scoring configuration — scales (PRD-5), per-question
 * measurements and result variables (PRD-2) — from storage and maps the DB rows
 * to the `@shared` engine spec shapes consumed by
 * {@link module:server/services/result-compute}. The mapping mirrors the SCORM
 * exporter (server/scorm/builders/test-json.ts) so both runtimes feed the engines
 * identical configuration (PRD-12 §3.5).
 *
 * Kept separate from result-compute so the pure compute path stays storage-free
 * and unit-testable without a database.
 */

import type { ScaleSpec, MeasurementSpec } from "@shared/scales/engine";
import { parseScaleInterpretation } from "@shared/scales/interpretation";
import type { ResultVariableSpec } from "@shared/formula/result-variables";
import { storage } from "../storage";
import type { ScoringConfig } from "./result-compute";
import type { Scale, QuestionMeasurement, ResultVariable } from "@shared/schema";

/** The scoring rows reader — live storage by default, a snapshot at delivery. */
export interface ScoringConfigSource {
  getScales(testId: string): Promise<Scale[]>;
  getQuestionMeasurements(testId: string): Promise<QuestionMeasurement[]>;
  getResultVariables(testId: string): Promise<ResultVariable[]>;
}

/**
 * Loads and maps a test's scales / measurements / result variables to engine specs.
 * Orphan measurement rows (scale deleted, cascade missed) are skipped, as in the
 * exporter. PRD-15 block B: pass a snapshot source so a published attempt is
 * graded from frozen scales/variables; defaults to live storage.
 */
export async function loadScoringConfig(
  testId: string,
  source: ScoringConfigSource = storage,
): Promise<ScoringConfig> {
  const [scaleRows, measurementRows, rvRows] = await Promise.all([
    source.getScales(testId),
    source.getQuestionMeasurements(testId),
    source.getResultVariables(testId),
  ]);

  // PRD-29: read the WHOLE interpretation, not just `bands` — the domain and the
  // valence travel in the same `config_json` and downstream consumers need them.
  const scales: ScaleSpec[] = scaleRows.map((s) => {
    const interpretation = parseScaleInterpretation(s.configJson);
    return {
      key: s.key,
      aggregation: s.aggregation as ScaleSpec["aggregation"],
      normalization: s.normalization as ScaleSpec["normalization"],
      direction: s.direction as ScaleSpec["direction"],
      bands: interpretation.bands,
    };
  });

  const scaleKeyById = new Map(scaleRows.map((s) => [s.id, s.key]));
  const measurements: MeasurementSpec[] = measurementRows
    .map((m): MeasurementSpec | null => {
      const scaleKey = scaleKeyById.get(m.scaleId);
      if (!scaleKey) return null;
      return {
        questionId: m.questionId,
        scaleKey,
        sourceType: m.sourceType as MeasurementSpec["sourceType"],
        sourceKey: m.sourceKey ?? null,
        value: m.valueJson as number,
        weight: m.weight ?? 1,
      };
    })
    .filter((m): m is MeasurementSpec => m !== null);

  const resultVariables: ResultVariableSpec[] = rvRows.map((rv) => ({
    name: rv.name,
    type: rv.type as ResultVariableSpec["type"],
    formula: rv.formula,
    controlsStatus: (rv.controlsStatus ?? undefined) as ResultVariableSpec["controlsStatus"],
    sortOrder: rv.sortOrder ?? 0,
  }));

  return { scales, measurements, resultVariables };
}
