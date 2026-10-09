/**
 * @module tests/breakdown-analytics-scorm
 * @description Долг Э1: пересчёт показателей для телеметрийной попытки не видел разрезов,
 * поэтому формула с `tag()` давала в аналитике ноль при том, что пакет посчитал настоящее
 * значение. Проверяется чистая часть — сборка элементов из строк телеметрии.
 */
import { describe, it, expect } from "vitest";
import { scormBreakdownItems } from "../server/routes/analytics/scorm";
import { computeBreakdowns } from "../shared/breakdown/compute";

const answer = (questionId: string, topicId: string | null, points: number, maxPoints: number) => ({
  questionId, topicId, points, maxPoints,
});

describe("scormBreakdownItems", () => {
  it("берёт теги живого банка и цену из строки телеметрии", () => {
    const items = scormBreakdownItems(
      [answer("q1", "law", 2, 3)],
      new Map([["q1", ["ПДн"]]]),
    );
    expect(items).toEqual([
      { sectionId: "law", axisKeys: { tag: ["ПДн"] }, earned: 2, possible: 3, answered: true },
    ]);
    expect(computeBreakdowns(items)[0]).toMatchObject({ key: "ПДн", percentPoints: (2 / 3) * 100 });
  });

  it("пропускает ответы без тега и без раздела", () => {
    expect(scormBreakdownItems([answer("q1", "law", 1, 1)], new Map())).toEqual([]);
    expect(scormBreakdownItems([answer("q1", null, 1, 1)], new Map([["q1", ["ПДн"]]]))).toEqual([]);
  });

  it("пропускает вопрос без возможных баллов (FR-02 отработает в движке)", () => {
    const items = scormBreakdownItems([answer("q1", "law", 0, 0)], new Map([["q1", ["ПДн"]]]));
    expect(computeBreakdowns(items)).toEqual([]);
  });
});
