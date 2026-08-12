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
 * Pure — no DOM, no Node.
 */

import type { ScalesChartKind } from "./scales-chart";

export type BlockSetting = "auto" | "show" | "hide";

export interface ResultsBlockSettings {
  scoreSummary?: BlockSetting;
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
