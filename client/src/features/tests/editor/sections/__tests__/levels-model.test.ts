/**
 * @module features/tests/editor/sections/__tests__/levels-model
 * @description PRD-45. The band ↔ draft arithmetic: the load-bearing part of the
 * levels editor, checked without a DOM.
 */

import { describe, expect, it } from "vitest";

import { bandsToDraft, draftToBands } from "../levels-model";
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
