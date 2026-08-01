/**
 * @module shared/template/radar-view
 *
 * Turns the visible scales of a test into ONE radar chart — the first cross-scale
 * view on the results screen. Every other measurement view (PRD-29 `measure-view`)
 * draws a single scale, so the radar lives at the block level, not in a card.
 *
 * The core computes everything the layout needs — angles, points, the polygon
 * string, ring geometry, label baselines and zone colours — because the DSL is a
 * mustache subset with no arithmetic, and because the web player and the SCORM
 * package must draw the identical figure.
 *
 * Three decisions are load-bearing and must not be "simplified" later:
 *
 *   - the radius is the raw share of the domain, NEVER inverted by `valence`.
 *     Inverting would put a high burnout score near the centre under a label that
 *     says "Эмоциональное истощение", and would contradict the `band_ruler` of the
 *     same scale sitting in the card next to it. Evaluation is carried by colour.
 *   - visibility `level` QUANTIZES the ray to the middle of its band. Drawing the
 *     exact position would disclose graphically the very number the author chose to
 *     hide, and PRD-29 §6.3 already states that a method's verdict is categorical.
 *   - no numbers are printed on the chart at all. The card beside it prints the
 *     value with a ruler and band boundaries; a second copy on the diagram would
 *     turn a profile into a table, and long labels are the real constraint once a
 *     method has five or more scales.
 *
 * Pure — no DOM, no Node.
 */

import {
  findBand,
  type LearnerVisibility,
  type LevelTone,
  type ScaleInterpretation,
  type Valence,
} from "../scales/interpretation";
import { rampColor, zoneColors, type HslTriple, type LevelRamp } from "./level-ramp";

/** Below three axes there is no figure to read — a pair of rulers reads better. */
const MIN_AXES = 3;

/**
 * Viewport of the widget, in its own coordinates — the rendered size is CSS's
 * business, so print and a 360px phone reuse the same numbers. Not square: the
 * labels need horizontal room, the rings do not (values taken from the approved
 * wireframe docs/wireframes/prd35-competency-radar.html).
 */
const WIDTH = 340;
const HEIGHT = 300;
const CENTER_X = 170;
const CENTER_Y = 150;
const RADIUS = 100;
/** Distance from the centre to the axis label, past the outer ring. */
const LABEL_GAP = 30;
/** Baseline step from the scale name down to its level label. */
const LEVEL_STEP = 16;
/** Grid rings at quarter steps of the domain; unlabelled on purpose (see below). */
const RING_STEPS = [0.25, 0.5, 0.75, 1];

export interface RadarAxisInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  visibility: LearnerVisibility;
  /** Shape shared by scales and numeric indicators; the radar reads only the numeric part. */
  interpretation: Pick<ScaleInterpretation, "domainMin" | "domainMax" | "valence" | "bands">;
}

export interface CtxRadarAxis {
  key: string;
  label: string;
  /** Level label. Empty when the value falls outside every declared band. */
  levelText: string;
  tone: LevelTone;
  color: HslTriple;
  /** "" or `tb-radar__dot--quantized`: the DSL has no conditional classes. */
  quantizedClass: string;
  radiusPercent: number;
  cx: number;
  cy: number;
  x: number;
  y: number;
  axisX: number;
  axisY: number;
  labelX: number;
  labelY: number;
  levelY: number;
  labelAnchor: "start" | "middle" | "end";
}

/** One grid ring. Each carries the centre: a DSL loop cannot reach its parent. */
export interface CtxRadarRing {
  cx: number;
  cy: number;
  radius: number;
}

export interface CtxRadarChart {
  width: number;
  height: number;
  axes: CtxRadarAxis[];
  rings: CtxRadarRing[];
  polygonPoints: string;
  ariaLabel: string;
}

export interface RadarChartInput {
  axes: RadarAxisInput[];
  ramp: LevelRamp;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function clamp01(n: number): number {
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Tone of the current band. Mirrors `measure-view.toneOf` so the vertex marker and
 * the level tag in the card never disagree about the same value.
 */
function toneOf(valence: Valence, index: number, count: number): LevelTone {
  if (valence === "none" || count <= 1 || index < 0) return "neutral";
  const position = index / (count - 1);
  const t = valence === "lower_is_better" ? 1 - position : position;
  if (t >= 0.75) return "favorable";
  if (t >= 0.375) return "attention";
  return "critical";
}

/** Share of the domain the value sits at, or the middle of its band when quantized. */
function radiusRatio(
  value: number,
  interpretation: RadarAxisInput["interpretation"],
  domainMin: number,
  domainMax: number,
  quantize: boolean,
): number {
  const span = domainMax - domainMin;
  if (span <= 0) return 0;
  if (!quantize) return clamp01((value - domainMin) / span);
  const bands = interpretation.bands;
  const band = findBand(bands, value);
  if (!band) return 0;
  const index = bands.indexOf(band);
  const right = index + 1 < bands.length ? bands[index + 1].min : domainMax;
  const middle = (band.min + right) / 2;
  return clamp01((middle - domainMin) / span);
}

/**
 * Labels sit UNDER the ray end and are centred; only a genuinely horizontal axis
 * (four, eight, … axes) gets a side anchor, because there a centred label would
 * collide with the figure. Centring is what keeps long Russian scale names inside
 * the viewport — anchoring them outwards pushed «Обесценивание достижений» off canvas.
 */
function anchorFor(cos: number): "start" | "middle" | "end" {
  if (cos > 0.95) return "start";
  if (cos < -0.95) return "end";
  return "middle";
}

/**
 * Build the chart, or `null` when it must not be drawn.
 *
 * `null` covers every refusal: fewer than {@link MIN_AXES} visible scales, a scale
 * whose value is not a number, a scale without a usable domain. The refusal is
 * deliberately all-or-nothing — a closed figure built from part of the scales looks
 * complete and misreads as the whole profile.
 */
export function buildRadarChart(input: RadarChartInput): CtxRadarChart | null {
  const visible = input.axes.filter((a) => a.visibility !== "hidden");
  if (visible.length < MIN_AXES) return null;

  const prepared: CtxRadarAxis[] = [];
  const step = (Math.PI * 2) / visible.length;

  for (let i = 0; i < visible.length; i += 1) {
    const source = visible[i];
    const { interpretation } = source;
    const value = source.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    if (interpretation.domainMin === null || interpretation.domainMax === null) return null;

    const domainMin = interpretation.domainMin;
    const domainMax = interpretation.domainMax;
    if (domainMax - domainMin <= 0) return null;

    const quantized = source.visibility === "level";
    const ratio = radiusRatio(value, interpretation, domainMin, domainMax, quantized);

    const bands = interpretation.bands;
    const band = findBand(bands, value);
    const bandIndex = band ? bands.indexOf(band) : -1;
    const tone = band?.tone ?? toneOf(interpretation.valence, bandIndex, bands.length);
    const colors = zoneColors(input.ramp, bands.length, interpretation.valence);
    const color =
      bandIndex >= 0 && colors[bandIndex]
        ? colors[bandIndex]
        : rampColor(input.ramp, interpretation.valence === "lower_is_better" ? 1 - ratio : ratio);

    // Starts at the top and goes clockwise: a profile read like a clock face.
    const angle = -Math.PI / 2 + step * i;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const labelY = round1(CENTER_Y + sin * (RADIUS + LABEL_GAP));

    prepared.push({
      key: source.key,
      label: source.name,
      levelText: band ? band.label ?? band.level : "",
      tone,
      color,
      quantizedClass: quantized ? "tb-radar__dot--quantized" : "",
      radiusPercent: round1(ratio * 100),
      cx: CENTER_X,
      cy: CENTER_Y,
      x: round1(CENTER_X + cos * RADIUS * ratio),
      y: round1(CENTER_Y + sin * RADIUS * ratio),
      axisX: round1(CENTER_X + cos * RADIUS),
      axisY: round1(CENTER_Y + sin * RADIUS),
      labelX: round1(CENTER_X + cos * (RADIUS + LABEL_GAP)),
      labelY,
      levelY: round1(labelY + LEVEL_STEP),
      labelAnchor: anchorFor(cos),
    });
  }

  return {
    width: WIDTH,
    height: HEIGHT,
    axes: prepared,
    rings: RING_STEPS.map((s) => ({ cx: CENTER_X, cy: CENTER_Y, radius: round1(RADIUS * s) })),
    polygonPoints: prepared.map((a) => `${a.x},${a.y}`).join(" "),
    ariaLabel: `Профиль по шкалам: ${prepared
      .map((a) => `${a.label} — ${a.levelText || "уровень не определён"}`)
      .join("; ")}`,
  };
}
