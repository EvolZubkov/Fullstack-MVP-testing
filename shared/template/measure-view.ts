/**
 * @module shared/template/measure-view
 *
 * Turns one scale or one result variable into the card the results screen draws.
 * The card is a fixed composition of four slots — name, value, level, explanation —
 * and the chosen render kind governs the VALUE slot only. That is why a diagram and
 * a "your level" label never compete: the level is always present.
 *
 * Everything the layout needs is precomputed here (zone geometry, zone colours,
 * marker position, ring offset, the fallen-back render kind), so the DSL binds
 * values and never computes. Both hosts call this module, so a scale cannot render
 * differently in the web player and in the SCORM package.
 *
 * Pure — no DOM, no Node.
 */

import {
  findBand,
  findOutcome,
  type IndicatorInterpretation,
  type LearnerVisibility,
  type LevelTone,
  type ScaleInterpretation,
  type Valence,
} from "../scales/interpretation";
import { rampColor, zoneColors, type HslTriple, type LevelRamp } from "./level-ramp";
import { richTextToHtml } from "./rich-text";

export type RenderKind = "label" | "value" | "value_of_max" | "ring" | "band_ruler" | "gradient_bar";

/** Ring geometry from `layouts/results.html` (`<circle r="63">`). */
const RING_CIRCUMFERENCE = 2 * Math.PI * 63;

export interface CtxMeasureZone {
  label: string;
  leftPercent: number;
  widthPercent: number;
  color: HslTriple;
  current: boolean;
}

export interface CtxMeasureMark {
  percent: number;
  label: string;
}

export type BannerVariant = "success" | "info" | "warning" | "error";

export interface CtxMeasureView {
  key: string;
  name: string;
  renderKind: RenderKind;
  showValue: boolean;
  valueText: string;
  maxText: string;
  valueLabel: string;
  levelLabel: string;
  tone: LevelTone;
  toneClass: string;
  bannerVariant: BannerVariant;
  text?: string;
  /**
   * Толкование РАЗМЕТКОЙ: то же, что {@link CtxMeasureView.text}, пропущенное через
   * {@link module:shared/template/rich-text}. Абзацы, которыми автор разделил объяснение
   * уровня, доходят до слушателя переносами, а не схлопываются в полотно. Идёт рядом со
   * строкой, а не вместо неё: `text` печатают макеты внешних шаблонов.
   */
  textHtml?: string;
  zones: CtxMeasureZone[];
  marks: CtxMeasureMark[];
  markerPercent?: number;
  percent?: number;
  ringDashoffset?: number;
  /**
   * Explicit «this is a ring» switch. The layout cannot branch on `renderKind`
   * (the DSL has no comparisons), and branching on `ringDashoffset` would break at
   * the top of the scale: a learner scoring `domainMax` gets an offset of exactly 0,
   * and the ring would silently disappear for the one result that fills it.
   */
  isRing?: boolean;
  /**
   * Screen-reader label for the rail: a stack of `span`s conveys nothing without it.
   * Core-prepared because the layout has no way to assemble the sentence from the
   * parts it binds.
   */
  ariaLabel?: string;
}

/**
 * Tone to DS presentation. The tag gets a template class, the indicator banner a
 * DS modifier — the layout binds a prepared string and never maps anything itself.
 */
const BANNER_BY_TONE: Record<LevelTone, BannerVariant> = {
  favorable: "success",
  neutral: "info",
  attention: "warning",
  critical: "error",
};

export interface MeasureCapabilities {
  hasDomain: boolean;
  hasBands: boolean;
  isNumeric: boolean;
}

export interface MeasureViewInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  visibility: LearnerVisibility;
  interpretation: ScaleInterpretation | IndicatorInterpretation;
  /** Author's choice from the design params, before feasibility fallback. */
  requestedKind: RenderKind;
  ramp: LevelRamp;
}

/**
 * Fallback chain per requested kind, most-preferred first. A single "descending
 * richness" list cannot express this, because degradation is not one-dimensional.
 *
 * A ring reports a PERCENT, and for a scale with `normalization: none` a percent is
 * undefined — that is the premise of this whole feature. So a ring is legitimate only
 * as the author's explicit choice and must never be an automatic substitute for a
 * bar; otherwise the tool invents a number the methodology never produced.
 *
 * A gradient bar carries the opposite risk: without bands there is no level, no tone
 * and no explanatory text, so a colour continuum would imply an evaluation the author
 * never made. It degrades to the plain «27 из 45», which claims nothing.
 *
 * Between the two linear readouts the move is sideways, not down: a bar asked for with
 * bands present becomes the banded ruler, and a ruler asked for without bands becomes
 * the plain value.
 */
const FALLBACK_CHAINS: Record<RenderKind, RenderKind[]> = {
  gradient_bar: ["gradient_bar", "band_ruler", "value_of_max", "value", "label"],
  band_ruler: ["band_ruler", "value_of_max", "value", "label"],
  ring: ["ring", "value_of_max", "value", "label"],
  value_of_max: ["value_of_max", "value", "label"],
  value: ["value", "label"],
  label: ["label"],
};

function isFeasible(kind: RenderKind, caps: MeasureCapabilities): boolean {
  if (!caps.isNumeric) return kind === "label";
  switch (kind) {
    case "gradient_bar":
      return caps.hasDomain && !caps.hasBands;
    case "band_ruler":
      return caps.hasDomain && caps.hasBands;
    case "ring":
    case "value_of_max":
      return caps.hasDomain;
    case "value":
    case "label":
      return true;
  }
}

/**
 * The kind actually drawn: the requested one when feasible, else the next feasible
 * kind down the ladder. A fallback is normal operation, not an error — an author
 * picks one kind for the whole test and its scales differ.
 */
export function resolveRenderKind(requested: RenderKind, caps: MeasureCapabilities): RenderKind {
  for (const kind of FALLBACK_CHAINS[requested] ?? ["label"]) {
    if (isFeasible(kind, caps)) return kind;
  }
  return "label";
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function outcomesOf(i: ScaleInterpretation | IndicatorInterpretation) {
  return (i as IndicatorInterpretation).outcomes ?? [];
}

/** Zone geometry: each band runs to the NEXT band's start, so zones are contiguous. */
function buildZones(
  input: MeasureViewInput,
  domainMin: number,
  domainMax: number,
  currentLevel: string,
): CtxMeasureZone[] {
  const bands = input.interpretation.bands;
  const span = domainMax - domainMin;
  if (span <= 0) return [];
  const colors = zoneColors(input.ramp, bands.length, input.interpretation.valence);
  return bands.map((band, i) => {
    const right = i + 1 < bands.length ? bands[i + 1].min : domainMax;
    return {
      label: band.label ?? band.level,
      leftPercent: round1(((band.min - domainMin) / span) * 100),
      widthPercent: round1(((right - band.min) / span) * 100),
      color: colors[i],
      current: band.level === currentLevel && currentLevel !== "",
    };
  });
}

/**
 * Tone of the current level: the author's override, else the ramp position.
 *
 * The thresholds mirror the RAMP, not an independent ladder: the tag sits next to a
 * zone painted from the same position, so a midpoint that reads yellow on the ruler
 * must not read blue on the tag. `neutral` is therefore reserved for `valence: none`
 * — the one case that genuinely carries no evaluation.
 */
function toneOf(
  input: MeasureViewInput,
  override: LevelTone | undefined,
  index: number,
  count: number,
): LevelTone {
  if (override) return override;
  return deriveLevelTone(input.interpretation.valence, index, count);
}

/**
 * The tone a level carries when its author left «Авто»: derived from the scale's
 * valence and the level's position on the ramp. Exported because the AUTHOR-side
 * levels editor paints its coverage ribbon with it — a ribbon that previewed the
 * split in colours the learner never sees would preview nothing.
 *
 * @public
 */
export function deriveLevelTone(valence: Valence, index: number, count: number): LevelTone {
  if (valence === "none" || count <= 1 || index < 0) return "neutral";
  const position = index / (count - 1);
  const t = valence === "lower_is_better" ? 1 - position : position;
  if (t >= 0.75) return "favorable";
  if (t >= 0.375) return "attention";
  return "critical";
}

/**
 * Build the card. `value` may be a number (scale, numeric indicator), a string
 * (indicator outcome code) or a boolean; the shape of the interpretation decides
 * how it is matched.
 */
export function buildMeasureView(input: MeasureViewInput): CtxMeasureView {
  const { interpretation } = input;
  const isNumeric = typeof input.value === "number" && Number.isFinite(input.value);
  const hasDomain = interpretation.domainMin !== null && interpretation.domainMax !== null;
  const hasBands = interpretation.bands.length > 0;
  const renderKind = resolveRenderKind(input.requestedKind, { hasDomain, hasBands, isNumeric });
  // The render kind governs the FORM of the value slot (ruler, ring, bar, plain number);
  // the visibility governs whether the value is shown AT ALL. So the gate here is
  // numeric-ness, not the kind: `label` means «no diagram», never «no number».
  //
  // It used to read `renderKind !== "label"`, and that silenced the value of every
  // NUMERIC measure drawn as a label — which is the default of «Вид показателей» in the
  // shipped template. A numeric indicator without interpretation bands then had nothing
  // left: no level (no bands) and no value (this gate), so its card rendered as an empty
  // banner beside string indicators that read fine.
  //
  // A non-numeric measure keeps `showValue: false`, and that is not an exception to the
  // rule but the same rule: its value IS the outcome label the level slot already prints,
  // so a value slot would print the code twice.
  const showValue = input.visibility === "level_and_value" && isNumeric;

  const base: CtxMeasureView = {
    key: input.key,
    name: input.name,
    renderKind,
    showValue,
    valueText: "",
    maxText: "",
    valueLabel: "",
    levelLabel: "",
    tone: "neutral",
    toneClass: "tb-tone--neutral",
    bannerVariant: "info",
    zones: [],
    marks: [],
  };

  if (!isNumeric) {
    const outcomes = outcomesOf(interpretation);
    const outcome = findOutcome(outcomes, input.value as string | boolean);
    // No dictionary entry for this code (or none configured at all): the tone stays
    // neutral, but the raw value still prints — an empty title is indistinguishable
    // from a broken render, while the value itself is always known.
    if (!outcome) return { ...base, levelLabel: String(input.value ?? "") };
    const tone = outcome.tone ?? "neutral";
    return {
      ...base,
      levelLabel: outcome.label,
      tone,
      toneClass: `tb-tone--${tone}`,
      bannerVariant: BANNER_BY_TONE[tone],
      ...(outcome.text ? { text: outcome.text, textHtml: richTextToHtml(outcome.text) } : {}),
    };
  }

  const value = input.value as number;
  const domainMin = interpretation.domainMin ?? 0;
  const domainMax = interpretation.domainMax ?? 0;
  const band = findBand(interpretation.bands, value);
  const bandIndex = band ? interpretation.bands.indexOf(band) : -1;

  const tone = toneOf(input, band?.tone, bandIndex, interpretation.bands.length);
  const view: CtxMeasureView = {
    ...base,
    valueText: String(round1(value)),
    maxText: hasDomain ? String(round1(domainMax)) : "",
    valueLabel: hasDomain ? `${round1(value)} из ${round1(domainMax)}` : String(round1(value)),
    levelLabel: band ? band.label ?? band.level : "",
    tone,
    toneClass: `tb-tone--${tone}`,
    bannerVariant: BANNER_BY_TONE[tone],
    ...(band?.text ? { text: band.text, textHtml: richTextToHtml(band.text) } : {}),
  };

  if (!hasDomain) return view;

  const span = domainMax - domainMin;
  const ratio = span > 0 ? (value - domainMin) / span : 0;
  const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;

  if (renderKind === "band_ruler") {
    view.zones = buildZones(input, domainMin, domainMax, band?.level ?? "");
    view.markerPercent = round1(clamped * 100);
    // Boundaries are NUMBERS under the rail; the level NAME lives in the tag beside
    // it. Printing zone names under the rail crowds three labels into a 6px track and
    // breaks entirely on a narrow screen — the tag says it once, unambiguously.
    view.marks = [
      { percent: 0, label: String(round1(domainMin)) },
      ...interpretation.bands
        .slice(1)
        .map((b) => ({ percent: round1(((b.min - domainMin) / span) * 100), label: String(round1(b.min)) })),
      { percent: 100, label: String(round1(domainMax)) },
    ];
  }
  if (renderKind === "gradient_bar") {
    view.markerPercent = round1(clamped * 100);
    view.zones = [
      {
        label: "",
        leftPercent: 0,
        widthPercent: 100,
        color: rampColor(input.ramp, interpretation.valence === "lower_is_better" ? 1 - clamped : clamped),
        current: true,
      },
    ];
  }
  if (renderKind === "ring") {
    view.percent = Math.round(clamped * 100);
    view.ringDashoffset = round1(RING_CIRCUMFERENCE * (1 - clamped));
    view.isRing = true;
  }

  if (renderKind === "band_ruler" || renderKind === "gradient_bar" || renderKind === "ring") {
    const level = view.levelLabel ? `, уровень: ${view.levelLabel}` : "";
    view.ariaLabel = `${input.name}: ${view.valueText} из ${view.maxText}${level}`;
  }

  return view;
}
