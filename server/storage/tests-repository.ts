/**
 * @module server/storage/tests-repository
 * @description Data access for the test aggregate: the `tests` row lifecycle
 * (read with legacy normalization, versioned update, status patch, deep delete),
 * section reads (`test_sections`), publication snapshots (`test_snapshots`) and
 * the referential-integrity lookups that answer "which tests use this
 * topic/question" (PRD-15 FR-03). `deleteTest` is the single owner of test
 * deletion: it removes every row that has no meaning without the test
 * (adaptive config, sections, assignments and their access links, access grants,
 * attempts, snapshots, saved analytics slices, delivery exposure, and the whole
 * LMS trail — telemetry, import batches, packages) in one transaction;
 * content_pages/scales/result_variables/question_measurements/
 * test_question_scoring go via FK ON DELETE CASCADE. Section WRITES live in
 * `TestSettingsService`, not here. Exposed through the `IStorage` facade, never
 * imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, and, sql, desc, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  tests, testSections, testScenarios, testSnapshots, attempts,
  adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks,
  testAssignments, testAccessGrants, questions, questionMeasurements, contentPages,
  assignmentAccessTokens, analyticsSlices, questionExposure,
  type Test, type InsertTest, type TestSection, type TestScenario, type TestSnapshot,
} from "@shared/schema";
import { countTestLmsTrail, purgeTestLmsData, type TestLmsTrailCounts } from "./scorm-repository";

/** What deleting a test takes with it (PRD-15 FR-07a): web attempts plus the LMS trail. */
export interface TestDeleteImpact extends TestLmsTrailCounts {
  /** Attempts taken in the service itself. */
  webAttempts: number;
}

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

  /**
   * PRD-56 FR-19a: снимок теста по НОМЕРУ версии — так прохождение из LMS находит свою
   * версию публикации. Пара (тест, версия) уникальна (`test_snapshots_test_version_idx`),
   * поэтому номера в пакете достаточно и идентификатор снимка наружу не уезжает.
   */
  async getSnapshotByVersion(testId: string, version: number): Promise<TestSnapshot | undefined> {
    const [row] = await db
      .select()
      .from(testSnapshots)
      .where(and(eq(testSnapshots.testId, testId), eq(testSnapshots.version, version)));
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
   * test row goes. The LMS trail (telemetry, import batches with the participants
   * they created, packages) goes too — PRD-15 FR-07a, revised 2026-10-07: it used
   * to be kept "for administrators", but without the test it explains nothing,
   * the LMS keeps its own record, and archive is the retention path.
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
      await tx.delete(testScenarios).where(eq(testScenarios.testId, id));
      await tx.delete(testAssignments).where(eq(testAssignments.testId, id));
      // Personal access links (attempt and review) lead nowhere without the test.
      await tx.delete(assignmentAccessTokens).where(eq(assignmentAccessTokens.testId, id));
      await tx.delete(testAccessGrants).where(eq(testAccessGrants.testId, id));
      // Saved analytics slices are bound to exactly one test (PRD-56); filters carry none.
      await tx.delete(analyticsSlices).where(eq(analyticsSlices.testId, id));

      // Delivery history. A hard delete is not restorable (archive is the
      // retention path), so attempts and snapshots go too. Attempts pin
      // snapshots, so drop attempts first.
      await tx.delete(attempts).where(eq(attempts.testId, id));
      await tx.delete(testSnapshots).where(eq(testSnapshots.testId, id));
      await tx.delete(questionExposure).where(eq(questionExposure.testId, id));

      // LMS trail. AFTER assignments and web attempts: the batch rollback keeps a
      // participant it created while anything still refers to them.
      await purgeTestLmsData(tx, id);

      const result = await tx.delete(tests).where(eq(tests.id, id)).returning();
      return result.length > 0;
    });
  }

  /**
   * What {@link deleteTest} would take with the test — the numbers the delete
   * dialog names (PRD-15 FR-07a). Read-only; counts every attempt, finished or
   * abandoned, since all of them go.
   */
  async getTestDeleteImpact(id: string): Promise<TestDeleteImpact> {
    const [[web], lms] = await Promise.all([
      db.select({ n: sql<number>`count(*)::int` }).from(attempts).where(eq(attempts.testId, id)),
      countTestLmsTrail(id),
    ]);
    return { webAttempts: Number(web?.n ?? 0), ...lms };
  }

  async getTestSections(testId: string): Promise<TestSection[]> {
    return db
      .select()
      .from(testSections)
      .where(eq(testSections.testId, testId))
      .orderBy(testSections.sortOrder);
  }

  /** «Сценарий в ИС»: пункты-сценарии теста в порядке автора. */
  async getTestScenarios(testId: string): Promise<TestScenario[]> {
    return db
      .select()
      .from(testScenarios)
      .where(eq(testScenarios.testId, testId))
      .orderBy(testScenarios.sortOrder);
  }

  /** Пункты-сценарии, для которых тема служит банком — «где используется тема». */
  async getTestScenariosByTopic(topicId: string): Promise<TestScenario[]> {
    return db.select().from(testScenarios).where(eq(testScenarios.topicId, topicId));
  }

  async getTestSectionsByTopic(topicId: string): Promise<TestSection[]> {
    return db.select().from(testSections).where(eq(testSections.topicId, topicId));
  }

  /**
   * Разделы сразу по НЕСКОЛЬКИМ темам — PRD-54: определение теста по вопросам из шапки выгрузки.
   *
   * Одним запросом, а не циклом из `getTestSectionsByTopic`: тем в выгрузке столько же, сколько
   * различных тем у её вопросов, и опрос по одной превратил бы опознание файла в N обращений к базе.
   *
   * @param topicIds идентификаторы тем
   * @returns разделы, ссылающиеся на любую из них; пустой массив на пустом списке
   */
  async getTestSectionsByTopicIds(topicIds: string[]): Promise<TestSection[]> {
    // Пустой список проверяется отдельно: `inArray` с пустым массивом даёт `IN ()` — синтаксическую
    // ошибку Postgres, а не пустую выборку.
    if (topicIds.length === 0) return [];
    return db.select().from(testSections).where(inArray(testSections.topicId, topicIds));
  }

  async getTopicPageRefs(topicId: string): Promise<Array<{ testId: string }>> {
    return db
      .select({ testId: contentPages.testId })
      .from(contentPages)
      .where(eq(contentPages.topicId, topicId));
  }
}
