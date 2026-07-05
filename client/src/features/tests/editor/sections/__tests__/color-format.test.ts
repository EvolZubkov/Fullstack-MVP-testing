/**
 * @module features/tests/editor/sections/__tests__/color-format.test
 * @description Unit tests for the pure color round-trip helpers used by the
 * template ColorPicker binding. These are framework-free functions, so the
 * suite calls them directly and asserts on inputs/outputs — no rendering.
 *
 * Coverage:
 *   - detectColorFormat: 6/3-digit hex (with/without `#`), HSL «H S% L%»
 *     (integers and decimals), non-strings and unparseable values.
 *   - toHex: passthrough of hex, HSL→hex for every hue sextant, grayscale,
 *     fallback for non-strings / garbage, custom fallback.
 *   - hexToHsl: primaries (r/g/b max branches), grayscale (max===min),
 *     light vs dark lightness, the `g < b` hue correction, invalid input.
 *   - fromHex: format round-trip to hsl / hex, fallbackFormat selection,
 *     and the `hexToHsl(...) ?? pickerHex` guard for an unparseable picker value.
 */
import { describe, expect, it } from "vitest";
import { detectColorFormat, toHex, hexToHsl, fromHex } from "../color-format";

// ─── detectColorFormat ─────────────────────────────────────────────────────────

describe("detectColorFormat", () => {
  it("returns null for non-string inputs", () => {
    expect(detectColorFormat(123)).toBeNull();
    expect(detectColorFormat(null)).toBeNull();
    expect(detectColorFormat(undefined)).toBeNull();
    expect(detectColorFormat({})).toBeNull();
  });

  it("detects 6-digit hex with and without a leading #", () => {
    expect(detectColorFormat("#RRGGBB".replace("RRGGBB", "1a2b3c"))).toBe("hex");
    expect(detectColorFormat("#1A2B3C")).toBe("hex");
    expect(detectColorFormat("1a2b3c")).toBe("hex");
  });

  it("detects 3-digit hex with and without a leading #", () => {
    expect(detectColorFormat("#f00")).toBe("hex");
    expect(detectColorFormat("abc")).toBe("hex");
  });

  it("detects HSL «H S% L%» for integers and decimals", () => {
    expect(detectColorFormat("210 50% 40%")).toBe("hsl");
    expect(detectColorFormat("210.5 50.2% 40.9%")).toBe("hsl");
    expect(detectColorFormat("  120 100% 50%  ")).toBe("hsl");
  });

  it("returns null for unparseable strings", () => {
    expect(detectColorFormat("red")).toBeNull();
    expect(detectColorFormat("#12")).toBeNull();
    expect(detectColorFormat("210 50 40")).toBeNull();
    expect(detectColorFormat("210deg 50% 40%")).toBeNull();
    expect(detectColorFormat("")).toBeNull();
  });
});

// ─── toHex ──────────────────────────────────────────────────────────────────────

describe("toHex", () => {
  it("returns the default fallback for non-strings", () => {
    expect(toHex(42)).toBe("#000000");
    expect(toHex(null)).toBe("#000000");
  });

  it("honours a custom fallback for non-strings and garbage", () => {
    expect(toHex(null, "#FFFFFF")).toBe("#FFFFFF");
    expect(toHex("not-a-color", "#123456")).toBe("#123456");
  });

  it("normalizes hex input to uppercase #RRGGBB (6 and 3 digit, no #)", () => {
    expect(toHex("#1a2b3c")).toBe("#1A2B3C");
    expect(toHex("1a2b3c")).toBe("#1A2B3C");
    expect(toHex("#f00")).toBe("#FF0000");
    expect(toHex("0f0")).toBe("#00FF00");
  });

  it("converts HSL primaries to hex", () => {
    expect(toHex("0 100% 50%")).toBe("#FF0000");
    expect(toHex("120 100% 50%")).toBe("#00FF00");
    expect(toHex("240 100% 50%")).toBe("#0000FF");
  });

  it("covers every hue sextant of the HSL→RGB conversion", () => {
    expect(toHex("30 100% 50%")).toBe("#FF8000"); // h < 60
    expect(toHex("90 100% 50%")).toBe("#80FF00"); // h < 120
    expect(toHex("150 100% 50%")).toBe("#00FF80"); // h < 180
    expect(toHex("210 100% 50%")).toBe("#0080FF"); // h < 240
    expect(toHex("270 100% 50%")).toBe("#8000FF"); // h < 300
    expect(toHex("330 100% 50%")).toBe("#FF0080"); // else
  });

  it("converts an achromatic HSL (saturation 0) to a gray", () => {
    expect(toHex("0 0% 50%")).toBe("#808080");
    expect(toHex("0 0% 0%")).toBe("#000000");
    expect(toHex("0 0% 100%")).toBe("#FFFFFF");
  });
});

// ─── hexToHsl ────────────────────────────────────────────────────────────────────

describe("hexToHsl", () => {
  it("returns null for an unparseable hex string", () => {
    expect(hexToHsl("not-hex")).toBeNull();
    expect(hexToHsl("#12")).toBeNull();
  });

  it("maps the three RGB primaries (each `max` branch)", () => {
    expect(hexToHsl("#FF0000")).toBe("0 100% 50%"); // max === r
    expect(hexToHsl("#00FF00")).toBe("120 100% 50%"); // max === g
    expect(hexToHsl("#0000FF")).toBe("240 100% 50%"); // max === b
  });

  it("maps achromatic colors (max === min → s=0, h=0)", () => {
    expect(hexToHsl("#000000")).toBe("0 0% 0%");
    expect(hexToHsl("#FFFFFF")).toBe("0 0% 100%");
    expect(hexToHsl("#808080")).toBe("0 0% 50%");
  });

  it("uses the l>0.5 saturation branch for light colors", () => {
    // Light red: lightness 0.9 (> 0.5) exercises d/(2-max-min).
    expect(hexToHsl("#FFCCCC")).toBe("0 100% 90%");
  });

  it("applies the `g < b` hue correction (max === r, g below b)", () => {
    expect(hexToHsl("#FF0080")).toBe("330 100% 50%");
  });

  it("accepts 3-digit hex input", () => {
    expect(hexToHsl("#f00")).toBe("0 100% 50%");
  });
});

// ─── fromHex ──────────────────────────────────────────────────────────────────────

describe("fromHex", () => {
  it("round-trips back to HSL when the original value was HSL", () => {
    expect(fromHex("#ff0000", "10 20% 30%")).toBe("0 100% 50%");
  });

  it("round-trips back to uppercase HEX when the original value was HEX", () => {
    expect(fromHex("#ff0000", "#abcdef")).toBe("#FF0000");
  });

  it("falls back to the fallbackFormat when the original is unparseable", () => {
    // Default fallbackFormat is "hex".
    expect(fromHex("#ff0000", null)).toBe("#FF0000");
    // Explicit "hsl" fallback for an empty original.
    expect(fromHex("#ff0000", "", "hsl")).toBe("0 100% 50%");
  });

  it("keeps the picker value when hexToHsl cannot parse it", () => {
    // Original is HSL → target format hsl, but the picker value is not hex,
    // so hexToHsl returns null and the `?? pickerHex` guard returns it verbatim.
    expect(fromHex("not-a-color", "10 20% 30%")).toBe("not-a-color");
  });
});
