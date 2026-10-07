/**
 * @module tests/it/delete-test-deep.it.test
 * @description deleteTest is now the single, atomic owner of test deletion. This
 * spec seeds a test with every kind of dependent row and asserts that after
 * deletion nothing is orphaned — structural dependents and delivery history are
 * gone, FK ON DELETE CASCADE rows are gone, and so is the LMS trail — telemetry,
 * import batches (rolled back with the participants they created) and packages
 * (PRD-15 FR-07a, revised 2026-10-07: it used to be retained).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  tests, topics, testSections, attempts, testAssignments, testAccessGrants,
  testSnapshots, adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks,
  scormPackages, contentPages, scales,
  scormAttempts, scormAnswers, lmsImportBatches, lmsImportBatchUsers, groups, users, userRoles,
  userGroups, analyticsSlices, questionExposure, assignmentAccessTokens,
} from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { DatabaseStorage } from "../../server/storage";

let storage: DatabaseStorage;

beforeAll(async () => {
  h.current = await createHarness();
  storage = new DatabaseStorage();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

describe("deleteTest — atomic deep delete leaves no orphans", () => {
  it("removes all dependent + FK-cascaded rows, SCORM packages included", async () => {
    const db = h.current!.db;
    const testId = randomUUID();
    const topicId = randomUUID();
    const levelId = randomUUID();
    const userId = randomUUID();

    await db.insert(topics).values({ id: topicId, name: "T" } as never);
    await db.insert(tests).values({
      id: testId, title: "Del", overallPassRuleJson: { type: "percent", value: 80 },
    } as never);
    await db.insert(testSections).values({ id: randomUUID(), testId, topicId, drawCount: 1 } as never);
    await db.insert(attempts).values({
      id: randomUUID(), userId, testId, variantJson: {}, startedAt: new Date("2024-01-01"),
    } as never);
    await db.insert(testAssignments).values({ id: randomUUID(), testId, assignedBy: userId } as never);
    await db.insert(testAccessGrants).values({
      id: randomUUID(), testId, userId, accessLevel: "edit",
    } as never);
    await db.insert(testSnapshots).values({ id: randomUUID(), testId, version: 1, contentJson: {} } as never);
    await db.insert(adaptiveTopicSettings).values({ id: randomUUID(), testId, topicId } as never);
    await db.insert(adaptiveLevels).values({
      id: levelId, testId, topicId, levelIndex: 0, levelName: "L",
      minDifficulty: 0, maxDifficulty: 100, questionsCount: 5, passThreshold: 60,
    } as never);
    await db.insert(adaptiveLevelLinks).values({ id: randomUUID(), levelId, title: "c", url: "u" } as never);
    await db.insert(scormPackages).values({
      id: randomUUID(), testId, testTitle: "Del", secretKey: "k",
      apiBaseUrl: "http://x", exportedAt: new Date("2024-01-01"), createdBy: userId,
    } as never);
    // FK ON DELETE CASCADE rows:
    await db.insert(contentPages).values({ testId, position: "before", type: "intro", kind: "intro" } as never);
    await db.insert(scales).values({ testId, key: "s1", label: "S", type: "number" } as never);

    expect(await storage.deleteTest(testId)).toBe(true);

    const countByTest = async (table: unknown, col: unknown) =>
      (await db.select().from(table as never).where(eq(col as never, testId))).length;

    // Structural dependents + delivery history removed.
    expect(await countByTest(tests, tests.id)).toBe(0);
    expect(await countByTest(testSections, testSections.testId)).toBe(0);
    expect(await countByTest(attempts, attempts.testId)).toBe(0);
    expect(await countByTest(testAssignments, testAssignments.testId)).toBe(0);
    expect(await countByTest(testAccessGrants, testAccessGrants.testId)).toBe(0);
    expect(await countByTest(testSnapshots, testSnapshots.testId)).toBe(0);
    expect(await countByTest(adaptiveTopicSettings, adaptiveTopicSettings.testId)).toBe(0);
    expect(await countByTest(adaptiveLevels, adaptiveLevels.testId)).toBe(0);
    expect(
      (await db.select().from(adaptiveLevelLinks).where(eq(adaptiveLevelLinks.levelId, levelId))).length,
    ).toBe(0);

    // FK ON DELETE CASCADE.
    expect(await countByTest(contentPages, contentPages.testId)).toBe(0);
    expect(await countByTest(scales, scales.testId)).toBe(0);

    // PRD-15 FR-07a: the LMS trail goes with the test.
    expect(await countByTest(scormPackages, scormPackages.testId)).toBe(0);
  });
});

describe("deleteTest — the LMS trail of the test goes with it (PRD-15 FR-07a)", () => {
  /** A test row, its package and the participant an import of it created. */
  async function seedLmsTest() {
    const db = h.current!.db;
    const testId = randomUUID();
    const packageId = randomUUID();
    await db.insert(tests).values({
      id: testId, title: "Del", overallPassRuleJson: { type: "percent", value: 80 },
    } as never);
    await db.insert(scormPackages).values({
      id: packageId, testId, testTitle: "Del", secretKey: "k",
      apiBaseUrl: "http://x", exportedAt: new Date("2024-01-01"), createdBy: randomUUID(),
    } as never);
    return { testId, packageId };
  }

  it("removes telemetry (own test_id and legacy via package), batches, packages and test-scoped rows", async () => {
    const db = h.current!.db;
    const { testId, packageId } = await seedLmsTest();
    const other = await seedLmsTest();
    const at = new Date("2026-09-09");

    // Telemetry: a current row, a legacy row known only through its package, and one of another test.
    const telemetry = [
      { id: randomUUID(), testId, packageId, sessionId: "s1" },
      { id: randomUUID(), testId: null, packageId, sessionId: "s2" },
      { id: randomUUID(), testId: other.testId, packageId: other.packageId, sessionId: "s3" },
    ];
    for (const row of telemetry) {
      await db.insert(scormAttempts).values({ ...row, startedAt: at, lastActivityAt: at } as never);
      await db.insert(scormAnswers).values({
        id: randomUUID(), attemptId: row.id, questionId: randomUUID(), questionPrompt: "Q",
        questionType: "single", userAnswerJson: 0, answeredAt: at,
      } as never);
    }

    // An import batch that created an external participant and put them into a group.
    const groupId = randomUUID();
    const userId = randomUUID();
    const batchId = randomUUID();
    await db.insert(groups).values({ id: groupId, name: "Группа выгрузки" });
    await db.insert(users).values({ id: userId, isExternal: true } as never);
    await db.insert(userRoles).values({ id: randomUUID(), userId, role: "learner" } as never);
    await db.insert(userGroups).values({ id: randomUUID(), userId, groupId } as never);
    await db.insert(lmsImportBatches).values({
      id: batchId, testId, groupId, fileName: "выгрузка.xlsx", fileHash: randomUUID(),
      anonymized: true, sourceAnonymized: false, linkUsers: true, importedBy: randomUUID(),
    } as never);
    await db.insert(lmsImportBatchUsers).values({ batchId, userId, createdUser: true, addedToGroup: true });
    await db.insert(scormAttempts).values({
      id: randomUUID(), testId, origin: "import", batchId, groupId, userId,
      participantKey: "k", attemptKey: "c:2026-09-09:1", startedAt: at, lastActivityAt: at,
    } as never);
    // The participant was also assigned to this test: the assignment goes first, so it does not
    // keep the record alive.
    await db.insert(testAssignments).values({ id: randomUUID(), testId, userId, assignedBy: randomUUID() } as never);

    // Test-scoped leftovers.
    await db.insert(analyticsSlices).values({
      id: randomUUID(), name: "Срез", kind: "slice", testId, createdBy: randomUUID(), conditionsJson: {},
    } as never);
    await db.insert(questionExposure).values({
      questionId: randomUUID(), testId, bucketMonth: "2026-09-01", source: "live",
    } as never);
    await db.insert(assignmentAccessTokens).values({
      id: randomUUID(), userId, testId, tokenHash: randomUUID(), expiresAt: new Date("2030-01-01"),
    } as never);

    expect(await storage.deleteTest(testId)).toBe(true);

    const left = await db.select({ id: scormAttempts.id }).from(scormAttempts);
    expect(left.map((r) => r.id)).toEqual([telemetry[2].id]);
    const answers = await db.select({ attemptId: scormAnswers.attemptId }).from(scormAnswers);
    expect(answers.map((r) => r.attemptId)).toEqual([telemetry[2].id]);
    const packages = await db.select({ id: scormPackages.id }).from(scormPackages);
    expect(packages.map((r) => r.id)).toEqual([other.packageId]);

    // The batch is rolled back by the same rule as the rollback button.
    expect(await db.select().from(lmsImportBatches)).toEqual([]);
    expect(await db.select().from(lmsImportBatchUsers)).toEqual([]);
    expect(await db.select().from(userGroups)).toEqual([]);
    expect(await db.select().from(users).where(eq(users.id, userId))).toEqual([]);
    expect(await db.select().from(userRoles).where(eq(userRoles.userId, userId))).toEqual([]);

    expect(await db.select().from(analyticsSlices)).toEqual([]);
    expect(await db.select().from(questionExposure)).toEqual([]);
    expect(await db.select().from(assignmentAccessTokens)).toEqual([]);
  });

  it("keeps a participant the deleted test's import created while another test still uses them", async () => {
    const db = h.current!.db;
    const { testId } = await seedLmsTest();
    const other = await seedLmsTest();
    const userId = randomUUID();
    const batchId = randomUUID();
    await db.insert(users).values({ id: userId, isExternal: true } as never);
    await db.insert(lmsImportBatches).values({
      id: batchId, testId, groupId: null, fileName: "выгрузка.xlsx", fileHash: randomUUID(),
      anonymized: true, sourceAnonymized: false, linkUsers: true, importedBy: randomUUID(),
    } as never);
    await db.insert(lmsImportBatchUsers).values({ batchId, userId, createdUser: true, addedToGroup: false });
    await db.insert(testAssignments).values({
      id: randomUUID(), testId: other.testId, userId, assignedBy: randomUUID(),
    } as never);

    await storage.deleteTest(testId);

    expect(await db.select().from(users).where(eq(users.id, userId))).toHaveLength(1);
    expect(await db.select().from(lmsImportBatches)).toEqual([]);
  });
});
