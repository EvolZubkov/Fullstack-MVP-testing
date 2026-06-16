/**
 * @module shared/draw/feasibility
 *
 * Pure draw-feasibility core (PRD-15 block A, FR-04; BRD BRC-15; audit matrix
 * E-1..E-13). Given a topic's question pool AS IT WOULD BE AFTER a proposed
 * mutation (deletion, re-tagging, difficulty change, move) and the draw
 * requirements of every dependent test, it reports per-test issues:
 *
 * - `pool_shortfall`        — fewer questions than the section `drawCount` (E-1);
 * - `quota_shortfall`       — a blueprint stratum cannot be filled (E-3);
 * - `adaptive_shortfall`    — an adaptive level loses its minimum pool (E-4);
 * - `measurement_loss`      — removed questions carry scale contributions in
 *                             this test (E-5, the `question_measurements`
 *                             cascade);
 * - `draw_all_shrink`       — a `drawAll` section silently gets shorter (E-9;
 *                             advisory even for published tests).
 *
 * Blueprint feasibility is checked by SIMULATING the real draw
 * (`drawSection` with a deterministic shuffle), so the verdict is exactly as
 * strict as the runtime selection — same greedy stratum order, same shared
 * `used` set, same exact/min fill rules.
 *
 * The module is policy-free: it does not decide what blocks and what warns.
 * The caller (server/services/draw-feasibility, plan T-07) maps issues to the
 * PRD-15 policy — published dependents block with `409`, drafts warn —
 * except `draw_all_shrink`, which is always advisory (`advisory: true`).
 *
 * Per-test difficulty overrides (block D, FR-34) are applied per dependent
 * test, because the EFFECTIVE difficulty of the same question differs between
 * tests.
 */

import type { DrawBlueprint } from "../schema";
import { drawSection } from "./blueprint";

/**
 * Topic deletion also reports `content_pages_loss` — the dependent test's
 * before/after-topic pages reference the topic via a real FK; deleting the
 * topic destroys them (audit F-4 turned from an opaque 500 into a reason).
 */

/** A pool question as the feasibility check sees it (post-mutation state). */
export interface FeasibilityQuestion {
  id: string;
  tags?: string[];
  /** PRD-16: optional; null = «не задано» (doesn't fit any difficulty band). */
  difficulty: number | null;
}

/** Draw requirement of one dependent test's section on the mutated topic. */
export interface SectionRequirement {
  drawCount: number;
  drawAll: boolean;
  blueprint?: DrawBlueprint | null;
}

/** Pool requirement of one adaptive level (PRD: adaptive_levels row). */
export interface AdaptiveLevelRequirement {
  levelIndex: number;
  levelName?: string;
  minDifficulty: number;
  maxDifficulty: number;
  questionsCount: number;
}

/** Everything the check needs to know about one dependent test. */
export interface DependentTestRequirement {
  testId: string;
  /** Carried through verbatim for the caller's 409 payload. */
  title?: string;
  status?: string;
  ownerId?: string | null;
  section?: SectionRequirement | null;
  adaptiveLevels?: AdaptiveLevelRequirement[] | null;
  /** Question ids of this topic contributing to this test's scales (PRD-5). */
  measurementQuestionIds?: string[] | null;
  /**
   * Topic-scoped content pages (PRD-1 before/after-topic) of this test on the
   * mutated topic — they die with the topic (the accidental FK of audit F-4,
   * now reported as a reason instead of a 500).
   */
  topicPageCount?: number | null;
  /**
   * Result-variable names (PRD-2) whose formula references a tag that the
   * mutation empties across this test's pool (audit E-6). Computed by the
   * service; the core only forwards it as an issue.
   */
  formulaLossVariableNames?: string[] | null;
  /** Per-test effective-difficulty overrides (block D): questionId -> value. */
  difficultyOverrides?: Record<string, number> | null;
}

export type FeasibilityIssue =
  | { kind: "pool_shortfall"; required: number; available: number }
  | { kind: "quota_shortfall"; tag: string; requested: number; available: number }
  | {
      kind: "adaptive_shortfall";
      levelIndex: number;
      levelName?: string;
      required: number;
      available: number;
    }
  | { kind: "measurement_loss"; questionIds: string[] }
  | { kind: "content_pages_loss"; pageCount: number }
  | { kind: "formula_loss"; variableNames: string[] }
  | { kind: "draw_all_shrink"; removed: number; remaining: number; advisory: true };

export interface TestFeasibility {
  testId: string;
  title?: string;
  status?: string;
  ownerId?: string | null;
  issues: FeasibilityIssue[];
}

export interface FeasibilityInput {
  /** The topic's pool AFTER the proposed mutation. */
  pool: FeasibilityQuestion[];
  /** Ids removed from the topic by the mutation (deletion or move away). */
  removedQuestionIds?: string[];
  tests: DependentTestRequirement[];
}

/** Deterministic shuffle: feasibility must not depend on randomness. */
const identityShuffle = <T>(arr: T[]): T[] => arr;

function checkSection(pool: FeasibilityQuestion[], section: SectionRequirement): FeasibilityIssue[] {
  if (section.drawAll) return [];
  const issues: FeasibilityIssue[] = [];
  const { selected, warnings } = drawSection(
    pool,
    section.drawCount,
    section.blueprint ?? null,
    identityShuffle,
  );
  for (const w of warnings) {
    issues.push({ kind: "quota_shortfall", tag: w.tag, requested: w.requested, available: w.available });
  }
  if (selected.length < section.drawCount) {
    issues.push({ kind: "pool_shortfall", required: section.drawCount, available: selected.length });
  }
  return issues;
}

function checkAdaptive(
  pool: FeasibilityQuestion[],
  levels: AdaptiveLevelRequirement[],
  overrides: Record<string, number> | null | undefined,
): FeasibilityIssue[] {
  const issues: FeasibilityIssue[] = [];
  for (const level of levels) {
    const available = pool.filter((q) => {
      const difficulty = overrides?.[q.id] ?? q.difficulty;
      // PRD-16: «не задано» (null) doesn't fit any difficulty band.
      if (difficulty == null) return false;
      return difficulty >= level.minDifficulty && difficulty <= level.maxDifficulty;
    }).length;
    if (available < level.questionsCount) {
      issues.push({
        kind: "adaptive_shortfall",
        levelIndex: level.levelIndex,
        levelName: level.levelName,
        required: level.questionsCount,
        available,
      });
    }
  }
  return issues;
}

/**
 * Checks every dependent test against the post-mutation pool. Returns an entry
 * per test that has at least one issue; tests that stay feasible are omitted.
 */
export function checkDrawFeasibility(input: FeasibilityInput): TestFeasibility[] {
  const removed = new Set(input.removedQuestionIds ?? []);
  const results: TestFeasibility[] = [];

  for (const test of input.tests) {
    const issues: FeasibilityIssue[] = [];

    if (test.section) {
      issues.push(...checkSection(input.pool, test.section));
      if (test.section.drawAll && removed.size > 0) {
        issues.push({
          kind: "draw_all_shrink",
          removed: removed.size,
          remaining: input.pool.length,
          advisory: true,
        });
      }
    }

    if (test.adaptiveLevels && test.adaptiveLevels.length > 0) {
      issues.push(...checkAdaptive(input.pool, test.adaptiveLevels, test.difficultyOverrides));
    }

    if (test.measurementQuestionIds && test.measurementQuestionIds.length > 0 && removed.size > 0) {
      const lost = test.measurementQuestionIds.filter((id) => removed.has(id));
      if (lost.length > 0) issues.push({ kind: "measurement_loss", questionIds: lost });
    }

    if (typeof test.topicPageCount === "number" && test.topicPageCount > 0) {
      issues.push({ kind: "content_pages_loss", pageCount: test.topicPageCount });
    }

    if (test.formulaLossVariableNames && test.formulaLossVariableNames.length > 0) {
      issues.push({ kind: "formula_loss", variableNames: test.formulaLossVariableNames });
    }

    if (issues.length > 0) {
      results.push({
        testId: test.testId,
        title: test.title,
        status: test.status,
        ownerId: test.ownerId,
        issues,
      });
    }
  }

  return results;
}
