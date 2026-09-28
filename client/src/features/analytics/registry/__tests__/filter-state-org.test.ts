/**
 * @module features/analytics/registry/__tests__/filter-state-org.test
 * @description Org-structure conditions of the registry filter (PRD-56 FR-06b,
 * org-structure plan task 5): they survive the round trip through the address,
 * read as names in the chips, come back from a saved slice and are counted.
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_FILTER,
  conditionsToFilter,
  countConditions,
  describeConditions,
  filterToSearch,
  isEmptyFilter,
  parseFilter,
} from "../filter-state";

const dictionaries = { tests: [], groups: [] };

describe("org conditions in the address", () => {
  it("round-trip without loss", () => {
    const filter = {
      ...EMPTY_FILTER,
      organizations: ["ООО «Альфа, Бета»"],
      units: ["Отдел продаж", "Логистика"],
      positions: ["Кладовщик"],
    };
    expect(parseFilter(filterToSearch(filter))).toEqual(filter);
  });

  it("are not split on commas: a comma belongs to an organisation's name", () => {
    const parsed = parseFilter(`?organization=${encodeURIComponent("ООО «Альфа, Бета»")}`);
    expect(parsed.organizations).toEqual(["ООО «Альфа, Бета»"]);
  });

  it("make the filter non-empty and are counted one per value", () => {
    const filter = { ...EMPTY_FILTER, units: ["Отдел продаж", "Логистика"] };
    expect(isEmptyFilter(filter)).toBe(false);
    expect(countConditions(filter)).toBe(2);
  });
});

describe("org conditions in words", () => {
  it("name each value in its own chip", () => {
    const chips = describeConditions(
      { ...EMPTY_FILTER, organizations: ["АО «Ромашка»"], units: ["Отдел продаж"], positions: ["Кладовщик"] },
      dictionaries,
    );
    expect(chips).toEqual([
      { id: "organization:АО «Ромашка»", label: "Организация: АО «Ромашка»" },
      { id: "unit:Отдел продаж", label: "Подразделение: Отдел продаж" },
      { id: "position:Кладовщик", label: "Должность: Кладовщик" },
    ]);
  });
});

describe("org conditions of a saved slice", () => {
  it("come back into the filter", () => {
    const filter = conditionsToFilter({ units: ["Отдел продаж", 42], positions: "не список" });
    expect(filter.units).toEqual(["Отдел продаж"]);
    expect(filter.positions).toEqual([]);
    expect(filter.organizations).toEqual([]);
  });
});
