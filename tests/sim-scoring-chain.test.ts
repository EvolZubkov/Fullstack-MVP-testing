/**
 * @module tests/sim-scoring-chain
 * @description «Сценарий в ИС», этап Э5а: цепочка штрафов сценария «система → тест → вопрос в тесте».
 * Каждый штраф и «засчитывать частичное» берутся с ближайшего уровня, который их задал; контекст
 * оценки теста кладёт в вопрос-сценарий полностью разрешённое значение, и по нему одинаково
 * считают веб (`shared/scoring/engine`) и пакет (ES5-двойник); балл по умолчанию пункта отвечает за
 * вопросы его темы-банка.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import { DEFAULT_SIM_PENALTIES, resolveSimScoring, simulationRatio } from "@shared/sim/scoring";
import { scoreAnswer } from "@shared/scoring/engine";
import { buildTestScoringContext } from "../server/services/effective-scoring";

const run = {
  outcome: "partial",
  goal: { share: 0.75 },
  counts: { misses: 1, blocked: 0, wrongValues: 0, detours: 0, traps: 1, hints: 0 },
};

describe("слияние уровней", () => {
  it("без уровней — системные умолчания и частичное засчитывается", () => {
    expect(resolveSimScoring(null, null)).toEqual({ kind: "simulation", penalties: { ...DEFAULT_SIM_PENALTIES }, countPartial: true });
  });

  it("каждый штраф — с ближайшего уровня, который его задал", () => {
    const r = resolveSimScoring({ penalties: { trap: 0.2, miss: 0.03 } }, { penalties: { trap: 0.3 } });
    expect(r.penalties.trap).toBe(0.3);
    expect(r.penalties.miss).toBe(0.03);
    expect(r.penalties.hint).toBe(DEFAULT_SIM_PENALTIES.hint);
  });

  it("частичное выполнение: вопрос сильнее теста, тест сильнее системы", () => {
    expect(resolveSimScoring({ countPartial: false }, null).countPartial).toBe(false);
    expect(resolveSimScoring({ countPartial: false }, { countPartial: true }).countPartial).toBe(true);
  });

  it("значение вне [0, 1] уровнем не считается", () => {
    expect(resolveSimScoring({ penalties: { trap: 2 } }, null).penalties.trap).toBe(DEFAULT_SIM_PENALTIES.trap);
  });
});

describe("контекст оценки теста", () => {
  const sim = { id: "s1", type: "simulation", topicId: "bank", contentHash: null } as never;
  const plain = { id: "q1", type: "single", topicId: "t1", contentHash: null } as never;
  const override = (scoringJson: unknown) =>
    ({ questionId: "s1", points: null, scoringJson, difficulty: null, pinnedContentHash: null }) as never;

  it("сценарию — штрафы теста и переопределение вопроса, слитые по цепочке", () => {
    const ctx = buildTestScoringContext(
      { defaultQuestionPoints: null, simScoringJson: { penalties: { trap: 0.2 }, countPartial: false } },
      [],
      [override({ kind: "simulation", penalties: { miss: 0.1 } })],
    );
    const eff = ctx.resolve(sim);
    expect(eff.scoring).toEqual({
      kind: "simulation",
      penalties: { ...DEFAULT_SIM_PENALTIES, trap: 0.2, miss: 0.1 },
      countPartial: false,
    });
    expect(eff.source.scoring).toBe("override");
  });

  it("прочих вопросов штрафы не касаются", () => {
    const ctx = buildTestScoringContext({ defaultQuestionPoints: null, simScoringJson: { penalties: { trap: 0.2 } } }, [], []);
    expect(ctx.resolve(plain).scoring).toEqual({ kind: "exact" });
  });

  it("балл по умолчанию пункта отвечает за вопросы его темы-банка", () => {
    const section = { topicId: "scenario:it1", defaultPoints: null, scenarioItem: { topicId: "bank", defaultPoints: 5 } } as never;
    const ctx = buildTestScoringContext({ defaultQuestionPoints: 2 }, [section], []);
    expect(ctx.resolve(sim).points).toBe(5);
    expect(ctx.resolve(plain).points).toBe(2);
  });
});

describe("счёт по разрешённым штрафам — веб и пакет одинаково", () => {
  const scoring = resolveSimScoring({ penalties: { trap: 0.3 } }, null);
  const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const port = new Function("TBTemplate", `${read("server/scorm/template/app/utils/qtype.js")}\n${read("server/scorm/template/app/scoring/engine.js")}\n;return ScoringEngine;`)({
    simulationRatio,
  }) as { scoreAnswer: (input: unknown) => { ratio: number } };

  it("веб считает по штрафам из оценки вопроса", () => {
    const expected = 0.75 - DEFAULT_SIM_PENALTIES.miss - 0.3;
    expect(scoreAnswer({ type: "simulation", correct: {}, answer: run, scoring } as never).ratio).toBeCloseTo(expected, 10);
  });

  it("пакет считает так же", () => {
    const web = scoreAnswer({ type: "simulation", correct: {}, answer: run, scoring } as never);
    expect(port.scoreAnswer({ type: "simulation", answer: run, scoring }).ratio).toBe(web.ratio);
  });

  it("«не засчитывать частичное» обнуляет частичный исход и там, и там", () => {
    const off = resolveSimScoring({ countPartial: false }, null);
    expect(scoreAnswer({ type: "simulation", correct: {}, answer: run, scoring: off } as never).ratio).toBe(0);
    expect(port.scoreAnswer({ type: "simulation", answer: run, scoring: off }).ratio).toBe(0);
  });
});
