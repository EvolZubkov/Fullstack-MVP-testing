/**
 * @module shared/psychometrics/__tests__/distractors
 *
 * Набор построен так, чтобы каждый вариант играл свою роль: нулевой — верный, первый —
 * работающий дистрактор (его выбирают слабые), второй — мёртвый, третий — инвертированный
 * (его выбирают сильные).
 */
import { describe, expect, it } from "vitest";

import { analyseOptions, flagsOf, type ChoiceResponse } from "../distractors";
import { abilities, type ItemResponse } from "../item-metrics";

/** Восемь респондентов: четверо сильных, четверо слабых. */
const ABILITY_SET: ItemResponse[] = [];
for (const [respondentId, ratio] of [
  ["S1", 1], ["S2", 1], ["S3", 0.9], ["S4", 0.9],
  ["W1", 0.2], ["W2", 0.2], ["W3", 0.1], ["W4", 0.1],
] as Array<[string, number]>) {
  ABILITY_SET.push({ respondentId, itemId: "other", ratio });
}
const ABILITY = abilities(ABILITY_SET);

/** Выборы: сильные берут верный (0) и один — инвертированный (3); слабые берут дистрактор (1). */
const CHOICES: ChoiceResponse[] = [
  { respondentId: "S1", chosen: [0] },
  { respondentId: "S2", chosen: [0] },
  { respondentId: "S3", chosen: [3] },
  { respondentId: "S4", chosen: [3] },
  { respondentId: "W1", chosen: [1] },
  { respondentId: "W2", chosen: [1] },
  { respondentId: "W3", chosen: [1] },
  { respondentId: "W4", chosen: [0] },
];

describe("analyseOptions", () => {
  it("считает долю выбора каждого варианта от ВСЕХ наблюдений", () => {
    const { options, observations } = analyseOptions(CHOICES, [0], 4, ABILITY);

    expect(observations).toBe(8);
    expect(options.map(o => o.share)).toEqual([3 / 8, 3 / 8, 0, 2 / 8]);
  });

  it("невыбранный вариант в разборе присутствует — иначе мёртвого не увидеть", () => {
    const { options } = analyseOptions(CHOICES, [0], 4, ABILITY);
    expect(options[2]).toMatchObject({ index: 2, share: 0 });
  });

  it("доли крайних групп считаются ОТ СВОЕЙ группы (FR-26b)", () => {
    // floor(8 × 0,27) = 2. Слабые: W3, W4 (оба брали 1 и 0 соответственно); сильные: S1, S2.
    const { options } = analyseOptions(CHOICES, [0], 4, ABILITY);

    expect(options[0].topShare).toBe(1);
    expect(options[0].bottomShare).toBe(0.5);
    expect(options[1].bottomShare).toBe(0.5);
    expect(options[1].topShare).toBe(0);
  });

  it("верный вариант связан с баллом положительно, работающий дистрактор — отрицательно", () => {
    const { options } = analyseOptions(CHOICES, [0], 4, ABILITY);

    expect(options[0].restCorrelation!).toBeGreaterThan(0);
    expect(options[1].restCorrelation!).toBeLessThan(0);
  });

  it("на пустой выборке ничего не выдумывает", () => {
    expect(analyseOptions([], [0], 4, ABILITY)).toEqual({ options: [], observations: 0 });
  });
});

describe("flagsOf", () => {
  const { options } = analyseOptions(CHOICES, [0], 4, ABILITY);

  it("мёртвым считается неверный вариант, которого почти никто не выбрал", () => {
    expect(flagsOf(options[2])).toMatchObject({ dead: true });
  });

  it("инвертированным — неверный вариант, который выбирают сильные", () => {
    // Симптом, а не причина: частично верен он, двусмыслен или ключ ошибочен — по числам не
    // различить, и приписывать расчёту такое знание нельзя.
    expect(flagsOf(options[3])).toMatchObject({ inverted: true });
  });

  it("верный вариант, который выбирают СЛАБЫЕ, назван — это симптом испорченного ключа", () => {
    // Вскрыто приёмкой: у такого варианта стоял нейтральный ярлык «Верный ответ», хотя рядом
    // висела отрицательная корреляция. Нейтральный ярлык читается как «здесь всё в порядке».
    const brokenKey = analyseOptions(
      [
        { respondentId: "S1", chosen: [1] }, { respondentId: "S2", chosen: [1] },
        { respondentId: "S3", chosen: [1] }, { respondentId: "S4", chosen: [1] },
        { respondentId: "W1", chosen: [0] }, { respondentId: "W2", chosen: [0] },
        { respondentId: "W3", chosen: [0] }, { respondentId: "W4", chosen: [0] },
      ],
      [0], 2, ABILITY,
    );

    expect(flagsOf(brokenKey.options[0])).toMatchObject({ correctButWeak: true });
  });

  it("верный вариант признаков дистрактора не получает никогда", () => {
    // У него положительная связь с баллом по построению — это норма, а не симптом.
    expect(flagsOf(options[0])).toEqual({ dead: false, inverted: false, correctButWeak: false });
  });

  it("работающий дистрактор чист по обоим признакам", () => {
    expect(flagsOf(options[1])).toEqual({ dead: false, inverted: false, correctButWeak: false });
  });
});
