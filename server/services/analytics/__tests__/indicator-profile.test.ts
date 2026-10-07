/**
 * @module server/services/analytics/__tests__/indicator-profile.test
 * @description PRD-56 FR-21c - FR-21e: the profile of a test's indicators.
 */
import { describe, expect, it } from "vitest";

import { CATEGORICAL_HUES } from "@shared/template/categorical-palette";
import { LEVEL_SCHEMES, zoneColors } from "@shared/template/level-ramp";
import { summariseIndicators } from "../indicator-profile";

const ramp = LEVEL_SCHEMES.traffic;

/** Numeric indicator with three bands, «higher is better». */
const INDEX = {
  name: "idx",
  label: "Индекс человекоцентричности",
  type: "number",
  sortOrder: 1,
  configJson: {
    domainMin: 0,
    domainMax: 100,
    valence: "higher_is_better",
    bands: [
      { min: 0, max: 39, level: "dev", label: "Зона развития" },
      { min: 40, max: 69, level: "base", label: "Базовый" },
      { min: 70, max: 100, level: "strong", label: "Сильная сторона" },
    ],
  },
};

/** Numeric indicator without bands. */
const SPREAD = { name: "spread", label: "Разброс стилей", type: "number", sortOrder: 2, configJson: { domainMin: 0, domainMax: 28 } };

/** String indicator with outcomes; one of them carries an author's tone. */
const STYLE = {
  name: "style",
  label: "Ведущий стиль",
  type: "string",
  sortOrder: 3,
  configJson: {
    outcomes: [
      { code: "kom", label: "Командный" },
      { code: "vdh", label: "Вдохновляющий", tone: "favorable" },
      { code: "cel", label: "Целеустремлённый" },
    ],
  },
};

/** Boolean indicator without outcomes. */
const RESERVE = { name: "reserve", label: "", type: "boolean", sortOrder: 4, configJson: {} };

const rows = (...list: Array<Record<string, unknown>>) =>
  list.map((values, i) => ({ attemptId: `a${i}`, source: "web" as const, values }));

describe("summariseIndicators — numeric with bands", () => {
  it("averages web numbers and LMS strings alike and splits them by band", () => {
    const [profile] = summariseIndicators(
      [...rows({ idx: 30 }, { idx: 50 }), { attemptId: "l1", source: "import" as const, values: { idx: "70" } }],
      [INDEX],
      { ramp },
    );

    const colors = zoneColors(ramp, 3, "higher_is_better");
    expect(profile).toMatchObject({
      name: "idx",
      kind: "bands",
      type: "number",
      average: 50,
      sampleSize: 3,
      missing: 0,
      domainMin: 0,
      domainMax: 100,
    });
    expect(profile.shares.map(s => [s.key, s.label, s.count, Math.round(s.share), s.color])).toEqual([
      ["dev", "Зона развития", 1, 33, `hsl(${colors[0]})`],
      ["base", "Базовый", 1, 33, `hsl(${colors[1]})`],
      ["strong", "Сильная сторона", 1, 33, `hsl(${colors[2]})`],
    ]);
  });

  it("drops bands no run fell into, like empty outcomes", () => {
    // A real ЧИЛ indicator carries fifteen bands; a legend of fifteen mostly-zero items says nothing.
    const [profile] = summariseIndicators(rows({ idx: 80 }, { idx: 90 }), [INDEX], { ramp });

    expect(profile.shares.map(s => s.key)).toEqual(["strong"]);
  });

  it("counts the runs of the selection without a value as missing, not as zero", () => {
    const [profile] = summariseIndicators(rows({ idx: 60 }, {}, { idx: "" }), [INDEX], { ramp });

    expect(profile).toMatchObject({ average: 60, sampleSize: 1, missing: 2 });
  });

  it("invents no average and no shares when no run holds a value", () => {
    const [profile] = summariseIndicators(rows({}, {}), [INDEX], { ramp });

    expect(profile).toMatchObject({ average: null, sampleSize: 0, missing: 2, shares: [] });
  });
});

describe("summariseIndicators — numeric without bands", () => {
  it("gives the average only", () => {
    const [profile] = summariseIndicators(rows({ spread: 6 }, { spread: "8" }), [SPREAD], { ramp });

    expect(profile).toMatchObject({ kind: "average", average: 7, sampleSize: 2, domainMax: 28, shares: [] });
  });
});

describe("summariseIndicators — outcomes", () => {
  it("counts outcomes in the author's order, drops empty ones and puts the rest last", () => {
    const [profile] = summariseIndicators(
      rows({ style: "vdh" }, { style: "kom" }, { style: "kom" }, { style: "zzz" }),
      [STYLE],
      { ramp },
    );

    expect(profile).toMatchObject({ kind: "outcomes", average: null, sampleSize: 4 });
    expect(profile.shares.map(s => [s.key, s.label, s.count, s.share])).toEqual([
      ["kom", "Командный", 2, 50],
      ["vdh", "Вдохновляющий", 1, 25],
      ["__rest__", "Прочее", 1, 25],
    ]);
  });

  it("paints a toned outcome by its tone, the others by the categorical palette, the rest grey", () => {
    const [profile] = summariseIndicators(
      rows({ style: "kom" }, { style: "vdh" }, { style: "cel" }, { style: "zzz" }),
      [STYLE],
      { ramp },
    );

    const color = (key: string) => profile.shares.find(s => s.key === key)!;
    expect(color("kom")).toMatchObject({ color: `hsl(${CATEGORICAL_HUES[0]})`, tone: null });
    expect(color("vdh")).toMatchObject({ color: "var(--ou-success-default)", tone: "favorable" });
    expect(color("cel")).toMatchObject({ color: `hsl(${CATEGORICAL_HUES[2]})`, tone: null });
    expect(color("__rest__")).toMatchObject({ color: "var(--ou-border-strong)", rest: true });
  });

  it("groups by the value itself when the author defined no outcomes", () => {
    const [profile] = summariseIndicators(
      rows({ reserve: true }, { reserve: "true" }, { reserve: false }),
      [RESERVE],
      { ramp },
    );

    expect(profile.label).toBe("reserve");
    expect(profile.shares.map(s => [s.label, s.count])).toEqual([["Да", 2], ["Нет", 1]]);
  });

  it("keeps at most six value groups and folds the tail into the rest", () => {
    const plain = { name: "word", label: "Слово", type: "string", sortOrder: 5, configJson: {} };
    const values = ["a", "a", "b", "c", "d", "e", "f", "g", "h"].map(word => ({ word }));

    const [profile] = summariseIndicators(rows(...values), [plain], { ramp });

    expect(profile.shares).toHaveLength(7);
    expect(profile.shares[0]).toMatchObject({ label: "a", count: 2 });
    expect(profile.shares[6]).toMatchObject({ label: "Прочее", count: 2, rest: true });
  });
});

describe("summariseIndicators — order", () => {
  it("follows the author's order of indicators", () => {
    const profiles = summariseIndicators([], [RESERVE, STYLE, INDEX, SPREAD], { ramp });

    expect(profiles.map(p => p.name)).toEqual(["idx", "spread", "style", "reserve"]);
  });
});
