import { describe, it, expect } from "vitest";
import { parseNumericAnswer, matchNumber } from "../shared/answer-check/number";

describe("parseNumericAnswer", () => {
  it("принимает точку и запятую как разделитель", () => {
    expect(parseNumericAnswer("3.14")).toBe(3.14);
    expect(parseNumericAnswer("3,14")).toBe(3.14);
  });

  it("не замечает пробелов, включая неразрывный", () => {
    expect(parseNumericAnswer(" 3,14 ")).toBe(3.14);
    expect(parseNumericAnswer("1 000,5")).toBe(1000.5);
  });

  it("принимает отрицательные значения", () => {
    expect(parseNumericAnswer("-25")).toBe(-25);
    expect(parseNumericAnswer("−25")).toBe(-25);
  });

  it("возвращает null на том, что числом не является", () => {
    expect(parseNumericAnswer("")).toBeNull();
    expect(parseNumericAnswer("пять")).toBeNull();
    expect(parseNumericAnswer("3,14 кг")).toBeNull();
    expect(parseNumericAnswer(null)).toBeNull();
  });

  it("принимает обыкновенные дроби", () => {
    expect(parseNumericAnswer("1/3")).toBeCloseTo(1 / 3, 12);
    expect(parseNumericAnswer("-3/4")).toBe(-0.75);
  });

  it("принимает смешанные дроби", () => {
    expect(parseNumericAnswer("2 1/2")).toBe(2.5);
    expect(parseNumericAnswer("-2 1/2")).toBe(-2.5);
    // Неразрывный пробел приезжает вместе с ответом, скопированным из таблицы.
    expect(parseNumericAnswer("2 1/2")).toBe(2.5);
  });

  it("дробь и десятичная запись одного числа — один ответ", () => {
    expect(parseNumericAnswer("1/2")).toBe(parseNumericAnswer("0,5"));
    expect(parseNumericAnswer(".5")).toBe(parseNumericAnswer("0,5"));
  });

  it("принимает научную нотацию", () => {
    expect(parseNumericAnswer("3.14e0")).toBe(3.14);
    expect(parseNumericAnswer("1E-3")).toBe(0.001);
    expect(parseNumericAnswer("2,5e2")).toBe(250);
  });

  it("пробел между целой частью и дробью сильнее разделителя разрядов", () => {
    // 1 500 — полторы тысячи, 1 500/3 — одна целая и пятьсот третьих: отличает их
    // только то, что стоит справа от пробела (устройство Э5, §2).
    expect(parseNumericAnswer("1 500")).toBe(1500);
    expect(parseNumericAnswer("1 500/3")).toBeCloseTo(1 + 500 / 3, 12);
  });

  it("отвергает дробь с нулевым знаменателем и мусор вокруг числа", () => {
    expect(parseNumericAnswer("1/0")).toBeNull();
    expect(parseNumericAnswer("1/2/3")).toBeNull();
    expect(parseNumericAnswer("около трёх")).toBeNull();
  });
});

describe("matchNumber", () => {
  const rule = { kind: "number", op: "eq", value: 3.14, tolerance: { unit: "abs", value: 0.01 } } as const;

  it("зачитывает ответ внутри допуска в единицах", () => {
    expect(matchNumber(rule, 3.14)).toBe(true);
    expect(matchNumber(rule, 3.1416)).toBe(true);
    expect(matchNumber(rule, 3.15)).toBe(true);
    expect(matchNumber(rule, 3.2)).toBe(false);
  });

  it("зачитывает ответ внутри допуска в процентах", () => {
    // 5 % от 200 — это 10, то есть окно 190…210 включительно.
    const pct = { kind: "number", op: "eq", value: 200, tolerance: { unit: "pct", value: 5 } } as const;
    expect(matchNumber(pct, 189)).toBe(false);
    expect(matchNumber(pct, 190)).toBe(true);
    expect(matchNumber(pct, 195)).toBe(true);
    expect(matchNumber(pct, 210)).toBe(true);
    expect(matchNumber(pct, 211)).toBe(false);
  });

  it("процентный допуск от отрицательного эталона считается по модулю", () => {
    const pct = { kind: "number", op: "eq", value: -200, tolerance: { unit: "pct", value: 5 } } as const;
    expect(matchNumber(pct, -195)).toBe(true);
    expect(matchNumber(pct, -180)).toBe(false);
  });

  it("без допуска сравнивает точно", () => {
    const exact = { kind: "number", op: "eq", value: 7 } as const;
    expect(matchNumber(exact, 7)).toBe(true);
    expect(matchNumber(exact, 7.0001)).toBe(false);
  });

  it("«не равно» без допуска отвергает только само значение", () => {
    const ne = { kind: "number", op: "ne", value: 0 } as const;
    expect(matchNumber(ne, 0)).toBe(false);
    expect(matchNumber(ne, 0.1)).toBe(true);
    expect(matchNumber(ne, -5)).toBe(true);
  });

  it("«не равно» с допуском отвергает всё окно", () => {
    const ne = { kind: "number", op: "ne", value: 100, tolerance: { unit: "abs", value: 5 } } as const;
    expect(matchNumber(ne, 100)).toBe(false);
    expect(matchNumber(ne, 105)).toBe(false);
    expect(matchNumber(ne, 105.1)).toBe(true);
  });

  it("границы различают включённую и исключённую", () => {
    expect(matchNumber({ kind: "number", op: "gt", value: 0 }, 0)).toBe(false);
    expect(matchNumber({ kind: "number", op: "gt", value: 0 }, 0.1)).toBe(true);
    expect(matchNumber({ kind: "number", op: "gte", value: 0.5 }, 0.5)).toBe(true);
    expect(matchNumber({ kind: "number", op: "gte", value: 0.5 }, 0.49)).toBe(false);
    expect(matchNumber({ kind: "number", op: "lt", value: 100 }, 100)).toBe(false);
    expect(matchNumber({ kind: "number", op: "lt", value: 100 }, 99.9)).toBe(true);
    expect(matchNumber({ kind: "number", op: "lte", value: 100 }, 100)).toBe(true);
    expect(matchNumber({ kind: "number", op: "lte", value: 100 }, 100.1)).toBe(false);
  });

  it("допуск у границы не расширяет её", () => {
    // Допуск задаётся только для «равно» и «не равно» (§3 устройства); попавший в
    // хранилище от старой версии — не должен менять смысл границы.
    const gte = { kind: "number", op: "gte", value: 10, tolerance: { unit: "abs", value: 5 } } as const;
    expect(matchNumber(gte, 9.9)).toBe(false);
    expect(matchNumber(gte, 10)).toBe(true);
  });

  it("диапазон собирается двумя правилами — каждое считается само по себе", () => {
    const low = { kind: "number", op: "gte", value: 12 } as const;
    const high = { kind: "number", op: "lte", value: 15 } as const;
    expect(matchNumber(low, 13) && matchNumber(high, 13)).toBe(true);
    expect(matchNumber(low, 15) && matchNumber(high, 15)).toBe(true);
    expect(matchNumber(low, 11) && matchNumber(high, 11)).toBe(false);
    expect(matchNumber(low, 16) && matchNumber(high, 16)).toBe(false);
  });
});
