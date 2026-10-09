import { describe, it, expect } from "vitest";

import { simplifyExpression } from "../shared/answer-check/simplify";

describe("simplifyExpression — перевод выражения в обычное сравнение (FR-28p)", () => {
  it("переводит якоря, буквальные куски и «любое продолжение»", () => {
    expect(simplifyExpression(String.raw`^Федеральная служба по .* надзору$`)).toBe(
      "Федеральная служба по * надзору",
    );
  });

  it("одиночная точка становится знаком вопроса", () => {
    expect(simplifyExpression("^ГОСТ .....$")).toBe("ГОСТ ?????");
  });

  it("без якорей ответ может быть и длиннее: края открываются звёздочками", () => {
    expect(simplifyExpression("надзор")).toBe("*надзор*");
    expect(simplifyExpression("^надзор")).toBe("надзор*");
    expect(simplifyExpression("надзор$")).toBe("*надзор");
  });

  it("экранированные знаки остаются буквами", () => {
    expect(simplifyExpression(String.raw`^3\.14$`)).toBe("3.14");
  });

  it("отказывает там, где точного соответствия нет", () => {
    // Перечисление, набор символов, счётчик, ссылка на группу, классы — всё это в
    // обычном сравнении не выражается, а приблизительная замена засчитывала бы не то.
    expect(simplifyExpression("^(а|б)$")).toBeNull();
    expect(simplifyExpression("^[абв]+$")).toBeNull();
    expect(simplifyExpression("^а{2,4}$")).toBeNull();
    expect(simplifyExpression(String.raw`^(\w+) \1$`)).toBeNull();
    expect(simplifyExpression(String.raw`^\d+$`)).toBeNull();
  });

  it("«один и больше» тоже отказ, хотя перевод напрашивается", () => {
    // Звёздочка обычного сравнения принимает и пустое продолжение, а `.+` — нет.
    // Различие на глаз не видно, и замена начала бы засчитывать то, что не засчитывала.
    expect(simplifyExpression("^надзор .+$")).toBeNull();
  });

  it("буквальные звёздочка и вопрос — отказ: в обычном сравнении их не экранировать", () => {
    expect(simplifyExpression(String.raw`^2 \* 2$`)).toBeNull();
    expect(simplifyExpression(String.raw`^как\?$`)).toBeNull();
  });

  it("пустое выражение переводить не во что", () => {
    expect(simplifyExpression("")).toBeNull();
    expect(simplifyExpression("^$")).toBeNull();
  });
});
