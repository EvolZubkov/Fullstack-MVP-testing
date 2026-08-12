// shared/formula/__tests__/outcome-literals.test.ts
import { describe, it, expect } from "vitest";
import { collectStringLiterals, findUnknownOutcomes } from "../outcome-literals";

describe("collectStringLiterals", () => {
  it("собирает строковые константы формулы", () => {
    expect(collectStringLiterals('IF(scaleById("s").raw > 10, "high", "low")').sort())
      .toEqual(["high", "low"]);
  });

  it("не считает литералом ключ шкалы внутри scaleById", () => {
    // Ключ живёт в поле `arg` узла accessor, а не отдельным строковым узлом,
    // поэтому исключается структурно, а не списком имён функций.
    expect(collectStringLiterals('scaleById("emotional_exhaustion").raw > 10')).toEqual([]);
  });

  it("обходит вложенные ветви целиком", () => {
    const f = 'IF(percent >= 0, IF(percent > 50, "a", "b"), IF(percent > 20, "c", "d"))';
    expect(collectStringLiterals(f).sort()).toEqual(["a", "b", "c", "d"]);
  });

  it("схлопывает повторы", () => {
    expect(collectStringLiterals('IF(percent >= 0, "a", "a")')).toEqual(["a"]);
  });

  it("не падает на синтаксически неверной формуле", () => {
    expect(collectStringLiterals("IF(")).toEqual([]);
  });
});

describe("findUnknownOutcomes", () => {
  it("находит исход, которого нет в перечне", () => {
    expect(findUnknownOutcomes('IF(percent >= 0, "growing", "burnout")', ["growing"]))
      .toEqual(["burnout"]);
  });

  it("не считает ключ шкалы неизвестным исходом", () => {
    expect(findUnknownOutcomes('IF(scaleById("ee").raw > 10, "growing", "growing")', ["growing"]))
      .toEqual([]);
  });

  it("возвращает пустой список, когда перечень пуст", () => {
    expect(findUnknownOutcomes('IF(percent >= 0, "a", "b")', [])).toEqual([]);
  });

  it("ничего не находит, когда все коды объявлены", () => {
    expect(findUnknownOutcomes('IF(percent >= 0, "a", "b")', ["a", "b", "c"])).toEqual([]);
  });
});
