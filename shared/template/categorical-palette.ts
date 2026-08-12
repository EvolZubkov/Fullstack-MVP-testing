/**
 * @module shared/template/categorical-palette
 *
 * Hues that carry IDENTITY on the rose chart — one per scale, in the author's order
 * (PRD-46 §7).
 *
 * The level ramp cannot do this job. It encodes STATE, and it deliberately falls back to a
 * neutral grey when a scale declares no direction (`valence: none`) — which is precisely the
 * case of a typology such as the ЧИЛ questionnaire. Four grey sectors differ only in
 * lightness, so the reader can no longer say which slice belongs to which caption, and the
 * traffic-light ramp would be worse still: it would announce a good style and a bad one where
 * the method claims neither.
 *
 * The values are DERIVED from the design system's categorical tokens `--ou-cat-*`, not copied
 * from them. Two reasons the tokens cannot be used verbatim:
 *
 *   - the DS scopes them to «category identity (badges, list markers)», where colours sit
 *     apart on a page. On a rose the sectors TOUCH, so adjacent pairs must survive the
 *     stricter separation a chart needs;
 *   - measured against the palette checks, the token set fails three of them: `--ou-cat-digital`
 *     is too light for the shared lightness band, `--ou-cat-b2b` reads as grey (chroma 0.036,
 *     below the 0.10 floor), and the pair digital/b2c sits at ΔE 12 for normal vision, under
 *     the floor of 15.
 *
 * So each token's OKLCH HUE is kept and its lightness and chroma are re-stepped to L = 0.62,
 * the band both the light and the dark mode share; the grey slot is dropped rather than
 * saturated into a second blue. The ORDER below is not the token order: it is the cyclic
 * order that maximises the worst neighbouring pair, because on a rose the last sector touches
 * the first. Verified with the palette validator in both modes — every check passes, worst
 * adjacent pair ΔE 24.5 for normal vision and 10.9 under deuteranopia.
 *
 * Changing a value or the order without re-running that validation is a regression even when
 * the result looks fine on the author's monitor.
 *
 * Stored as HSL triples because that is how every colour reaches the layouts (see
 * `level-ramp`): the design CSS wraps them as `hsl(var(--x))`, so a value must never carry
 * its own `hsl(...)` or `#rrggbb` wrapper.
 *
 * Pure — no DOM, no Node.
 */

import type { HslTriple } from "./level-ramp";

/**
 * Six identity hues, in drawing order. Six and not more: beyond it a sector is narrower than
 * its caption, and a seventh hue could not be added without pushing some neighbouring pair
 * back under the separation floor.
 */
export const CATEGORICAL_HUES: readonly HslTriple[] = [
  "257.9 71.3% 65.9%", // derived from --ou-cat-business
  "28.2 97.1% 41.2%", // derived from --ou-cat-b2c
  "167.4 100% 30.8%", // derived from --ou-cat-b2o
  "13.6 71.7% 51.6%", // derived from --ou-cat-leadership
  "223.1 85.1% 63.1%", // derived from --ou-cat-bti
  "41.9 96.6% 34.9%", // derived from --ou-cat-digital
];

/**
 * Hue of the scale at `index`, or `null` when the order is exhausted.
 *
 * Never cycles. A seventh scale reusing the first colour would put two identical sectors on
 * one circle, and the reader has no way to know which caption the duplicate belongs to. The
 * caller refuses the chart instead.
 */
export function categoricalColor(index: number): HslTriple | null {
  if (!Number.isInteger(index) || index < 0 || index >= CATEGORICAL_HUES.length) return null;
  return CATEGORICAL_HUES[index];
}
