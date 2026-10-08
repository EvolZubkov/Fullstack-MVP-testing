/**
 * @module server/services/analytics/__tests__/indicator-profile.test
 * @description PRD-56 FR-21c - FR-21e: the profile of a test's indicators.
 */
import { describe, expect, it } from "vitest";

import { LEVEL_SCHEMES, zoneColors } from "@shared/template/level-ramp";
import { indicatorRanges, summariseIndicators } from "../indicator-profile";

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

  it("bands the author labelled alike become one row", () => {
    const alike = {
      ...INDEX,
      configJson: {
        ...INDEX.configJson,
        bands: [
          { min: 0, max: 39, level: "a", label: "Другие стили" },
          { min: 40, max: 69, level: "b", label: "Другие стили" },
          { min: 70, max: 100, level: "c", label: "Ведущий" },
        ],
      },
    };

    const [profile] = summariseIndicators(rows({ idx: 10 }, { idx: 50 }, { idx: 80 }, { idx: 90 }), [alike], { ramp });

    expect(profile.shares.map(s => [s.label, s.count, s.share])).toEqual([["Другие стили", 2, 50], ["Ведущий", 2, 50]]);
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

describe("summariseIndicators — histogram of a numeric indicator without bands (2026-10-08)", () => {
  it("splits the domain into ten integer intervals", () => {
    const [profile] = summariseIndicators(rows({ spread: 0 }, { spread: 4 }, { spread: 5 }, { spread: 28 }), [SPREAD], { ramp });

    expect(profile.histogram.map(b => b.label)).toEqual([
      "0–2", "3–5", "6–8", "9–11", "12–14", "15–17", "18–20", "21–23", "24–26", "27–28",
    ]);
    expect(profile.histogram.map(b => b.count)).toEqual([1, 2, 0, 0, 0, 0, 0, 0, 0, 1]);
    expect(profile.histogram[1].share).toBe(50);
  });

  it("one interval per value when there are ten values or fewer", () => {
    const small = { ...SPREAD, configJson: { domainMin: 0, domainMax: 4 } };

    const [profile] = summariseIndicators(rows({ spread: 1 }, { spread: 1 }, { spread: 4 }), [small], { ramp });

    expect(profile.histogram.map(b => [b.label, b.count])).toEqual([["0", 0], ["1", 2], ["2", 0], ["3", 0], ["4", 1]]);
  });

  it("without a domain the range of the whole test fixes the intervals", () => {
    const open = { ...SPREAD, configJson: {} };

    const [profile] = summariseIndicators(rows({ spread: 12 }), [open], { ramp, ranges: { spread: { min: 10, max: 29 } } });

    expect(profile.histogram[0]).toMatchObject({ label: "10–11", count: 0 });
    expect(profile.histogram.find(b => b.count === 1)?.label).toBe("12–13");
  });

  it("fractional values get fractional bounds with a decimal comma", () => {
    const open = { ...SPREAD, configJson: { domainMin: 0, domainMax: 1 } };

    const [profile] = summariseIndicators(rows({ spread: 0.05 }, { spread: 1 }), [open], { ramp });

    expect(profile.histogram).toHaveLength(10);
    expect(profile.histogram[0]).toMatchObject({ label: "0–0,1", count: 1 });
    expect(profile.histogram[9]).toMatchObject({ label: "0,9–1", count: 1 });
  });

  it("indicatorRanges reads the min and max of every numeric indicator over all rows", () => {
    expect(indicatorRanges(rows({ spread: "7" }, { spread: 3 }, {}), [SPREAD, STYLE])).toEqual({ spread: { min: 3, max: 7 } });
  });

  it("a banded or outcome indicator has no histogram", () => {
    const [banded] = summariseIndicators(rows({ idx: 50 }), [INDEX], { ramp });

    expect(banded.histogram).toEqual([]);
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
      ["Командный", "Командный", 2, 50],
      ["Вдохновляющий", "Вдохновляющий", 1, 25],
      ["__rest__", "Прочее", 1, 25],
    ]);
  });

  it("orders outcomes by share, largest first; ties keep the author's order; «Прочее» stays last", () => {
    // Owner 2026-10-08: a list of outcomes is read by size, not in the order they were authored.
    const [profile] = summariseIndicators(
      rows({ style: "cel" }, { style: "zzz" }, { style: "zzz" }, { style: "zzz" }, { style: "vdh" }, { style: "vdh" }, { style: "kom" }),
      [STYLE],
      { ramp },
    );

    expect(profile.shares.map(s => s.label)).toEqual(["Вдохновляющий", "Командный", "Целеустремлённый", "Прочее"]);
  });

  it("paints a toned outcome by its tone, the others by the categorical palette, the rest grey", () => {
    const [profile] = summariseIndicators(
      rows({ style: "kom" }, { style: "vdh" }, { style: "cel" }, { style: "zzz" }),
      [STYLE],
      { ramp },
    );

    // approved/analytics-indicators.html: outcomes business, bti, digital, leadership; «Прочее» fg-muted.
    const color = (key: string) => profile.shares.find(s => s.key === key)!;
    expect(color("Командный")).toMatchObject({ color: "var(--ou-cat-business)", tone: null });
    expect(color("Вдохновляющий")).toMatchObject({ color: "var(--ou-success-default)", tone: "favorable" });
    expect(color("Целеустремлённый")).toMatchObject({ color: "var(--ou-cat-digital)", tone: null });
    expect(color("__rest__")).toMatchObject({ color: "var(--ou-fg-muted)", rest: true });
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

describe("summariseIndicators — readable outcomes (live ЧИЛ data, 2026-10-08)", () => {
  it("a «neutral» tone judges nothing and does not paint every outcome the same blue", () => {
    const neutral = {
      ...STYLE,
      configJson: { outcomes: STYLE.configJson.outcomes.map(o => ({ ...o, tone: "neutral" })) },
    };

    const [profile] = summariseIndicators(rows({ style: "kom" }, { style: "vdh" }, { style: "cel" }), [neutral], { ramp });

    expect(profile.shares.map(s => s.color)).toEqual([
      "var(--ou-cat-business)", "var(--ou-cat-bti)", "var(--ou-cat-digital)",
    ]);
  });

  it("outcomes the author labelled alike become one share", () => {
    const alike = {
      ...STYLE,
      configJson: {
        outcomes: [
          { code: "cel", label: "Сфокусированный" },
          { code: "cel+vdo", label: "Двухвекторный профиль" },
          { code: "kom", label: "Сфокусированный" },
        ],
      },
    };

    const [profile] = summariseIndicators(
      rows({ style: "cel" }, { style: "kom" }, { style: "kom" }, { style: "cel+vdo" }),
      [alike],
      { ramp },
    );

    expect(profile.shares.map(s => [s.label, s.count])).toEqual([
      ["Сфокусированный", 3], ["Двухвекторный профиль", 1],
    ]);
  });

  it("values that are scale keys are named by the scales, not printed as codes", () => {
    const close = { name: "close", label: "Второй близкий стиль", type: "string", sortOrder: 1, configJson: {} };

    const [profile] = summariseIndicators(
      rows({ close: "kom" }, { close: "kom" }, { close: "pro+cel" }, { close: "zzz" }),
      [close],
      { ramp, scaleLabels: { kom: "Командный", pro: "Процессный", cel: "Целеустремлённый" } },
    );

    expect(profile.shares.map(s => s.label)).toEqual(["Командный", "Процессный, Целеустремлённый", "zzz"]);
  });
});

describe("summariseIndicators — mask values of the PRD-53 transition (ЧИЛ, 2026-10-08)", () => {
  // PRD-53 §7.1: one interpretation answers codes with outcomes and old mask NUMBERS with bands;
  // the learner's screen reads both. Analytics folded the numbers into «Прочее» — 48 % on live data.
  const PROFILE = {
    name: "profile", label: "Резюме профиля", type: "string", sortOrder: 1,
    configJson: {
      outcomes: [
        { code: "cel", label: "Сфокусированный" },
        { code: "cel+pro", label: "Двухвекторный профиль" },
      ],
      bands: [
        { min: 1, max: 1, level: "m1", label: "Сфокусированный" },
        { min: 9, max: 9, level: "m9", label: "Двухвекторный профиль" },
      ],
    },
  };

  it("reads a number by the bands when no outcome matches, as the results screen does", () => {
    const [profile] = summariseIndicators(
      [...rows({ profile: "cel" }, { profile: 9 }, { profile: "cel+pro" }),
        { attemptId: "l1", source: "import" as const, values: { profile: "1" } }],
      [PROFILE],
      { ramp },
    );

    expect(profile.shares.map(s => [s.label, s.count])).toEqual([
      ["Сфокусированный", 2], ["Двухвекторный профиль", 2],
    ]);
  });

  it("a set code from a WebTutor export («cel pro» for «cel+pro») is its outcome, not «Прочее»", () => {
    const [profile] = summariseIndicators(
      [{ attemptId: "l1", source: "import" as const, values: { profile: "cel pro" } }],
      [PROFILE],
      { ramp },
    );

    expect(profile.shares.map(s => s.label)).toEqual(["Двухвекторный профиль"]);
  });

  it("a number outside every band is still «Прочее»", () => {
    const [profile] = summariseIndicators(rows({ profile: 42 }, { profile: "cel" }), [PROFILE], { ramp });

    expect(profile.shares.map(s => s.label)).toEqual(["Сфокусированный", "Прочее"]);
  });
});

describe("summariseIndicators — order", () => {
  it("follows the author's order of indicators", () => {
    const profiles = summariseIndicators([], [RESERVE, STYLE, INDEX, SPREAD], { ramp });

    expect(profiles.map(p => p.name)).toEqual(["idx", "spread", "style", "reserve"]);
  });
});
