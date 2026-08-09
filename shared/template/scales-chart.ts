/**
 * @module shared/template/scales-chart
 *
 * Decides WHICH cross-scale diagram the results screen draws — the radar of PRD-35, the rose
 * of PRD-46, or neither.
 *
 * The decision is deliberately split from both geometries. Each builder already refuses what
 * it cannot draw (too few axes, no domain, nothing to divide), and those refusals are about
 * the figure. This module answers the question above them: what does the author want said
 * about these scales, and does the data support saying it.
 *
 * Pure — no DOM, no Node.
 */

import {
  buildRadarChart,
  type CtxRadarAxis,
  type RadarAxisInput,
  type RadarAxisLimit,
} from "./radar-view";
import {
  buildRoseChart,
  type CtxRoseSector,
  type CtxRoseSpoke,
  type RoseField,
} from "./rose-view";
import type { CtxChartIcon, CtxChartLabel } from "./chart-frame";
import type { LevelRamp } from "./level-ramp";
import { applyScaleAppearance, parseScaleAppearance } from "./scale-appearance";

/** Values of the author's setting, in the order the manifest lists them. */
export type ScalesChartKind = "none" | "auto" | "radar" | "rose";

/** What the renderer should build, or `null` when no diagram is drawn. */
export type ResolvedChartKind = "radar" | "rose" | null;

/**
 * Block settings this module reads. `showCompetencyRadar` is PRD-35's boolean, kept for the
 * tests saved before the setting became four-valued.
 */
export interface ChartKindSettings {
  scalesChartKind?: ScalesChartKind;
  showCompetencyRadar?: boolean;
  /**
   * PRD-46: the per-scale look, as the author's map of `key → { color, icon }` (see
   * `scale-appearance`). Typed as `unknown` on purpose — it arrives from `settings_json`,
   * which nothing validates, so it is parsed rather than trusted.
   *
   * It rides in the SAME settings object as the kind, so a host that already hands over its
   * variant settings needs no second channel — and the two can never be read from different
   * variants and disagree about which chart is being dressed.
   */
  scaleAppearance?: unknown;
  /** PRD-46 §6: what a full ray of the RADAR stands for. Unread by the rose. */
  radarAxisLimit?: unknown;
}

const AXIS_LIMITS: readonly string[] = ["domain", "declared", "attempt"];

/**
 * The author's axis limit, defaulting to `domain`.
 *
 * An unknown value degrades to `domain` rather than to anything that redraws: a setting the
 * current build does not understand must not silently rescale a chart, because the figure
 * would still look plausible and nothing on screen would say it changed.
 */
export function axisLimitSetting(settings: ChartKindSettings): RadarAxisLimit {
  const raw = settings.radarAxisLimit;
  return typeof raw === "string" && AXIS_LIMITS.includes(raw) ? (raw as RadarAxisLimit) : "domain";
}

const KINDS: readonly string[] = ["none", "auto", "radar", "rose"];

/**
 * The author's choice, with PRD-35's boolean migrated.
 *
 * Absence resolves to `none`, never to `auto`: `auto` draws, and a default that draws would
 * put a diagram on every existing test whose author never asked for one (PRD-35 §9 forbids
 * exactly that). An unknown value degrades the same way — a saved setting the current build
 * does not understand must not silently pick a picture.
 */
export function chartKindSetting(settings: ChartKindSettings): ScalesChartKind {
  const explicit = settings.scalesChartKind;
  if (typeof explicit === "string") return KINDS.includes(explicit) ? explicit : "none";
  return settings.showCompetencyRadar === true ? "radar" : "none";
}

/**
 * The kind the author's PRD-35 boolean stands for while the new field is UNTOUCHED, or `null`
 * when nothing has to be carried over.
 *
 * {@link chartKindSetting} already migrates the boolean, but only where an untouched field is
 * still ABSENT — which holds for a results page, whose `settings_json` stores what the author
 * saved and nothing else. The report resolves its fields against the manifest first
 * (`resolveReportValues`), so by the time the kind is read, the untouched field already carries
 * the manifest default `none`, and an explicit `none` rightly outranks the boolean. The two
 * cases are indistinguishable afterwards, so the carry-over has to happen where the AUTHORED
 * values are still in hand.
 *
 * "Untouched" is `undefined`/`null` — the same absence `resolveReportValues` treats as "author
 * gave nothing"; an author who did open the selector and chose «Не показывать» has touched it,
 * and their choice stands.
 *
 * @param authored Values as the author saved them, BEFORE manifest defaults are merged in.
 */
export function legacyChartKind(authored: ChartKindSettings): ScalesChartKind | null {
  const explicit = authored.scalesChartKind;
  if (explicit !== undefined && explicit !== null) return null;
  return authored.showCompetencyRadar === true ? "radar" : null;
}

export interface ChartKindInput {
  setting: ScalesChartKind;
  /** Do the scales divide one whole? See `shared/scales/composition`. */
  ipsative: boolean;
  /** Is at least one visible scale showing a level instead of its value? */
  hasHiddenValue: boolean;
}

/**
 * Resolve the setting against the data.
 *
 * Two refusals of an explicitly chosen rose, for different reasons:
 *
 *   - scales that do NOT divide a whole still draw. Ipsativity is inferred from the model, and
 *     the author may know something about their method that the inference cannot see; the
 *     editor warns instead of overriding them.
 *   - a hidden value does NOT draw. That is not a judgement call: the rose states shares of a
 *     whole, and a share quantized to the middle of a band is no longer that share (PRD-46
 *     §3.4). `auto` falls back to the radar there, which survives quantization because its
 *     rays are independent.
 */
/**
 * One context shape for both diagrams.
 *
 * A discriminated union would be cleaner in TypeScript and useless in the layout: the DSL is a
 * mustache subset with no `case` and no comparison, so the markup can only ask «is this
 * truthy». Hence `isRadar` / `isRose` beside `kind`, and one flat object whose irrelevant
 * lists are EMPTY rather than absent — an empty DSL loop draws nothing, so both charts run
 * through the same block of markup without either knowing about the other.
 */
export interface CtxScalesChart {
  kind: "radar" | "rose";
  isRadar: boolean;
  isRose: boolean;
  width: number;
  height: number;
  labels: CtxChartLabel[];
  ariaLabel: string;
  /** Grid rings — both charts have them. */
  rings: { cx: number; cy: number; radius: number }[];
  /** Radar only; empty for the rose. */
  axes: CtxRadarAxis[];
  /** Radar only; empty string for the rose. */
  polygonPoints: string;
  /** Rose only; empty for the radar. */
  sectors: CtxRoseSector[];
  spokes: CtxRoseSpoke[];
  icons: CtxChartIcon[];
  /**
   * Radar only; empty for the rose AND under the default limit. What a full ray stands for,
   * in words — see {@link module:shared/template/radar-view CtxRadarChart.limitCaption}. The
   * rose needs no such line: its reference is the even-split ring, which is drawn.
   */
  limitCaption: string;
}

export interface ScalesChartInput {
  axes: RadarAxisInput[];
  ramp: LevelRamp;
  settings: ChartKindSettings;
  /** Do the scales divide one whole? See `shared/scales/composition`. */
  ipsative: boolean;
  /** Rose field mode; the radar ignores it. */
  field?: RoseField;
}

/**
 * Build whichever diagram the setting and the data call for, or `null`.
 *
 * `null` comes from two different places and means the same thing to the layout: this screen
 * has no diagram. Either the rule said so (`resolveChartKind`), or the builder refused the
 * figure it was asked for — too few visible scales, no domain, nothing to divide. The refusal
 * is NOT retried with the other chart: an author who asked for a rose and got a radar because
 * the rose could not be drawn would be shown a different claim about their data than the one
 * they chose. Only `auto` is allowed to pick, and it picks before either builder runs.
 */
export function buildScalesChart(input: ScalesChartInput): CtxScalesChart | null {
  // PRD-46: the author's look is applied HERE and not in either host. Both already hand over
  // the variant settings the map rides in, so one application point is also the only way the
  // two players cannot end up drawing differently coloured sectors from the same test — the
  // parity the PRD-29 §9 rule asks for, bought by construction rather than by two mirrored
  // edits kept in step by hand.
  const axes = applyScaleAppearance(input.axes, parseScaleAppearance(input.settings.scaleAppearance));
  const visible = axes.filter((a) => a.visibility !== "hidden");
  const kind = resolveChartKind({
    setting: chartKindSetting(input.settings),
    ipsative: input.ipsative,
    hasHiddenValue: visible.some((a) => a.visibility === "level"),
  });
  if (!kind) return null;

  if (kind === "rose") {
    const rose = buildRoseChart({ axes, ramp: input.ramp, field: input.field });
    if (!rose) return null;
    return {
      kind,
      isRadar: false,
      isRose: true,
      width: rose.width,
      height: rose.height,
      labels: rose.labels,
      ariaLabel: rose.ariaLabel,
      rings: rose.rings,
      axes: [],
      polygonPoints: "",
      sectors: rose.sectors,
      spokes: rose.spokes,
      icons: rose.icons,
      limitCaption: "",
    };
  }

  // Fed the dressed axes as well, though it reads neither field today: its vertices state the
  // level and its captions carry no glyph. Handing both builders the SAME axes is what keeps
  // «which figure is drawn» the only difference between the two branches.
  const radar = buildRadarChart({ axes, ramp: input.ramp, limit: axisLimitSetting(input.settings) });
  if (!radar) return null;
  return {
    kind,
    isRadar: true,
    isRose: false,
    width: radar.width,
    height: radar.height,
    labels: radar.labels,
    ariaLabel: radar.ariaLabel,
    rings: radar.rings,
    axes: radar.axes,
    polygonPoints: radar.polygonPoints,
    sectors: [],
    spokes: [],
    icons: [],
    limitCaption: radar.limitCaption,
  };
}

export function resolveChartKind(input: ChartKindInput): ResolvedChartKind {
  switch (input.setting) {
    case "none":
      return null;
    case "radar":
      return "radar";
    case "rose":
      return input.hasHiddenValue ? null : "rose";
    case "auto":
      return input.ipsative && !input.hasHiddenValue ? "rose" : "radar";
    default:
      return null;
  }
}
