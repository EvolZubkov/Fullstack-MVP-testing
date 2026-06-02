/**
 * @module shared/scales/engine
 *
 * Pure scale-computation core (PRD-5, B5). Given a test's scale configs, the
 * per-question measurement contributions and the learner's answers, it produces
 * the `scale.*` namespace (one {@link ScaleResult} per scale key) consumed by the
 * SCORM runtime and by the server-side preview/validate endpoints. It is the
 * authoritative implementation; a plain-JS twin
 * (server/scorm/template/app/scales/engine.js) runs in the package and is kept in
 * parity by a golden test.
 *
 * Pipeline per scale (scoring-model §10): select active contributions for the
 * learner's answer -> aggregate (sum/avg/weighted_avg/max/min) into `raw` ->
 * normalize (`none` keeps raw; `percent` maps to 0..100, inverted when
 * `direction = inverse`) -> apply interpretation bands to the *raw* value to
 * derive `level`/`label`.
 *
 * Stage-1 unit identity is index-based (the answer pipeline has no stable option
 * ids): `source_key` is the option index ("2"), the matching pair ("left:right")
 * or the ranking placement ("item:pos"); `source_type = "question"` contributes
 * whenever the question is answered.
 */

import type { ScaleResult } from "../formula/types";

export type ScaleAggregation = "sum" | "avg" | "weighted_avg" | "max" | "min";
export type ScaleNormalization = "none" | "percent" | "custom";
export type ScaleDirection = "positive" | "inverse";
export type QuestionType = "single" | "multiple" | "matching" | "ranking";

/** One interpretation band; `level` is the machine code, `label` the display text. */
export interface ScaleBand {
  min: number;
  max: number;
  level: string;
  label?: string;
}

export interface ScaleSpec {
  key: string;
  aggregation: ScaleAggregation;
  normalization: ScaleNormalization;
  direction: ScaleDirection;
  bands?: ScaleBand[];
}

export interface MeasurementSpec {
  questionId: string;
  scaleKey: string;
  sourceType: "question" | "option" | "matching_pair" | "ranking_position";
  sourceKey: string | null;
  value: number;
  weight: number;
}

/** Learner answer shapes by question type (runtime encoding). */
export type Answer = number | number[] | Record<string, number> | null | undefined;

export interface ScaleComputation {
  values: Record<string, ScaleResult>;
  errors: Array<{ key: string; message: string }>;
}

const EMPTY_RESULT: ScaleResult = {
  raw: 0,
  normalized: 0,
  percent: 0,
  level: "",
  label: "",
  hasValue: false,
};

/** Is this contribution unit active given the learner's answer? */
function isActive(m: MeasurementSpec, answer: Answer, qType: QuestionType | undefined): boolean {
  if (m.sourceType === "question") return answer !== null && answer !== undefined;
  if (answer === null || answer === undefined) return false;

  if (m.sourceType === "option") {
    const i = Number(m.sourceKey);
    if (Number.isNaN(i)) return false;
    if (qType === "single") return answer === i;
    if (qType === "multiple") return Array.isArray(answer) && answer.includes(i);
    return false;
  }
  if (m.sourceType === "matching_pair") {
    const [left, right] = String(m.sourceKey).split(":").map(Number);
    return typeof answer === "object" && !Array.isArray(answer) && (answer as Record<string, number>)[left] === right;
  }
  if (m.sourceType === "ranking_position") {
    const [item, pos] = String(m.sourceKey).split(":").map(Number);
    return Array.isArray(answer) && answer[pos] === item;
  }
  return false;
}

function aggregate(contribs: number[], agg: ScaleAggregation, weights: number[]): number {
  if (contribs.length === 0) return 0;
  const total = contribs.reduce((s, v) => s + v, 0);
  switch (agg) {
    case "sum":
      return total;
    case "avg":
      return total / contribs.length;
    case "weighted_avg": {
      const sw = weights.reduce((s, w) => s + w, 0);
      return sw === 0 ? 0 : total / sw;
    }
    case "max":
      return Math.max(...contribs);
    case "min":
      return Math.min(...contribs);
    default:
      return total;
  }
}

/**
 * The min/max raw a scale can take, used for percent normalization. Per question
 * the learner realises one option's value (single), any subset (multiple → 0..Σ
 * positives / Σ negatives..0), or a unit value (matching/ranking, best effort);
 * the per-question extremes are aggregated the same way as the live value.
 */
function rawRange(
  scaleMeasurements: MeasurementSpec[],
  agg: ScaleAggregation,
  questionTypes: Record<string, QuestionType>,
): { min: number; max: number } {
  const byQuestion = new Map<string, MeasurementSpec[]>();
  for (const m of scaleMeasurements) {
    const list = byQuestion.get(m.questionId) ?? [];
    list.push(m);
    byQuestion.set(m.questionId, list);
  }

  const mins: number[] = [];
  const maxes: number[] = [];
  const weights: number[] = [];
  for (const [questionId, ms] of byQuestion) {
    const vals = ms.map((m) => m.value * m.weight);
    const qType = questionTypes[questionId];
    if (qType === "multiple") {
      mins.push(vals.filter((v) => v < 0).reduce((s, v) => s + v, 0));
      maxes.push(vals.filter((v) => v > 0).reduce((s, v) => s + v, 0));
    } else {
      mins.push(Math.min(...vals));
      maxes.push(Math.max(...vals));
    }
    weights.push(ms.reduce((s, m) => s + m.weight, 0) / ms.length);
  }
  return {
    min: aggregate(mins, agg, weights),
    max: aggregate(maxes, agg, weights),
  };
}

function applyBands(raw: number, bands: ScaleBand[] | undefined): { level: string; label: string } {
  if (!bands || bands.length === 0) return { level: "", label: "" };
  const hit = bands.find((b) => raw >= b.min && raw <= b.max);
  if (!hit) return { level: "", label: "" };
  return { level: hit.level, label: hit.label ?? hit.level };
}

/**
 * Compute all scales. Deterministic — the same inputs always yield the same
 * output, so a recovered attempt recomputes identically.
 */
export function computeScales(
  scales: ScaleSpec[],
  measurements: MeasurementSpec[],
  answers: Record<string, Answer>,
  questionTypes: Record<string, QuestionType>,
): ScaleComputation {
  const values: Record<string, ScaleResult> = {};
  const errors: Array<{ key: string; message: string }> = [];

  for (const scale of scales) {
    try {
      const scaleMeasurements = measurements.filter((m) => m.scaleKey === scale.key);
      if (scaleMeasurements.length === 0) {
        values[scale.key] = { ...EMPTY_RESULT };
        continue;
      }

      const activeContribs: number[] = [];
      const activeWeights: number[] = [];
      for (const m of scaleMeasurements) {
        if (isActive(m, answers[m.questionId], questionTypes[m.questionId])) {
          activeContribs.push(m.value * m.weight);
          activeWeights.push(m.weight);
        }
      }

      const raw = aggregate(activeContribs, scale.aggregation, activeWeights);

      let normalized = raw;
      let percent = 0;
      if (scale.normalization === "percent") {
        const { min, max } = rawRange(scaleMeasurements, scale.aggregation, questionTypes);
        const span = max - min;
        if (span !== 0) {
          percent =
            scale.direction === "inverse"
              ? ((max - raw) / span) * 100
              : ((raw - min) / span) * 100;
        }
        normalized = percent;
      } else {
        // `none`: percent still exposed as a best-effort raw-as-percent is not
        // meaningful, so leave it 0 unless explicitly normalized.
        percent = 0;
      }

      const { level, label } = applyBands(raw, scale.bands);
      values[scale.key] = {
        raw,
        normalized,
        percent,
        level,
        label,
        hasValue: activeContribs.length > 0,
      };
    } catch (e) {
      errors.push({ key: scale.key, message: e instanceof Error ? e.message : String(e) });
      values[scale.key] = { ...EMPTY_RESULT };
    }
  }

  return { values, errors };
}
