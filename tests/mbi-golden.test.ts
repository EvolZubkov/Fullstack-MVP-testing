/**
 * @module tests/mbi-golden
 * @description Stage C end-to-end golden test for the MBI burnout scenario
 * (PRD-5 + PRD-2). Builds the normative MBI fixture from
 * docs/specs/prd-5/example-mbi.md — 3 scales (EE/D/AD, AD inverse), 22
 * single-choice questions (option value 0..5), and the `burnout_category`
 * result variable — then drives the authoritative pipeline (shared scale engine
 * → shared formula DSL) and asserts the computed scale levels and burnout
 * category match an INDEPENDENT reference implementation of the spec's 27-level
 * combination table (the logic the external `process_burnout_export.py` encodes).
 *
 * This proves the package replaces the external post-processor: the same answers
 * yield the same category through test-builder's Core, with no manual Excel step.
 */
import { describe, it, expect } from "vitest";
import {
  computeScales,
  type ScaleSpec,
  type MeasurementSpec,
  type QuestionType,
  type Answer,
} from "../shared/scales/engine";
import { computeResultVariables, type ResultVariableSpec } from "../shared/formula";
import type { EvalContext } from "../shared/formula/types";

type ScaleKey = "ee" | "d" | "ad";

// ─── Fixture (example-mbi.md §2) ──────────────────────────────────────────────

const QUESTIONS_OF_SCALE: Record<ScaleKey, number[]> = {
  ee: [1, 2, 3, 6, 8, 13, 14, 16, 20],
  d: [5, 10, 11, 15, 22],
  ad: [4, 7, 9, 12, 17, 18, 19, 21],
};

const SCALE_OF_QUESTION: Record<number, ScaleKey> = {};
(Object.keys(QUESTIONS_OF_SCALE) as ScaleKey[]).forEach((scale) => {
  for (const n of QUESTIONS_OF_SCALE[scale]) SCALE_OF_QUESTION[n] = scale;
});

const MBI_SCALES: ScaleSpec[] = [
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
const MBI_MEASUREMENTS: MeasurementSpec[] = [];
const MBI_QUESTION_TYPES: Record<string, QuestionType> = {};
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

const BURNOUT_VAR: ResultVariableSpec = {
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

type Level = "low" | "mid" | "high";

/** Map a scale's raw to its level via the spec thresholds (example-mbi §2.2). */
function referenceLevel(scale: ScaleKey, raw: number): Level {
  if (scale === "ee") return raw <= 14 ? "low" : raw <= 24 ? "mid" : "high";
  if (scale === "d") return raw <= 4 ? "low" : raw <= 9 ? "mid" : "high";
  // ad: bands are ascending on raw but the level semantics are inverse.
  return raw <= 27 ? "high" : raw <= 32 ? "mid" : "low";
}

/** The 27-combination category table (example-mbi §2.5). */
function referenceCategory(highCount: number, midCount: number): string {
  if (highCount === 3) return "Выгорание";
  if (highCount === 2) return "Возрастающее истощение";
  if (highCount === 1) return midCount === 2 ? "Возрастающее истощение" : "Начинающееся истощение";
  // highCount === 0
  return midCount === 0 ? "Вовлечённость" : "Снижающаяся вовлечённость";
}

function referenceRun(answers: Record<string, number>): {
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

// ─── Pipeline runner (authoritative: shared engine → shared DSL) ──────────────────

function pipelineRun(answers: Record<string, Answer>) {
  const scaleComputation = computeScales(MBI_SCALES, MBI_MEASUREMENTS, answers, MBI_QUESTION_TYPES);
  const base: Omit<EvalContext, "vars"> = {
    percent: 0,
    topics: {},
    tags: {},
    scales: scaleComputation.values,
    sections: {},
  };
  const result = computeResultVariables([BURNOUT_VAR], base);
  return {
    scales: scaleComputation.values,
    scaleErrors: scaleComputation.errors,
    category: result.values.burnout_category,
    formulaErrors: result.errors,
  };
}

// ─── Answer builders ──────────────────────────────────────────────────────────

/** Distribute a target raw across `n` single-choice questions (each option 0..5). */
function distribute(target: number, n: number): number[] {
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
function answersForRaw(raw: Partial<Record<ScaleKey, number>>): Record<string, number> {
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
const RAW_FOR_LEVEL: Record<ScaleKey, Record<Level, number>> = {
  ee: { low: 10, mid: 20, high: 30 },
  d: { low: 2, mid: 7, high: 15 },
  ad: { high: 10, mid: 30, low: 36 },
};

// ─── Tests ──────────────────────────────────────────────────────────────────────

describe("MBI fixture sanity", () => {
  it("covers all 22 questions exactly once across the three scales", () => {
    expect(QUESTIONS_OF_SCALE.ee.length + QUESTIONS_OF_SCALE.d.length + QUESTIONS_OF_SCALE.ad.length).toBe(22);
    expect(Object.keys(SCALE_OF_QUESTION)).toHaveLength(22);
    expect(MBI_MEASUREMENTS).toHaveLength(22 * 6);
  });
});

describe("MBI numeric checks (example-mbi §5.3)", () => {
  // ee=32 (high), d=7 (mid), ad=22 (high) — the worked example in the spec.
  const answers = answersForRaw({ ee: 32, d: 7, ad: 22 });
  const pipe = pipelineRun(answers);

  it("#1 scale.ee.raw is the sum of the EE answers", () => {
    expect(pipe.scales.ee.raw).toBe(32);
  });

  it("#2 scale.ad.percent for raw=22 is 45 (inverse normalization)", () => {
    expect(pipe.scales.ad.raw).toBe(22);
    expect(pipe.scales.ad.percent).toBe(45);
  });

  it("#3 scale.ee.level for raw=32 is high", () => {
    expect(pipe.scales.ee.level).toBe("high");
  });

  it("#4 scale.ad.level for raw=22 is high (raw < 28 → band 0..27)", () => {
    expect(pipe.scales.ad.level).toBe("high");
  });

  it("#5 count(high) over the three levels is 2 (high/mid/high)", () => {
    expect(pipe.scales.d.level).toBe("mid");
    const highCount = [pipe.scales.ee.level, pipe.scales.d.level, pipe.scales.ad.level].filter((l) => l === "high").length;
    expect(highCount).toBe(2);
  });

  it("#6 result.burnout_category is «Возрастающее истощение»", () => {
    expect(pipe.category).toBe("Возрастающее истощение");
    expect(pipe.formulaErrors).toEqual([]);
    expect(pipe.scaleErrors).toEqual([]);
  });
});

describe("MBI golden corpus — 27 level combinations", () => {
  const LEVELS: Level[] = ["low", "mid", "high"];

  for (const eeL of LEVELS) {
    for (const dL of LEVELS) {
      for (const adL of LEVELS) {
        it(`ee=${eeL} d=${dL} ad=${adL}: pipeline category matches the reference`, () => {
          const answers = answersForRaw({
            ee: RAW_FOR_LEVEL.ee[eeL],
            d: RAW_FOR_LEVEL.d[dL],
            ad: RAW_FOR_LEVEL.ad[adL],
          });
          const ref = referenceRun(answers);

          // The chosen representative raws really land in the intended bands.
          expect(ref.levels).toEqual({ ee: eeL, d: dL, ad: adL });

          const pipe = pipelineRun(answers);
          // Engine bands agree with the reference thresholds...
          expect(pipe.scales.ee.level).toBe(eeL);
          expect(pipe.scales.d.level).toBe(dL);
          expect(pipe.scales.ad.level).toBe(adL);
          // ...and the DSL category matches the independent table.
          expect(pipe.category).toBe(ref.category);
          expect(pipe.formulaErrors).toEqual([]);
        });
      }
    }
  }
});

describe("MBI category table (example-mbi §2.5) — pinned strings", () => {
  // One level triple per documented (count high, count mid) row → expected category.
  const rows: Array<{ triple: [Level, Level, Level]; category: string }> = [
    { triple: ["low", "low", "high"], category: "Начинающееся истощение" }, // 1 high, 0 mid
    { triple: ["mid", "low", "high"], category: "Начинающееся истощение" }, // 1 high, 1 mid
    { triple: ["mid", "mid", "high"], category: "Возрастающее истощение" }, // 1 high, 2 mid
    { triple: ["high", "mid", "high"], category: "Возрастающее истощение" }, // 2 high
    { triple: ["high", "high", "high"], category: "Выгорание" }, // 3 high
    { triple: ["low", "low", "low"], category: "Вовлечённость" }, // 0 high, 0 mid
    { triple: ["mid", "low", "low"], category: "Снижающаяся вовлечённость" }, // 0 high, 1 mid
  ];

  for (const { triple, category } of rows) {
    it(`levels ${triple.join("/")} → «${category}»`, () => {
      const [eeL, dL, adL] = triple;
      const answers = answersForRaw({
        ee: RAW_FOR_LEVEL.ee[eeL],
        d: RAW_FOR_LEVEL.d[dL],
        ad: RAW_FOR_LEVEL.ad[adL],
      });
      expect(pipelineRun(answers).category).toBe(category);
    });
  }
});

describe("MBI regression points (example-mbi §5.4)", () => {
  it("a test without scales/result-variables computes cleanly (no scales → no category)", () => {
    const scaleComputation = computeScales([], [], {}, {});
    expect(scaleComputation.values).toEqual({});
    const base: Omit<EvalContext, "vars"> = { percent: 0, topics: {}, tags: {}, scales: {}, sections: {} };
    const result = computeResultVariables([], base);
    expect(result.values).toEqual({});
    expect(result.errors).toEqual([]);
  });

  it("a broken result-variable formula does not break the scale values", () => {
    const answers = answersForRaw({ ee: 30, d: 15, ad: 10 });
    const scaleComputation = computeScales(MBI_SCALES, MBI_MEASUREMENTS, answers, MBI_QUESTION_TYPES);
    const base: Omit<EvalContext, "vars"> = {
      percent: 0,
      topics: {},
      tags: {},
      scales: scaleComputation.values,
      sections: {},
    };
    const result = computeResultVariables(
      [{ name: "broken", type: "number", formula: "scaleById(" }, BURNOUT_VAR],
      base,
    );
    expect(result.values.broken).toBeNull();
    expect(result.errors.some((e) => e.name === "broken")).toBe(true);
    // The scale values are untouched and the good variable still computes.
    expect(scaleComputation.values.ee.level).toBe("high");
    expect(result.values.burnout_category).toBe("Выгорание"); // 3 high (ad raw 10 → high)
  });
});
