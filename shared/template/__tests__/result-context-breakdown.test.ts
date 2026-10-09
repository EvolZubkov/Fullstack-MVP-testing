/**
 * @module shared/template/__tests__/result-context-breakdown
 * @description PRD-50 FR-31 - FR-33: breakdown rows inside the topic card, hidden unless
 * the author turned them on.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";

const topic = {
  topicName: "Право", correct: 1, total: 2, percent: 50, earnedPoints: 1, possiblePoints: 2,
  passed: false,
  breakdown: [
    { scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
      unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 40 },
  ],
};
const result = { passed: false, percent: 50, totalQuestions: 2, correct: 1,
  earnedPoints: 1, possiblePoints: 2, topicResults: [topic] };

describe("разрез в карточке темы", () => {
  it("при hidden полос нет", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "hidden", basis: "units" },
    } as never);
    expect((ctx.result.topicResults![0] as never as { breakdown?: unknown[] }).breakdown).toBeUndefined();
  });

  it("при bar печатает полосу по нормированной базе и без числа", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ key: "ПДн", barPercent: 40, showValue: false });
  });

  it("при bar_and_value и базе points печатает балльный процент", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar_and_value", basis: "points" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ barPercent: 50, showValue: true, valueLabel: "50 %" });
  });
});

describe("полный состав строки (§8.1)", () => {
  it("строка несёт счётчики, баллы и обе базы, а не только полосу", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar_and_value", basis: "units" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    // toEqual, а не toMatchObject: контракт строки — это её ПОЛНЫЙ состав. Лишнее поле
    // здесь так же значимо, как недостающее: сторонний шаблон реестра PRD-3 привязывается
    // к именам, и молча появившееся имя потом придётся возить по обоим хостам.
    expect(rows[0]).toEqual({
      key: "ПДн",
      items: 2,
      answered: 2,
      earned: 1,
      possible: 2,
      percent: 40,
      percentUnits: 40,
      percentPoints: 50,
      barPercent: 40,
      showValue: true,
      valueLabel: "40 %",
      // PRD-50 §16 (FR-54): исход подтемы снова в составе строки. Запись фикстуры сделана
      // без него, поэтому здесь он пустой: `null` и класс без модификатора. Надписи порога
      // нет — порога не было. `toEqual` стережёт состав: третьего поля молча не добавить.
      passed: null,
      passClass: "",
    });
  });

  it("percent следует ВЫБРАННОЙ базе, а percentPoints остаётся валютой вердикта", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "points" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0].percent).toBe(50);
    expect(rows[0].percentUnits).toBe(40);
    expect(rows[0].percentPoints).toBe(50);
  });

  it("дробные значения приходят с одним знаком, а не сырым отношением", () => {
    const messy = {
      ...topic,
      breakdown: [
        { scope: "section:law", axis: "tag", key: "ПДн", items: 3, answered: 3,
          earned: 5 / 3, possible: 3, unitEarned: 5 / 9, unitPossible: 3,
          percentPoints: (5 / 9) * 100, percentUnits: (5 / 27) * 100 },
      ],
    };
    const ctx = buildResultContext({ ...result, topicResults: [messy] } as never, "Тест", {
      breakdownDisplay: { visibility: "bar_and_value", basis: "points" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0].earned).toBe(1.7);
    expect(rows[0].percentPoints).toBe(55.6);
    expect(rows[0].barPercent).toBe(56);
  });
});

describe("исход подтемы в строке (§16)", () => {
  it("PRD-50 FR-54: строка несёт исход, класс и надпись порога", () => {
    const ctx = buildResultContext(
      {
        ...result,
        topicResults: [
          {
            ...topic,
            breakdown: [
              { scope: "section:s1", axis: "tag", key: "Право", items: 2, answered: 2,
                earned: 1, possible: 2, unitEarned: 1, unitPossible: 2,
                percentPoints: 50, percentUnits: 50, passed: false, thresholdPercent: 70 },
            ],
          },
        ],
      } as never,
      "Тест",
      { breakdownDisplay: { visibility: "bar_and_value", basis: "points" } } as never,
    );
    const row = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown[0];
    expect(row.passed).toBe(false);
    expect(row.passClass).toBe("is-fail");
    expect(row.requiredLabel).toBe("Нужно 70 %");
  });

  it("PRD-50 FR-57: запись без исхода печатается нейтрально", () => {
    const ctx = buildResultContext(
      {
        ...result,
        topicResults: [
          {
            ...topic,
            breakdown: [
              { scope: "section:s1", axis: "tag", key: "Право", items: 2, answered: 2,
                earned: 1, possible: 2, unitEarned: 1, unitPossible: 2,
                percentPoints: 50, percentUnits: 50 },
            ],
          },
        ],
      } as never,
      "Тест",
      { breakdownDisplay: { visibility: "bar_and_value", basis: "points" } } as never,
    );
    const row = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown[0];
    expect(row.passed).toBeNull();
    expect(row.passClass).toBe("");
    expect(row.requiredLabel).toBeUndefined();
  });
});
