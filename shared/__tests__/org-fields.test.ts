/**
 * @module shared/__tests__/org-fields.test
 * @description Normalisation and folding of org-structure values (plan Р-4):
 * one engine for the profile form, the users list, the import and the analytics
 * axes, so «ОТДЕЛ ПРОДАЖ» from an LMS export and «Отдел продаж» from a profile
 * land in the same slice everywhere.
 */
import { describe, it, expect } from "vitest";
import { normalizeOrgValue, orgValueKey, foldOrgValues } from "../org-fields";

describe("normalizeOrgValue", () => {
  it("trims the edges and collapses inner runs of whitespace", () => {
    expect(normalizeOrgValue("  Отдел   продаж \t")).toBe("Отдел продаж");
    expect(normalizeOrgValue("Отдел продаж")).toBe("Отдел продаж");
  });

  it("keeps the case as typed: the value is shown to people as entered", () => {
    expect(normalizeOrgValue("ОТДЕЛ Продаж")).toBe("ОТДЕЛ Продаж");
  });

  it("turns an empty or missing value into null, never an empty string", () => {
    expect(normalizeOrgValue("   ")).toBeNull();
    expect(normalizeOrgValue("")).toBeNull();
    expect(normalizeOrgValue(null)).toBeNull();
    expect(normalizeOrgValue(undefined)).toBeNull();
  });
});

describe("orgValueKey", () => {
  it("ignores case and extra whitespace", () => {
    expect(orgValueKey("ОТДЕЛ  ПРОДАЖ ")).toBe(orgValueKey("Отдел продаж"));
  });

  it("has no key for an empty value", () => {
    expect(orgValueKey(" ")).toBeNull();
  });
});

describe("foldOrgValues", () => {
  it("merges spellings of one value and labels the group with the most frequent one", () => {
    const folded = foldOrgValues([
      { value: "Отдел продаж", users: 14, attempts: 0 },
      { value: "ОТДЕЛ ПРОДАЖ", users: 0, attempts: 212 },
      { value: "отдел продаж ", users: 1, attempts: 0 },
    ]);
    expect(folded).toEqual([{ value: "ОТДЕЛ ПРОДАЖ", users: 15, attempts: 212 }]);
  });

  it("keeps distinct values apart and orders them alphabetically", () => {
    const folded = foldOrgValues([
      { value: "Логистика", users: 3, attempts: 10 },
      { value: "Бухгалтерия", users: 2, attempts: 0 },
    ]);
    expect(folded.map(v => v.value)).toEqual(["Бухгалтерия", "Логистика"]);
  });

  it("drops empty values: «not set» is a separate slice, not a value to choose", () => {
    expect(foldOrgValues([{ value: "  ", users: 5, attempts: 5 }])).toEqual([]);
  });
});
