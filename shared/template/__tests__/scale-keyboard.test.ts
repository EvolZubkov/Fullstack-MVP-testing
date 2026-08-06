/**
 * @module shared/template/__tests__/scale-keyboard
 * @description PRD-26 scale keyboard: arrows move and select on both axes, Home/End
 * jump to a pole, moves past an end are refused, and the first key press on an
 * unanswered scale enters it from the side the key points to.
 */
import { describe, it, expect } from "vitest";
import { nextScaleIndex } from "../scale-keyboard";

const COUNT = 6;

describe("nextScaleIndex", () => {
  it("steps towards the first graduation on left and up", () => {
    expect(nextScaleIndex("ArrowLeft", 3, COUNT)).toBe(2);
    expect(nextScaleIndex("ArrowUp", 3, COUNT)).toBe(2);
  });

  it("steps towards the last graduation on right and down", () => {
    expect(nextScaleIndex("ArrowRight", 3, COUNT)).toBe(4);
    expect(nextScaleIndex("ArrowDown", 3, COUNT)).toBe(4);
  });

  it("refuses to move past either end", () => {
    expect(nextScaleIndex("ArrowLeft", 0, COUNT)).toBeNull();
    expect(nextScaleIndex("ArrowRight", COUNT - 1, COUNT)).toBeNull();
  });

  it("jumps to a pole on Home and End", () => {
    expect(nextScaleIndex("Home", 3, COUNT)).toBe(0);
    expect(nextScaleIndex("End", 3, COUNT)).toBe(COUNT - 1);
  });

  it("does not re-emit the answer when already at the requested pole", () => {
    expect(nextScaleIndex("Home", 0, COUNT)).toBeNull();
    expect(nextScaleIndex("End", COUNT - 1, COUNT)).toBeNull();
  });

  it("enters an unanswered scale from the side the key points to", () => {
    expect(nextScaleIndex("ArrowRight", null, COUNT)).toBe(0);
    expect(nextScaleIndex("ArrowDown", null, COUNT)).toBe(0);
    expect(nextScaleIndex("ArrowLeft", null, COUNT)).toBe(COUNT - 1);
    expect(nextScaleIndex("ArrowUp", null, COUNT)).toBe(COUNT - 1);
  });

  it("ignores keys that are not scale keys", () => {
    ["Enter", " ", "Tab", "a", "Escape", "PageUp"].forEach((key) =>
      expect(nextScaleIndex(key, 2, COUNT)).toBeNull(),
    );
  });

  it("ignores a scale with no graduations", () => {
    expect(nextScaleIndex("ArrowRight", null, 0)).toBeNull();
    expect(nextScaleIndex("Home", null, 0)).toBeNull();
  });

  it("handles a two-point scale at both ends", () => {
    expect(nextScaleIndex("ArrowRight", 0, 2)).toBe(1);
    expect(nextScaleIndex("ArrowRight", 1, 2)).toBeNull();
    expect(nextScaleIndex("ArrowLeft", 1, 2)).toBe(0);
  });
});
