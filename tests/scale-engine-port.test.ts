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

const portSrc = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/scales/engine.js"),
  "utf8",
);
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const ScaleEnginePort = new Function(`${portSrc}\n;return ScaleEngine;`)() as {
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
};

const scenarios: Scenario[] = [
  {
    name: "sum",
    scales: [{ key: "s", aggregation: "sum", normalization: "none", direction: "positive" }],
    measurements: [...likert("q1", "s"), ...likert("q2", "s")],
    answers: { q1: 5, q2: 3 },
    questionTypes: { q1: "single", q2: "single" },
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
];

describe("scale engine port parity (PRD-5)", () => {
  for (const s of scenarios) {
    it(`${s.name} — TS ≡ runtime port`, () => {
      const ts = tsCompute(s.scales, s.measurements, s.answers, s.questionTypes);
      const port = ScaleEnginePort.computeScales(s.scales, s.measurements, s.answers, s.questionTypes);
      expect(port).toEqual(ts);
    });
  }
});
