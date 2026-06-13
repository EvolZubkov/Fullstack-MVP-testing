/**
 * @module shared/scoring/effective-scoring
 *
 * Pure resolver of the EFFECTIVE per-question scoring inside a specific test
 * (PRD-15, block D; BRD BRC-17..BRC-19). Scoring is a property of the test,
 * not of the question: the question row carries only content, while the price
 * and the graded config come from the test-side chain
 *
 *   per-question override (test_question_scoring)
 *     -> section default (test_sections.default_points)
 *     -> test default (tests.default_question_points)
 *     -> system default: 1 point, exact match (no partial credit)
 *
 * The graded config (`QuestionScoring`) has no section/test default — weights
 * and tiers reference concrete options of one question, so the chain for it is
 * override -> system `exact`.
 *
 * Difficulty follows its own two-step chain (PRD-15 FR-34): per-test override
 * -> the question's base difficulty.
 *
 * Note: `questions.points` / `questions.scoring_json` were dropped in T-40, so
 * no caller feeds the optional `legacy` link any more (the chain resolves from
 * the override and the section/test defaults). The `legacy` input is retained
 * as a pure, side-effect-free seam — historically it carried the question's own
 * values for bit-identical pre-backfill behaviour, and keeping it costs nothing
 * while documenting the migration.
 *
 * The module is dependency-free (besides schema types) so the web runtime, the
 * server-side recompute, the SCORM builder and the publication snapshots
 * (block B) all share one implementation.
 */

import type { QuestionScoring } from "../schema";

/** System default price: 1 point for a fully correct answer. */
export const SYSTEM_DEFAULT_POINTS = 1;

/** System default graded config: exact match, no partial credit (FR-31). */
export const SYSTEM_DEFAULT_SCORING: QuestionScoring = { kind: "exact" };

/** Where a resolved value came from (for UI explainability and tests). */
export type PointsSource = "override" | "legacy" | "section" | "test" | "system";
export type ScoringSource = "override" | "legacy" | "system";

/** Per-(test, question) override row (test_question_scoring projection). */
export interface QuestionScoringOverride {
  points?: number | null;
  scoring?: QuestionScoring | null;
  difficulty?: number | null;
  /** Question contentHash the override was authored against (staleness pin). */
  pinnedContentHash?: string | null;
}

/** Test-side defaults of the chain (section first, then test). */
export interface ScoringDefaults {
  sectionDefaultPoints?: number | null;
  testDefaultPoints?: number | null;
}

/**
 * Transitional carrier of the question's own scoring columns; used only until
 * the columns are dropped (T-40). See the module header.
 */
export interface LegacyQuestionScoring {
  points?: number | null;
  scoring?: QuestionScoring | null;
}

export interface ResolveScoringInput {
  override?: QuestionScoringOverride | null;
  defaults?: ScoringDefaults | null;
  legacy?: LegacyQuestionScoring | null;
  /** Current contentHash of the question (staleness check input). */
  questionContentHash?: string | null;
}

export interface EffectiveScoring {
  /** Effective price of the question inside this test (>= 0). */
  points: number;
  /** Effective graded config; never null — system default is `exact`. */
  scoring: QuestionScoring;
  /** Which chain link produced each value. */
  source: { points: PointsSource; scoring: ScoringSource };
  /**
   * True when the override was pinned to a contentHash that no longer matches
   * the question — the editor must surface "настройка устарела" (FR-30).
   */
  stale: boolean;
}

/** A finite, non-negative number — anything else falls through the chain. */
function isValidPoints(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Resolves the effective price and graded config of one question inside one
 * test by walking the chain override -> legacy -> section -> test -> system.
 * Pure and total: any malformed link is skipped, the system default always
 * terminates the chain.
 */
export function resolveEffectiveScoring(input: ResolveScoringInput): EffectiveScoring {
  const { override, defaults, legacy, questionContentHash } = input;

  let points = SYSTEM_DEFAULT_POINTS;
  let pointsSource: PointsSource = "system";
  if (override && isValidPoints(override.points)) {
    points = override.points;
    pointsSource = "override";
  } else if (legacy && isValidPoints(legacy.points)) {
    points = legacy.points;
    pointsSource = "legacy";
  } else if (defaults && isValidPoints(defaults.sectionDefaultPoints)) {
    points = defaults.sectionDefaultPoints;
    pointsSource = "section";
  } else if (defaults && isValidPoints(defaults.testDefaultPoints)) {
    points = defaults.testDefaultPoints;
    pointsSource = "test";
  }

  let scoring: QuestionScoring = SYSTEM_DEFAULT_SCORING;
  let scoringSource: ScoringSource = "system";
  if (override?.scoring) {
    scoring = override.scoring;
    scoringSource = "override";
  } else if (legacy?.scoring) {
    scoring = legacy.scoring;
    scoringSource = "legacy";
  }

  const stale =
    !!override &&
    !!override.pinnedContentHash &&
    !!questionContentHash &&
    override.pinnedContentHash !== questionContentHash;

  return { points, scoring, source: { points: pointsSource, scoring: scoringSource }, stale };
}

/**
 * Resolves the effective difficulty of a question inside a test: the per-test
 * override wins over the question's base value (FR-34). Adaptive draw must use
 * this value, not the raw column.
 */
export function resolveEffectiveDifficulty(
  override: number | null | undefined,
  questionDifficulty: number,
): number {
  return typeof override === "number" && Number.isFinite(override) ? override : questionDifficulty;
}
