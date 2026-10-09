/**
 * @module tests/answer-outcomes
 *
 * PRD-57, решение владельца 2026-09-19 (#43): результат попытки несёт исход КАЖДОГО
 * ответа. До этого хранилась только сводка, и аналитике приходилось пересчитывать
 * верность заново — по живым вопросам, мимо снимка попытки.
 */
import { describe, it, expect } from "vitest";
import { aggregateStandardResult } from "../shared/scoring/aggregate";

const section = (questions: unknown[]) => ({
  topicId: "t1",
  topicName: "Тема",
  topicPassRule: null,
  questions: questions as never,
});

describe("по-ответные исходы", () => {
  it("результат несёт исход каждого вопроса", () => {
    const result = aggregateStandardResult({
      overallPassRule: null,
      sections: [
        section([
          { id: "q1", type: "single", correct: { correctIndex: 1 }, points: 2, answer: 1 },
          { id: "q2", type: "single", correct: { correctIndex: 1 }, points: 2, answer: 0 },
        ]),
      ],
    });

    expect(result.questionOutcomes).toEqual([
      { questionId: "q1", result: "correct", earned: 2, possible: 2 },
      { questionId: "q2", result: "incorrect", earned: 0, possible: 2 },
    ]);
  });

  it("неоцениваемый вопрос получает нейтральный исход, а не «неверно»", () => {
    const result = aggregateStandardResult({
      overallPassRule: null,
      sections: [
        section([
          // Шкала без эталона и короткий ответ без правил — оба неоцениваемы.
          { id: "q3", type: "scale", correct: {}, points: 1, answer: 2 },
          { id: "q4", type: "short", correct: { answerKind: "text", join: "any", rules: [] }, points: 1, answer: "текст" },
        ]),
      ],
    });

    expect(result.questionOutcomes).toEqual([
      { questionId: "q3", result: "neutral", earned: 0, possible: 0 },
      { questionId: "q4", result: "neutral", earned: 0, possible: 0 },
    ]);
  });

  it("частично верный ответ несёт цену, а исходом остаётся «неверно»", () => {
    // Исход двузначен, цена числовая — вместе они и описывают частичную правоту.
    const result = aggregateStandardResult({
      overallPassRule: null,
      sections: [
        section([
          {
            id: "q5",
            type: "multiple",
            correct: { correctIndices: [0, 1] },
            points: 4,
            answer: [0],
            // Две ступени: полная даёт 2, частичная 1. Максимум равен 2, поэтому доля
            // частичного ответа — половина, а «верно» в продукте означает полную долю.
            scoring: {
              kind: "tiered",
              tiers: [
                { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
                { when: { all: [{ lhs: "c", op: ">=", rhs: 1 }] }, score: 1 },
              ],
            },
          },
        ]),
      ],
    });

    const outcome = result.questionOutcomes?.[0];
    expect(outcome?.result).toBe("incorrect");
    expect(outcome?.earned).toBeGreaterThan(0);
    expect(outcome?.possible).toBe(4);
  });

  it("неотвеченный вопрос — «неверно» с нулевой ценой", () => {
    const result = aggregateStandardResult({
      overallPassRule: null,
      sections: [section([{ id: "q6", type: "single", correct: { correctIndex: 1 }, points: 1, answer: null }])],
    });

    expect(result.questionOutcomes).toEqual([
      { questionId: "q6", result: "incorrect", earned: 0, possible: 1 },
    ]);
  });
});
