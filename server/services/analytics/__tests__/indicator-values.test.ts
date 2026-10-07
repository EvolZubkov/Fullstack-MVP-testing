/**
 * @module server/services/analytics/__tests__/indicator-values.test
 * @description PRD-56 FR-21e: a stored indicator value is read in the indicator's own type.
 *
 * The web stores native values, the package and the LMS export store strings. Analytics must
 * read both the same way, or one source would average «64» and the other would not count it.
 */
import { describe, expect, it } from "vitest";

import { indicatorValueOf, indicatorValuesOf, matchOutcome } from "../indicator-values";

describe("indicatorValueOf", () => {
  it("reads a number from a native number and from a string with either decimal mark", () => {
    expect(indicatorValueOf("number", 7)).toBe(7);
    expect(indicatorValueOf("number", "64")).toBe(64);
    expect(indicatorValueOf("number", "3.5")).toBe(3.5);
    expect(indicatorValueOf("number", "3,5")).toBe(3.5);
  });

  it("refuses what is not a number for a numeric indicator", () => {
    expect(indicatorValueOf("number", "abc")).toBeNull();
    expect(indicatorValueOf("number", "  ")).toBeNull();
    expect(indicatorValueOf("number", true)).toBeNull();
    expect(indicatorValueOf("number", Number.NaN)).toBeNull();
  });

  it("reads a boolean from a native boolean and from its string forms", () => {
    expect(indicatorValueOf("boolean", false)).toBe(false);
    expect(indicatorValueOf("boolean", "true")).toBe(true);
    expect(indicatorValueOf("boolean", "FALSE")).toBe(false);
    expect(indicatorValueOf("boolean", "1")).toBe(true);
    expect(indicatorValueOf("boolean", "0")).toBe(false);
    expect(indicatorValueOf("boolean", "maybe")).toBeNull();
  });

  it("keeps a string indicator as text", () => {
    expect(indicatorValueOf("string", "kom+vdh")).toBe("kom+vdh");
    expect(indicatorValueOf("string", 3)).toBe("3");
  });

  it("treats an absent or empty value as no value for every type", () => {
    for (const type of ["number", "boolean", "string"]) {
      expect(indicatorValueOf(type, null)).toBeNull();
      expect(indicatorValueOf(type, undefined)).toBeNull();
      expect(indicatorValueOf(type, "")).toBeNull();
    }
  });
});

describe("indicatorValuesOf", () => {
  const variables = [
    { name: "idx", type: "number" },
    { name: "style", type: "string" },
    { name: "reserve", type: "boolean" },
  ];

  it("normalises every known indicator and drops the ones without a value", () => {
    expect(indicatorValuesOf(variables, { idx: "64", style: "kom", reserve: "" })).toEqual({
      idx: 64,
      style: "kom",
    });
  });

  it("ignores keys the test does not define and survives a missing record", () => {
    expect(indicatorValuesOf(variables, { other: 1 })).toEqual({});
    expect(indicatorValuesOf(variables, null)).toEqual({});
    expect(indicatorValuesOf(variables, undefined)).toEqual({});
  });
});

describe("matchOutcome", () => {
  const outcomes = [
    { code: "cel", label: "Сфокусированный" },
    { code: "cel+kom", label: "Двухвекторный" },
    { code: "ok", label: "Готово к работе" },
  ];

  it("finds a set code that the WebTutor report wrote with spaces instead of «+»", () => {
    // The package reports «cel+kom»; the LMS report export holds «cel kom» (live data, 2026-10-08).
    expect(matchOutcome(outcomes, "cel kom")?.code).toBe("cel+kom");
    expect(matchOutcome(outcomes, "kom  cel")?.code).toBe("cel+kom");
  });

  it("tries the value as it is first", () => {
    expect(matchOutcome(outcomes, "cel")?.code).toBe("cel");
    expect(matchOutcome([{ code: "a b", label: "С пробелом" }, { code: "a+b", label: "Набор" }], "a b")?.label)
      .toBe("С пробелом");
  });

  it("leaves a text without a matching outcome unmatched", () => {
    expect(matchOutcome(outcomes, "совсем другое")).toBeNull();
    expect(matchOutcome(outcomes, null)).toBeNull();
  });
});
