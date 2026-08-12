import { describe, it, expect } from "vitest";
import { achievableRange } from "../engine";
import type { MeasurementSpec, QuestionType } from "../engine";

/** Nine questions, six graduations each (0..5), weight 1 — the Maslach EE scale. */
function maslachEE(): MeasurementSpec[] {
  const out: MeasurementSpec[] = [];
  for (let q = 1; q <= 9; q += 1) {
    for (let v = 0; v <= 5; v += 1) {
      out.push({
        questionId: `q${q}`,
        scaleKey: "emotional_exhaustion",
        sourceType: "option",
        sourceKey: String(v),
        value: v,
        weight: 1,
      });
    }
  }
  return out;
}

/** Every question of the Maslach scale is a graduated `scale` question. */
function maslachTypes(): Record<string, QuestionType> {
  const types: Record<string, QuestionType> = {};
  for (let q = 1; q <= 9; q += 1) types[`q${q}`] = "scale";
  return types;
}

describe("achievableRange", () => {
  it("для sum складывает достижимые крайние значения каждого вопроса", () => {
    expect(achievableRange(maslachEE(), "sum", maslachTypes())).toEqual({ min: 0, max: 45 });
  });

  it("учитывает вес", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 2, weight: 3 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 1, weight: 3 },
    ];
    expect(achievableRange(m, "sum", { q1: "single" })).toEqual({ min: 0, max: 6 });
  });

  it("зажимает нижнюю границу нулём: одноиндексный вопрос может не выбрать измеряемый вариант", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 3, weight: 1 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 5, weight: 1 },
    ];
    expect(achievableRange(m, "sum", { q1: "single" })).toEqual({ min: 0, max: 5 });
  });

  it("для множественного выбора складывает вклады внутри вопроса", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: 2, weight: 1 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 3, weight: 1 },
    ];
    expect(achievableRange(m, "sum", { q1: "multiple" })).toEqual({ min: 0, max: 5 });
  });

  it("учитывает отрицательные вклады в нижней границе", () => {
    const m: MeasurementSpec[] = [
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "0", value: -2, weight: 1 },
      { questionId: "q1", scaleKey: "s", sourceType: "option", sourceKey: "1", value: 3, weight: 1 },
    ];
    expect(achievableRange(m, "sum", { q1: "single" })).toEqual({ min: -2, max: 3 });
  });

  it("для avg берёт границы одного вклада", () => {
    expect(achievableRange(maslachEE(), "avg", maslachTypes())).toEqual({ min: 0, max: 5 });
  });

  it("для max и min берёт границы множества вкладов", () => {
    expect(achievableRange(maslachEE(), "max", maslachTypes())).toEqual({ min: 0, max: 5 });
    expect(achievableRange(maslachEE(), "min", maslachTypes())).toEqual({ min: 0, max: 5 });
  });

  it("считает и weighted_avg", () => {
    expect(achievableRange(maslachEE(), "weighted_avg", maslachTypes())).toEqual({ min: 0, max: 5 });
  });

  it("возвращает null на пустом списке вкладов", () => {
    expect(achievableRange([], "sum", {})).toBeNull();
  });

  it("не зависит от порядка вкладов", () => {
    const straight = achievableRange(maslachEE(), "sum", maslachTypes());
    const reversed = achievableRange(maslachEE().reverse(), "sum", maslachTypes());
    expect(reversed).toEqual(straight);
  });
});
