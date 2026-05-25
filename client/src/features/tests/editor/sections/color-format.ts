/**
 * @module features/tests/editor/sections/color-format
 * @description Helpers for round-tripping template color params between the
 * ui-kit `ColorPicker` (which speaks HEX only) and the template manifest
 * format (mixed: most templates store HSL `"H S% L%"`, some — like
 * `rtk-storyline` — store HEX `"#RRGGBB"`).
 *
 * The picker always operates on HEX; on save the value is coerced back to
 * the format detected on read (so we don't silently rewrite a template
 * author's choice of HSL).
 */

export type ColorFormat = "hex" | "hsl";

/** Returns the detected format of a stored color value, or `null` for unparseable. */
export function detectColorFormat(value: unknown): ColorFormat | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (/^#?[0-9a-fA-F]{6}$/.test(trimmed)) return "hex";
  if (/^#?[0-9a-fA-F]{3}$/.test(trimmed)) return "hex";
  if (/^\d+(?:\.\d+)?\s+\d+(?:\.\d+)?%\s+\d+(?:\.\d+)?%$/.test(trimmed)) return "hsl";
  return null;
}

/** Parses a HEX string (with or without leading `#`, 3 or 6 chars) → `[r,g,b]` 0..255. */
function hexToRgb(hex: string): [number, number, number] | null {
  let s = hex.trim().replace(/^#/, "");
  if (/^[0-9a-fA-F]{3}$/.test(s)) {
    s = s.split("").map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
  const r = parseInt(s.slice(0, 2), 16);
  const g = parseInt(s.slice(2, 4), 16);
  const b = parseInt(s.slice(4, 6), 16);
  return [r, g, b];
}

/** RGB triplet (0..255) → uppercase `#RRGGBB`. */
function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, "0");
  return ("#" + c(r) + c(g) + c(b)).toUpperCase();
}

/** Parses HSL `"H S% L%"` → `[r,g,b]` 0..255. */
function hslToRgb(hsl: string): [number, number, number] | null {
  const match = hsl.trim().match(/^(\d+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)%\s+(\d+(?:\.\d+)?)%$/);
  if (!match) return null;
  const h = Number(match[1]);
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) [r1, g1, b1] = [c, x, 0];
  else if (h < 120) [r1, g1, b1] = [x, c, 0];
  else if (h < 180) [r1, g1, b1] = [0, c, x];
  else if (h < 240) [r1, g1, b1] = [0, x, c];
  else if (h < 300) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];

  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

/** Converts any supported color value to HEX (`#RRGGBB`). Falls back to `#000000`. */
export function toHex(value: unknown, fallback: string = "#000000"): string {
  if (typeof value !== "string") return fallback;
  const format = detectColorFormat(value);
  if (format === "hex") {
    const rgb = hexToRgb(value);
    return rgb ? rgbToHex(rgb) : fallback;
  }
  if (format === "hsl") {
    const rgb = hslToRgb(value);
    return rgb ? rgbToHex(rgb) : fallback;
  }
  return fallback;
}

/** HEX → HSL `"H S% L%"` (no `hsl()` wrapper — matches manifest convention). */
export function hexToHsl(hex: string): string | null {
  const rgb = hexToRgb(hex);
  if (!rgb) return null;
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/**
 * Round-trip a new HEX picker value back to whichever format the stored
 * draft value originally used. When the draft is empty / unparseable
 * (e.g., template default not yet edited), falls back to the format
 * implied by the param's `default`.
 */
export function fromHex(
  pickerHex: string,
  originalValue: unknown,
  fallbackFormat: ColorFormat = "hex",
): string {
  const format =
    detectColorFormat(originalValue) ?? fallbackFormat;
  if (format === "hsl") {
    return hexToHsl(pickerHex) ?? pickerHex;
  }
  return pickerHex.toUpperCase();
}
