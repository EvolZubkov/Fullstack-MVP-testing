/**
 * @module tests/scale-engine-port
 *
 * Golden parity test for the PRD-5 scale engine. The SCORM runtime uses a
 * hand-maintained plain-JS port (server/scorm/template/app/scales/engine.js) of
 * the authoritative TypeScript engine (shared/scales/engine.ts). Both are run
 * over a shared set of scenarios so they can never silently diverge.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  computeScales as tsCompute,
  type ScaleSpec,
  type MeasurementSpec,
  type Answer,
  type QuestionType,
} from "../shared/scales/engine";
import type { AllocationSpec } from "../shared/questions/allocation";

const portSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/scales/engine.js"),
  "utf8",
);
// The question-type traits (`TBQType`, PRD-26) are prepended the way the package build
// concatenates them, so the port reads the same trait table the shipped runtime does.
const qTypeSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/qtype.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const ScaleEnginePort = new Function(`${qTypeSrc}\n${portSrc}\n;return ScaleEngine;`)() as {
  computeScales: (s: unknown, m: unknown, a: unknown, q: unknown) => unknown;
};

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

type Scenario = {
  name: string;
  scales: ScaleSpec[];
  measurements: MeasurementSpec[];
  answers: Record<string, Answer>;
  questionTypes: Record<string, QuestionType>;
  /** PRD-44: allocation specs by question id — read only by percent normalization. */
  budgets?: Record<string, AllocationSpec>;
};

/** Four statements sharing a budget of 7 — the reference questionnaire's shape. */
const allocationUnits = (questionId: string, scaleKey: string, indices: number[], value = 1): MeasurementSpec[] =>
  indices.map((i) => ({
    questionId,
    scaleKey,
    sourceType: "option_allocation" as const,
    sourceKey: String(i),
    value,
    weight: 1,
  }));

const BUDGET_7: AllocationSpec = { options: ["a", "b", "c", "d"], budget: 7, minPerOption: 0, maxPerOption: 7 };

const scenarios: Scenario[] = [
  {
    name: "sum",
    scales: [{ key: "s", aggregation: "sum", normalization: "none", direction: "positive" }],
    measurements: [...likert("q1", "s"), ...likert("q2", "s")],
    answers: { q1: 5, q2: 3 },
    questionTypes: { q1: "single", q2: "single" },
  },
  {
    // PRD-26: the same Likert contributions, now on the `scale` type — the shape the
    // burnout inventory actually imports as. A scale must behave like single choice
    // here (one graduation active, range = extremum), not fall into the sum branch.
    name: "scale type — Likert contributions",
    scales: [{ key: "ee", aggregation: "sum", normalization: "none", direction: "positive" }],
    measurements: [...likert("q1", "ee"), ...likert("q2", "ee")],
    answers: { q1: 5, q2: 3 },
    questionTypes: { q1: "scale", q2: "scale" },
  },
  {
    name: "scale type — percent + bands, unanswered item",
    scales: [
      {
        key: "d",
        aggregation: "sum",
        normalization: "percent",
        direction: "positive",
        bands: [
          { min: 0, max: 40, label: "Низкий", level: "low" },
          { min: 41, max: 100, label: "Высокий", level: "high" },
        ],
      },
    ],
    measurements: [...likert("q1", "d"), ...likert("q2", "d"), ...likert("q3", "d")],
    answers: { q1: 5, q2: 0 },
    questionTypes: { q1: "scale", q2: "scale", q3: "scale" },
  },
  {
    name: "mixed single + scale in one scale",
    scales: [{ key: "m", aggregation: "avg", normalization: "none", direction: "positive" }],
    measurements: [...likert("q1", "m"), ...likert("q2", "m")],
    answers: { q1: 2, q2: 4 },
    questionTypes: { q1: "single", q2: "scale" },
  },
  {
    name: "percent positive",
    scales: [{ key: "ee", aggregation: "sum", normalization: "percent", direction: "positive" }],
    measurements: [...likert("q1", "ee"), ...likert("q2", "ee"), ...likert("q3", "ee")],
    answers: { q1: 5, q2: 3, q3: 0 },
    questionTypes: { q1: "single", q2: "single", q3: "single" },
  },
  {
    name: "percent inverse + bands",
    scales: [
      {
        key: "ad",
        aggregation: "sum",
        normalization: "percent",
        direction: "inverse",
        bands: [
          { min: 0, max: 5, level: "high", label: "Высокий" },
          { min: 6, max: 15, level: "low", label: "Низкий" },
        ],
      },
    ],
    measurements: [...likert("q1", "ad"), ...likert("q2", "ad"), ...likert("q3", "ad")],
    answers: { q1: 1, q2: 1, q3: 0 },
    questionTypes: { q1: "single", q2: "single", q3: "single" },
  },
  {
    name: "multiple",
    scales: [{ key: "s", aggregation: "sum", normalization: "none", direction: "positive" }],
    measurements: likert("q1", "s"),
    answers: { q1: [1, 3, 4] },
    questionTypes: { q1: "multiple" },
  },
  {
    name: "matching + ranking + weighted_avg",
    scales: [{ key: "s", aggregation: "weighted_avg", normalization: "none", direction: "positive" }],
    measurements: [
      { questionId: "q1", scaleKey: "s", sourceType: "matching_pair", sourceKey: "0:1", value: 10, weight: 2 },
      { questionId: "q2", scaleKey: "s", sourceType: "ranking_position", sourceKey: "2:0", value: 4, weight: 1 },
    ],
    answers: { q1: { 0: 1 }, q2: [2, 0, 1] },
    questionTypes: { q1: "matching", q2: "ranking" },
  },
  // PRD-44: the allocation source. Its contribution is the LEARNER's amount, so a twin
  // that kept the old `value * weight` rule would silently score every distribution as
  // «one point per touched statement» — a divergence no other scenario can catch.
  {
    name: "allocation — вклад равен присвоенному баллу",
    scales: [{ key: "s", aggregation: "sum", normalization: "none", direction: "positive" }],
    measurements: allocationUnits("q1", "s", [0, 1, 2, 3]),
    answers: { q1: { 0: 3, 1: 0, 2: 4, 3: 0 } },
    questionTypes: { q1: "allocation" },
    budgets: { q1: BUDGET_7 },
  },
  {
    name: "allocation — коэффициент и обратный вклад",
    scales: [{ key: "s", aggregation: "sum", normalization: "none", direction: "positive" }],
    measurements: [...allocationUnits("q1", "s", [0], 2), ...allocationUnits("q1", "s", [1], -1)],
    answers: { q1: { 0: 3, 1: 4, 2: 0, 3: 0 } },
    questionTypes: { q1: "allocation" },
    budgets: { q1: BUDGET_7 },
  },
  {
    name: "allocation — процент от домена, ограниченного бюджетом",
    scales: [{ key: "s", aggregation: "sum", normalization: "percent", direction: "positive" }],
    measurements: allocationUnits("q1", "s", [0, 1]),
    answers: { q1: { 0: 3, 1: 1, 2: 3, 3: 0 } },
    questionTypes: { q1: "allocation" },
    budgets: { q1: BUDGET_7 },
  },
  {
    name: "allocation — среднее по активным единицам",
    scales: [{ key: "s", aggregation: "avg", normalization: "none", direction: "positive" }],
    measurements: allocationUnits("q1", "s", [0, 1, 2, 3]),
    answers: { q1: { 0: 5, 1: 2, 2: 0, 3: 0 } },
    questionTypes: { q1: "allocation" },
    budgets: { q1: BUDGET_7 },
  },
  {
    name: "allocation рядом с обычным выбором",
    scales: [{ key: "s", aggregation: "sum", normalization: "percent", direction: "positive" }],
    measurements: [...allocationUnits("q1", "s", [0]), ...likert("q2", "s")],
    answers: { q1: { 0: 7, 1: 0, 2: 0, 3: 0 }, q2: 3 },
    questionTypes: { q1: "allocation", q2: "single" },
    budgets: { q1: BUDGET_7 },
  },
];

describe("scale engine port parity (PRD-5)", () => {
  for (const s of scenarios) {
    it(`${s.name} — TS ≡ runtime port`, () => {
      const ts = tsCompute(s.scales, s.measurements, s.answers, s.questionTypes, s.budgets ?? {});
      const port = ScaleEnginePort.computeScales(
        s.scales,
        s.measurements,
        s.answers,
        s.questionTypes,
        s.budgets ?? {},
      );
      expect(port).toEqual(ts);
    });
  }
});
