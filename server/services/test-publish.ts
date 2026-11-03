/**
 * @module server/services/test-publish
 * @description Publishing a test as one operation shared by the two places that publish:
 * the «Опубликовать» action (`PATCH /api/tests/:id/status`) and the SCORM export.
 *
 * Owner decision Р7а (2026-10-31, plan `docs/plans/2026-10-01-analytics-ux-plan.md`, Э5):
 * a SCORM export IS a publication. A draft, or a published test edited after its last
 * publication, is published by the export, and the package is baked from the new snapshot —
 * so every package carries the publication version it was built from (PRD-56 FR-19a). A
 * published test without changes exports its active snapshot and gets no new version.
 * Archived tests are outside the decision and keep their previous behaviour (live bake, no
 * publication) until the archive workflow is designed.
 */
import { storage } from "../storage";
import { logger } from "../logger";
import { assessTestPublish, type PublishCheckFinding } from "./draw-feasibility";
import { assessBreakdownPublish } from "./breakdown-warnings";
import { assessScoringPublish, type ScoringWarning } from "./scoring-warnings";
import { createTestSnapshot, getPublicationState } from "./test-snapshot";

/** Result of {@link publishTest}. */
export type PublishOutcome =
  | {
    ok: true;
    /** The status row as `patchTestStatus` returns it. */
    updated: { id: string; status: string; version: number };
    /** PRD-50 FR-45 - FR-47: advisory notes, never a reason to refuse. */
    breakdownWarnings: Awaited<ReturnType<typeof assessBreakdownPublish>>;
    /** Advisory notes about answer scoring (weighted reference mismatch); never a refusal. */
    scoringWarnings: ScoringWarning[];
  }
  | {
    ok: false;
    /** PRD-15 FR-06 (E-12): why the draw cannot be delivered with the current pools. */
    findings: PublishCheckFinding[];
  };

/**
 * Publish a test: check the draw is feasible, flip the status and freeze a new snapshot.
 *
 * @param testId test
 * @param publishedBy user recorded on the snapshot
 * @returns the outcome; `null` when the test is missing
 */
export async function publishTest(testId: string, publishedBy: string | null): Promise<PublishOutcome | null> {
  // PRD-15 FR-06 (E-12): a test must not be published with an infeasible draw — pools,
  // blueprint quotas and adaptive levels are checked against the current bank state.
  const findings = await assessTestPublish(testId);
  if (findings.length > 0) return { ok: false, findings };

  const updated = await storage.patchTestStatus(testId, "published");
  if (!updated) return null;

  // PRD-15 FR-10: publishing (and re-publishing) freezes the test into a new snapshot.
  // Delivery of this test now reads from the snapshot; edits to the bank do not affect it
  // until the next publish.
  await createTestSnapshot(testId, publishedBy);

  // PRD-50 FR-45 - FR-47: warnings, not prohibitions. Gathered AFTER the publication has
  // succeeded, so a failure to gather them is swallowed and logged rather than turning that
  // success into an error for the author.
  let breakdownWarnings: Awaited<ReturnType<typeof assessBreakdownPublish>> = [];
  try {
    breakdownWarnings = await assessBreakdownPublish(testId);
  } catch (error) {
    logger.error("breakdown publish warnings failed: " + (error as Error).message, "tests");
  }
  // Same policy for the scoring notes: they speak after the fact and never fail the publish.
  let scoringWarnings: ScoringWarning[] = [];
  try {
    scoringWarnings = await assessScoringPublish(testId);
  } catch (error) {
    logger.error("scoring publish warnings failed: " + (error as Error).message, "tests");
  }
  return { ok: true, updated, breakdownWarnings, scoringWarnings };
}

/** What a SCORM export of a test does with its publication (decision Р7а). */
export interface ScormPublicationPlan {
  /** The export publishes the test first. */
  publishes: boolean;
  /**
   * The publication version the package will carry: the next one when {@link publishes},
   * the active one otherwise. `null` — the package is baked live without a version
   * (archived test, outside the decision).
   */
  version: number | null;
}

/**
 * Decide what a SCORM export of `testId` does with its publication. The export route and
 * the «Сохранить как…» window both read this, so the window promises exactly what happens.
 *
 * @param testId test
 * @returns the plan; `null` when the test is missing
 */
export async function planScormPublication(testId: string): Promise<ScormPublicationPlan | null> {
  const test = await storage.getTest(testId);
  if (!test) return null;
  if (test.status === "archived") return { publishes: false, version: null };

  const latest = await storage.getLatestSnapshot(testId);
  const next = (latest?.version ?? 0) + 1;
  // A test published before snapshots existed has nothing to bake from: it is published anew.
  if (test.status !== "published" || !latest) return { publishes: true, version: next };

  const { state } = await getPublicationState(testId);
  return state === "published_with_changes"
    ? { publishes: true, version: next }
    : { publishes: false, version: latest.version };
}
