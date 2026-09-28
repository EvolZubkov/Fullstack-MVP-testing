/**
 * @module server/services/analytics/__tests__/slice-axis-org.test
 * @description Org-structure axes of the slices (PRD-56 FR-06b, OQ-04):
 * organisation, unit, position. One slice per value whatever its spelling,
 * labelled with the most frequent spelling; «Не указано» for passages without a
 * value; and the registry conditions that open exactly the slice's passages.
 */
import { describe, it, expect } from "vitest";
import type { Observation } from "../observations";
import { NONE, registryConditions, splitByAxis, type AxisContext } from "../slice-axis";

function observation(id: string, over: Partial<Observation> = {}): Observation {
  return {
    id, source: "web", testId: "test1", userId: id, participant: id, participantKey: null,
    participantId: id, groupId: null,
    startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
    durationMs: 1, percent: 80, passed: true, earnedPoints: 8, possiblePoints: 10,
    outcome: "passed", adaptive: false, snapshotId: null, forms: {},
    organization: null, unit: null, position: null,
    ...over,
  };
}

const context: AxisContext = {
  groupsOfParticipant: new Map(),
  groupNames: new Map(),
  externalParticipants: new Set(),
  snapshotVersions: new Map(),
  formLabels: new Map(),
};

describe("org axes", () => {
  it("fold spellings of one unit into one slice named by the most frequent spelling", () => {
    const buckets = splitByAxis([
      observation("a", { unit: "Отдел продаж" }),
      observation("b", { unit: "ОТДЕЛ ПРОДАЖ" }),
      observation("c", { unit: "ОТДЕЛ ПРОДАЖ" }),
      observation("d", { unit: "Логистика" }),
    ], "unit", context);

    const sales = buckets.find(b => b.observations.length === 3)!;
    expect(sales.label).toBe("ОТДЕЛ ПРОДАЖ");
    expect(sales.observations.map(o => o.id).sort()).toEqual(["a", "b", "c"]);
    expect(buckets.find(b => b.label === "Логистика")?.observations).toHaveLength(1);
  });

  it("put passages without a value into «Не указано»", () => {
    const buckets = splitByAxis([observation("a"), observation("b", { position: "Кладовщик" })], "position", context);
    const none = buckets.find(b => b.key === NONE)!;
    expect(none.label).toBe("Не указана");
    expect(none.observations.map(o => o.id)).toEqual(["a"]);
  });

  it("split by organisation", () => {
    const buckets = splitByAxis([
      observation("a", { organization: "АО «Ромашка»" }),
      observation("b", { organization: "ООО «Партнёр»" }),
    ], "organization", context);
    expect(buckets.map(b => b.label).sort()).toEqual(["АО «Ромашка»", "ООО «Партнёр»"]);
  });

  it("key a slice by its label, so the registry condition reads as a name", () => {
    const [bucket] = splitByAxis([observation("a", { unit: "Логистика" })], "unit", context);
    expect(bucket.key).toBe("Логистика");
    expect(registryConditions("unit", bucket.key)).toEqual({ units: ["Логистика"] });
    expect(registryConditions("organization", "АО")).toEqual({ organizations: ["АО"] });
    expect(registryConditions("position", "Кладовщик")).toEqual({ positions: ["Кладовщик"] });
  });

  it("give «Не указано» no registry condition: the registry selects by values, not by their absence", () => {
    expect(registryConditions("unit", NONE)).toEqual({});
  });
});
