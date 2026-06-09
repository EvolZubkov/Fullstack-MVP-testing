/**
 * @module tests/fixtures/mbi
 *
 * Shared MBI burnout fixture (PRD-5 + PRD-2; docs/specs/prd-5/example-mbi.md):
 * 3 scales (EE/D/AD, AD inverse), 22 single-choice questions (option value 0..5),
 * the `burnout_category` result variable, answer builders, and an INDEPENDENT
 * reference implementation of the spec's 27-level combination table (the logic
 * the external `process_burnout_export.py` encodes).
 *
 * Shared by the authoritative-pipeline golden (tests/mbi-golden) and the
 * server-orchestration parity test (tests/result-compute-mbi-parity) so both
 * assert against one corpus (PRD-12 task 2-6).
 */
import type { ScaleSpec, MeasurementSpec, QuestionType } from "../../shared/scales/engine";
import type { ResultVariableSpec } from "../../shared/formula";

export type ScaleKey = "ee" | "d" | "ad";
export type Level = "low" | "mid" | "high";

export const QUESTIONS_OF_SCALE: Record<ScaleKey, number[]> = {
  ee: [1, 2, 3, 6, 8, 13, 14, 16, 20],
  d: [5, 10, 11, 15, 22],
  ad: [4, 7, 9, 12, 17, 18, 19, 21],
};

export const SCALE_OF_QUESTION: Record<number, ScaleKey> = {};
(Object.keys(QUESTIONS_OF_SCALE) as ScaleKey[]).forEach((scale) => {
  for (const n of QUESTIONS_OF_SCALE[scale]) SCALE_OF_QUESTION[n] = scale;
});

export const MBI_SCALES: ScaleSpec[] = [
  {
    key: "ee",
    aggregation: "sum",
    normalization: "percent",
    direction: "positive",
    bands: [
      { min: 0, max: 14, level: "low", label: "Низкий" },
      { min: 15, max: 24, level: "mid", label: "Средний" },
      { min: 25, max: 45, level: "high", label: "Высокий" },
    ],
  },
  {
    key: "d",
    aggregation: "sum",
    normalization: "percent",
    direction: "positive",
    bands: [
      { min: 0, max: 4, level: "low", label: "Низкий" },
      { min: 5, max: 9, level: "mid", label: "Средний" },
      { min: 10, max: 25, level: "high", label: "Высокий" },
    ],
  },
  {
    key: "ad",
    aggregation: "sum",
    normalization: "percent",
    direction: "inverse",
    bands: [
      { min: 0, max: 27, level: "high", label: "Высокий" },
      { min: 28, max: 32, level: "mid", label: "Средний" },
      { min: 33, max: 40, level: "low", label: "Низкий" },
    ],
  },
];

// Every question is single-choice with six options whose explicit contribution
// equals the option index 0..5 (example-mbi §2.3/§2.4).
export const MBI_MEASUREMENTS: MeasurementSpec[] = [];
export const MBI_QUESTION_TYPES: Record<string, QuestionType> = {};
for (let n = 1; n <= 22; n++) {
  const questionId = `q${n}`;
  MBI_QUESTION_TYPES[questionId] = "single";
  const scaleKey = SCALE_OF_QUESTION[n];
  for (let opt = 0; opt <= 5; opt++) {
    MBI_MEASUREMENTS.push({
      questionId,
      scaleKey,
      sourceType: "option",
      sourceKey: String(opt),
      value: opt,
      weight: 1,
    });
  }
}

export const BURNOUT_VAR: ResultVariableSpec = {
  name: "burnout_category",
  type: "string",
  sortOrder: 100,
  formula: `
    IF(countScales(["ee","d","ad"], "high") = 3, "Выгорание",
    IF(countScales(["ee","d","ad"], "high") = 2, "Возрастающее истощение",
    IF(countScales(["ee","d","ad"], "high") = 1
       AND countScales(["ee","d","ad"], "mid") <= 1, "Начинающееся истощение",
    IF(countScales(["ee","d","ad"], "high") = 1
       AND countScales(["ee","d","ad"], "mid") = 2, "Возрастающее истощение",
    IF(countScales(["ee","d","ad"], "high") = 0
       AND countScales(["ee","d","ad"], "mid") = 0, "Вовлечённость",
    "Снижающаяся вовлечённость")))))
  `,
};

// ─── Independent reference (the external post-processor's logic) ─────────────────

/** Map a scale's raw to its level via the spec thresholds (example-mbi §2.2). */
export function referenceLevel(scale: ScaleKey, raw: number): Level {
  if (scale === "ee") return raw <= 14 ? "low" : raw <= 24 ? "mid" : "high";
  if (scale === "d") return raw <= 4 ? "low" : raw <= 9 ? "mid" : "high";
  // ad: bands are ascending on raw but the level semantics are inverse.
  return raw <= 27 ? "high" : raw <= 32 ? "mid" : "low";
}

/** The 27-combination category table (example-mbi §2.5). */
export function referenceCategory(highCount: number, midCount: number): string {
  if (highCount === 3) return "Выгорание";
  if (highCount === 2) return "Возрастающее истощение";
  if (highCount === 1) return midCount === 2 ? "Возрастающее истощение" : "Начинающееся истощение";
  // highCount === 0
  return midCount === 0 ? "Вовлечённость" : "Снижающаяся вовлечённость";
}

export function referenceRun(answers: Record<string, number>): {
  raws: Record<ScaleKey, number>;
  levels: Record<ScaleKey, Level>;
  category: string;
} {
  const raws: Record<ScaleKey, number> = { ee: 0, d: 0, ad: 0 };
  for (const [questionId, opt] of Object.entries(answers)) {
    const n = Number(questionId.slice(1));
    raws[SCALE_OF_QUESTION[n]] += opt;
  }
  const levels: Record<ScaleKey, Level> = {
    ee: referenceLevel("ee", raws.ee),
    d: referenceLevel("d", raws.d),
    ad: referenceLevel("ad", raws.ad),
  };
  const list = [levels.ee, levels.d, levels.ad];
  const highCount = list.filter((l) => l === "high").length;
  const midCount = list.filter((l) => l === "mid").length;
  return { raws, levels, category: referenceCategory(highCount, midCount) };
}

// ─── Answer builders ──────────────────────────────────────────────────────────

/** Distribute a target raw across `n` single-choice questions (each option 0..5). */
export function distribute(target: number, n: number): number[] {
  if (target > n * 5) throw new Error(`unreachable raw ${target} for ${n} questions`);
  const out: number[] = [];
  let remaining = target;
  for (let i = 0; i < n; i++) {
    const v = Math.min(5, remaining);
    out.push(v);
    remaining -= v;
  }
  return out;
}

/** Build a full 22-answer set hitting the given raw per scale. */
export function answersForRaw(raw: Partial<Record<ScaleKey, number>>): Record<string, number> {
  const answers: Record<string, number> = {};
  (Object.keys(QUESTIONS_OF_SCALE) as ScaleKey[]).forEach((scale) => {
    const qs = QUESTIONS_OF_SCALE[scale];
    const dist = distribute(raw[scale] ?? 0, qs.length);
    qs.forEach((n, i) => {
      answers[`q${n}`] = dist[i];
    });
  });
  return answers;
}

/** A representative raw inside each scale's level band (for the combination sweep). */
export const RAW_FOR_LEVEL: Record<ScaleKey, Record<Level, number>> = {
  ee: { low: 10, mid: 20, high: 30 },
  d: { low: 2, mid: 7, high: 15 },
  ad: { high: 10, mid: 30, low: 36 },
};
