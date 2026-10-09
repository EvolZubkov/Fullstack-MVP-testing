/**
 * @module shared/template/bar-fill
 *
 * How the bar of a breakdown row (a sub-topic of a topic, or a row of the test-scope
 * summary block) is coloured — and, in the «by share» mode, the ready CSS fill of it.
 *
 * Three modes, chosen by the author in the design params (`breakdownBarFill`):
 * - `verdict` — the bar speaks the row's verdict through `passClass` (`is-pass` /
 *   `is-fail`), coloured by the template's CSS. The historical behaviour, and what an
 *   absent param means.
 * - `share` — the colour encodes the SHARE, not the verdict: under the fill lies the
 *   «unfavourable → favourable» ramp across the whole track, and the fill shows its left
 *   part up to the value. The row then carries no verdict class — two signals on one bar
 *   would contradict each other at every value between the threshold and the ramp's middle.
 * - `neutral` — no colour signal at all: no verdict class, no fill; the template's
 *   neutral bar colour stays.
 *
 * WHY THE FILL IS COMPUTED HERE. The earlier form lived in one template's report CSS:
 * a full-width gradient stretched back over the fill with
 * `background-size: calc(100% * 100 / var(--tb-bar-percent))`, hard-coded colours and the
 * share handed over by the layout. Every template and every surface (screen, report) would
 * need its own copy of that trick, and the colours could not follow the test's level
 * scheme. Here the fill is a plain `linear-gradient` from the ramp's unfavourable end to the
 * ramp's colour AT THE VALUE — for a bar of width `p` that is exactly the left part of the
 * full-track gradient, with no division by the share and no reliance on `background-size`.
 *
 * THE TRANSITION IS A STRAIGHT LINE IN RGB, the way a CSS gradient between the ramp's ends
 * blends — exactly the transition the report printed before (owner's decision 2026-09-24).
 * The level zones interpolate along the HSL hue arc instead
 * ({@link module:shared/template/level-ramp rampColor}), which for an
 * orange → teal pair runs through yellow and green; a bar is one continuous fill, not a set
 * of zones, and keeps the report's direct blend. A midpoint, when the scheme has one, is the
 * only intermediate stop: the RGB line bends there and nowhere else.
 *
 * The ramp is the test's LEVEL ramp ({@link module:shared/template/level-ramp
 * rampFromParams}): one «bad → good» palette paints the level zones, the analytics bands and
 * these bars.
 *
 * Output uses the comma form `rgb(r, g, b)`: the SCORM package renders inside whatever
 * engine the LMS embeds, and the PDF rasterizer parses colours itself — the legacy form is
 * the one every consumer reads.
 *
 * Pure — no DOM, no Node.
 */

import { LEVEL_SCHEMES, parseHsl, rampFromParams, type LevelRamp } from "./level-ramp";

/** Design-param key the author's choice is stored under (manifest `params[]`). */
export const BAR_FILL_PARAM = "breakdownBarFill";

/** The three colouring modes of a breakdown bar. */
export const BAR_FILL_MODES = ["verdict", "share", "neutral"] as const;

export type BarFillMode = (typeof BAR_FILL_MODES)[number];

/**
 * The resolved colouring of breakdown bars, as the results builder takes it
 * (`ResultContextOptions.barFill`). Absent means `verdict` — the byte-identical context of a
 * test built before the setting existed.
 */
export interface BarFillSetting {
  mode: Exclude<BarFillMode, "verdict">;
  ramp: LevelRamp;
}

/**
 * The bar colouring of a test, from its design params.
 *
 * `null` for the `verdict` mode — the caller then passes nothing and the context stays
 * byte-identical to the one built before this setting. An unknown value reads as `verdict`
 * too: a typo in stored settings must not silently recolour a screen.
 *
 * @param params The test's design params, already resolved against the manifest defaults
 *   ({@link module:shared/template/params-css withParamDefaults}) — the template decides
 *   what an untouched test looks like.
 * @returns The setting for the builder, or `null`.
 */
export function barFillFromParams(params: Record<string, unknown> | null | undefined): BarFillSetting | null {
  const source = params ?? {};
  const raw = source[BAR_FILL_PARAM];
  if (raw !== "share" && raw !== "neutral") return null;
  return { mode: raw, ramp: rampFromParams(source) };
}

/**
 * The ramp with every end guaranteed to be a parseable triple.
 *
 * The custom scheme carries the author's own values, and the fill ends up inside a `style`
 * attribute: anything that is not a triple is replaced by the traffic scheme's end rather
 * than printed. A broken midpoint is dropped — a two-point ramp is still a ramp.
 */
function safeRamp(ramp: LevelRamp): LevelRamp {
  return {
    favorable: parseHsl(ramp.favorable) ? ramp.favorable : LEVEL_SCHEMES.traffic.favorable,
    mid: ramp.mid && parseHsl(ramp.mid) ? ramp.mid : null,
    unfavorable: parseHsl(ramp.unfavorable) ? ramp.unfavorable : LEVEL_SCHEMES.traffic.unfavorable,
  };
}

/** Round to one decimal — enough for a colour stop, short in the markup. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** An sRGB colour, channels 0-255 (unrounded while interpolating). */
type Rgb = [number, number, number];

/** A ramp triple in sRGB; the triple is known to parse. */
function tripleToRgb(triple: string): Rgb {
  const { h, s, l } = parseHsl(triple)!;
  const sat = s / 100;
  const lig = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(lig, 1 - lig);
  const f = (n: number) => lig - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/** Straight-line blend of two sRGB colours — what a CSS gradient does between two stops. */
function lerpRgb(from: Rgb, to: Rgb, t: number): Rgb {
  return [0, 1, 2].map((i) => from[i] + (to[i] - from[i]) * t) as Rgb;
}

/** The comma form of `rgb()`, channels rounded. */
function rgbCss(c: Rgb): string {
  return `rgb(${c.map((v) => Math.round(v)).join(", ")})`;
}

/**
 * The CSS fill of a bar filled to `percent` in the «by share» mode.
 *
 * Positions are relative to the FILL, not to the track: the fill's right edge is the value,
 * so a ramp point at share `t` lands at `t / p` of the fill's width. Between the stops the
 * browser blends in RGB, and the colour at the value is computed by the same straight line —
 * so a short bar is exactly the left part of the full-track gradient.
 *
 * @param ramp The level ramp to paint with.
 * @param percent The bar's width, 0-100.
 * @returns A `linear-gradient(...)` value, or `""` for an empty bar — there is no fill to
 *   paint, and the field is left out of the row.
 */
export function barFillCss(ramp: LevelRamp, percent: number): string {
  const p = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) / 100 : 0;
  if (p <= 0) return "";
  const safe = safeRamp(ramp);
  const low = tripleToRgb(safe.unfavorable);
  const high = tripleToRgb(safe.favorable);
  const mid = safe.mid ? tripleToRgb(safe.mid) : null;
  const colorAt = (t: number): Rgb =>
    !mid ? lerpRgb(low, high, t) : t <= 0.5 ? lerpRgb(low, mid, t / 0.5) : lerpRgb(mid, high, (t - 0.5) / 0.5);
  const stops = [`${rgbCss(low)} 0%`];
  // The midpoint is the one place the line bends; it is a stop only when the bar reaches past it.
  if (mid && p > 0.5) stops.push(`${rgbCss(mid)} ${round1((0.5 / p) * 100)}%`);
  stops.push(`${rgbCss(colorAt(p))} 100%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
