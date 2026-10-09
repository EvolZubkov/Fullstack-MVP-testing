/**
 * @module tests/breakdown-effective-scoring
 * @description Инвариант подытога по подтеме: он считается по ЭФФЕКТИВНОЙ оценке вопроса
 * в этом тесте — цене и схеме, которые дал `effective-scoring`, — а не по «верно/неверно».
 *
 * Три следствия, которые здесь и закреплены:
 *
 * 1. частичный ответ даёт долю: доля баллов подтемы отличается от доли вопросов;
 * 2. цена вопроса, переопределённая в тесте, меняет и подытог — обе доли считаются
 *    по тем же баллам, что и вердикт темы;
 * 3. измерительный вопрос (шкала без верной градации) в разрез не попадает вовсе:
 *    ни в число вопросов подтемы, ни в её баллы.
 *
 * Вердикта в записи разреза нет: подтема говорит о результате, но не судит его
 * (решение владельца 2026-09-03).
 */
import { describe, it, expect } from "vitest";
import { aggregateStandardResult, type AggregateSection } from "../shared/scoring/aggregate";

const section = (topicId: string, questions: AggregateSection["questions"]): AggregateSection => ({
  topicId,
  topicName: topicId,
  topicPassRule: null,
  questions,
});

/** Вопрос с одним верным вариантом: цена `points`, ответ верен при `ok`. */
const single = (ok: boolean, tags: string[], points: number) => ({
  type: "single" as const,
  correct: { correctIndex: 0 },
  scoring: null,
  points,
  answer: ok ? 0 : 1,
  axisKeys: { tag: tags },
});

describe("подытог считается по эффективной оценке вопроса", () => {
  it("частичный ответ даёт долю, а не ноль (ступенчатая схема)", () => {
    // Три верных варианта из четырёх: ступень «c >= 2 и x = 0» даёт 2 балла из 4.
    const agg = aggregateStandardResult({
      sections: [
        section("law", [
          {
            type: "multiple",
            correct: { correctIndices: [0, 1, 2] },
            scoring: {
              kind: "tiered",
              sMax: 4,
              tiers: [
                { when: { all: [{ lhs: "c", op: "==", rhs: "T" }, { lhs: "x", op: "==", rhs: 0 }] }, score: 4 },
                { when: { all: [{ lhs: "c", op: ">=", rhs: 2 }, { lhs: "x", op: "==", rhs: 0 }] }, score: 2 },
              ],
            },
            points: 4,
            answer: [0, 1],
            axisKeys: { tag: ["ПДн"] },
          },
        ]),
      ],
      overallPassRule: null,
    });
    const row = agg.topicResults[0].breakdown[0];
    expect(row.key).toBe("ПДн");
    expect(row.earned).toBe(2);
    expect(row.possible).toBe(4);
    expect(row.percentPoints).toBe(50);
    // Доля вопросов считает вопрос по его собственной доле: 0.5 из 1.
    expect(row.percentUnits).toBe(50);
  });

  it("цена вопроса в этом тесте меняет подытог вместе с вердиктом темы", () => {
    // Дешёвый верный и дорогой неверный: вопросов поровну, баллов — четверть.
    const agg = aggregateStandardResult({
      sections: [section("law", [single(true, ["ПДн"], 1), single(false, ["ПДн"], 3)])],
      overallPassRule: null,
    });
    const row = agg.topicResults[0].breakdown[0];
    expect(row.items).toBe(2);
    expect(row.percentUnits).toBe(50);
    expect(row.percentPoints).toBe(25);
    expect(row.earned).toBe(1);
    expect(row.possible).toBe(4);
    // Тот же счёт, что у темы: подытог и вердикт считаются одними баллами.
    expect(agg.topicResults[0].percent).toBe(25);
  });

  it("измерительный вопрос в разрез не попадает (PRD-26 FR-08)", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [
          single(true, ["ПДн"], 2),
          {
            // Шкальный вопрос без верной градации — он ничего не оценивает.
            type: "scale",
            correct: {},
            scoring: null,
            points: 5,
            answer: 3,
            axisKeys: { tag: ["ПДн"] },
          },
        ]),
      ],
      overallPassRule: null,
    });
    const row = agg.topicResults[0].breakdown[0];
    expect(row.items).toBe(1);
    expect(row.possible).toBe(2);
    expect(row.percentPoints).toBe(100);
    expect(agg.topicResults[0].total).toBe(1);
  });

  it("без порога у теста запись разреза исхода не несёт (PRD-50 §16)", () => {
    // Порог подтемы производный: правила нет ни у теста, ни у темы — значит, судить нечем,
    // и запись остаётся с пустым исходом, а не проваливается на 0 %.
    const agg = aggregateStandardResult({
      sections: [section("law", [single(false, ["ПДн"], 1)])],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].breakdown[0].passed).toBeNull();
    expect(agg.breakdowns[0].passed).toBeNull();
  });
});
