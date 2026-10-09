import { describe, it, expect } from "vitest";
import { collectBreakdownFeedback } from "../feedback";
import type { BreakdownEntry } from "../types";

function entry(key: string, passed: boolean | null): BreakdownEntry {
  return {
    scope: "section:s1", axis: "tag", key,
    items: 2, answered: 2, earned: 1, possible: 2,
    unitEarned: 1, unitPossible: 2,
    percentPoints: 50, percentUnits: 50,
    passed,
  };
}

describe("collectBreakdownFeedback", () => {
  it("отдаёт текст непройденной подтемы", () => {
    const out = collectBreakdownFeedback([
      { breakdown: [entry("Право", false)], breakdownFeedback: { "Право": "учить" } },
    ]);
    expect(out).toEqual(["учить"]);
  });

  it("молчит о пройденной подтеме", () => {
    const out = collectBreakdownFeedback([
      { breakdown: [entry("Право", true)], breakdownFeedback: { "Право": "учить" } },
    ]);
    expect(out).toEqual([]);
  });

  it("молчит, когда порога нет (исход null)", () => {
    const out = collectBreakdownFeedback([
      { breakdown: [entry("Право", null)], breakdownFeedback: { "Право": "учить" } },
    ]);
    expect(out).toEqual([]);
  });

  it("подтема без написанного текста ничего не даёт", () => {
    const out = collectBreakdownFeedback([
      { breakdown: [entry("Право", false)], breakdownFeedback: { "Охрана труда": "учить" } },
    ]);
    expect(out).toEqual([]);
  });
});
