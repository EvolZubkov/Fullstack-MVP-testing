/**
 * @module tests/analytics-stored-outcomes
 *
 * PRD-57, решение владельца 2026-09-19 (#43): аналитика и выгрузка читают исход, который
 * ЗАСЧИТАЛА попытка, а не считают его заново.
 *
 * Дефект, ради которого это делается: пересчёт шёл по ЖИВЫМ вопросам, и правка эталона
 * после прохождения заставляла выгрузку противоречить результату участника.
 */
import { describe, it, expect } from "vitest";
import { outcomeFor } from "../server/services/analytics/answer-outcome";

const storedResult = {
  totalCorrect: 1,
  questionOutcomes: [
    { questionId: "q1", result: "correct", earned: 2, possible: 2 },
    { questionId: "q2", result: "neutral", earned: 0, possible: 0 },
  ],
};

const question = (over: Record<string, unknown> = {}) =>
  ({ id: "q1", type: "single", correctJson: { correctIndex: 1 }, ...over }) as never;

describe("outcomeFor", () => {
  it("берёт сохранённый исход, а не считает по живому вопросу", () => {
    // Эталон ИЗМЕНЁН после прохождения: живой вопрос сказал бы «неверно».
    const changed = question({ correctJson: { correctIndex: 9 } });
    expect(outcomeFor(storedResult, "q1", changed, 1, { points: 2 })).toEqual({
      result: "correct",
      earned: 2,
      possible: 2,
      computed: false,
    });
  });

  it("нейтральный исход переживает чтение", () => {
    expect(outcomeFor(storedResult, "q2", question({ id: "q2" }), 1, { points: 1 })?.result).toBe("neutral");
  });

  it("у попытки без списка считает на месте и помечает это", () => {
    const outcome = outcomeFor({ totalCorrect: 1 }, "q1", question(), 1, { points: 2 });
    expect(outcome).toEqual({ result: "correct", earned: 2, possible: 2, computed: true });
  });

  it("считая на месте, признаёт неоцениваемое неоцениваемым", () => {
    // Короткий ответ БЕЗ правил: «неверно» здесь было бы ложью (§5.3, FR-16).
    const short = question({ id: "q3", type: "short", correctJson: { answerKind: "text", join: "any", rules: [] } });
    expect(outcomeFor({}, "q3", short, "что-то", { points: 1 })).toEqual({
      result: "neutral",
      earned: 0,
      possible: 0,
      computed: true,
    });
  });

  it("вопроса больше нет — исхода нет, и выдумывать его не из чего", () => {
    expect(outcomeFor({}, "q9", undefined, 1, { points: 1 })).toBeNull();
  });

  it("список есть, но этого вопроса в нём нет — считает на месте", () => {
    const outcome = outcomeFor(storedResult, "q7", question({ id: "q7" }), 1, { points: 3 });
    expect(outcome?.computed).toBe(true);
    expect(outcome?.possible).toBe(3);
  });
});
