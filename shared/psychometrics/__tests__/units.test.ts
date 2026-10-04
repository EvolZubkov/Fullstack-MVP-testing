/**
 * @module shared/psychometrics/__tests__/units.test
 * @description Э4а: разбор сопоставления, ранжирования и пропусков по единицам.
 *
 * Доли — от ответивших на задание (пустая единица не верна, пустой ответ в разбор не входит);
 * частая ошибка — то, что действительно поставили; крайние группы — только при способностях.
 */
import { describe, expect, it } from "vitest";

import { analyseUnits, type UnitResponse } from "../units";

const matching = {
  type: "matching" as const,
  prompt: "Сопоставьте документ и срок хранения",
  data: { left: ["Приказы", "Договоры"], right: ["75 лет", "50 лет", "10 лет"] },
  correct: { pairs: [{ left: 0, right: 0 }, { left: 1, right: 1 }] },
};

const r = (id: string, answer: unknown): UnitResponse => ({ respondentId: id, answer });

describe("analyseUnits — сопоставление", () => {
  it("считает долю верных пар и частую ошибку", () => {
    const result = analyseUnits(matching, [
      r("a", { 0: 0, 1: 1 }),
      r("b", { 0: 1, 1: 1 }),
      r("c", { 0: 1, 1: 2 }),
      r("d", { 0: 0 }),
      r("e", {}),
    ])!;

    expect(result.observations).toBe(4);
    expect(result.units.map(u => u.label)).toEqual(["Приказы", "Договоры"]);
    expect(result.units[0]).toMatchObject({ reference: "75 лет", share: 0.5, mistake: { label: "50 лет", share: 0.5 } });
    // «d» пару не трогал: она не верна, но и ошибкой не считается.
    expect(result.units[1]).toMatchObject({ share: 0.5, mistake: { label: "10 лет", share: 0.25 } });
    expect(result.share).toBe(0.5);
    expect(result.units[0].bottomShare).toBeNull();
  });

  it("без ответов и без пар разбирать нечего", () => {
    expect(analyseUnits(matching, [r("a", {})])).toBeNull();
    expect(analyseUnits({ ...matching, correct: {} }, [r("a", { 0: 0 })])).toBeNull();
  });

  it("разрез по крайним группам — по способности", () => {
    const responses = Array.from({ length: 10 }, (_, i) => r(`p${i}`, i < 5 ? { 0: 1, 1: 1 } : { 0: 0, 1: 1 }));
    const ability = new Map(responses.map((response, i) => [response.respondentId, i / 10]));

    const result = analyseUnits(matching, responses, ability)!;

    expect(result.units[0].bottomShare).toBe(0);
    expect(result.units[0].topShare).toBe(1);
  });
});

describe("analyseUnits — ранжирование", () => {
  it("считает долю на своём месте, среднее место и сдвиг", () => {
    const question = {
      type: "ranking" as const,
      prompt: "Расположите по порядку",
      data: { items: ["Запрос", "Проверка", "Решение"] },
      correct: { correctOrder: [0, 1, 2] },
    };

    const result = analyseUnits(question, [r("a", [0, 1, 2]), r("b", [1, 0, 2])])!;

    expect(result.units[0]).toMatchObject({ label: "Запрос", place: 1, share: 0.5, meanPlace: 1.5, meanShift: 0.5 });
    expect(result.units[0].mistake).toEqual({ label: "2-е место", share: 0.5 });
    expect(result.units[2]).toMatchObject({ share: 1, meanShift: 0 });
    expect(result.meanShift).toBeCloseTo(1 / 3);
  });
});

describe("analyseUnits — пропуски", () => {
  const question = {
    type: "blanks" as const,
    prompt: "Столица России — {{city}}. Основана в {{year}} году.",
    data: {},
    correct: {
      blanks: [
        { id: "city", join: "any", answerKind: "text", rules: [{ kind: "text", match: "wildcard", value: "Москва" }] },
        { id: "year", join: "any", answerKind: "number", rules: [{ kind: "number", op: "eq", value: 1147 }] },
        { id: "spare", join: "any", answerKind: "text", rules: [] },
      ],
    },
  };

  it("проверяет пропуск его правилами и сводит написания ошибки", () => {
    const result = analyseUnits(question, [
      r("a", { city: "Москва", year: "1147" }),
      r("b", { city: "Питер", year: "1703" }),
      r("c", { city: "питер ", year: "" }),
    ])!;

    // Пропуск без правил в счёт не идёт — как у движка оценивания.
    expect(result.units).toHaveLength(2);
    expect(result.units[0]).toMatchObject({ label: "1-й пропуск", reference: "Москва", context: "Столица России — ______." });
    expect(result.units[0].share).toBeCloseTo(1 / 3);
    expect(result.units[0].mistake?.share).toBeCloseTo(2 / 3);
    expect(result.units[1]).toMatchObject({ label: "2-й пропуск", reference: "1147", context: "Основана в ______ году." });
  });
});
