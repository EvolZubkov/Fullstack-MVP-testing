import { describe, it, expect } from "vitest";
import { normalizeForCompare } from "../shared/answer-check/normalize";

describe("normalizeForCompare", () => {
  it("снимает регистр", () => {
    expect(normalizeForCompare("Ростехнадзор")).toBe("ростехнадзор");
  });

  it("сводит ё к е", () => {
    expect(normalizeForCompare("Ёлка приёма")).toBe("елка приема");
  });

  it("схлопывает повторные пробелы и обрезает края", () => {
    expect(normalizeForCompare("  два   слова  ")).toBe("два слова");
  });

  it("сводит неразрывный пробел к обычному", () => {
    expect(normalizeForCompare("10 кг")).toBe("10 кг");
  });

  it("сводит виды дефисов к одному", () => {
    expect(normalizeForCompare("что—то")).toBe("что-то");
    expect(normalizeForCompare("минус − 5")).toBe("минус - 5");
  });

  it("сводит виды кавычек к прямым", () => {
    expect(normalizeForCompare("«Роса»")).toBe('"роса"');
    expect(normalizeForCompare("“роса”")).toBe('"роса"');
    expect(normalizeForCompare("‘роса’")).toBe("'роса'");
  });

  it("не падает на пустом и на не-строке", () => {
    expect(normalizeForCompare("")).toBe("");
    expect(normalizeForCompare(null)).toBe("");
    expect(normalizeForCompare(undefined)).toBe("");
  });

  it("идемпотентна", () => {
    const once = normalizeForCompare("  Ёлка — «Роса»  ");
    expect(normalizeForCompare(once)).toBe(once);
  });
});
