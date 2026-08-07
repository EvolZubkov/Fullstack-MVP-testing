/**
 * @module features/tests/editor/sections/__tests__/levels-model
 * @description PRD-45. The band ↔ draft arithmetic: the load-bearing part of the
 * levels editor, checked without a DOM.
 */

import { describe, expect, it } from "vitest";

import {
  addLevel,
  bandsToDraft,
  coverageSegments,
  draftErrors,
  draftToBands,
  hasStoredGap,
  moveLevel,
  removeLevel,
} from "../levels-model";
import type { ScaleBandModel } from "../../test-editor.types";

function band(min: string, max: string, level: string): ScaleBandModel {
  return { clientKey: `b-${level}`, min, max, label: `Метка ${level}`, level, text: "", tone: "" };
}

describe("bandsToDraft", () => {
  it("splits contiguous bands into start, cuts and end", () => {
    const draft = bandsToDraft([band("0", "15", "low"), band("15", "29", "mid"), band("29", "98", "high")]);
    expect(draft.start).toBe("0");
    expect(draft.cuts).toEqual(["15", "29"]);
    expect(draft.end).toBe("98");
    expect(draft.levels.map((l) => l.level)).toEqual(["low", "mid", "high"]);
  });

  it("takes the cut from the LOWER band's max, so a legacy gap closes downwards", () => {
    // Legacy pair 0-15 / 16-29: the gap (15, 16) had no level at all. Closing it
    // downwards means no score that already had a level changes level.
    const draft = bandsToDraft([band("0", "15", "low"), band("16", "29", "mid")]);
    expect(draft.cuts).toEqual(["15"]);
  });

  it("returns an empty draft for no bands", () => {
    expect(bandsToDraft([])).toEqual({ start: "", cuts: [], end: "", levels: [] });
  });
});

describe("draftToBands", () => {
  it("writes the cut into both neighbours", () => {
    const bands = draftToBands(bandsToDraft([band("0", "15", "low"), band("16", "29", "mid")]));
    expect(bands.map((b) => [b.min, b.max])).toEqual([["0", "15"], ["15", "29"]]);
  });

  it("keeps a single level spanning start to end", () => {
    const bands = draftToBands(bandsToDraft([band("0", "10", "only")]));
    expect(bands.map((b) => [b.min, b.max])).toEqual([["0", "10"]]);
  });

  it("round-trips a contiguous set unchanged", () => {
    const input = [band("0", "15", "low"), band("15", "29", "mid")];
    expect(draftToBands(bandsToDraft(input))).toEqual(input);
  });

  it("keeps half-typed input as the author typed it", () => {
    const draft = { start: "0", cuts: ["1,"], end: "10", levels: bandsToDraft([band("0", "5", "a"), band("5", "10", "b")]).levels };
    expect(draftToBands(draft).map((b) => [b.min, b.max])).toEqual([["0", "1,"], ["1,", "10"]]);
  });
});

const THREE = bandsToDraft([band("0", "15", "low"), band("15", "29", "mid"), band("29", "98", "high")]);

describe("draftErrors", () => {
  it("passes a well-ordered draft", () => {
    const e = draftErrors(THREE);
    expect(e.blocking).toBeNull();
    expect(e.cuts).toEqual([null, null]);
  });

  it("allows a zero-width level, because a single band 0..0 is legal today", () => {
    expect(draftErrors({ ...THREE, cuts: ["0", "29"] }).blocking).toBeNull();
  });

  it("marks BOTH fields of a descending pair", () => {
    const e = draftErrors({ ...THREE, cuts: ["42", "29"] });
    expect(e.cuts[0]).toBe("Больше следующего порога 29");
    expect(e.cuts[1]).toBe("Меньше предыдущего порога 42");
    expect(e.blocking).toBe("Числа в ряду «Начало — пороги — Конец» должны идти по возрастанию.");
  });

  it("names the neighbour by its role, not always «порог»", () => {
    const e = draftErrors({ ...THREE, start: "50" });
    expect(e.start).toBe("Больше следующего порога 15");
    expect(e.cuts[0]).toBe("Меньше предыдущего начала 50");
  });

  it("reports a non-numeric field and blocks", () => {
    const e = draftErrors({ ...THREE, end: "x" });
    expect(e.end).toBe("Укажите число");
    expect(e.blocking).toBe("Границы уровней заданы не полностью: укажите числа во всех полях.");
  });

  it("says nothing when there are no levels", () => {
    expect(draftErrors({ start: "", cuts: [], end: "", levels: [] }).blocking).toBeNull();
  });
});

describe("hasStoredGap", () => {
  it("detects a legacy gap", () => {
    expect(hasStoredGap([band("0", "15", "low"), band("16", "29", "mid")])).toBe(true);
  });

  it("ignores contiguous bands", () => {
    expect(hasStoredGap([band("0", "15", "low"), band("15", "29", "mid")])).toBe(false);
  });

  it("ignores unparseable boundaries", () => {
    expect(hasStoredGap([band("0", "x", "low"), band("16", "29", "mid")])).toBe(false);
  });
});

describe("coverageSegments", () => {
  it("returns one segment per level when the domain matches", () => {
    expect(coverageSegments(THREE, { min: 0, max: 98 })).toEqual([
      { kind: "level", index: 0, from: 0, to: 15 },
      { kind: "level", index: 1, from: 15, to: 29 },
      { kind: "level", index: 2, from: 29, to: 98 },
    ]);
  });

  it("adds gap segments when the domain is wider than the levels", () => {
    const segments = coverageSegments({ ...THREE, start: "10", end: "69" }, { min: 0, max: 98 });
    expect(segments?.[0]).toEqual({ kind: "gap", from: 0, to: 10 });
    expect(segments?.[segments.length - 1]).toEqual({ kind: "gap", from: 69, to: 98 });
  });

  it("omits gaps when the domain is unknown", () => {
    const segments = coverageSegments({ ...THREE, start: "10", end: "69" }, null);
    expect(segments?.every((s) => s.kind === "level")).toBe(true);
  });

  it("returns null while the numbers do not parse or do not ascend", () => {
    expect(coverageSegments({ ...THREE, end: "x" }, null)).toBeNull();
    expect(coverageSegments({ ...THREE, cuts: ["42", "29"] }, null)).toBeNull();
  });
});

describe("addLevel", () => {
  it("seeds the first level from the domain", () => {
    const draft = addLevel({ start: "", cuts: [], end: "", levels: [] }, { min: 0, max: 98 });
    expect(draft.start).toBe("0");
    expect(draft.end).toBe("98");
    expect(draft.cuts).toEqual([]);
    expect(draft.levels).toHaveLength(1);
  });

  it("seeds the first level with zeroes when the domain is unknown", () => {
    const draft = addLevel({ start: "", cuts: [], end: "", levels: [] }, null);
    expect([draft.start, draft.end]).toEqual(["0", "0"]);
  });

  it("cuts the last level in half", () => {
    const draft = addLevel(bandsToDraft([band("0", "98", "only")]), null);
    expect(draft.cuts).toEqual(["49"]);
    expect(draft.levels).toHaveLength(2);
  });

  it("leaves the new cut empty when the last level does not parse", () => {
    const draft = addLevel(bandsToDraft([band("0", "x", "only")]), null);
    expect(draft.cuts).toEqual([""]);
  });
});

describe("removeLevel", () => {
  it("drops the cut below the level, so coverage stays continuous", () => {
    const draft = removeLevel(THREE, 1);
    expect(draft.cuts).toEqual(["29"]);
    expect(draft.levels.map((l) => l.level)).toEqual(["low", "high"]);
  });

  it("drops the cut ABOVE the first level", () => {
    const draft = removeLevel(THREE, 0);
    expect(draft.cuts).toEqual(["29"]);
    expect(draft.levels.map((l) => l.level)).toEqual(["mid", "high"]);
  });

  it("keeps the outer bounds when the last level goes", () => {
    const draft = removeLevel(THREE, 2);
    expect([draft.start, draft.end]).toEqual(["0", "98"]);
    expect(draft.cuts).toEqual(["15"]);
  });

  it("empties the whole draft when the only level goes", () => {
    expect(removeLevel(bandsToDraft([band("0", "10", "only")]), 0)).toEqual({
      start: "", cuts: [], end: "", levels: [],
    });
  });
});

describe("moveLevel", () => {
  it("moves the level CONTENT and leaves the boundaries alone", () => {
    const draft = moveLevel(THREE, 2, 0);
    expect(draft.levels.map((l) => l.level)).toEqual(["high", "low", "mid"]);
    expect(draft.cuts).toEqual(["15", "29"]);
    expect([draft.start, draft.end]).toEqual(["0", "98"]);
  });

  it("ignores an out-of-range target", () => {
    expect(moveLevel(THREE, 0, 3)).toBe(THREE);
    expect(moveLevel(THREE, 0, -1)).toBe(THREE);
  });
});
