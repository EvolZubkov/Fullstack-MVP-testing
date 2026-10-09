import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluator";
import { parse } from "../parser";
import type { EvalContext, ScaleResult } from "../types";

function ctx(raw: Record<string, number | null>): EvalContext {
  const scales: Record<string, ScaleResult> = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      {
        raw: value ?? 0,
        normalized: value ?? 0,
        percent: 0,
        level: "",
        label: "",
        hasValue: value !== null,
      },
    ]),
  );
  return {
    percent: 0,
    score: 0,
    topics: {},
    tags: {},
    scales,
    scaleOrder: Object.keys(scales),
    sections: {},
    vars: {},
  };
}

const run = (formula: string, raw: Record<string, number | null>) => evaluate(parse(formula), ctx(raw));
const CHIL = { cel: 42, vdo: 7, kom: 7, pro: 42 };

describe("вычисление topGroup", () => {
  it("отдаёт код набора", () => {
    expect(run('topGroup(["cel","vdo","kom","pro"], 5).code', CHIL)).toBe("cel+pro");
  });

  it("отдаёт размер набора и максимум", () => {
    expect(run('topGroup(["cel","vdo","kom","pro"], 5).count', CHIL)).toBe(2);
    expect(run('topGroup(["cel","vdo","kom","pro"], 5).max', CHIL)).toBe(42);
  });

  it("пустой группе отдаёт пустой код и нули, а не null", () => {
    expect(run('topGroup(["vdo"], 5).code', { vdo: null })).toBe("");
    expect(run('topGroup(["vdo"], 5).count', { vdo: null })).toBe(0);
  });

  it("непонятный порог даёт null и не бросает исключение", () => {
    expect(run('topGroup(["cel","pro"], "десять").code', CHIL)).toBeNull();
  });

  it("сравнивается со строкой в IF", () => {
    const formula = 'IF(topGroup(["cel","vdo","kom","pro"], 5).code = "cel+pro", "да", "нет")';
    expect(run(formula, CHIL)).toBe("да");
  });
});
