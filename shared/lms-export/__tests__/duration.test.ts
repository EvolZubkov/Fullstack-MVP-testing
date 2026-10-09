/**
 * @module shared/lms-export/__tests__/duration
 * @description Формат времени на задании: `cmi.interactions.n.latency` (техдолг ROADMAP §0.3 —
 * колонка «Продолжительность (сек.)» в отчёте LMS была пуста всегда, потому что пакет время
 * показа вопроса не измерял вовсе).
 */
import { describe, it, expect } from "vitest";
import { formatScormDuration, parseExportSeconds } from "../duration";

describe("formatScormDuration", () => {
  it("секунды", () => {
    expect(formatScormDuration(7000)).toBe("PT7S");
  });

  it("минуты с секундами", () => {
    expect(formatScormDuration(95000)).toBe("PT1M35S");
  });

  it("часы, минуты и секунды", () => {
    expect(formatScormDuration(3725000)).toBe("PT1H2M5S");
  });

  it("нулевые разряды не печатаются, но сам ноль — печатается", () => {
    // «PT» без единого разряда стандарт не допускает, поэтому ноль пишется как «PT0S».
    expect(formatScormDuration(3600000)).toBe("PT1H");
    expect(formatScormDuration(0)).toBe("PT0S");
  });

  it("дробные секунды округляются вниз — отчёт читает целые", () => {
    expect(formatScormDuration(1999)).toBe("PT1S");
  });

  it("мусор и отрицательное время дают ноль, а не битую строку", () => {
    // Часы пользователя могут прыгнуть назад; латентность «минус три секунды» бессмысленна,
    // а ПОЛОМАННАЯ строка в cmi портит всю запись взаимодействия.
    expect(formatScormDuration(-5000)).toBe("PT0S");
    expect(formatScormDuration(Number.NaN)).toBe("PT0S");
    expect(formatScormDuration(undefined as unknown as number)).toBe("PT0S");
  });
});

describe("parseExportSeconds", () => {
  it("целые секунды из колонки выгрузки", () => {
    expect(parseExportSeconds("35")).toBe(35);
  });

  it("дробные секунды округляются до целых", () => {
    expect(parseExportSeconds("35,7")).toBe(36);
    expect(parseExportSeconds("35.4")).toBe(35);
  });

  it("пустая ячейка — это отсутствие измерения, а не ноль", () => {
    // Ноль означал бы «ответил мгновенно»; отсутствие означает «пакет не измерял».
    expect(parseExportSeconds("")).toBeNull();
    expect(parseExportSeconds("   ")).toBeNull();
    expect(parseExportSeconds("—")).toBeNull();
  });
});
