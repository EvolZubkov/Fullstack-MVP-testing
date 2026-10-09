/**
 * @module shared/psychometrics/__tests__/reliability
 *
 * Эталон посчитан вручную (AC-01) на том же наборе, что и метрики задания:
 *
 * ```text
 *        q1   q2   q3   q4   сумма
 *   A     1    1    1    1     4
 *   B     1    1    1    0     3
 *   C     1    1    0    0     2
 *   D     0    1    0    0     1
 * ```
 *
 * Дисперсии пунктов (делитель 3): 0,25 + 0 + 0,3(3) + 0,25 = 0,8(3).
 * Дисперсия суммы: 5 / 3 = 1,6(6). alpha = (4/3) × (1 − 0,8(3)/1,6(6)) = 2/3.
 * SEM = √(5/3) × √(1/3) = 0,745355…
 */
import { describe, expect, it } from "vitest";

import {
  alphaOf,
  countWithinBand,
  cutScoreBand,
  pairwiseReliability,
  spearmanBrown,
  standardErrorOfMeasurement,
  type ItemValue,
} from "../reliability";

/** Тот же эталонный набор, приведённый к значениям пунктов. */
const VALUES: ItemValue[] = [
  { respondentId: "A", itemId: "q1", value: 1 },
  { respondentId: "A", itemId: "q2", value: 1 },
  { respondentId: "A", itemId: "q3", value: 1 },
  { respondentId: "A", itemId: "q4", value: 1 },
  { respondentId: "B", itemId: "q1", value: 1 },
  { respondentId: "B", itemId: "q2", value: 1 },
  { respondentId: "B", itemId: "q3", value: 1 },
  { respondentId: "B", itemId: "q4", value: 0 },
  { respondentId: "C", itemId: "q1", value: 1 },
  { respondentId: "C", itemId: "q2", value: 1 },
  { respondentId: "C", itemId: "q3", value: 0 },
  { respondentId: "C", itemId: "q4", value: 0 },
  { respondentId: "D", itemId: "q1", value: 0 },
  { respondentId: "D", itemId: "q2", value: 1 },
  { respondentId: "D", itemId: "q3", value: 0 },
  { respondentId: "D", itemId: "q4", value: 0 },
];

describe("alphaOf", () => {
  it("совпадает с ручным счётом", () => {
    const result = alphaOf(VALUES);
    expect(typeof result).not.toBe("string");
    if (typeof result === "string") return;

    expect(result.alpha).toBeCloseTo(2 / 3, 12);
    expect(result.items).toBe(4);
    expect(result.respondents).toBe(4);
    expect(result.totalSd).toBeCloseTo(Math.sqrt(5 / 3), 12);
  });

  it("дихотомический набор опознаётся — там альфа И ЕСТЬ KR-20", () => {
    // Не другая формула, а её частный случай: считать KR-20 отдельно значило бы завести
    // второй источник одного и того же числа.
    const result = alphaOf(VALUES);
    if (typeof result === "string") throw new Error("ожидался коэффициент");
    expect(result.dichotomous).toBe(true);
  });

  it("частичный кредит дихотомией не считается", () => {
    const partial = VALUES.map(v => (v.itemId === "q3" && v.value === 1 ? { ...v, value: 0.5 } : v));
    const result = alphaOf(partial);
    if (typeof result === "string") throw new Error("ожидался коэффициент");
    expect(result.dichotomous).toBe(false);
  });

  it("считает ТОЛЬКО по полным наборам и говорит, скольких включил", () => {
    // Респондент, пропустивший пункт, попал бы в дисперсию одних пунктов и не попал в
    // дисперсию других: отношение таких дисперсий не значит ничего (FR-19b).
    const withGap: ItemValue[] = [
      ...VALUES,
      { respondentId: "E", itemId: "q1", value: 1 },
      { respondentId: "E", itemId: "q2", value: 1 },
    ];
    const result = alphaOf(withGap);
    if (typeof result === "string") throw new Error("ожидался коэффициент");

    expect(result.respondents).toBe(4);
    expect(result.alpha).toBeCloseTo(2 / 3, 12);
  });

  it("перевёрнутый вклад пункта МЕНЯЕТ альфу — она вычислима, а не гадательна (FR-31b)", () => {
    // Значение пункта — вклад со знаком, поэтому «а что, если перевернуть» проверяется тем же
    // движком на тех же наблюдениях. Это и позволяет подписи давать следствие вместо догадки.
    const mirrored = VALUES.map(v => (v.itemId === "q4" ? { ...v, value: 1 - v.value } : v));
    const before = alphaOf(VALUES);
    const after = alphaOf(mirrored);
    if (typeof before === "string" || typeof after === "string") throw new Error("ожидался коэффициент");

    expect(after.alpha).not.toBeCloseTo(before.alpha, 6);
  });

  it("на одном пункте согласованности нет по построению", () => {
    expect(alphaOf(VALUES.filter(v => v.itemId === "q1"))).toBe("too-few-items");
  });

  it("на одном респонденте разброса нет", () => {
    expect(alphaOf(VALUES.filter(v => v.respondentId === "A"))).toBe("too-few-respondents");
  });

  it("когда все набрали поровну, коэффициента нет — это не нулевая надёжность", () => {
    const flat: ItemValue[] = [
      { respondentId: "A", itemId: "q1", value: 1 },
      { respondentId: "A", itemId: "q2", value: 0 },
      { respondentId: "B", itemId: "q1", value: 0 },
      { respondentId: "B", itemId: "q2", value: 1 },
    ];
    expect(alphaOf(flat)).toBe("no-variance");
  });
});

describe("standardErrorOfMeasurement", () => {
  it("совпадает с ручным счётом", () => {
    expect(standardErrorOfMeasurement(Math.sqrt(5 / 3), 2 / 3)).toBeCloseTo(0.7453559925, 9);
  });

  it("при нулевой надёжности ошибка равна всему разбросу", () => {
    expect(standardErrorOfMeasurement(2, 0)).toBe(2);
  });

  it("при отрицательной альфе ошибка не превышает разброс дважды и остаётся числом", () => {
    // Набор, где пункты противоречат друг другу, не измеряет ничего — но `NaN` вместо числа
    // ронял бы экран (FR-44).
    expect(Number.isFinite(standardErrorOfMeasurement(2, -0.5))).toBe(true);
  });
});

describe("cutScoreBand", () => {
  it("строит интервал вокруг порога", () => {
    const band = cutScoreBand(70, 5);
    expect(band.low).toBeCloseTo(70 - 1.96 * 5, 12);
    expect(band.high).toBeCloseTo(70 + 1.96 * 5, 12);
  });

  it("множитель ошибки задаётся явно", () => {
    expect(cutScoreBand(70, 5, 1).low).toBe(65);
  });
});

describe("countWithinBand", () => {
  /** Четыре участника с суммами 0, 1, 2 и 3 по трём пунктам. */
  const VALUES = [
    { respondentId: "A", itemId: "q1", value: 0 },
    { respondentId: "A", itemId: "q2", value: 0 },
    { respondentId: "A", itemId: "q3", value: 0 },
    { respondentId: "B", itemId: "q1", value: 1 },
    { respondentId: "B", itemId: "q2", value: 0 },
    { respondentId: "B", itemId: "q3", value: 0 },
    { respondentId: "C", itemId: "q1", value: 1 },
    { respondentId: "C", itemId: "q2", value: 1 },
    { respondentId: "C", itemId: "q3", value: 0 },
    { respondentId: "D", itemId: "q1", value: 1 },
    { respondentId: "D", itemId: "q2", value: 1 },
    { respondentId: "D", itemId: "q3", value: 1 },
  ];

  it("считает участников, чей балл попал внутрь интервала (FR-21a)", () => {
    // Две суммы из четырёх лежат между 0,5 и 2,5 — это и есть те, чей исход решает ошибка
    // измерения, а не подготовка.
    expect(countWithinBand(VALUES, { low: 0.5, high: 2.5, z: 1.96 })).toBe(2);
  });

  it("границы интервала считаются ВНУТРИ: на самой границе исход тоже ненадёжен", () => {
    expect(countWithinBand(VALUES, { low: 1, high: 2, z: 1.96 })).toBe(2);
  });

  it("считает по ПОЛНЫМ наборам — тем же, на которых стоит сама надёжность", () => {
    // У неполного участника сумма меньше просто потому, что он видел не все задания, и
    // сравнивать её с порогом означало бы записать его в сомнительные без основания.
    const partial = [...VALUES, { respondentId: "E", itemId: "q1", value: 1 }];
    expect(countWithinBand(partial, { low: 0.5, high: 2.5, z: 1.96 })).toBe(2);
  });
});

describe("spearmanBrown", () => {
  it("считает, во сколько раз удлинить тест ради целевой надёжности", () => {
    // alpha = 0,6, цель 0,8: factor = 0,8 × 0,4 / (0,6 × 0,2) = 2,6(6) → к 10 заданиям ещё 17.
    const forecast = spearmanBrown(0.6, 0.8, 10)!;
    expect(forecast.factor).toBeCloseTo(2.6666666667, 9);
    expect(forecast.itemsDelta).toBe(17);
  });

  it("при надёжности выше целевой тест можно укоротить", () => {
    const forecast = spearmanBrown(0.9, 0.8, 20)!;
    expect(forecast.factor).toBeLessThan(1);
    expect(forecast.itemsDelta).toBeLessThan(0);
  });

  it("не добавляет лишнее задание из-за погрешности вычислений", () => {
    // alpha = 2/3 при четырёх пунктах даёт РОВНО двукратную длину, но в двоичной дроби
    // множитель выходит 2,0000000000000004, и округление вверх превращало «добавить 4» в
    // «добавить 5». Совет автору нельзя брать из шума последнего разряда.
    const forecast = spearmanBrown(2 / 3, 0.8, 4)!;
    expect(forecast.itemsDelta).toBe(4);
  });

  it("прогноза нет там, где он невозможен", () => {
    // Несогласованные пункты не лечатся добавлением таких же; надёжность в единицу
    // недостижима никаким числом заданий.
    expect(spearmanBrown(0, 0.8, 10)).toBeNull();
    expect(spearmanBrown(-0.2, 0.8, 10)).toBeNull();
    expect(spearmanBrown(0.6, 1, 10)).toBeNull();
  });
});

/**
 * PRD-66 FR-20: оценка надёжности по связям заданий — для выдачи, где у участников разные наборы.
 *
 * Средняя корреляция по парам (каждая пара — по тем, кому досталось и то и другое) и пересчёт
 * по Спирмену-Брауну на длину варианта: `L·r̄ / (1 + (L−1)·r̄)`.
 */
describe("pairwiseReliability", () => {
  /**
   * Банк из шести заданий, каждый участник видит три подряд по кругу: полного набора нет ни у
   * кого, но каждая соседняя пара встречается у многих. Ответ определяется способностью, и все
   * задания меряют одно и то же.
   */
  function rotating(respondents: number): ItemValue[] {
    const out: ItemValue[] = [];
    for (let i = 0; i < respondents; i += 1) {
      const ability = (i % 10) / 9;
      for (let k = 0; k < 3; k += 1) {
        const item = (i + k) % 6;
        // Задание тем труднее, чем больше номер: разброс по заданиям не нулевой.
        out.push({ respondentId: `R${i}`, itemId: `q${item}`, value: ability > item / 6 ? 1 : 0 });
      }
    }
    return out;
  }

  it("строит оценку без полных наборов и называет длину варианта", () => {
    const result = pairwiseReliability(rotating(120));
    expect(typeof result).not.toBe("string");
    const reliability = result as Exclude<typeof result, string>;
    expect(reliability.method).toBe("pairwise");
    expect(reliability.items).toBe(3);
    expect(reliability.alpha).toBeGreaterThan(0);
    expect(reliability.alpha).toBeLessThan(1);
    expect(reliability.pairs).toBeGreaterThan(0);
  });

  it("совпадает с формулой Спирмена-Брауна от средней корреляции", () => {
    // Три задания, идеально согласованные у всех, кто их видел: r̄ = 1 → надёжность 1.
    const values: ItemValue[] = [];
    for (let i = 0; i < 20; i += 1) {
      const v = i % 2;
      values.push(
        { respondentId: `R${i}`, itemId: "a", value: v },
        { respondentId: `R${i}`, itemId: "b", value: v },
        { respondentId: `R${i}`, itemId: "c", value: v },
      );
    }
    const reliability = pairwiseReliability(values) as Exclude<ReturnType<typeof pairwiseReliability>, string>;
    expect(reliability.alpha).toBeCloseTo(1, 10);
  });

  it("без пар с достаточным пересечением — причина, а не число", () => {
    // Каждый видит свои задания: пары не встречаются вовсе.
    const disjoint: ItemValue[] = ["A", "B", "C", "D"].flatMap((r, i) => [
      { respondentId: r, itemId: `x${i}`, value: 1 },
      { respondentId: r, itemId: `y${i}`, value: 0 },
    ]);
    expect(pairwiseReliability(disjoint)).toBe("random-delivery");
  });
});
