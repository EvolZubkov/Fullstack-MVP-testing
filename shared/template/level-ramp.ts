/**
 * @module shared/template/level-ramp
 *
 * Colour ramp for interpretation levels, modelled on spreadsheet conditional
 * formatting: two endpoints plus an optional midpoint. A zone's colour follows from
 * its POSITION in the ordered list, so any number of levels is covered by three
 * reference colours — two zones land on the endpoints, three reproduce the classic
 * three-colour scale, seven give seven steps.
 *
 * Colours are HSL triples ("142 76% 36%") because that is how design params are
 * stored (see params-css) — the design CSS wraps them as `hsl(var(--x))`, so a
 * value must never carry its own `hsl(...)` or `#rrggbb` wrapper.
 *
 * Interpolation runs here rather than through CSS `color-mix()`: the SCORM package
 * renders inside whatever engine the LMS embeds, and computing in Core keeps both
 * hosts byte-identical.
 *
 * Hue interpolation takes the SHORT arc, which is also what a traffic-light ramp
 * wants: 142 down to 0 passes through yellow and orange rather than through blue.
 *
 * Pure — no DOM, no Node.
 */

import type { Valence } from "../scales/interpretation";

export type HslTriple = string;

export interface LevelRamp {
  favorable: HslTriple;
  mid: HslTriple | null;
  unfavorable: HslTriple;
}

/** Built-in schemes offered in the design params; `custom` supplies its own triples. */
export const LEVEL_SCHEMES: Record<"traffic" | "neutral", LevelRamp> = {
  traffic: { favorable: "142 76% 36%", mid: "38 92% 50%", unfavorable: "0 84% 60%" },
  neutral: { favorable: "215 16% 65%", mid: null, unfavorable: "215 16% 35%" },
};

export interface Hsl { h: number; s: number; l: number }

const HSL_RE = /^\s*(-?[\d.]+)\s+(-?[\d.]+)%\s+(-?[\d.]+)%\s*$/;

/** Parse a stored triple; `null` when the value is not in the design-param format. */
export function parseHsl(triple: HslTriple): Hsl | null {
  const m = HSL_RE.exec(String(triple ?? ""));
  if (!m) return null;
  return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
}

function formatHsl(c: Hsl): HslTriple {
  const round = (n: number) => Math.round(n * 10) / 10;
  return `${round(c.h)} ${round(c.s)}% ${round(c.l)}%`;
}

/** Interpolate hue along the SHORT arc of the colour wheel. */
function lerpHue(from: number, to: number, t: number): number {
  let delta = ((to - from) % 360 + 540) % 360 - 180;
  const h = from + delta * t;
  return (h % 360 + 360) % 360;
}

function lerp(from: Hsl, to: Hsl, t: number): Hsl {
  return {
    h: lerpHue(from.h, to.h, t),
    s: from.s + (to.s - from.s) * t,
    l: from.l + (to.l - from.l) * t,
  };
}

function clamp01(t: number): number {
  if (!Number.isFinite(t)) return 0;
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

/**
 * Colour at position `t` of the ramp: `0` is the unfavourable end, `1` the
 * favourable one. With a midpoint the ramp is two segments meeting at `0.5`.
 * Endpoints are returned verbatim so a scheme's exact triples survive round-trip.
 */
export function rampColor(ramp: LevelRamp, t: number): HslTriple {
  const p = clamp01(t);
  if (p === 0) return ramp.unfavorable;
  if (p === 1) return ramp.favorable;

  const low = parseHsl(ramp.unfavorable);
  const high = parseHsl(ramp.favorable);
  if (!low || !high) return ramp.mid ?? ramp.favorable;

  const mid = ramp.mid ? parseHsl(ramp.mid) : null;
  if (!mid) return formatHsl(lerp(low, high, p));
  if (p === 0.5) return ramp.mid as HslTriple;
  return p < 0.5
    ? formatHsl(lerp(low, mid, p / 0.5))
    : formatHsl(lerp(mid, high, (p - 0.5) / 0.5));
}

/**
 * Colours for `count` zones ordered by ascending value. `valence` decides which end
 * of the ramp the highest zone gets; `none` swaps the scheme for the neutral ramp,
 * because a typology has no better or worse level to signal.
 */
export function zoneColors(ramp: LevelRamp, count: number, valence: Valence): HslTriple[] {
  if (count <= 0) return [];
  const effective = valence === "none" ? LEVEL_SCHEMES.neutral : ramp;
  if (count === 1) return [rampColor(effective, 0.5)];

  const out: HslTriple[] = [];
  for (let i = 0; i < count; i += 1) {
    const position = i / (count - 1);
    out.push(rampColor(effective, valence === "lower_is_better" ? 1 - position : position));
  }
  return out;
}
