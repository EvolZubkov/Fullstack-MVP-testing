/**
 * @module server/storage/tests-repository
 * @description Data access for the test aggregate: the `tests` row lifecycle
 * (read with legacy normalization, versioned update, status patch, deep delete),
 * section reads (`test_sections`), publication snapshots (`test_snapshots`) and
 * the referential-integrity lookups that answer "which tests use this
 * topic/question" (PRD-15 FR-03). `deleteTest` is the single owner of test
 * deletion: it removes every row that has no meaning without the test
 * (adaptive config, sections, assignments, access grants, attempts, snapshots)
 * in one transaction; content_pages/scales/result_variables/question_measurements/
 * test_question_scoring go via FK ON DELETE CASCADE, and SCORM telemetry is
 * deliberately kept (nullable `testId`). Section WRITES live in
 * `TestSettingsService`, not here. Exposed through the `IStorage` facade, never
 * imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, and, sql, desc } from "drizzle-orm";
import { db } from "../db";
import {
  tests, testSections, testSnapshots, attempts,
  adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks,
  testAssignments, testAccessGrants, questions, questionMeasurements, contentPages,
  type Test, type InsertTest, type TestSection, type TestSnapshot,
} from "@shared/schema";

/**
 * Minimal projection of a test that depends on a topic/question (PRD-15
 * FR-03): enough for the 409 referential-protection payload and for the
 * draw-feasibility policy (published vs draft, adaptive vs standard).
 */
export interface TestUsageRef {
  id: string;
  title: string;
  ownerId: string | null;
  status: Test["status"];
  mode: Test["mode"];
}

/**
 * Normalizes a test row from the DB for backward compatibility (PRD-7 §1.11).
 * - If `status` is falsy (pre-migration row), derives it from `published`.
 * - Ensures `published` is always in sync with `status` when reading.
 */
function mapLegacyTest(row: Test): Test {
  const status = row.status || (row.published ? "published" : "draft");
  const published = status === "published";
  if (status === row.status && published === row.published) return row;
  return { ...row, status: status as Test["status"], published };
}

/** Repository for the test aggregate (tests, sections, snapshots, lifecycle). */
export class TestsRepository {
  async getTestsUsingTopic(topicId: string): Promise<TestUsageRef[]> {
    return db
      .selectDistinct({
        id: tests.id,
        title: tests.title,
        ownerId: tests.ownerId,
        status: tests.status,
        mode: tests.mode,
      })
      .from(testSections)
      .innerJoin(tests, eq(testSections.testId, tests.id))
      .where(eq(testSections.topicId, topicId));
  }

  async getTestsUsingQuestion(questionId: string): Promise<TestUsageRef[]> {
    // A question is delivered through its topic's sections; scale contributions
    // (question_measurements) add direct per-test dependencies (PRD-5).
    const [question] = await db.select().from(questions).where(eq(questions.id, questionId));
    const byTopic = question ? await this.getTestsUsingTopic(question.topicId) : [];
    const viaMeasurements = await db
      .selectDistinct({
        id: tests.id,
        title: tests.title,
        ownerId: tests.ownerId,
        status: tests.status,
        mode: tests.mode,
      })
      .from(questionMeasurements)
      .innerJoin(tests, eq(questionMeasurements.testId, tests.id))
      .where(eq(questionMeasurements.questionId, questionId));
    const seen = new Map<string, TestUsageRef>();
    for (const ref of [...byTopic, ...viaMeasurements]) seen.set(ref.id, ref);
    return [...seen.values()];
  }

  // ─── Publication snapshots (PRD-15 block B) ────────────────────────────────

  async createTestSnapshot(snapshot: {
    testId: string;
    version: number;
    contentJson: unknown;
    publishedBy: string | null;
  }): Promise<TestSnapshot> {
    const [row] = await db
      .insert(testSnapshots)
      .values({
        id: randomUUID(),
        testId: snapshot.testId,
        version: snapshot.version,
        contentJson: snapshot.contentJson,
        publishedBy: snapshot.publishedBy,
      })
      .returning();
    return row;
  }

  async getLatestSnapshot(testId: string): Promise<TestSnapshot | undefined> {
    const [row] = await db
      .select()
      .from(testSnapshots)
      .where(eq(testSnapshots.testId, testId))
      .orderBy(desc(testSnapshots.version))
      .limit(1);
    return row || undefined;
  }

  async getSnapshot(id: string): Promise<TestSnapshot | undefined> {
    const [row] = await db.select().from(testSnapshots).where(eq(testSnapshots.id, id));
    return row || undefined;
  }

  async getSnapshotsForTest(testId: string): Promise<TestSnapshot[]> {
    return db
      .select()
      .from(testSnapshots)
      .where(eq(testSnapshots.testId, testId))
      .orderBy(desc(testSnapshots.version));
  }

  /**
   * Every snapshot in the database, for the media re-sync (Медиатека). The other
   * reads are test-scoped; the rebuild needs the whole table, the same way
   * `getAllContentPages` serves it.
   */
  async getAllSnapshots(): Promise<TestSnapshot[]> {
    return db.select().from(testSnapshots);
  }

  async deleteSnapshotsForTest(testId: string): Promise<void> {
    await db.delete(testSnapshots).where(eq(testSnapshots.testId, testId));
  }

  async getReferencedSnapshotIds(testId: string): Promise<string[]> {
    const rows = await db
      .selectDistinct({ snapshotId: attempts.snapshotId })
      .from(attempts)
      .where(and(eq(attempts.testId, testId), sql`${attempts.snapshotId} IS NOT NULL`));
    return rows.map((r) => r.snapshotId).filter((id): id is string => !!id);
  }

  async deleteSnapshotById(id: string): Promise<void> {
    await db.delete(testSnapshots).where(eq(testSnapshots.id, id));
  }

  // ─── Test rows + sections ──────────────────────────────────────────────────

  async getTests(): Promise<Test[]> {
    const rows = await db.select().from(tests);
    return rows.map(mapLegacyTest);
  }

  async getTest(id: string): Promise<Test | undefined> {
    const [row] = await db.select().from(tests).where(eq(tests.id, id));
    return row ? mapLegacyTest(row) : undefined;
  }

  /**
   * Returns counts of legacy rows not yet covered by migration 003.
   * `legacyStartPageCount` — tests with non-empty `start_page_content` that have
   * no intro `content_pages` row (position='before', topic_id IS NULL).
   */
  async getMigrationHealth(): Promise<{ legacyStartPageCount: number }> {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` })
      .from(tests)
      .where(
        and(
          sql`${tests.startPageContent} IS NOT NULL`,
          sql`length(trim(coalesce(${tests.startPageContent}, ''))) > 0`,
          sql`NOT EXISTS (
            SELECT 1 FROM content_pages cp
            WHERE cp.test_id = ${tests.id}
              AND cp.type = 'intro'
              AND cp.topic_id IS NULL
          )`,
        ),
      );
    return { legacyStartPageCount: count ?? 0 };
  }

  async updateTest(id: string, updates: Partial<InsertTest>): Promise<Test | undefined> {
    return db.transaction(async (tx) => {
      // PRD-7 §4.1: keep status and published in sync on every write.
      const patch: Partial<InsertTest> = { ...updates };
      if (patch.status !== undefined) {
        patch.published = patch.status === "published";
      } else if (patch.published !== undefined) {
        patch.status = patch.published ? "published" : "draft";
      }

      const [updated] = await tx.update(tests)
        .set({ ...patch, version: sql`${tests.version} + 1`, updatedAt: new Date() })
        .where(eq(tests.id, id))
        .returning();
      if (!updated) return undefined;
      // Section writes go exclusively through TestSettingsService (the single
      // section writer). updateTest only patches the test row.
      return updated;
    });
  }

  async patchTestStatus(id: string, status: "draft" | "published" | "archived"): Promise<{ id: string; status: string; version: number } | undefined> {
    const [row] = await db.update(tests)
      .set({ status, published: status === "published", updatedAt: new Date() })
      .where(eq(tests.id, id))
      .returning({ id: tests.id, status: tests.status, version: tests.version });
    return row ?? undefined;
  }

  /**
   * Delete a test and every row that has no meaning without it, atomically —
   * the single owner of test deletion (callers no longer clean up adaptive rows
   * themselves). FK ON DELETE CASCADE removes content_pages, scales,
   * result_variables, question_measurements and test_question_scoring when the
   * test row goes. SCORM packages/attempts/answers are deliberately KEPT:
   * `scorm_packages.testId` is nullable by design — the exported package outlives
   * the test in the LMS, so its telemetry is retained.
   */
  async deleteTest(id: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      // Adaptive config: links carry no testId, so resolve them via their levels.
      await tx.delete(adaptiveLevelLinks).where(
        sql`${adaptiveLevelLinks.levelId} IN (SELECT ${adaptiveLevels.id} FROM ${adaptiveLevels} WHERE ${adaptiveLevels.testId} = ${id})`,
      );
      await tx.delete(adaptiveLevels).where(eq(adaptiveLevels.testId, id));
      await tx.delete(adaptiveTopicSettings).where(eq(adaptiveTopicSettings.testId, id));

      // Structural dependents.
      await tx.delete(testSections).where(eq(testSections.testId, id));
      await tx.delete(testAssignments).where(eq(testAssignments.testId, id));
      await tx.delete(testAccessGrants).where(eq(testAccessGrants.testId, id));

      // Delivery history. A hard delete is not restorable (archive is the
      // retention path), so attempts and snapshots go too. Attempts pin
      // snapshots, so drop attempts first.
      await tx.delete(attempts).where(eq(attempts.testId, id));
      await tx.delete(testSnapshots).where(eq(testSnapshots.testId, id));

      const result = await tx.delete(tests).where(eq(tests.id, id)).returning();
      return result.length > 0;
    });
  }

  async getTestSections(testId: string): Promise<TestSection[]> {
    return db
      .select()
      .from(testSections)
      .where(eq(testSections.testId, testId))
      .orderBy(testSections.sortOrder);
  }

  async getTestSectionsByTopic(topicId: string): Promise<TestSection[]> {
    return db.select().from(testSections).where(eq(testSections.topicId, topicId));
  }

  async getTopicPageRefs(topicId: string): Promise<Array<{ testId: string }>> {
    return db
      .select({ testId: contentPages.testId })
      .from(contentPages)
      .where(eq(contentPages.topicId, topicId));
  }
}
