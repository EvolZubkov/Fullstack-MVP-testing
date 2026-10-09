import { describe, it, expect } from "vitest";
import { thresholdPercentOf, applyBreakdownGate } from "../gate";
import type { BreakdownEntry } from "../types";

function entry(key: string, percentPoints: number): BreakdownEntry {
  return {
    scope: "section:s1", axis: "tag", key,
    items: 3, answered: 3, earned: percentPoints / 10, possible: 10,
    unitEarned: 0, unitPossible: 3,
    percentPoints, percentUnits: percentPoints,
  };
}

describe("thresholdPercentOf", () => {
  it("правило в процентах отдаёт своё значение", () => {
    expect(thresholdPercentOf({ type: "percent", value: 70 }, 40)).toBe(70);
  });

  it("правило в баллах переводится в долю от достижимого", () => {
    expect(thresholdPercentOf({ type: "count", value: 20 }, 40)).toBe(50);
  });

  it("правила нет — порога нет", () => {
    expect(thresholdPercentOf(null, 40)).toBeNull();
  });

  it("баллы без достижимого не переводятся", () => {
    expect(thresholdPercentOf({ type: "count", value: 20 }, 0)).toBeNull();
  });
});

describe("applyBreakdownGate", () => {
  it("штампует исход и порог, возвращает признак провала", () => {
    const rows = [entry("Право", 80), entry("Пожарная безопасность", 33)];
    const failed = applyBreakdownGate(rows, 70);
    expect(failed).toBe(true);
    expect(rows[0].passed).toBe(true);
    expect(rows[1].passed).toBe(false);
    expect(rows[1].thresholdPercent).toBe(70);
  });

  it("ровно порог — взята", () => {
    const rows = [entry("Право", 70)];
    expect(applyBreakdownGate(rows, 70)).toBe(false);
    expect(rows[0].passed).toBe(true);
  });

  it("порога нет — исход null, провала нет", () => {
    const rows = [entry("Право", 10)];
    expect(applyBreakdownGate(rows, null)).toBe(false);
    expect(rows[0].passed).toBeNull();
    expect(rows[0].thresholdPercent).toBeNull();
  });
});
