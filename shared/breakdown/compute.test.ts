/**
 * @module shared/breakdown/compute.test
 * @description PRD-50 FR-01 - FR-05: the single breakdown algorithm both hosts call.
 */
import { describe, it, expect } from "vitest";
import { computeBreakdowns, TEST_SCOPE, sectionScope } from "./compute";
import type { BreakdownItem } from "./types";

const item = (sectionId: string, tags: string[] | null, earned: number, possible: number): BreakdownItem => ({
  sectionId,
  axisKeys: tags ? { tag: tags } : null,
  earned,
  possible,
  answered: true,
});

describe("computeBreakdowns", () => {
  it("даёт запись в области раздела и в области теста", () => {
    const out = computeBreakdowns([item("law", ["ПДн"], 1, 2)]);
    expect(out).toEqual([
      { scope: sectionScope("law"), axis: "tag", key: "ПДн", items: 1, answered: 1,
        earned: 1, possible: 2, unitEarned: 0.5, unitPossible: 1,
        percentPoints: 50, percentUnits: 50 },
      { scope: TEST_SCOPE, axis: "tag", key: "ПДн", items: 1, answered: 1,
        earned: 1, possible: 2, unitEarned: 0.5, unitPossible: 1,
        percentPoints: 50, percentUnits: 50 },
    ]);
  });

  it("не берёт вопрос без возможных баллов (FR-02)", () => {
    expect(computeBreakdowns([item("law", ["ПДн"], 0, 0)])).toEqual([]);
  });

  it("не берёт вопрос без ключей", () => {
    expect(computeBreakdowns([item("law", null, 1, 1)])).toEqual([]);
  });

  it("тег в двух разделах даёт три записи (FR-04)", () => {
    const out = computeBreakdowns([item("law", ["ПДн"], 1, 1), item("sec", ["ПДн"], 0, 1)]);
    expect(out.map((e) => e.scope)).toEqual([sectionScope("law"), TEST_SCOPE, sectionScope("sec")]);
    const test = out.find((e) => e.scope === TEST_SCOPE)!;
    expect(test).toMatchObject({ items: 2, earned: 1, possible: 2, unitEarned: 1, percentUnits: 50 });
  });

  it("повторённый ключ одного вопроса считается один раз", () => {
    const out = computeBreakdowns([item("law", ["ПДн", "ПДн"], 1, 1)]);
    expect(out[0].items).toBe(1);
  });

  it("балльная и нормированная базы расходятся при разной цене вопросов", () => {
    const out = computeBreakdowns([item("law", ["ПДн"], 3, 3), item("law", ["ПДн"], 0, 1)]);
    const sec = out[0];
    expect(sec.percentPoints).toBe(75);
    expect(sec.percentUnits).toBe(50);
  });
});
