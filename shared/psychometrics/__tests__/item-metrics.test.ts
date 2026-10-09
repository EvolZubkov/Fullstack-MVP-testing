/**
 * @module shared/psychometrics/__tests__/item-metrics
 *
 * Эталонный набор посчитан вручную (AC-01). Четыре респондента, четыре задания, доли балла:
 *
 * ```text
 *        q1   q2   q3   q4   способность
 *   A     1    1    1    1       1,00
 *   B     1    1    1    0       0,75
 *   C     1    1    0    0       0,50
 *   D     0    1    0    0       0,25
 *   p   0,75 1,00 0,50 0,25
 * ```
 *
 * Набор выбран так, что каждое задание проверяет свой случай: `q1` — обычное, `q2` — решённое
 * всеми (дискриминативности нет вовсе), `q3` и `q4` — разной трудности при одинаковом порядке
 * респондентов.
 */
import { describe, expect, it } from "vitest";

import {
  abilities,
  difficulty,
  discriminationIndex,
  guessingCorrectedDifficulty,
  itemRestCorrelation,
  type ItemResponse,
} from "../item-metrics";

/** Матрица эталонного набора. */
const SET: ItemResponse[] = [
  { respondentId: "A", itemId: "q1", ratio: 1 },
  { respondentId: "A", itemId: "q2", ratio: 1 },
  { respondentId: "A", itemId: "q3", ratio: 1 },
  { respondentId: "A", itemId: "q4", ratio: 1 },
  { respondentId: "B", itemId: "q1", ratio: 1 },
  { respondentId: "B", itemId: "q2", ratio: 1 },
  { respondentId: "B", itemId: "q3", ratio: 1 },
  { respondentId: "B", itemId: "q4", ratio: 0 },
  { respondentId: "C", itemId: "q1", ratio: 1 },
  { respondentId: "C", itemId: "q2", ratio: 1 },
  { respondentId: "C", itemId: "q3", ratio: 0 },
  { respondentId: "C", itemId: "q4", ratio: 0 },
  { respondentId: "D", itemId: "q1", ratio: 0 },
  { respondentId: "D", itemId: "q2", ratio: 1 },
  { respondentId: "D", itemId: "q3", ratio: 0 },
  { respondentId: "D", itemId: "q4", ratio: 0 },
];

const itemsOf = (itemId: string) => SET.filter(r => r.itemId === itemId);

describe("difficulty", () => {
  it("считает среднюю долю балла по видевшим задание", () => {
    expect(difficulty(itemsOf("q1"))).toBe(0.75);
    expect(difficulty(itemsOf("q2"))).toBe(1);
    expect(difficulty(itemsOf("q4"))).toBe(0.25);
  });

  it("учитывает ЧАСТИЧНЫЙ кредит, а не бинарную верность", () => {
    // Порог `=== 1` объявил бы это задание полностью проваленным, хотя половина баллов взята.
    const partial: ItemResponse[] = [
      { respondentId: "A", itemId: "q", ratio: 0.5 },
      { respondentId: "B", itemId: "q", ratio: 0.5 },
    ];
    expect(difficulty(partial)).toBe(0.5);
  });

  it("измерительные ответы в трудность не идут вовсе", () => {
    const withNeutral: ItemResponse[] = [
      ...itemsOf("q4"),
      { respondentId: "E", itemId: "q4", ratio: null },
    ];
    expect(difficulty(withNeutral)).toBe(0.25);
  });

  it("без наблюдений трудности нет — это не ноль", () => {
    // Ноль означал бы «не решил никто»; отсутствие данных такого не утверждает.
    expect(difficulty([])).toBeNull();
  });
});

describe("guessingCorrectedDifficulty", () => {
  it("вычитает вероятность случайного попадания", () => {
    // p = 0,6 при четырёх вариантах: (0,6 − 0,25) / 0,75 = 0,4(6)
    expect(guessingCorrectedDifficulty(0.6, 4)).toBeCloseTo(0.4666666667, 9);
  });

  it("на уровне угадывания даёт ноль, ниже — отрицательное число", () => {
    // Признак «на уровне угадывания» — это `p_corrected <= 0`, и он обязан быть достижим.
    expect(guessingCorrectedDifficulty(0.25, 4)).toBeCloseTo(0, 12);
    expect(guessingCorrectedDifficulty(0.1, 4)).toBeLessThan(0);
  });

  it("у задания без вычислимой вероятности поправки нет", () => {
    // Сопоставление, ранжирование, распределение баллов: пустое место честнее нуля.
    expect(guessingCorrectedDifficulty(0.5, 1)).toBeNull();
    expect(guessingCorrectedDifficulty(0.5, 0)).toBeNull();
    expect(guessingCorrectedDifficulty(null, 4)).toBeNull();
  });
});

describe("abilities", () => {
  it("способность есть доля балла на СВОЕЙ форме", () => {
    const ability = abilities(SET);
    expect(ability.get("A")).toBe(1);
    expect(ability.get("B")).toBe(0.75);
    expect(ability.get("D")).toBe(0.25);
  });

  it("респондент без оценённых ответов способности не получает", () => {
    // Иначе отвечавший только на измерительные задания оказался бы в самом низу рейтинга.
    const ability = abilities([{ respondentId: "E", itemId: "q1", ratio: null }]);
    expect(ability.has("E")).toBe(false);
  });
});

describe("itemRestCorrelation", () => {
  it("совпадает с ручным счётом", () => {
    // q1 = [1,1,1,0]; остаток = [1; 0,6(6); 0,3(3); 0,3(3)] → r = 0,52223…
    expect(itemRestCorrelation("q1", SET)).toBeCloseTo(0.5222329678, 9);
  });

  it("считает ОСТАТОК, а не полный балл", () => {
    // Корреляция с полным баллом включила бы задание в собственный критерий и завысила оценку.
    // На этом наборе разница видна прямо: с полным баллом у q1 вышло бы 0,7746, а не 0,5222.
    expect(itemRestCorrelation("q1", SET)).toBeLessThan(0.7);
  });

  it("у задания, решённого всеми, дискриминативности НЕТ — и это не ноль", () => {
    // Оно никого не различает, потому что ничего не измеряет. «Нулевая дискриминативность»
    // была бы о нём ложью — списать его по этому числу нельзя.
    expect(itemRestCorrelation("q2", SET)).toBeNull();
  });

  it("испорченный ключ даёт отрицательную корреляцию", () => {
    // Сильные ошибаются чаще слабых — красный флаг первого приоритета (FR-16).
    const broken = SET.map(r =>
      r.itemId === "q4" && r.ratio !== null ? { ...r, ratio: 1 - r.ratio } : r,
    );
    expect(itemRestCorrelation("q4", broken)!).toBeLessThan(0);
  });

  it("на одном респонденте корреляции нет", () => {
    expect(itemRestCorrelation("q1", SET.filter(r => r.respondentId === "A"))).toBeNull();
  });
});

describe("discriminationIndex", () => {
  it("сравнивает крайние 27 % по способности", () => {
    // Четыре респондента: floor(4 × 0,27) = 1 человек в каждой группе — A сверху, D снизу.
    const groups = discriminationIndex("q1", SET, abilities(SET))!;
    expect(groups.size).toBe(1);
    expect(groups.topDifficulty).toBe(1);
    expect(groups.bottomDifficulty).toBe(0);
    expect(groups.index).toBe(1);
  });

  it("у задания, решённого всеми, индекс нулевой — контраст и вправду нулевой", () => {
    // Здесь ноль законен: обе группы решили задание одинаково, и это ФАКТ, а не пустота.
    expect(discriminationIndex("q2", SET, abilities(SET))!.index).toBe(0);
  });

  it("задание, которое решают только слабые, уводит индекс в минус", () => {
    // Восемь респондентов, чтобы в крайние 27 % попало по двое: floor(8 × 0,27) = 2. Два
    // обычных задания задают порядок способностей, третье решают ровно те, кто слабее всех, —
    // это и есть симптом «сильные ошибаются чаще» (FR-16).
    const weakOnly: ItemResponse[] = [];
    const rows: Array<[string, number, number, number]> = [
      ["R1", 0, 0, 1], ["R2", 0, 0, 1],
      ["R3", 0, 1, 1], ["R4", 1, 0, 1],
      ["R5", 1, 1, 0], ["R6", 1, 1, 0],
      ["R7", 1, 1, 0], ["R8", 1, 1, 0],
    ];
    for (const [respondentId, a, b, x] of rows) {
      weakOnly.push({ respondentId, itemId: "qA", ratio: a });
      weakOnly.push({ respondentId, itemId: "qB", ratio: b });
      weakOnly.push({ respondentId, itemId: "qX", ratio: x });
    }

    const groups = discriminationIndex("qX", weakOnly, abilities(weakOnly))!;
    expect(groups.size).toBe(2);
    expect(groups.bottomDifficulty).toBe(1);
    expect(groups.topDifficulty).toBe(0);
    expect(groups.index).toBe(-1);
    // Тот же симптом виден и корреляцией задание-остаток — два показателя, один диагноз.
    expect(itemRestCorrelation("qX", weakOnly)!).toBeLessThan(0);
  });

  it("на выборке, где крайняя группа пуста, индекс не считается", () => {
    // floor(3 × 0,27) = 0: сравнивать не с кем, и выдать ноль значило бы соврать.
    const tiny = SET.filter(r => r.respondentId !== "D");
    expect(discriminationIndex("q1", tiny, abilities(tiny))).toBeNull();
  });
});
