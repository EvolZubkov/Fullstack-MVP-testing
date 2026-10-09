import { describe, expect, it, vi } from "vitest";
import { PACE, jitteredDelay, longPauseMs, retryPlan, sleep } from "../../scripts/deps/pace.mjs";

describe("PACE", () => {
  it("числа темпа соответствуют разделу 5 спецификации (docs/specs/tooling/deps-check.md)", () => {
    expect(PACE).toEqual({
      baseDelayMs: 500,
      jitterMs: 200,
      retryBaseMs: 2000,
      retryMaxMs: 60000,
      longPauseEvery: 50,
      longPauseMs: 5000,
    });
  });
});

describe("jitteredDelay", () => {
  it("добавляет к базовой паузе случайную часть разброса", () => {
    expect(jitteredDelay(500, () => 0)).toBe(500);
    expect(jitteredDelay(500, () => 0.5)).toBe(600);
  });

  it("округляет случайную добавку вниз до целых миллисекунд", () => {
    expect(jitteredDelay(500, () => 1 / 3)).toBe(566);
  });

  it("по умолчанию использует базу и разброс из PACE", () => {
    expect(jitteredDelay(undefined, () => 0)).toBe(500);
    expect(jitteredDelay(undefined, () => 0.999)).toBe(699);
  });
});

describe("retryPlan", () => {
  it("уважает Retry-After в секундах, если он не больше минуты", () => {
    expect(retryPlan(0, "3")).toEqual({ waitMs: 3000, stop: false, askedMs: 3000 });
  });

  it("на границе минуты не останавливает прогон", () => {
    expect(retryPlan(0, "60")).toEqual({ waitMs: 60000, stop: false, askedMs: 60000 });
  });

  it("останавливает прогон, если Retry-After просит больше минуты, а не спит минуту", () => {
    expect(retryPlan(0, "3600")).toEqual({ waitMs: 0, stop: true, askedMs: 3600000 });
  });

  it("удваивает выдержку без Retry-After", () => {
    expect(retryPlan(0, null)).toEqual({ waitMs: 2000, stop: false, askedMs: null });
    expect(retryPlan(1, null)).toEqual({ waitMs: 4000, stop: false, askedMs: null });
    expect(retryPlan(2, null)).toEqual({ waitMs: 8000, stop: false, askedMs: null });
  });

  it("экспоненциальная выдержка не превышает минуту", () => {
    expect(retryPlan(10, null)).toEqual({ waitMs: 60000, stop: false, askedMs: null });
  });

  it("разбирает Retry-After в форме HTTP-date, считая интервал от переданного now", () => {
    // 30 seconds before the asked-for date — well inside the minute cap.
    const now = Date.parse("Wed, 21 Oct 2026 07:27:30 GMT");
    expect(retryPlan(0, "Wed, 21 Oct 2026 07:28:00 GMT", now)).toEqual({
      waitMs: 30000,
      stop: false,
      askedMs: 30000,
    });
  });

  it("HTTP-date дальше минуты от now останавливает прогон, как и Retry-After в секундах", () => {
    // 10 minutes before the asked-for date.
    const now = Date.parse("Wed, 21 Oct 2026 07:18:00 GMT");
    expect(retryPlan(0, "Wed, 21 Oct 2026 07:28:00 GMT", now)).toEqual({
      waitMs: 0,
      stop: true,
      askedMs: 600000,
    });
  });

  it("HTTP-date в прошлом относительно now трактуется как отсутствие Retry-After", () => {
    // now is AFTER the asked-for date — the instruction has already expired.
    const now = Date.parse("Wed, 21 Oct 2026 08:00:00 GMT");
    expect(retryPlan(0, "Wed, 21 Oct 2026 07:28:00 GMT", now)).toEqual({
      waitMs: 2000,
      stop: false,
      askedMs: null,
    });
  });

  it("мусор вместо даты и вместо числа игнорируется как отсутствие Retry-After", () => {
    expect(retryPlan(0, "не дата и не число")).toEqual({
      waitMs: 2000,
      stop: false,
      askedMs: null,
    });
  });

  it("игнорирует Retry-After: 0 и отрицательные значения", () => {
    expect(retryPlan(0, "0")).toEqual({ waitMs: 2000, stop: false, askedMs: null });
    expect(retryPlan(0, "-5")).toEqual({ waitMs: 2000, stop: false, askedMs: null });
  });

  it("усекает дробный Retry-After до целых секунд", () => {
    expect(retryPlan(0, "2.9")).toEqual({ waitMs: 2000, stop: false, askedMs: 2000 });
  });

  it("игнорирует пустую строку и undefined как отсутствие Retry-After", () => {
    expect(retryPlan(1, "")).toEqual({ waitMs: 4000, stop: false, askedMs: null });
    expect(retryPlan(1, undefined)).toEqual({ waitMs: 4000, stop: false, askedMs: null });
  });

  it("отсекает отрицательный номер попытки, считая его нулевым", () => {
    expect(retryPlan(-1, null)).toEqual({ waitMs: 2000, stop: false, askedMs: null });
  });
});

describe("longPauseMs", () => {
  it("даёт передышку каждые пятьдесят запросов", () => {
    expect(longPauseMs(0)).toBe(0);
    expect(longPauseMs(49)).toBe(0);
    expect(longPauseMs(50)).toBe(5000);
    expect(longPauseMs(100)).toBe(5000);
  });
});

describe("sleep", () => {
  it("резолвится не раньше, чем пройдёт указанное время", async () => {
    vi.useFakeTimers();
    try {
      const resolved = vi.fn();
      sleep(1000).then(resolved);

      await vi.advanceTimersByTimeAsync(999);
      expect(resolved).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      expect(resolved).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
