import { describe, expect, it } from "vitest";
import { groupCode, parseGroupThreshold, resolveTopGroup, subsetCodes } from "../scale-group";
import type { ScaleResult } from "../types";

const ORDER = ["cel", "vdo", "kom", "pro"];

function scales(raw: Record<string, number | null>): Record<string, ScaleResult> {
  return Object.fromEntries(
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
}

describe("parseGroupThreshold", () => {
  it("читает абсолютный порог числом", () => {
    expect(parseGroupThreshold(5)).toEqual({ kind: "abs", value: 5 });
  });

  it("читает долю строкой «N%»", () => {
    expect(parseGroupThreshold("10%")).toEqual({ kind: "pct", value: 10 });
  });

  it("отвергает отрицательный порог и мусор", () => {
    expect(parseGroupThreshold(-1)).toBeNull();
    expect(parseGroupThreshold("десять")).toBeNull();
    expect(parseGroupThreshold("10")).toBeNull();
  });
});

describe("resolveTopGroup", () => {
  const values = scales({ cel: 42, vdo: 7, kom: 7, pro: 42 });

  it("контрольный случай книги ЧИЛ: 42/7/7/42 при Δ=5 даёт cel+pro", () => {
    expect(resolveTopGroup(ORDER, values, ORDER, { kind: "abs", value: 5 })).toEqual({
      code: "cel+pro",
      count: 2,
      max: 42,
    });
  });

  it("граница включается: отставание ровно на Δ — в зоне, на Δ+1 — нет", () => {
    const v = scales({ cel: 30, vdo: 25, kom: 24, pro: 19 });
    expect(resolveTopGroup(ORDER, v, ORDER, { kind: "abs", value: 5 }).code).toBe("cel+vdo");
  });

  it("код набора всегда в авторском порядке, а не в порядке аргумента", () => {
    const got = resolveTopGroup(["pro", "kom", "vdo", "cel"], values, ORDER, { kind: "abs", value: 5 });
    expect(got.code).toBe("cel+pro");
  });

  it("шкала без значения не участвует ни в максимуме, ни в наборе", () => {
    const v = scales({ cel: 10, vdo: null, kom: 8, pro: 1 });
    expect(resolveTopGroup(ORDER, v, ORDER, { kind: "abs", value: 5 })).toEqual({
      code: "cel+kom",
      count: 2,
      max: 10,
    });
  });

  it("пустая группа не выдумывает набор", () => {
    expect(resolveTopGroup(["vdo"], scales({ vdo: null }), ORDER, { kind: "abs", value: 5 })).toEqual({
      code: "",
      count: 0,
      max: 0,
    });
  });

  it("долевой порог считается от максимума по группе", () => {
    // max = 42, 10% = 4.2 → порог 37.8: cel и pro внутри, vdo и kom нет.
    expect(resolveTopGroup(ORDER, values, ORDER, { kind: "pct", value: 10 }).code).toBe("cel+pro");
  });

  it("ключ, повторённый в группе, не занимает два места", () => {
    expect(resolveTopGroup(["cel", "cel", "pro"], values, ORDER, { kind: "abs", value: 5 }).count).toBe(2);
  });
});

describe("groupCode / subsetCodes", () => {
  it("канонизирует произвольный порядок ключей", () => {
    expect(groupCode(["pro", "cel"], ORDER)).toBe("cel+pro");
  });

  it("перечисляет все непустые подмножества по возрастанию размера", () => {
    const codes = subsetCodes(["cel", "vdo"], ORDER);
    expect(codes).toEqual(["cel", "vdo", "cel+vdo"]);
  });

  it("для четырёх шкал даёт ровно пятнадцать наборов", () => {
    expect(subsetCodes(ORDER, ORDER)).toHaveLength(15);
  });

  it("отказывается перечислять слишком большую группу", () => {
    const many = Array.from({ length: 13 }, (_, i) => `s${i}`);
    expect(subsetCodes(many, many)).toEqual([]);
  });
});
