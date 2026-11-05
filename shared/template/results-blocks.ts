/**
 * @module shared/template/results-blocks
 *
 * Resolves the results screen's block settings into three booleans.
 *
 * Each block is a three-position setting rather than a checkbox because the useful
 * default is "decide for me": the manifest cannot know whether a given test has a
 * pass threshold or visible scales. `auto` derives the answer from the test, while
 * `show` and `hide` let the author see and override that derivation — an implicit
 * rule the author cannot inspect reads as a bug the first time a block vanishes.
 *
 * The score bar under the screen header is the one exception to the three-position
 * rule: its `auto` has nothing of its own to derive and follows the score summary
 * (`summary`), so hiding the summary hides the bar with it, while `show`/`hide` let the
 * author part the two.
 *
 * Pure — no DOM, no Node.
 */

import type { ScalesChartKind } from "./scales-chart";

export type BlockSetting = "auto" | "show" | "hide";

/** The score bar's setting: `summary` follows the score summary, the other two override it. */
export type ScoreBarSetting = "summary" | "show" | "hide";

export interface ResultsBlockSettings {
  scoreSummary?: BlockSetting;
  /** The thin bar under the results header whose length is the score percent. */
  scoreBar?: ScoreBarSetting;
  indicators?: BlockSetting;
  scales?: BlockSetting;
  /**
   * PRD-46. Which cross-scale diagram to draw: `none` / `auto` / `radar` / `rose`.
   *
   * Four-valued, not the boolean PRD-35 declared. That boolean rested on «the answer is never
   * derivable», which stopped being true once the rose existed: whether the scales divide one
   * whole IS derivable from the contribution model, so `auto` now has something to read. The
   * choice between the two claims stays the author's — `auto` is opt-in, not the default.
   */
  scalesChartKind?: ScalesChartKind;
  /** PRD-35's boolean, read only when the four-valued key is absent. */
  showCompetencyRadar?: boolean;
}

/** What the test itself offers, used to answer `auto`. */
export interface ResultsBlockState {
  hasPassThreshold: boolean;
  hasVisibleScales: boolean;
  hasVisibleIndicators: boolean;
}

export interface ResultsBlocks {
  scoreSummary: boolean;
  indicators: boolean;
  scales: boolean;
}

/** Effective visibility of the two ways the screen prints the score. */
export interface ScoreDisplay {
  /** The score summary: the ring and the numbers beside it. */
  summary: boolean;
  /** The score bar under the header. */
  bar: boolean;
}

function resolve(setting: BlockSetting | undefined, auto: boolean): boolean {
  if (setting === "show") return true;
  if (setting === "hide") return false;
  return auto;
}

/** Effective visibility of each block. Unknown setting values degrade to `auto`. */
export function resolveResultsBlocks(
  settings: ResultsBlockSettings,
  state: ResultsBlockState,
): ResultsBlocks {
  return {
    scoreSummary: resolve(settings.scoreSummary, state.hasPassThreshold),
    indicators: resolve(settings.indicators, state.hasVisibleIndicators),
    scales: resolve(settings.scales, state.hasVisibleScales),
  };
}

/**
 * Effective visibility of the score summary and the score bar.
 *
 * @param settings The «Итоги» variant settings; only `scoreSummary` and `scoreBar` are read.
 * @param summaryAuto The `auto` answer for the summary, which the caller derives from the test.
 * @returns Both answers; an unknown `scoreBar` value degrades to following the summary.
 */
export function resolveScoreDisplay(
  settings: Pick<ResultsBlockSettings, "scoreSummary" | "scoreBar">,
  summaryAuto: boolean,
): ScoreDisplay {
  const summary = resolve(settings.scoreSummary, summaryAuto);
  const bar = settings.scoreBar === "show" ? true : settings.scoreBar === "hide" ? false : summary;
  return { summary, bar };
}
