/**
 * @module server/services/analytics/indicator-profile
 * @description PRD-56 FR-21c - FR-21e: the profile of a test by its indicators (PRD-2).
 *
 * The second half of FR-21, next to {@link module:server/services/analytics/scale-profile}. One
 * summary per indicator, and its form follows the indicator's TYPE:
 *
 *  - numeric with interpretation bands — the average and the shares of the bands, coloured
 *    exactly like the bands of a scale (`bandShares`, FR-21a); bands without runs are dropped;
 *  - numeric without bands — the average alone;
 *  - string and boolean — the shares of the outcomes (`findOutcome`, the same matching the
 *    learner's results screen uses). Without outcomes in the interpretation, the shares of the
 *    values themselves.
 *
 * VALUES ARE THE STORED ONES (FR-21e). A run that holds no value of an indicator — an old
 * package, an indicator not published to the LMS report — is counted as MISSING, never
 * recomputed from its answers and never taken as zero.
 */

import {
  findBand,
  parseIndicatorInterpretation,
  type LevelTone,
} from "@shared/scales/interpretation";
import type { LevelRamp } from "@shared/template/level-ramp";
import type { IndicatorValuesRow } from "../../storage/analytics-repository";
import { indicatorValueOf, matchOutcome, type IndicatorValue } from "./indicator-values";
import { categoryColor, OUTCOME_CATEGORY_COLORS, REST_CATEGORY_COLOR } from "./category-colors";
import { bandShares } from "./scale-profile";

/** An indicator of the test, as the profile reads it (`result_variables` row). */
export interface ProfileIndicator {
  name: string;
  label: string;
  type: string;
  configJson: unknown;
  sortOrder?: number | null;
}

/** One band, outcome or value group of an indicator. */
export interface IndicatorShare {
  /** Band level, outcome code, the value itself, or {@link REST_KEY}. */
  key: string;
  label: string;
  count: number;
  /** Percent of the runs that hold a value. */
  share: number;
  /** READY CSS colour: the screen prints it and never chooses one. */
  color: string;
  /** Tone set by the AUTHOR; `null` — the colour came from the ramp or the palette. */
  tone: LevelTone | null;
  /** The «Прочее» bucket: values outside the outcomes or past the visible groups. */
  rest?: boolean;
}

export interface IndicatorProfile {
  name: string;
  label: string;
  type: "number" | "string" | "boolean";
  /** Which summary the indicator gets (FR-21d). */
  kind: "bands" | "average" | "outcomes";
  /** Runs that hold a value — the denominator of the average and the shares. */
  sampleSize: number;
  /** Runs of the selection WITHOUT a value: shown as «не передано», never as zero. */
  missing: number;
  average: number | null;
  domainMin: number | null;
  domainMax: number | null;
  shares: IndicatorShare[];
  /**
   * Distribution of a numeric indicator WITHOUT bands (owner 2026-10-08: an average alone says
   * nothing about the group). Ten equal intervals of the domain; empty for other kinds.
   */
  histogram: HistogramBin[];
}

/** One interval of the histogram. */
export interface HistogramBin {
  /** «0–2», «7», «0,9–1». */
  label: string;
  from: number;
  to: number;
  count: number;
  /** Percent of the runs that hold a value. */
  share: number;
}

export interface IndicatorProfileOptions {
  /** The test's level ramp: bands of a numeric indicator take it, like bands of a scale. */
  ramp: LevelRamp;
  /**
   * Labels of the test's scales by key. A string indicator often stores scale KEYS («kom»,
   * «pro+cel» — a leading style, a close style); without outcomes those keys would reach the
   * screen as codes. With this map they read as the scales' names.
   */
  scaleLabels?: Readonly<Record<string, string>>;
  /**
   * The range of each numeric indicator over ALL runs of the test ({@link indicatorRanges}). An
   * indicator without a domain takes its intervals from here, so a filter or a slice does not
   * move their bounds and slices stay comparable interval by interval.
   */
  ranges?: Readonly<Record<string, { min: number; max: number }>>;
}

/** How many intervals the histogram of a numeric indicator has at most. */
const HISTOGRAM_BINS = 10;

/** A bound as the screen prints it: up to two decimals, Russian decimal mark. */
function boundText(value: number): string {
  return String(Math.round(value * 100) / 100).replace(".", ",");
}

/**
 * Min and max of every numeric indicator over the given rows.
 *
 * @param rows stored values of ALL runs of the test
 * @param indicators the test's indicators
 * @returns «name -> {min, max}» for indicators that hold at least one number
 */
export function indicatorRanges(
  rows: readonly IndicatorValuesRow[],
  indicators: readonly ProfileIndicator[],
): Record<string, { min: number; max: number }> {
  const out: Record<string, { min: number; max: number }> = {};
  for (const indicator of indicators) {
    if (indicator.type !== "number") continue;
    for (const row of rows) {
      const value = indicatorValueOf("number", row.values[indicator.name]);
      if (typeof value !== "number") continue;
      const range = out[indicator.name];
      if (!range) out[indicator.name] = { min: value, max: value };
      else {
        range.min = Math.min(range.min, value);
        range.max = Math.max(range.max, value);
      }
    }
  }
  return out;
}

/**
 * Histogram of numeric values over `[lo, hi]`.
 *
 * Integer data gets integer bounds: one interval per value when there are at most ten values,
 * otherwise intervals of `ceil(span / 10)` values («0–2», «3–5»). Fractional data gets ten equal
 * intervals. A value outside the range (a domain narrower than reality) lands in the edge interval
 * rather than vanishing.
 */
function histogramOf(values: readonly number[], lo: number, hi: number): HistogramBin[] {
  const total = values.length;
  const integer = Number.isInteger(lo) && Number.isInteger(hi) && values.every(Number.isInteger);
  const bins: Array<{ from: number; to: number; label: string }> = [];
  if (integer) {
    const span = hi - lo + 1;
    const width = Math.max(1, Math.ceil(span / HISTOGRAM_BINS));
    for (let from = lo; from <= hi; from += width) {
      const to = Math.min(hi, from + width - 1);
      bins.push({ from, to, label: from === to ? String(from) : `${from}–${to}` });
    }
  } else {
    const width = (hi - lo) / HISTOGRAM_BINS || 1;
    for (let i = 0; i < HISTOGRAM_BINS; i += 1) {
      const from = lo + width * i;
      const to = i === HISTOGRAM_BINS - 1 ? hi : lo + width * (i + 1);
      bins.push({ from, to, label: `${boundText(from)}–${boundText(to)}` });
    }
  }
  const counts = bins.map(() => 0);
  for (const value of values) {
    let index = bins.findIndex((bin, i) => (i === bins.length - 1 ? value <= bin.to : integer ? value <= bin.to : value < bin.to));
    if (value < lo) index = 0;
    if (index < 0) index = bins.length - 1;
    counts[index] += 1;
  }
  return bins.map((bin, i) => ({ ...bin, count: counts[i], share: percentOf(counts[i], total) }));
}

/** Key of the «Прочее» bucket; cannot clash with an outcome code or a band level. */
export const REST_KEY = "__rest__";

/** How many value groups an indicator WITHOUT outcomes shows before folding the tail. */
const VALUE_GROUPS_MAX = 6;

/**
 * Author's EVALUATIVE tone -> design-system colour (FR-21a). The «neutral» tone is absent on
 * purpose: it judges nothing, and painting it info-blue made every outcome of a typology the same
 * colour (live ЧИЛ data, 2026-10-08). A neutral outcome takes the categorical palette instead.
 */
const TONE_COLOR: Partial<Record<LevelTone, string>> = {
  favorable: "var(--ou-success-default)",
  attention: "var(--ou-warning-default)",
  critical: "var(--ou-error-default)",
};

/** Colour of an unordered category at `index`: outcomes have no «worse» or «better». */
function categoricalColor(index: number): string {
  return categoryColor(OUTCOME_CATEGORY_COLORS, index);
}

const percentOf = (count: number, total: number) => (total > 0 ? (count / total) * 100 : 0);

/** The «Прочее» bucket, or nothing when it is empty. */
function restShare(count: number, total: number): IndicatorShare[] {
  return count > 0
    ? [{ key: REST_KEY, label: "Прочее", count, share: percentOf(count, total), color: REST_CATEGORY_COLOR, tone: null, rest: true }]
    : [];
}

/**
 * How a value reads in a group of its own (no outcomes defined): a boolean as «Да» / «Нет», a
 * scale key or a «+»-set of scale keys by the scales' names, anything else as it is.
 */
function valueLabel(value: IndicatorValue, scaleLabels: Readonly<Record<string, string>>): string {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  const text = String(value);
  const parts = text.split("+").map(part => part.trim()).filter(Boolean);
  if (parts.length > 0 && parts.every(part => part in scaleLabels)) {
    return parts.map(part => scaleLabels[part]).join(", ");
  }
  return text;
}

/**
 * Fold groups that read the same into one share, in first-seen order.
 *
 * The reader tells shares apart by their LABEL only: two outcomes the author named alike
 * («Сфокусированный» for each single-style code) printed as two identical legend items and two
 * split shares. Summed, they answer the question the screen asks — how many runs got «Сфокусированный».
 * The key of a share is its label, so a slice comparison joins the same share across slices.
 */
function byLabel(groups: ReadonlyArray<{ label: string; count: number; tone: LevelTone | null }>): Array<{
  label: string; count: number; tone: LevelTone | null;
}> {
  const merged = new Map<string, { label: string; count: number; tone: LevelTone | null }>();
  for (const group of groups) {
    const seen = merged.get(group.label);
    if (seen) seen.count += group.count;
    else merged.set(group.label, { ...group });
  }
  return [...merged.values()];
}

/**
 * Shares of the outcomes of a string or boolean indicator.
 *
 * With outcomes: largest share first, empty outcomes dropped, alike labels folded, unmatched values
 * in «Прочее». The colour of an outcome is fixed by the position of its label among the
 * interpretation's labels — not by what this selection happened to contain — so the same outcome
 * keeps its colour in every slice. Without outcomes: groups of equal values, the most frequent
 * first, at most {@link VALUE_GROUPS_MAX}, the tail in «Прочее».
 */
function outcomeShares(
  values: readonly IndicatorValue[],
  interpretation: Pick<ReturnType<typeof parseIndicatorInterpretation>, "outcomes" | "bands">,
  scaleLabels: Readonly<Record<string, string>>,
): IndicatorShare[] {
  const total = values.length;
  const { outcomes, bands } = interpretation;

  if (outcomes.length > 0 || bands.length > 0) {
    // PRD-53 §7.1: one interpretation answers codes with OUTCOMES and old mask NUMBERS with BANDS
    // (ЧИЛ stored the style set as `9` before it stored `cel+pro`). The learner's screen reads both;
    // so does analytics — outcome first, then a band for a number. Before, every mask value fell
    // into «Прочее»: 48 % of a live test.
    const outcomeLabel = (outcome: (typeof outcomes)[number]) => outcome.label || outcome.code;
    const bandLabel = (band: (typeof bands)[number]) => band.label || band.level;
    const labelOrder = [...new Set([...outcomes.map(outcomeLabel), ...bands.map(bandLabel)])];
    const groups = new Map<string, { label: string; count: number; tone: LevelTone | null }>();
    let rest = 0;
    for (const value of values) {
      let label: string | null = null;
      let tone: LevelTone | null = null;
      // Tolerant to the WebTutor report, which writes «cel+kom» as «cel kom».
      const outcome = matchOutcome(outcomes, value);
      if (outcome) {
        label = outcomeLabel(outcome);
        tone = outcome.tone ?? null;
      } else if (typeof value === "number" || (typeof value === "string" && value.trim() !== "")) {
        const n = typeof value === "number" ? value : Number(value.trim().replace(",", "."));
        const band = Number.isFinite(n) ? findBand(bands, n) : null;
        if (band) {
          label = bandLabel(band);
          tone = band.tone ?? null;
        }
      }
      if (label === null) {
        rest += 1;
        continue;
      }
      const group = groups.get(label);
      if (group) group.count += 1;
      else groups.set(label, { label, count: 1, tone });
    }
    // Largest share first (owner 2026-10-08: a list of outcomes is read by size); a tie keeps the
    // author's order. The colour stays bound to the author's order, so it does not change when the
    // order of the rows does.
    const shares = [...groups.values()]
      .sort((x, y) => y.count - x.count || labelOrder.indexOf(x.label) - labelOrder.indexOf(y.label))
      .map(group => ({
        key: group.label,
        label: group.label,
        count: group.count,
        share: percentOf(group.count, total),
        color: (group.tone && TONE_COLOR[group.tone]) || categoricalColor(labelOrder.indexOf(group.label)),
        tone: group.tone,
      }));
    return [...shares, ...restShare(rest, total)];
  }

  const groups = byLabel(values.map(value => ({ label: valueLabel(value, scaleLabels), count: 1, tone: null })))
    .sort((a, b) => b.count - a.count);
  const visible = groups.slice(0, VALUE_GROUPS_MAX);
  const rest = groups.slice(VALUE_GROUPS_MAX).reduce((sum, group) => sum + group.count, 0);
  return [
    ...visible.map((group, index) => ({
      key: group.label,
      label: group.label,
      count: group.count,
      share: percentOf(group.count, total),
      color: categoricalColor(index),
      tone: null,
    })),
    ...restShare(rest, total),
  ];
}

/** The interval range of an indicator: its domain, else the whole test's range, else the selection's. */
function rangeOf(
  name: string,
  interpretation: { domainMin: number | null; domainMax: number | null },
  values: readonly number[],
  opts: IndicatorProfileOptions,
): [number, number] {
  if (interpretation.domainMin !== null && interpretation.domainMax !== null
    && interpretation.domainMax > interpretation.domainMin) {
    return [interpretation.domainMin, interpretation.domainMax];
  }
  const test = opts.ranges?.[name];
  if (test) return [test.min, test.max];
  return [Math.min(...values), Math.max(...values)];
}

/**
 * Profile of every indicator of the test, in the author's order.
 *
 * @param rows stored indicator values of the selection's runs (all sources)
 * @param indicators the test's indicators
 * @param opts the test's level ramp
 */
export function summariseIndicators(
  rows: readonly IndicatorValuesRow[],
  indicators: readonly ProfileIndicator[],
  opts: IndicatorProfileOptions,
): IndicatorProfile[] {
  return [...indicators]
    .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
    .map(indicator => {
      const type = indicator.type === "number" || indicator.type === "boolean" ? indicator.type : "string";
      const interpretation = parseIndicatorInterpretation(indicator.configJson);
      const values = rows
        .map(row => indicatorValueOf(type, row.values[indicator.name]))
        .filter((value): value is IndicatorValue => value !== null);

      const base = {
        name: indicator.name,
        label: indicator.label || indicator.name,
        type,
        sampleSize: values.length,
        missing: rows.length - values.length,
        domainMin: interpretation.domainMin,
        domainMax: interpretation.domainMax,
      } as const;

      if (type === "number") {
        const numbers = values as number[];
        const hasBands = interpretation.bands.length > 0;
        return {
          ...base,
          kind: hasBands ? "bands" : "average",
          // No value — no average: a zero would read as a measured zero.
          average: numbers.length > 0 ? numbers.reduce((sum, value) => sum + value, 0) / numbers.length : null,
          histogram: !hasBands && numbers.length > 0
            ? histogramOf(numbers, ...rangeOf(indicator.name, interpretation, numbers, opts))
            : [],
          shares: hasBands && numbers.length > 0
            // Bands nobody fell into are dropped, like empty outcomes: an indicator may carry many
            // bands (a real one has fifteen), and a legend of zeros hides the ones that matter.
            ? bandShares(numbers, interpretation, opts.ramp)
              .filter(band => band.count > 0)
              .map(({ level, ...band }) => ({ key: level, ...band }))
              // Alike labels become one row, like outcomes: the reader tells rows apart by label.
              .reduce<IndicatorShare[]>((out, band) => {
                const seen = out.find(row => row.label === band.label);
                if (seen) {
                  seen.count += band.count;
                  seen.share += band.share;
                } else out.push({ ...band });
                return out;
              }, [])
            : [],
        } satisfies IndicatorProfile;
      }

      return {
        ...base,
        kind: "outcomes",
        average: null,
        shares: outcomeShares(values, interpretation, opts.scaleLabels ?? {}),
        histogram: [],
      } satisfies IndicatorProfile;
    });
}
