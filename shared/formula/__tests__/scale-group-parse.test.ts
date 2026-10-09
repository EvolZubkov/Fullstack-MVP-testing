import { describe, expect, it } from "vitest";
import { parse } from "../parser";
import { FormulaSyntaxError } from "../types";

describe("разбор topGroup", () => {
  it("читает список ключей, числовой порог и свойство", () => {
    expect(parse('topGroup(["cel","pro"], 5).code')).toEqual({
      type: "scaleGroup",
      keys: ["cel", "pro"],
      threshold: 5,
      prop: "code",
    });
  });

  it("читает долевой порог строкой", () => {
    expect(parse('topGroup(["cel","pro"], "10%").count')).toEqual({
      type: "scaleGroup",
      keys: ["cel", "pro"],
      threshold: "10%",
      prop: "count",
    });
  });

  it("знает свойство max", () => {
    expect(parse('topGroup(["cel","pro"], 5).max').type).toBe("scaleGroup");
  });

  it("отвергает неизвестное свойство", () => {
    expect(() => parse('topGroup(["cel"], 5).label')).toThrow(FormulaSyntaxError);
  });

  it("отвергает порог, который не число и не строка", () => {
    expect(() => parse('topGroup(["cel"], percent).code')).toThrow(FormulaSyntaxError);
  });

  it("работает внутри выражения", () => {
    const ast = parse('IF(topGroup(["cel","pro"], 5).count > 1, "набор", "один")');
    expect(ast.type).toBe("if");
  });
});
