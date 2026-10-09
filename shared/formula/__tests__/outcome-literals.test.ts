// shared/formula/__tests__/outcome-literals.test.ts
import { describe, it, expect } from "vitest";
import { collectStringLiterals, findUnknownOutcomes, readScaleGroup } from "../outcome-literals";

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

describe("readScaleGroup (PRD-53)", () => {
  it("возвращает ключи и порог шаблона профиля", () => {
    expect(readScaleGroup('topGroup(["cel","vdo","kom","pro"], 5).code')).toEqual({
      keys: ["cel", "vdo", "kom", "pro"],
      threshold: 5,
    });
  });

  it("долевой порог возвращается строкой — он и есть строка в источнике", () => {
    expect(readScaleGroup('topGroup(["a","b"], "10%").count')).toEqual({
      keys: ["a", "b"],
      threshold: "10%",
    });
  });

  // Форма шаблона пишет голый topGroup, но автор вправе переписать источник руками:
  // группа должна находиться и внутри выражения, иначе кнопки матрицы у него погаснут.
  it("находит группу внутри выражения", () => {
    expect(readScaleGroup('IF(topGroup(["a","b"], 0).count > 1, "many", "one")')).toEqual({
      keys: ["a", "b"],
      threshold: 0,
    });
  });

  it("формула без группы даёт null", () => {
    expect(readScaleGroup('scaleById("a").normalized')).toBeNull();
  });

  it("неразбираемая формула даёт null, а не исключение", () => {
    expect(readScaleGroup("topGroup([")).toBeNull();
  });
});
