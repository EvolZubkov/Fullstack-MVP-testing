/**
 * @module server/services/result-compute
 *
 * Pure orchestration of the graded result namespaces — scales (PRD-5) and result
 * variables (PRD-2) — for the web learner runtime (PRD-12 Phase 2). It reuses the
 * authoritative `@shared` engines, the same ones the SCORM package runs, so the
 * web and SCORM produce identical numbers (PRD-12 §3.5). The compute order mirrors
 * the SCORM runtime (server/scorm/template/app/render/resultsPage.js): scales first
 * (so result-variable formulas can read `scale.*`), then the variables.
 *
 * This module is storage-free (unit-testable without a DB). The DB->spec config
 * loading lives in {@link module:server/services/scoring-config} (loadScoringConfig).
 */

import {
  computeScales,
  type ScaleSpec,
  type MeasurementSpec,
  type QuestionType,
  type Answer,
} from "@shared/scales/engine";
import { computeResultVariables, type ResultVariableSpec } from "@shared/formula/result-variables";
import type { EvalContext, FormulaValue, ScaleResult } from "@shared/formula/types";

/** A test's graded-scoring configuration, mapped to the `@shared` engine specs. */
export interface ScoringConfig {
  scales: ScaleSpec[];
  measurements: MeasurementSpec[];
  resultVariables: ResultVariableSpec[];
}

/** The computed graded namespaces for one attempt. */
export interface AttemptComputation {
  scaleResults: Record<string, ScaleResult>;
  resultVariables: Record<string, FormulaValue>;
  status: { success?: boolean; completion?: boolean };
}

/** Per-topic inputs the result-variable context needs (`percent`, `topicById`). */
export interface AttemptResultBase {
  percent: number;
  topicResults: Array<{ topicId: string; percent: number; passed: boolean | null; earnedPoints: number }>;
}

/**
 * Computes `scale.*` then `result.*` for an attempt, mirroring the SCORM runtime
 * order: scales first so result-variable formulas can read `scaleById()` /
 * `countScales()`, then the variables. Deterministic — the same answers always
 * yield the same output (NFR-04). `tags`/`sections` resolve to neutral defaults,
 * matching the current runtime (`buildResultVarContext`).
 */
export function computeAttemptResult(
  config: ScoringConfig,
  answers: Record<string, Answer>,
  questionTypes: Record<string, QuestionType>,
  base: AttemptResultBase,
): AttemptComputation {
  const scaleComputation = config.scales.length
    ? computeScales(config.scales, config.measurements, answers, questionTypes)
    : { values: {} as Record<string, ScaleResult>, errors: [] };

  const topics: EvalContext["topics"] = {};
  for (const tr of base.topicResults) {
    topics[tr.topicId] = {
      percent: tr.percent || 0,
      passed: tr.passed === true,
      score: tr.earnedPoints || 0,
    };
  }

  const evalBase: Omit<EvalContext, "vars"> = {
    percent: base.percent || 0,
    topics,
    tags: {},
    scales: scaleComputation.values,
    sections: {},
  };

  const resultComputation = config.resultVariables.length
    ? computeResultVariables(config.resultVariables, evalBase)
    : { values: {} as Record<string, FormulaValue>, errors: [], status: {} as AttemptComputation["status"] };

  return {
    scaleResults: scaleComputation.values,
    resultVariables: resultComputation.values,
    status: resultComputation.status,
  };
}
