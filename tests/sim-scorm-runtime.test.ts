/**
 * @module tests/sim-scorm-runtime
 * @description «Сценарий в ИС» в рантайме пакета (этап Э4): компактная ячейка прогона в
 * `cmi.suspend_data` (кодек `TBRunState`), оценка ES5-двойником через общий `simulationRatio`
 * (тот же счёт, что у веба) и взаимодействие `performance` в отчёте LMS.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { scoreAnswer } from "@shared/scoring/engine";
import { simulationRatio } from "@shared/sim/scoring";

const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const qType = read("server/scorm/template/app/utils/qtype.js");

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const TBRunState = new Function(`${read("server/scorm/template/app/utils/scorm/runState.js")}\nreturn TBRunState;`)() as {
  encodeAnswers: (answers: unknown[], questions: Array<{ type: string }>) => string;
  decodeAnswers: (row: string, questions: Array<{ type: string }>) => unknown[];
};
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const ScoringEngine = new Function("TBTemplate", `${qType}\n${read("server/scorm/template/app/scoring/engine.js")}\n;return ScoringEngine;`)({
  simulationRatio,
}) as { scoreAnswer: (input: unknown) => { score: number; sMax: number; ratio: number } };
// eslint-disable-next-line @typescript-eslint/no-implied-eval
const lms = new Function("TBTemplate", `${qType}\n${read("server/scorm/template/app/render/resultsPage.js")}\nreturn { mapScormType, formatResponse, correctPatternFor };`)({}) as {
  mapScormType: (q: unknown) => string;
  formatResponse: (q: unknown, a: unknown) => string;
  correctPatternFor: (q: unknown) => string;
};

const run = {
  outcome: "success",
  goal: { share: 1 },
  counts: { misses: 1, blocked: 0, wrongValues: 0, detours: 1, traps: 0, hints: 0 },
  durationMs: 242000,
};
const sim = { type: "simulation" };

describe("ячейка прогона в suspend_data", () => {
  it("компактна и читается обратно тем, что нужно оценке", () => {
    const row = TBRunState.encodeAnswers([run, 2], [sim, { type: "single" }]);
    expect(row).toBe("s2s.1.0.0.1.0.0.6q,2");
    const [back, other] = TBRunState.decodeAnswers(row, [sim, { type: "single" }]);
    expect(back).toEqual(run);
    expect(other).toBe(2);
    expect(simulationRatio(back)).toBe(simulationRatio(run));
  });

  it("частичный исход хранит долю цели; незнакомый исход — пустая ячейка", () => {
    const partial = { ...run, outcome: "partial", goal: { share: 0.67 } };
    const [back] = TBRunState.decodeAnswers(TBRunState.encodeAnswers([partial], [sim]), [sim]);
    expect(back).toMatchObject({ outcome: "partial", goal: { share: 0.67 } });
    expect(TBRunState.encodeAnswers([{ outcome: "?" }], [sim])).toBe("");
  });
});

describe("оценка прогона в пакете", () => {
  it("совпадает с общим движком веба", () => {
    for (const answer of [run, { ...run, outcome: "fail" }, { ...run, outcome: "partial", goal: { share: 0.5 } }, undefined]) {
      expect(ScoringEngine.scoreAnswer({ type: "simulation", answer })).toEqual(scoreAnswer({ type: "simulation", correct: {}, answer } as never));
    }
  });
});

describe("взаимодействие сценария в отчёте LMS", () => {
  it("тип performance, ответ шагами, эталона нет", () => {
    expect(lms.mapScormType(sim)).toBe("performance");
    expect(lms.formatResponse(sim, run)).toBe(
      "outcome[.]success[,]goal[.]100[,]misses[.]1[,]blocked[.]0[,]wrong[.]0[,]detours[.]1[,]traps[.]0[,]hints[.]0",
    );
    expect(lms.correctPatternFor(sim)).toBe("");
  });
});
