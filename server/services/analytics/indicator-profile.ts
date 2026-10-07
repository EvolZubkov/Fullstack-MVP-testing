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
  findOutcome,
  parseIndicatorInterpretation,
  type LevelTone,
} from "@shared/scales/interpretation";
import type { LevelRamp } from "@shared/template/level-ramp";
import type { IndicatorValuesRow } from "../../storage/analytics-repository";
import { indicatorValueOf, type IndicatorValue } from "./indicator-values";
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
}

export interface IndicatorProfileOptions {
  /** The test's level ramp: bands of a numeric indicator take it, like bands of a scale. */
  ramp: LevelRamp;
}

/** Key of the «Прочее» bucket; cannot clash with an outcome code or a band level. */
export const REST_KEY = "__rest__";

/** How many value groups an indicator WITHOUT outcomes shows before folding the tail. */
const VALUE_GROUPS_MAX = 6;

/** Author's tone -> design-system colour (FR-21a). */
const TONE_COLOR: Record<LevelTone, string> = {
  favorable: "var(--ou-success-default)",
  neutral: "var(--ou-info-default)",
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

/** How a value reads in a group of its own (no outcomes defined). */
function valueLabel(value: IndicatorValue): string {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  return String(value);
}

/**
 * Shares of the outcomes of a string or boolean indicator.
 *
 * With outcomes: the author's order, empty outcomes dropped, unmatched values in «Прочее».
 * Without them: groups of equal values, the most frequent first, at most {@link VALUE_GROUPS_MAX},
 * the tail in «Прочее».
 */
function outcomeShares(
  values: readonly IndicatorValue[],
  outcomes: ReturnType<typeof parseIndicatorInterpretation>["outcomes"],
): IndicatorShare[] {
  const total = values.length;

  if (outcomes.length > 0) {
    const counts = new Map<string, number>();
    let rest = 0;
    for (const value of values) {
      const outcome = findOutcome(outcomes, value as string | boolean);
      if (outcome) counts.set(outcome.code, (counts.get(outcome.code) ?? 0) + 1);
      else rest += 1;
    }
    const shares: IndicatorShare[] = [];
    outcomes.forEach((outcome, index) => {
      const count = counts.get(outcome.code) ?? 0;
      if (count === 0) return;
      shares.push({
        key: outcome.code,
        label: outcome.label || outcome.code,
        count,
        share: percentOf(count, total),
        color: outcome.tone ? TONE_COLOR[outcome.tone] : categoricalColor(index),
        tone: outcome.tone ?? null,
      });
    });
    return [...shares, ...restShare(rest, total)];
  }

  const groups = new Map<string, { value: IndicatorValue; count: number }>();
  for (const value of values) {
    const key = String(value);
    const group = groups.get(key);
    if (group) group.count += 1;
    else groups.set(key, { value, count: 1 });
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].count - a[1].count);
  const visible = ordered.slice(0, VALUE_GROUPS_MAX);
  const rest = ordered.slice(VALUE_GROUPS_MAX).reduce((sum, [, group]) => sum + group.count, 0);
  return [
    ...visible.map(([key, group], index) => ({
      key,
      label: valueLabel(group.value),
      count: group.count,
      share: percentOf(group.count, total),
      color: categoricalColor(index),
      tone: null,
    })),
    ...restShare(rest, total),
  ];
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
          shares: hasBands && numbers.length > 0
            // Bands nobody fell into are dropped, like empty outcomes: an indicator may carry many
            // bands (a real one has fifteen), and a legend of zeros hides the ones that matter.
            ? bandShares(numbers, interpretation, opts.ramp)
              .filter(band => band.count > 0)
              .map(({ level, ...band }) => ({ key: level, ...band }))
            : [],
        } satisfies IndicatorProfile;
      }

      return {
        ...base,
        kind: "outcomes",
        average: null,
        shares: outcomeShares(values, interpretation.outcomes),
      } satisfies IndicatorProfile;
    });
}
