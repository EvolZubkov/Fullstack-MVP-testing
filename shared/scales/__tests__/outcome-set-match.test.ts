import { describe, expect, it } from "vitest";
import { findOutcome, type InterpretationOutcome } from "../interpretation";

const outcomes: InterpretationOutcome[] = [
  { code: "cel", label: "Сфокусированный: Целеустремленный" },
  { code: "cel+pro", label: "Двухвекторный: Целеустремленный и Процессный" },
  { code: "count:3", label: "Широкий профиль" },
];

describe("findOutcome и наборы", () => {
  it("находит по точному коду", () => {
    expect(findOutcome(outcomes, "cel+pro")?.label).toContain("Двухвекторный");
  });

  it("находит независимо от порядка ключей в наборе", () => {
    expect(findOutcome(outcomes, "pro+cel")?.code).toBe("cel+pro");
  });

  it("падает на запасной исход по размеру набора", () => {
    expect(findOutcome(outcomes, "cel+vdo+kom")?.code).toBe("count:3");
  });

  it("точный код важнее запасного", () => {
    const withBoth = [...outcomes, { code: "count:2", label: "Любой двухвекторный" }];
    expect(findOutcome(withBoth, "cel+pro")?.code).toBe("cel+pro");
  });

  it("одиночный код по-прежнему сравнивается точно", () => {
    expect(findOutcome(outcomes, "cel")?.code).toBe("cel");
    expect(findOutcome(outcomes, "vdo")).toBeNull();
  });

  it("пустое и отсутствующее значение исхода не находят", () => {
    expect(findOutcome(outcomes, "")).toBeNull();
    expect(findOutcome(outcomes, null)).toBeNull();
    expect(findOutcome(outcomes, undefined)).toBeNull();
  });
});
