/**
 * @module shared/psychometrics/__tests__/timing
 */
import { describe, expect, it } from "vitest";

import { rushedShare, summariseTiming, timingFlags } from "../timing";

describe("summariseTiming", () => {
  it("считает медиану и межквартильный размах", () => {
    // [10, 20, 30, 40, 50]: медиана 30, Q1 20, Q3 40.
    const summary = summariseTiming([10_000, 20_000, 30_000, 40_000, 50_000])!;
    expect(summary.medianMs).toBe(30_000);
    expect(summary.q1Ms).toBe(20_000);
    expect(summary.q3Ms).toBe(40_000);
    expect(summary.measured).toBe(5);
  });

  it("не замечает выброса, который снёс бы среднее", () => {
    // Вкладку оставили открытой на два часа. Среднее выросло бы втрое, медиана не шелохнулась —
    // ради этого она и выбрана (FR-34).
    const normal = [10_000, 20_000, 30_000, 40_000, 50_000];
    const withOutlier = [...normal, 7_200_000];

    expect(summariseTiming(withOutlier)!.medianMs).toBe(35_000);
    expect(summariseTiming(normal)!.medianMs).toBe(30_000);
  });

  it("наблюдения без замера несут СВОЮ выборку, а не ноль секунд", () => {
    // Пакеты до 2026-09-12 и веб до этой работы времени не сообщали (FR-37b).
    const summary = summariseTiming([null, 10_000, null, 30_000])!;
    expect(summary.measured).toBe(2);
    expect(summary.medianMs).toBe(20_000);
  });

  it("без единого измерения сводки нет", () => {
    expect(summariseTiming([null, null])).toBeNull();
  });
});

describe("rushedShare", () => {
  it("порог правдоподобия зависит от ДЛИНЫ текста задания", () => {
    // 400 знаков × 15 мс = 6 секунд. Ответ за 3 секунды — быстрее, чем задание можно прочесть;
    // на однострочном вопросе те же 3 секунды подозрений не вызывают.
    const latencies = [3_000, 20_000, 25_000, 30_000];
    expect(rushedShare(latencies, 400)).toBe(0.25);
    expect(rushedShare(latencies, 40)).toBe(0);
  });

  it("у короткого задания порог не опускается ниже секунды", () => {
    // Иначе задание из двух слов объявило бы честным ответ за 50 миллисекунд.
    expect(rushedShare([500, 5_000], 10)).toBe(0.5);
  });

  it("без измерений доли нет", () => {
    expect(rushedShare([null, null], 100)).toBeNull();
  });
});

describe("timingFlags", () => {
  const summary = summariseTiming([60_000, 60_000, 60_000])!;

  it("«отвечают не читая» появляется только выше порога", () => {
    // Четыре процента — здоровое задание, и печатать про него число незачем.
    expect(timingFlags(summary, 0.04, 30_000, 0.5).rushed).toBe(false);
    expect(timingFlags(summary, 0.4, 30_000, 0.5).rushed).toBe(true);
  });

  it("«тормозит прогон» — заметно выше медианы теста при обычной трудности", () => {
    expect(timingFlags(summary, 0, 20_000, 0.5).slow).toBe(true);
  });

  it("трудному заданию время прощается — признак ищет перегруженный текст, а не предмет", () => {
    expect(timingFlags(summary, 0, 20_000, 0.1).slow).toBe(false);
  });

  it("без сводки и без медианы теста признаков нет", () => {
    expect(timingFlags(null, null, null, 0.5)).toEqual({ rushed: false, slow: false });
  });
});
