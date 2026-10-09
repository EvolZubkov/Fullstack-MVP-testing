/**
 * @module server/services/analytics/__tests__/question-review
 * @description PRD-56 FR-16: предустановленный вид «требуют ревизии».
 *
 * Вид не выносит приговор заданию — он показывает, где СОШЛИСЬ признаки проблемы, и называет
 * их словами. Один признак ничего не значит: трудный вопрос законен, редкий вопрос законен,
 * быстрый ответ законен. Подозрительно их совпадение: задание, которое видели все и почти все
 * провалили, либо на которое отвечают быстрее, чем его можно прочитать.
 *
 * Порог выборки здесь тот же, что у срезов: на пяти ответах «доля верных 20 %» — это один
 * человек, случайно нажавший не туда.
 */

import { describe, expect, it } from "vitest";

import { reviewFlags, type ReviewCandidate } from "../question-review";

function question(over: Partial<ReviewCandidate> = {}): ReviewCandidate {
  return {
    questionId: "q1",
    gradedAnswers: 40,
    correctPercent: 80,
    exposurePercent: 20,
    latencyMedianMs: 60_000,
    latencySampleSize: 40,
    ...over,
  };
}

const MIN = 10;

describe("reviewFlags", () => {
  it("метит задание, которое видели почти все и почти все провалили", () => {
    const flags = reviewFlags(
      question({ exposurePercent: 80, correctPercent: 25 }),
      { minObservations: MIN },
    );

    expect(flags).toContainEqual(
      expect.objectContaining({ kind: "hard-and-frequent" }),
    );
  });

  it("называет признак словами, а не кодом", () => {
    const [flag] = reviewFlags(
      question({ exposurePercent: 80, correctPercent: 25 }),
      { minObservations: MIN },
    );

    // Вид без объяснения читается как приговор: автор должен видеть, ЧТО именно сошлось.
    expect(flag.reason).toMatch(/выдаётся/i);
    expect(flag.reason).toMatch(/25 %/);
  });

  it("не метит трудное задание, которое выдаётся редко", () => {
    // Трудный вопрос сам по себе законен: он и должен отсеивать. Проблема — когда трудный
    // достаётся всем и решает исход теста для всей выборки.
    const flags = reviewFlags(
      question({ exposurePercent: 5, correctPercent: 25 }),
      { minObservations: MIN },
    );

    expect(flags).toEqual([]);
  });

  it("метит аномально быстрые ответы при низкой доле верных", () => {
    // Быстро и мимо — обычно признак того, что задание угадывают или не читают: например,
    // верный ответ выделяется длиной среди коротких дистракторов.
    const flags = reviewFlags(
      question({ latencyMedianMs: 4_000, correctPercent: 30 }),
      { minObservations: MIN },
    );

    expect(flags).toContainEqual(expect.objectContaining({ kind: "fast-and-wrong" }));
  });

  it("не метит быстрые ответы там, где отвечают верно", () => {
    // Лёгкое задание решают быстро и правильно — это не дефект, а простой вопрос.
    const flags = reviewFlags(
      question({ latencyMedianMs: 4_000, correctPercent: 95 }),
      { minObservations: MIN },
    );

    expect(flags).toEqual([]);
  });

  it("молчит там, где выборка меньше порога наблюдений", () => {
    // На пяти ответах «20 % верных» — это один человек, нажавший не туда.
    const flags = reviewFlags(
      question({ gradedAnswers: 5, exposurePercent: 90, correctPercent: 20 }),
      { minObservations: MIN },
    );

    expect(flags).toEqual([]);
  });

  it("молчит там, где величины не измерены", () => {
    // Пакеты старше 2026-09-12 времени не шлют, а у измерительного вопроса нет доли верных:
    // отсутствие числа — не признак проблемы.
    const flags = reviewFlags(
      question({ correctPercent: null, exposurePercent: null, latencyMedianMs: null }),
      { minObservations: MIN },
    );

    expect(flags).toEqual([]);
  });

  it("не судит о времени по горстке замеров", () => {
    // Медиана по трём ответам — это не медиана, а случайное из трёх чисел.
    const flags = reviewFlags(
      question({ latencyMedianMs: 3_000, correctPercent: 30, latencySampleSize: 3 }),
      { minObservations: MIN },
    );

    expect(flags).toEqual([]);
  });
});
