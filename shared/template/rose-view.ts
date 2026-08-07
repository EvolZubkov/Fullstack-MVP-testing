/**
 * @module shared/template/rose-view
 *
 * Turns the visible scales of a test into ONE rose — the Nightingale polar-area chart the
 * results screen draws instead of the radar when the scales divide a single whole (PRD-46).
 *
 * The radar and the rose answer different questions about the same profile. The radar says
 * «each scale stands here relative to its own limit»; the rose says «the whole split like
 * this». Only the second is true of an ipsative method such as the ЧИЛ questionnaire, where
 * fourteen blocks of seven points are shared out between four styles and the totals always
 * add up to 98 — there, growth of one style IS decline of another, and independent axes hide
 * exactly the relation that matters.
 *
 * Four decisions are load-bearing and must not be "simplified" later:
 *
 *   - the sector angle is `360 / N`, never proportional to the value. Equal angles keep each
 *     scale in a fixed place, so captions do not migrate between attempts and two profiles
 *     can be compared by overlay. Proportional angles would make this an ordinary pie and
 *     encode the same quantity twice.
 *   - the radius is the SQUARE ROOT of the share, so the AREA carries the value. Radius taken
 *     straight from the value grows area quadratically: at ЧИЛ 34 against 14 is 2.4 times and
 *     would look like 5.9. That is the very error Nightingale's original was criticised for.
 *   - the share is taken from the SUM of the values, never from the scale's domain. On an
 *     ipsative method the two coincide, but only because one style could in theory take the
 *     whole budget; leaning on the domain would silently stop summing to a whole on any
 *     method built differently.
 *   - a scale whose value is hidden behind a level (`visibility: "level"`) forbids the chart.
 *     The radar quantizes such a ray to the middle of its band; here the sectors share one
 *     circle, so moving one share breaks the arithmetic of the whole figure. See PRD-46 §3.4
 *     for the two rejected alternatives.
 *
 * Pure — no DOM, no Node.
 */

import { findBand, type ScaleInterpretation } from "../scales/interpretation";
import { zoneColors, type HslTriple, type LevelRamp } from "./level-ramp";
import { categoricalColor } from "./categorical-palette";
import type { RadarAxisInput } from "./radar-view";
import {
  CENTER_X,
  CENTER_Y,
  HEIGHT,
  LABEL_GAP,
  MIN_AXES,
  RADIUS,
  WIDTH,
  placeCaption,
  round1,
  type CtxChartLabel,
} from "./chart-frame";

/**
 * Above this many scales a sector is narrower than its own caption and the reader stops being
 * able to say which slice a name refers to. Six is also the length of the categorical hue
 * order — a seventh hue could not be added without pushing a neighbouring pair back under the
 * separation floor — so the limit binds for both reasons at once.
 */
const MAX_AXES = 6;

/**
 * Grid rings at equal shares of the whole: 25, 50, 75 and 100 per cent.
 *
 * Drawn ON TOP of the sectors, unlike the radar's, which sit under a polygon that is mostly
 * transparent. A rose's fills are opaque, so rings underneath them are visible only in the
 * gaps between short sectors — exactly where they say least. Over the fills they read as one
 * scale laid across the whole figure.
 *
 * Unlabelled, for the reason PRD-29 §6.5 gives: different scales carry different bands, so one
 * labelled common grid would state something false about most of them.
 */
const RING_SHARES = [0.25, 0.5, 0.75, 1];

/** One sector: a scale's share of the whole, ready to draw. */
export interface CtxRoseSector {
  key: string;
  label: string;
  /** Level label. Empty when the value falls outside every declared band. */
  levelText: string;
  /** Path of the sector, ready for the `d` attribute; empty when the share is zero. */
  d: string;
  color: HslTriple;
  radius: number;
  sharePercent: number;
}

/** One grid ring. Each carries the centre: a DSL loop cannot reach its parent. */
export interface CtxRoseRing {
  cx: number;
  cy: number;
  radius: number;
}

/**
 * One ray of the grid, from the centre to the field edge.
 *
 * The rays follow sector BOUNDARIES, not their middles: a boundary is where one scale ends
 * and the next begins, so the ray continues the edge the reader already sees on the fill and
 * carries it out to the rim. Carries the centre for the same reason a ring does.
 */
export interface CtxRoseSpoke {
  cx: number;
  cy: number;
  x: number;
  y: number;
}

export interface CtxRoseChart {
  width: number;
  height: number;
  sectors: CtxRoseSector[];
  rings: CtxRoseRing[];
  spokes: CtxRoseSpoke[];
  /**
   * The ring an EVEN split lands on, at `F / √N`. It is the chart's reference: a figure
   * bulging past it on one side and sinking inside it on another is exactly what a skewed
   * profile looks like, and no number has to be printed to say so.
   */
  labels: CtxChartLabel[];
  ariaLabel: string;
}

export interface RoseChartInput {
  axes: RadarAxisInput[];
  ramp: LevelRamp;
}

/** Colour of the band the value fell into, matching the card beside the chart. */
function levelColor(
  ramp: LevelRamp,
  interpretation: Pick<ScaleInterpretation, "valence" | "bands">,
  bandIndex: number,
): HslTriple {
  const colors = zoneColors(ramp, interpretation.bands.length, interpretation.valence);
  return bandIndex >= 0 && colors[bandIndex] ? colors[bandIndex] : colors[0] ?? ramp.unfavorable;
}

/**
 * Path of one sector, or an empty string when its share is zero.
 *
 * The rounded radius is used for the endpoints too, so the arc and the two straight sides
 * always meet: computing endpoints from the exact radius and drawing the arc with the rounded
 * one leaves a hairline gap that renders as a light seam in print.
 */
function sectorPath(radius: number, from: number, to: number): string {
  if (radius <= 0) return "";
  const x1 = round1(CENTER_X + Math.cos(from) * radius);
  const y1 = round1(CENTER_Y + Math.sin(from) * radius);
  const x2 = round1(CENTER_X + Math.cos(to) * radius);
  const y2 = round1(CENTER_Y + Math.sin(to) * radius);
  const largeArc = to - from > Math.PI ? 1 : 0;
  return `M ${CENTER_X},${CENTER_Y} L ${x1},${y1} A ${radius},${radius} 0 ${largeArc},1 ${x2},${y2} Z`;
}

/**
 * Build the chart, or `null` when it must not be drawn.
 *
 * Every refusal is all-or-nothing, as with the radar: a circle built from part of the scales
 * still looks like a whole and would be read as one.
 */
export function buildRoseChart(input: RoseChartInput): CtxRoseChart | null {
  const visible = input.axes.filter((a) => a.visibility !== "hidden");
  if (visible.length < MIN_AXES || visible.length > MAX_AXES) return null;
  // A hidden value cannot be quantized here the way the radar quantizes a ray, so the whole
  // chart steps aside rather than draw a circle that no longer adds up.
  if (visible.some((a) => a.visibility === "level")) return null;

  let total = 0;
  for (const source of visible) {
    if (typeof source.value !== "number" || !Number.isFinite(source.value) || source.value < 0) return null;
    total += source.value;
  }
  if (!(total > 0)) return null;

  // A typology has no better or worse level to signal, so colour is free to carry identity
  // instead — and has to, because the level ramp answers `valence: none` with a neutral grey
  // that would leave the sectors telling apart only by position. One scale with a declared
  // direction is enough to put the whole chart back on the level ramp: mixing the two would
  // paint the same value differently from the card standing beside it.
  const byIdentity = visible.every((a) => a.interpretation.valence === "none");

  const step = (Math.PI * 2) / visible.length;
  const sectors: CtxRoseSector[] = [];
  /** Direction of each caption, kept for the second pass over the sectors. */
  const directions: { cos: number; sin: number }[] = [];

  for (let i = 0; i < visible.length; i += 1) {
    const source = visible[i];
    const share = (source.value as number) / total;
    const radius = round1(RADIUS * Math.sqrt(share));

    const bands = source.interpretation.bands;
    const band = findBand(bands, source.value as number);
    const levelText = band ? band.label ?? band.level : "";

    // Starts at the top and goes clockwise, like the radar: a profile read like a clock face.
    const from = -Math.PI / 2 + step * i;
    const to = from + step;
    // The caption belongs to the MIDDLE of the sector, not to its edge: an edge is shared by
    // two sectors and a name sitting on it would point at both.
    const middle = from + step / 2;

    sectors.push({
      key: source.key,
      label: source.name,
      levelText,
      d: sectorPath(radius, from, to),
      color:
        (byIdentity ? categoricalColor(i) : null) ??
        levelColor(input.ramp, source.interpretation, band ? bands.indexOf(band) : -1),
      radius,
      sharePercent: round1(share * 100),
    });
    directions.push({ cos: Math.cos(middle), sin: Math.sin(middle) });
  }

  // Captions ring the FIELD, not the figure: the grid reaches the field edge, so a caption
  // placed by the sectors would have the outer ring running through its lines. One shared
  // ring, not one distance per sector — ragged captions at four different radii stop reading
  // as one legend for one figure.
  const labelRing = RADIUS + LABEL_GAP;
  const labels: CtxChartLabel[] = sectors.flatMap((sector, i) =>
    placeCaption({
      name: sector.label,
      levelText: sector.levelText,
      cos: directions[i].cos,
      sin: directions[i].sin,
      ringRadius: labelRing,
      nameClass: "tb-rose__label",
      levelClass: "tb-rose__level",
    }),
  );

  return {
    width: WIDTH,
    height: HEIGHT,
    sectors,
    rings: RING_SHARES.map((s) => ({ cx: CENTER_X, cy: CENTER_Y, radius: round1(RADIUS * Math.sqrt(s)) })),
    spokes: visible.map((_, i) => {
      const angle = -Math.PI / 2 + step * i;
      return {
        cx: CENTER_X,
        cy: CENTER_Y,
        x: round1(CENTER_X + Math.cos(angle) * RADIUS),
        y: round1(CENTER_Y + Math.sin(angle) * RADIUS),
      };
    }),
    labels,
    ariaLabel: `Расклад по шкалам: ${sectors
      .map((s) => `${s.label} — ${s.levelText || "уровень не определён"}`)
      .join("; ")}`,
  };
}
