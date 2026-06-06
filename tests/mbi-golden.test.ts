/**
 * @module tests/mbi-golden
 * @description Stage C end-to-end golden test for the MBI burnout scenario
 * (PRD-5 + PRD-2). Drives the authoritative pipeline (shared scale engine →
 * shared formula DSL) over the shared MBI fixture (tests/fixtures/mbi) and asserts
 * the computed scale levels and burnout category match an INDEPENDENT reference
 * implementation of the spec's 27-level combination table (the logic the external
 * `process_burnout_export.py` encodes).
 *
 * This proves the package replaces the external post-processor: the same answers
 * yield the same category through test-builder's Core, with no manual Excel step.
 */
import { describe, it, expect } from "vitest";
import { computeScales, type Answer } from "../shared/scales/engine";
import { computeResultVariables } from "../shared/formula";
import type { EvalContext } from "../shared/formula/types";
import {
  MBI_SCALES,
  MBI_MEASUREMENTS,
  MBI_QUESTION_TYPES,
  BURNOUT_VAR,
  QUESTIONS_OF_SCALE,
  SCALE_OF_QUESTION,
  RAW_FOR_LEVEL,
  answersForRaw,
  referenceRun,
  type Level,
} from "./fixtures/mbi";

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
