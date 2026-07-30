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
import { isSingleIndexChoice } from "../questions/question-type";

export type ScaleAggregation = "sum" | "avg" | "weighted_avg" | "max" | "min";
export type ScaleNormalization = "none" | "percent" | "custom";
export type ScaleDirection = "positive" | "inverse";
/** Re-exported so the type list has ONE source across the product. */
export type { QuestionType } from "../questions/question-type";
import type { QuestionType } from "../questions/question-type";

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
    // A scale is answered by ONE graduation index, so its per-option contribution is
    // read exactly like single choice (PRD-26 FR-11).
    if (isSingleIndexChoice(qType ?? "")) return answer === i;
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

/** One fired measurement unit's contribution to a scale, for a single answer. */
export interface AnswerContribution {
  scaleKey: string;
  /** The realised `value * weight` of the measurement unit. */
  delta: number;
}

/**
 * Per-answer scale contributions: for one question's answer, the `value * weight`
 * of every measurement unit that fired, tagged by scale. Mirrors the SCORM/debug
 * inspector's `contributionsFor` (one entry per active unit — NOT summed per
 * scale), so a multi-select answer can contribute several deltas to the same
 * scale. Used by the analytics per-attempt export to show how each answer moved
 * the scales, recomputed from the stored answer + the test's measurements.
 *
 * @param measurements - The test's measurement specs (all questions).
 * @param questionId - The question whose answer is scored.
 * @param answer - The learner's answer (runtime encoding).
 * @param qType - The question type (drives unit-firing for option/pair/position).
 * @returns One `{ scaleKey, delta }` per fired unit, in measurement order.
 */
export function computeAnswerContributions(
  measurements: MeasurementSpec[],
  questionId: string,
  answer: Answer,
  qType: QuestionType | undefined,
): AnswerContribution[] {
  const out: AnswerContribution[] = [];
  for (const m of measurements) {
    if (m.questionId !== questionId) continue;
    if (isActive(m, answer, qType)) out.push({ scaleKey: m.scaleKey, delta: m.value * m.weight });
  }
  return out;
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
 * The min/max raw a scale can take on THIS attempt (PRD-5 §5.2 minPossible /
 * maxPossible), used for percent normalization. Only questions actually delivered
 * to the learner bound the range: a bank question the draw did not deliver
 * contributes 0 to `raw`, so counting its extremes would push `raw` outside
 * [min, max] and make percent go negative / exceed 100 (the reported defect). A
 * question is "delivered" when it has an entry in `answers`.
 *
 * Per-question achievable contribution:
 * - single: exactly one unit fires and an unmeasured/other option scores 0, so the
 *   range is `[min(0, …vals), max(0, …vals)]`.
 * - multiple / matching / ranking: several units can fire together (a subset of
 *   options, every formed pair, every placement), so the extremes are the sums of
 *   the negative / positive units — the same way `raw` sums the active ones.
 */
function rawRange(
  scaleMeasurements: MeasurementSpec[],
  agg: ScaleAggregation,
  questionTypes: Record<string, QuestionType>,
  answers: Record<string, Answer>,
): { min: number; max: number } {
  const byQuestion = new Map<string, MeasurementSpec[]>();
  for (const m of scaleMeasurements) {
    if (!Object.prototype.hasOwnProperty.call(answers, m.questionId)) continue;
    const list = byQuestion.get(m.questionId) ?? [];
    list.push(m);
    byQuestion.set(m.questionId, list);
  }

  const mins: number[] = [];
  const maxes: number[] = [];
  const weights: number[] = [];
  for (const [questionId, ms] of byQuestion) {
    const vals = ms.map((m) => m.value * m.weight);
    // One-index answers (single choice, scale) can activate at most ONE unit of the
    // question, so the range is the extremum, not the sum.
    if (isSingleIndexChoice(questionTypes[questionId] ?? "")) {
      mins.push(Math.min(0, ...vals));
      maxes.push(Math.max(0, ...vals));
    } else {
      mins.push(vals.filter((v) => v < 0).reduce((s, v) => s + v, 0));
      maxes.push(vals.filter((v) => v > 0).reduce((s, v) => s + v, 0));
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
        const { min, max } = rawRange(scaleMeasurements, scale.aggregation, questionTypes, answers);
        const span = max - min;
        if (span > 0) {
          percent =
            scale.direction === "inverse"
              ? ((max - raw) / span) * 100
              : ((raw - min) / span) * 100;
        } else {
          // PRD-5 §5.2: the range is impossible / zero — percent is undefined, so
          // report it as a diagnostic rather than emitting a meaningless number.
          errors.push({ key: scale.key, message: "percent: диапазон нормализации невозможен или нулевой" });
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
