/**
 * @module server/services/analytics/__tests__/score-buckets
 * @description PRD-56 FR-13a: распределение результатов корзинами одной ширины.
 *
 * Корзина включает нижнюю границу и НЕ включает верхнюю — иначе результат 70 попадает сразу в
 * две. Последняя берёт 100, потому что иначе стопроцентный результат не попадает никуда.
 *
 * Цвет задаёт проходной балл, а не порядок полос: ниже порога — красный, выше — зелёный, а
 * корзина, ВНУТРИ которой проходит порог, красится жёлтым целиком. Красить её половиной в один
 * цвет, половиной в другой значило бы утверждать, что столбик делится по сдаваемости, — он не
 * делится: это один интервал, где есть и сдавшие, и нет.
 */

import { describe, expect, it } from "vitest";

import { scoreBuckets } from "../score-buckets";

describe("scoreBuckets", () => {
  it("раскладывает результаты по десяти корзинам одной ширины", () => {
    const buckets = scoreBuckets([0, 5, 15, 99, 100], 70);

    expect(buckets).toHaveLength(10);
    expect(buckets.map(b => b.label)).toEqual([
      "0–9", "10–19", "20–29", "30–39", "40–49",
      "50–59", "60–69", "70–79", "80–89", "90–100",
    ]);
    expect(buckets[0].count).toBe(2);
    expect(buckets[1].count).toBe(1);
    expect(buckets[9].count).toBe(2);
  });

  it("не считает результат дважды на границе корзины", () => {
    // 70 — это начало корзины «70–79», а не конец «60–69»: иначе одно прохождение
    // учитывается в двух столбиках и сумма долей уезжает за сто процентов.
    const buckets = scoreBuckets([70], 70);

    expect(buckets[6].count).toBe(0);
    expect(buckets[7].count).toBe(1);
  });

  it("красит корзины по проходному баллу", () => {
    const buckets = scoreBuckets([], 70);

    expect(buckets.slice(0, 7).map(b => b.tone)).toEqual(Array(7).fill("error"));
    expect(buckets.slice(7).map(b => b.tone)).toEqual(Array(3).fill("success"));
  });

  it("красит жёлтым корзину, внутри которой проходит порог", () => {
    const buckets = scoreBuckets([], 75);

    expect(buckets[7]).toMatchObject({ label: "70–79", tone: "warning", holdsThreshold: true });
    expect(buckets[6].tone).toBe("error");
    expect(buckets[8].tone).toBe("success");
  });

  it("сумма зелёных корзин равна доле сдавших, когда порог кратен ширине", () => {
    // Проверяемое обещание FR-13a: читатель складывает зелёные столбики глазами и получает
    // ту же долю, что подписана в плитке «Сдали».
    const percents = [40, 55, 69, 70, 80, 95];
    const buckets = scoreBuckets(percents, 70);

    const green = buckets.filter(b => b.tone === "success").reduce((sum, b) => sum + b.share, 0);
    const passRate = (percents.filter(p => p >= 70).length / percents.length) * 100;
    expect(green).toBeCloseTo(passRate, 6);
  });

  it("у теста без проходного балла столбцы одноцветные", () => {
    // Опросник ничего не оценивает: «красный» и «зелёный» тут утверждали бы о хорошем и
    // плохом там, где эталона нет вовсе (FR-21b — то же правило).
    const buckets = scoreBuckets([30, 80], null);

    expect(buckets.every(b => b.tone === "neutral")).toBe(true);
    expect(buckets.every(b => b.holdsThreshold === false)).toBe(true);
  });

  it("считает долю от числа прохождений с результатом", () => {
    const buckets = scoreBuckets([10, 10, 90, 90], 70);

    expect(buckets[1].share).toBe(50);
    expect(buckets[9].share).toBe(50);
  });

  it("на пустой выборке отдаёт корзины с нулями, а не пустоту", () => {
    // Пустая гистограмма — это «прохождений нет», и она отличается от «блок не построился».
    const buckets = scoreBuckets([], 70);

    expect(buckets).toHaveLength(10);
    expect(buckets.every(b => b.count === 0 && b.share === 0)).toBe(true);
  });

  it("порог 100 держит последняя корзина", () => {
    const buckets = scoreBuckets([], 100);

    expect(buckets[9]).toMatchObject({ tone: "warning", holdsThreshold: true });
  });
});
