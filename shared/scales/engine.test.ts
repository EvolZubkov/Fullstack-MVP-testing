/**
 * @module shared/scales/engine.test
 *
 * Tests for the PRD-5 scale engine (B5). Covers the aggregation modes, percent
 * normalization with inversion, interpretation bands, the four answer types
 * (single/multiple/matching/ranking) and determinism — including the MBI EE/AD
 * scenarios (scoring-model §5.2).
 */
import { describe, it, expect } from "vitest";
import {
  computeScales,
  computeAnswerContributions,
  type ScaleSpec,
  type MeasurementSpec,
  type Answer,
  type QuestionType,
} from "./engine";

function scale(over: Partial<ScaleSpec> & { key: string }): ScaleSpec {
  return { aggregation: "sum", normalization: "none", direction: "positive", ...over };
}

/** Likert options 0..max each contributing their index value to `scaleKey`. */
function likert(questionId: string, scaleKey: string, max = 5): MeasurementSpec[] {
  return Array.from({ length: max + 1 }, (_, i) => ({
    questionId,
    scaleKey,
    sourceType: "option" as const,
    sourceKey: String(i),
    value: i,
    weight: 1,
  }));
}

const single = (...ids: string[]): Record<string, QuestionType> =>
  Object.fromEntries(ids.map((id) => [id, "single" as const]));

describe("computeScales — aggregation", () => {
  it("sums active option contributions (sum)", () => {
    const out = computeScales(
      [scale({ key: "s" })],
      [...likert("q1", "s"), ...likert("q2", "s")],
      { q1: 5, q2: 3 },
      single("q1", "q2"),
    );
    expect(out.values.s.raw).toBe(8);
    expect(out.values.s.hasValue).toBe(true);
  });

  it("averages contributions (avg)", () => {
    const out = computeScales(
      [scale({ key: "s", aggregation: "avg" })],
      [...likert("q1", "s"), ...likert("q2", "s")],
      { q1: 4, q2: 2 },
      single("q1", "q2"),
    );
    expect(out.values.s.raw).toBe(3); // (4 + 2) / 2
  });

  it("weights contributions (weighted_avg)", () => {
    const out = computeScales(
      [scale({ key: "s", aggregation: "weighted_avg" })],
      [
        { questionId: "q1", scaleKey: "s", sourceType: "question", sourceKey: null, value: 4, weight: 3 },
        { questionId: "q2", scaleKey: "s", sourceType: "question", sourceKey: null, value: 2, weight: 1 },
      ],
      { q1: 0, q2: 0 },
      single("q1", "q2"),
    );
    // (4*3 + 2*1) / (3 + 1) = 14 / 4 = 3.5
    expect(out.values.s.raw).toBe(3.5);
  });

  it("takes the max / min of weighted contributions", () => {
    const ms = [...likert("q1", "s"), ...likert("q2", "s")];
    const ans = { q1: 5, q2: 2 };
    expect(computeScales([scale({ key: "s", aggregation: "max" })], ms, ans, single("q1", "q2")).values.s.raw).toBe(5);
    expect(computeScales([scale({ key: "s", aggregation: "min" })], ms, ans, single("q1", "q2")).values.s.raw).toBe(2);
  });
});

describe("computeScales — percent normalization & inversion (MBI)", () => {
  const ms = [...likert("q1", "ee"), ...likert("q2", "ee"), ...likert("q3", "ee")];
  const answers = { q1: 5, q2: 3, q3: 0 }; // raw = 8, range 0..15

  it("positive percent maps raw into 0..100", () => {
    const out = computeScales(
      [scale({ key: "ee", normalization: "percent", direction: "positive" })],
      ms,
      answers,
      single("q1", "q2", "q3"),
    );
    expect(out.values.ee.raw).toBe(8);
    expect(out.values.ee.percent).toBeCloseTo(53.33, 1);
    expect(out.values.ee.normalized).toBeCloseTo(53.33, 1);
  });

  it("inverse percent flips the scale (low raw → high percent)", () => {
    const out = computeScales(
      [scale({ key: "ad", normalization: "percent", direction: "inverse" })],
      ms.map((m) => ({ ...m, scaleKey: "ad" })),
      answers,
      single("q1", "q2", "q3"),
    );
    expect(out.values.ad.percent).toBeCloseTo(46.67, 1); // (15 - 8) / 15 * 100
  });
});

describe("computeScales — percent range is over DELIVERED questions (PRD-5 §5.2)", () => {
  // A scale measured across a bank of questions; the test delivers a SUBSET. All
  // contributions are positive and every delivered answer is correct — this is the
  // РТК-cert regression: pre-fix, `rawRange` summed per-question minima over the
  // whole bank, so raw < min and percent went NEGATIVE. It must be 100%.
  const bankMeasurements: MeasurementSpec[] = [
    // delivered:
    { questionId: "d1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 1, weight: 1 }, // single
    { questionId: "d2", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 0.5, weight: 1 }, // multiple
    { questionId: "d2", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 0.5, weight: 1 },
    { questionId: "d3", scaleKey: "s", sourceType: "matching_pair", sourceKey: "0:0", value: 0.25, weight: 1 }, // matching
    { questionId: "d3", scaleKey: "s", sourceType: "matching_pair", sourceKey: "1:1", value: 0.25, weight: 1 },
    { questionId: "d3", scaleKey: "s", sourceType: "matching_pair", sourceKey: "2:2", value: 0.25, weight: 1 },
    { questionId: "d3", scaleKey: "s", sourceType: "matching_pair", sourceKey: "3:3", value: 0.25, weight: 1 },
    // undelivered bank questions (each a +1 single) — must NOT widen the range:
    { questionId: "b4", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 1, weight: 1 },
    { questionId: "b5", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 1, weight: 1 },
    { questionId: "b6", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 1, weight: 1 },
  ];
  const qTypes: Record<string, QuestionType> = {
    d1: "single", d2: "multiple", d3: "matching", b4: "single", b5: "single", b6: "single",
  };

  it("all-correct on the delivered subset yields 100%, never negative", () => {
    const answers: Record<string, Answer> = { d1: 0, d2: [0, 1], d3: { 0: 0, 1: 1, 2: 2, 3: 3 } };
    const out = computeScales([scale({ key: "s", normalization: "percent" })], bankMeasurements, answers, qTypes);
    expect(out.values.s.raw).toBe(3); // 1 (single) + (0.5+0.5) (multiple) + (0.25*4) (matching)
    expect(out.values.s.percent).toBe(100);
    expect(out.errors).toHaveLength(0);
  });

  it("a fully-correct matching question reaches its max (pairs sum, not one pair)", () => {
    const ms = bankMeasurements.filter((m) => m.questionId === "d3");
    const out = computeScales([scale({ key: "s", normalization: "percent" })], ms, { d3: { 0: 0, 1: 1, 2: 2, 3: 3 } }, qTypes);
    expect(out.values.s.raw).toBe(1); // 0.25 * 4
    expect(out.values.s.percent).toBe(100);
  });

  it("a wrong single answer scores 0%, not a negative", () => {
    // Only d1 delivered; learner picks an unmeasured option (contributes 0).
    const ms = bankMeasurements.filter((m) => m.questionId === "d1");
    const out = computeScales([scale({ key: "s", normalization: "percent" })], ms, { d1: 9 }, qTypes);
    expect(out.values.s.raw).toBe(0);
    expect(out.values.s.percent).toBe(0);
  });

  it("reports a diagnostic (not a number) when the delivered range is degenerate", () => {
    // The only delivered contribution is a fixed 0 → min === max === 0 → span 0.
    const ms: MeasurementSpec[] = [{ questionId: "d1", scaleKey: "s", sourceType: "question", sourceKey: null, value: 0, weight: 1 }];
    const out = computeScales([scale({ key: "s", normalization: "percent" })], ms, { d1: 1 }, { d1: "single" });
    expect(out.errors.some((e) => e.key === "s")).toBe(true);
  });
});

describe("computeScales — bands apply to raw", () => {
  it("derives level/label from the band the raw falls into", () => {
    const bands = [
      { min: 0, max: 5, level: "low", label: "Низкий" },
      { min: 6, max: 10, level: "mid", label: "Средний" },
      { min: 11, max: 15, level: "high", label: "Высокий" },
    ];
    const out = computeScales(
      [scale({ key: "ee", normalization: "percent", bands })],
      [...likert("q1", "ee"), ...likert("q2", "ee"), ...likert("q3", "ee")],
      { q1: 5, q2: 3, q3: 0 }, // raw 8 → mid
      single("q1", "q2", "q3"),
    );
    expect(out.values.ee.level).toBe("mid");
    expect(out.values.ee.label).toBe("Средний");
  });
});

describe("computeScales — answer types", () => {
  it("multiple-choice sums every selected option", () => {
    const out = computeScales(
      [scale({ key: "s" })],
      likert("q1", "s"),
      { q1: [1, 3, 4] },
      { q1: "multiple" },
    );
    expect(out.values.s.raw).toBe(8); // 1 + 3 + 4
  });

  it("matching pair is active when the learner matched left→right", () => {
    const out = computeScales(
      [scale({ key: "s" })],
      [
        { questionId: "q1", scaleKey: "s", sourceType: "matching_pair", sourceKey: "0:1", value: 10, weight: 1 },
        { questionId: "q1", scaleKey: "s", sourceType: "matching_pair", sourceKey: "1:0", value: 5, weight: 1 },
      ],
      { q1: { 0: 1, 1: 2 } }, // matched 0→1 (active), 1→2 (not the measured 1→0)
      { q1: "matching" },
    );
    expect(out.values.s.raw).toBe(10);
  });

  it("ranking position is active when the item sits at that position", () => {
    const out = computeScales(
      [scale({ key: "s" })],
      [
        { questionId: "q1", scaleKey: "s", sourceType: "ranking_position", sourceKey: "2:0", value: 7, weight: 1 },
        { questionId: "q1", scaleKey: "s", sourceType: "ranking_position", sourceKey: "0:0", value: 3, weight: 1 },
      ],
      { q1: [2, 0, 1] }, // position 0 holds item 2 → first row active
      { q1: "ranking" },
    );
    expect(out.values.s.raw).toBe(7);
  });
});

describe("computeScales — edge cases", () => {
  it("hasValue is false when no contribution is active", () => {
    const out = computeScales([scale({ key: "s" })], likert("q1", "s"), {}, single("q1"));
    expect(out.values.s.hasValue).toBe(false);
    expect(out.values.s.raw).toBe(0);
  });

  it("a scale with no measurements yields an empty result", () => {
    const out = computeScales([scale({ key: "empty" })], [], { q1: 1 }, single("q1"));
    expect(out.values.empty.hasValue).toBe(false);
  });

  it("recomputes identically from the same inputs (determinism)", () => {
    const ms = [...likert("q1", "ee"), ...likert("q2", "ee")];
    const args = [
      [scale({ key: "ee", normalization: "percent" })],
      ms,
      { q1: 4, q2: 1 },
      single("q1", "q2"),
    ] as const;
    const a = computeScales(...args);
    const b = computeScales(...args);
    expect(b).toEqual(a);
  });
});

describe("computeAnswerContributions", () => {
  const ms: MeasurementSpec[] = [
    { questionId: "q1", scaleKey: "ee", sourceType: "option", sourceKey: "0", value: 2, weight: 1 },
    { questionId: "q1", scaleKey: "ee", sourceType: "option", sourceKey: "1", value: 3, weight: 2 },
    { questionId: "q1", scaleKey: "oc", sourceType: "option", sourceKey: "1", value: -1, weight: 1 },
    { questionId: "q2", scaleKey: "ee", sourceType: "question", sourceKey: null, value: 5, weight: 1 },
  ];

  it("returns only the fired unit for a single-choice answer", () => {
    expect(computeAnswerContributions(ms, "q1", 0, "single")).toEqual([{ scaleKey: "ee", delta: 2 }]);
  });

  it("applies weight to the delta (value * weight)", () => {
    expect(computeAnswerContributions(ms, "q1", 1, "single")).toEqual([
      { scaleKey: "ee", delta: 6 },
      { scaleKey: "oc", delta: -1 },
    ]);
  });

  it("lists one entry per fired unit for a multi-select answer (not summed)", () => {
    expect(computeAnswerContributions(ms, "q1", [0, 1], "multiple")).toEqual([
      { scaleKey: "ee", delta: 2 },
      { scaleKey: "ee", delta: 6 },
      { scaleKey: "oc", delta: -1 },
    ]);
  });

  it("fires a whole-question unit whenever the question is answered", () => {
    expect(computeAnswerContributions(ms, "q2", 0, "single")).toEqual([{ scaleKey: "ee", delta: 5 }]);
  });

  it("returns nothing for an unanswered question", () => {
    expect(computeAnswerContributions(ms, "q1", null, "single")).toEqual([]);
    expect(computeAnswerContributions(ms, "q2", undefined, "single")).toEqual([]);
  });

  it("ignores measurements of other questions", () => {
    expect(computeAnswerContributions(ms, "q1", 0, "single").every((c) => c.scaleKey !== undefined)).toBe(true);
    expect(computeAnswerContributions([], "q1", 0, "single")).toEqual([]);
  });
});
