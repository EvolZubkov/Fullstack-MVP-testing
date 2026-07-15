/**
 * @module tests/it/delete-test-deep.it.test
 * @description deleteTest is now the single, atomic owner of test deletion. This
 * spec seeds a test with every kind of dependent row and asserts that after
 * deletion nothing is orphaned — structural dependents and delivery history are
 * gone, FK ON DELETE CASCADE rows are gone, and SCORM telemetry is retained by
 * design (scorm_packages.testId is nullable — the exported package outlives the
 * test).
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import {
  tests, topics, testSections, attempts, testAssignments, testAccessGrants,
  testSnapshots, adaptiveTopicSettings, adaptiveLevels, adaptiveLevelLinks,
  scormPackages, contentPages, scales,
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
  it("removes all dependent + FK-cascaded rows, retains SCORM packages", async () => {
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

    // SCORM telemetry retained by design (nullable testId).
    expect(await countByTest(scormPackages, scormPackages.testId)).toBe(1);
  });
});
