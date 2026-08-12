/**
 * @module tests/result-compute-mbi-parity
 *
 * PRD-12 task 2-6: proves the server-side orchestration
 * (server/services/result-compute.computeAttemptResult) produces the SAME scale
 * levels and burnout category as the independent MBI reference
 * (tests/fixtures/mbi). Transitively this is web↔SCORM parity: computeAttemptResult
 * mirrors the SCORM runtime order (resultsPage.js: scales → result variables), and
 * tests/mbi-golden validates that same pipeline against the spec's category table.
 */
import { describe, it, expect } from "vitest";
import { computeAttemptResult, type ScoringConfig } from "../server/services/result-compute";
import {
  MBI_SCALES,
  MBI_MEASUREMENTS,
  MBI_QUESTION_TYPES,
  BURNOUT_VAR,
  RAW_FOR_LEVEL,
  answersForRaw,
  referenceRun,
  type Level,
} from "./fixtures/mbi";

const config: ScoringConfig = {
  scales: MBI_SCALES,
  measurements: MBI_MEASUREMENTS,
  resultVariables: [BURNOUT_VAR],
};

const base = {
  percent: 0,
  topicResults: [] as Array<{ topicId: string; percent: number; passed: boolean | null; earnedPoints: number }>,
};

function serverRun(answers: Record<string, number>) {
  return computeAttemptResult(config, answers, MBI_QUESTION_TYPES, base);
}

describe("server computeAttemptResult — MBI parity (PRD-12 2-6)", () => {
  const LEVELS: Level[] = ["low", "mid", "high"];

  for (const eeL of LEVELS) {
    for (const dL of LEVELS) {
      for (const adL of LEVELS) {
        it(`ee=${eeL} d=${dL} ad=${adL}: server scales + category match the reference`, () => {
          const answers = answersForRaw({
            ee: RAW_FOR_LEVEL.ee[eeL],
            d: RAW_FOR_LEVEL.d[dL],
            ad: RAW_FOR_LEVEL.ad[adL],
          });
          const ref = referenceRun(answers);
          const out = serverRun(answers);

          expect(out.scaleResults.ee.level).toBe(ref.levels.ee);
          expect(out.scaleResults.d.level).toBe(ref.levels.d);
          expect(out.scaleResults.ad.level).toBe(ref.levels.ad);
          expect(out.resultVariables.burnout_category).toBe(ref.category);
        });
      }
    }
  }

  it("worked example (ee=32 high, d=7 mid, ad=22 high) → «Возрастающее истощение»", () => {
    const out = serverRun(answersForRaw({ ee: 32, d: 7, ad: 22 }));
    expect(out.scaleResults.ee.raw).toBe(32);
    expect(out.scaleResults.ad.percent).toBe(45);
    expect(out.resultVariables.burnout_category).toBe("Возрастающее истощение");
  });
});
