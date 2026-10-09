/**
 * @module tests/it/migration-0052-purge-deleted-test-lms.it.test
 * @description The one-off data migration `0052_purge_deleted_test_lms` (PRD-15 FR-07a) run on
 * the real schema: it removes the LMS trail of tests deleted BEFORE `deleteTest` started purging
 * it, by the same rule as the batch rollback — and touches nothing that still has a test.
 *
 * A round trip is the only check worth having here: the migration is hand-written SQL that no
 * type checker reads, and its mistake would surface as deleted data on a production database.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { sql } from "drizzle-orm";
import {
  tests, scormPackages, scormAttempts, scormAnswers, lmsImportBatches, lmsImportBatchUsers,
  groups, users, userRoles, userGroups, testAssignments, analyticsSlices, questionExposure,
  assignmentAccessTokens,
} from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const MIGRATION = readFileSync(
  path.resolve(import.meta.dirname, "../../drizzle/0052_purge_deleted_test_lms.sql"),
  "utf8",
);

let h: Harness;

/** Apply the migration statement by statement, as the drizzle migrator does. */
async function migrate() {
  for (const statement of MIGRATION.split("--> statement-breakpoint")) {
    if (statement.replace(/--.*$/gm, "").trim()) await h.db.execute(sql.raw(statement));
  }
}

const at = new Date("2026-09-09");

async function insertTest(): Promise<string> {
  const id = randomUUID();
  await h.db.insert(tests).values({ id, title: "T", overallPassRuleJson: { type: "percent", value: 80 } } as never);
  return id;
}

async function insertPackage(testId: string | null): Promise<string> {
  const id = randomUUID();
  await h.db.insert(scormPackages).values({
    id, testId, testTitle: "T", secretKey: "k", apiBaseUrl: "http://x", exportedAt: at, createdBy: randomUUID(),
  } as never);
  return id;
}

async function insertTelemetry(testId: string | null, packageId: string): Promise<string> {
  const id = randomUUID();
  await h.db.insert(scormAttempts).values({
    id, testId, packageId, sessionId: randomUUID(), startedAt: at, lastActivityAt: at,
  } as never);
  await h.db.insert(scormAnswers).values({
    id: randomUUID(), attemptId: id, questionId: randomUUID(), questionPrompt: "Q",
    questionType: "single", userAnswerJson: 0, answeredAt: at,
  } as never);
  return id;
}

async function insertBatch(testId: string, groupId: string | null, importedAt: Date): Promise<string> {
  const id = randomUUID();
  await h.db.insert(lmsImportBatches).values({
    id, testId, groupId, fileName: "выгрузка.xlsx", fileHash: randomUUID(), anonymized: true,
    sourceAnonymized: false, linkUsers: true, importedBy: randomUUID(), importedAt,
  } as never);
  return id;
}

async function insertExternal(): Promise<string> {
  const id = randomUUID();
  await h.db.insert(users).values({ id, isExternal: true } as never);
  await h.db.insert(userRoles).values({ id: randomUUID(), userId: id, role: "learner" } as never);
  return id;
}

beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => {
  await h.close();
});
beforeEach(async () => {
  await h.reset();
});

describe("0052_purge_deleted_test_lms", () => {
  it("removes telemetry, packages and test-scoped rows of deleted tests, keeps those of live ones", async () => {
    const live = await insertTest();
    const gone = randomUUID();
    const livePkg = await insertPackage(live);
    const gonePkg = await insertPackage(gone);
    const nullPkg = await insertPackage(null);

    const kept = await insertTelemetry(live, livePkg);
    // Legacy row resolved through its package, a row with its own dead test_id, and a test-less one.
    await insertTelemetry(null, gonePkg);
    await insertTelemetry(gone, livePkg);
    await insertTelemetry(null, nullPkg);

    const userId = randomUUID();
    for (const testId of [live, gone]) {
      await h.db.insert(analyticsSlices).values({
        id: randomUUID(), name: `Срез ${testId}`, kind: "slice", testId, createdBy: userId, conditionsJson: {},
      } as never);
      await h.db.insert(questionExposure).values({
        questionId: randomUUID(), testId, bucketMonth: "2026-09-01", source: "live",
      } as never);
      await h.db.insert(assignmentAccessTokens).values({
        id: randomUUID(), userId, testId, tokenHash: randomUUID(), expiresAt: new Date("2030-01-01"),
      } as never);
    }
    // A saved filter carries no test and must survive.
    await h.db.insert(analyticsSlices).values({
      id: randomUUID(), name: "Фильтр", kind: "filter", testId: null, createdBy: userId, conditionsJson: {},
    } as never);

    await migrate();

    expect((await h.db.select({ id: scormAttempts.id }).from(scormAttempts)).map((r) => r.id)).toEqual([kept]);
    expect((await h.db.select({ a: scormAnswers.attemptId }).from(scormAnswers)).map((r) => r.a)).toEqual([kept]);
    expect((await h.db.select({ id: scormPackages.id }).from(scormPackages)).map((r) => r.id)).toEqual([livePkg]);
    const slices = await h.db.select().from(analyticsSlices);
    expect(slices.map((s) => s.testId).sort()).toEqual([live, null].sort());
    expect((await h.db.select().from(questionExposure)).map((e) => e.testId)).toEqual([live]);
    expect((await h.db.select().from(assignmentAccessTokens)).map((k) => k.testId)).toEqual([live]);
  });

  it("rolls back a dead batch: membership and record go when nothing else holds them", async () => {
    const gone = randomUUID();
    const groupId = randomUUID();
    await h.db.insert(groups).values({ id: groupId, name: "Группа" });
    const userId = await insertExternal();
    await h.db.insert(userGroups).values({ id: randomUUID(), userId, groupId } as never);
    const batchId = await insertBatch(gone, groupId, at);
    await h.db.insert(lmsImportBatchUsers).values({ batchId, userId, createdUser: true, addedToGroup: true });

    await migrate();

    expect(await h.db.select().from(lmsImportBatches)).toEqual([]);
    expect(await h.db.select().from(lmsImportBatchUsers)).toEqual([]);
    expect(await h.db.select().from(userGroups)).toEqual([]);
    expect(await h.db.select().from(userRoles)).toEqual([]);
    expect(await h.db.select().from(users)).toEqual([]);
  });

  it("hands the marks of a dead batch to the earliest live batch of the participant", async () => {
    const live = await insertTest();
    const gone = randomUUID();
    const groupId = randomUUID();
    await h.db.insert(groups).values({ id: groupId, name: "Группа" });
    const userId = await insertExternal();
    await h.db.insert(userGroups).values({ id: randomUUID(), userId, groupId } as never);
    const dead = await insertBatch(gone, groupId, new Date("2026-09-01"));
    const early = await insertBatch(live, groupId, new Date("2026-09-02"));
    const late = await insertBatch(live, groupId, new Date("2026-09-03"));
    await h.db.insert(lmsImportBatchUsers).values([
      { batchId: dead, userId, createdUser: true, addedToGroup: true },
      { batchId: early, userId, createdUser: false, addedToGroup: false },
      { batchId: late, userId, createdUser: false, addedToGroup: false },
    ]);

    await migrate();

    expect(await h.db.select().from(users)).toHaveLength(1);
    expect(await h.db.select().from(userGroups)).toHaveLength(1);
    const marks = await h.db.select().from(lmsImportBatchUsers);
    expect(marks).toHaveLength(2);
    expect(marks.find((m) => m.batchId === early)).toMatchObject({ createdUser: true, addedToGroup: true });
    expect(marks.find((m) => m.batchId === late)).toMatchObject({ createdUser: false, addedToGroup: false });
  });

  it("keeps a record the dead batch created while an assignment or a membership still holds it", async () => {
    const live = await insertTest();
    const gone = randomUUID();
    const assigned = await insertExternal();
    const member = await insertExternal();
    const otherGroup = randomUUID();
    await h.db.insert(groups).values({ id: otherGroup, name: "Другая" });
    await h.db.insert(userGroups).values({ id: randomUUID(), userId: member, groupId: otherGroup } as never);
    await h.db.insert(testAssignments).values({
      id: randomUUID(), testId: live, userId: assigned, assignedBy: randomUUID(),
    } as never);
    const batchId = await insertBatch(gone, null, at);
    await h.db.insert(lmsImportBatchUsers).values([
      { batchId, userId: assigned, createdUser: true, addedToGroup: false },
      { batchId, userId: member, createdUser: true, addedToGroup: false },
    ]);

    await migrate();

    expect((await h.db.select({ id: users.id }).from(users)).map((u) => u.id).sort())
      .toEqual([assigned, member].sort());
    expect(await h.db.select().from(userRoles)).toHaveLength(2);
    expect(await h.db.select().from(lmsImportBatches)).toEqual([]);
  });
});
