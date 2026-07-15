// @vitest-environment node
/**
 * @module tests/storage/assignments-repository.test
 * @description DAL coverage for {@link module:server/storage/assignments-repository}
 * against a real (pglite) database, driven through the {@link DatabaseStorage}
 * facade so `server/storage.ts` delegation is exercised too. The repository is a
 * thin data-access layer — mocking drizzle would assert query shape, not
 * behaviour — so these specs run the actual SQL through the same in-process
 * Postgres harness the integration suite uses. Runs in the `node` environment
 * (per-file override) so pglite works under the otherwise-jsdom unit run, and
 * because it lives under `tests/` (not `tests/it/`) its coverage counts toward
 * the reported total.
 *
 * pglite caveat: DELETE/UPDATE without RETURNING do not populate `result.rowCount`
 * (see db-harness). `deleteTestAssignment` reads `.rowCount`, so its boolean is
 * unreliable here — these specs assert the observable row effect instead of the
 * returned flag on the success path.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { createHarness, type Harness } from "../it/db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));
// Deterministic, config-free email crypto so the facade (which pulls in the
// users repository) imports without needing ENCRYPTION_* env.
vi.mock("../../server/utils/crypto", () => ({
  encryptEmail: async (e: string) => `enc:${e}`,
  decryptEmail: async (e: string) => e.replace(/^enc:/, ""),
  hashEmail: (e: string) => `hash:${e}`,
  hashPassword: async (p: string) => `hashed:${p}`,
  verifyPassword: async (plain: string, stored: string) => stored === `hashed:${plain}`,
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { DatabaseStorage } from "../../server/storage";
// eslint-disable-next-line import/first
import { tests, assignmentAccessTokens } from "@shared/schema";

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

/** Insert a minimal `tests` row directly (bypasses createTest defaults/Zod). */
async function insertTest(): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(tests).values({
    id,
    title: "T",
    overallPassRuleJson: {},
  } as never);
  return id;
}

/** Create a magic-link token row through the facade. */
function makeToken(over: Partial<{ assignmentId: string; userId: string; testId: string; tokenHash: string; expiresAt: Date }> = {}) {
  return storage.createAssignmentAccessToken({
    assignmentId: over.assignmentId ?? randomUUID(),
    userId: over.userId ?? randomUUID(),
    testId: over.testId ?? randomUUID(),
    tokenHash: over.tokenHash ?? `hash-${randomUUID()}`,
    expiresAt: over.expiresAt ?? new Date(Date.now() + 86_400_000),
  });
}

describe("AssignmentsRepository — assignment CRUD", () => {
  it("getAssignment returns undefined for an unknown id", async () => {
    expect(await storage.getAssignment(randomUUID())).toBeUndefined();
  });

  it("createTestAssignment (user branch) round-trips via getAssignment", async () => {
    const testId = await insertTest();
    const userId = randomUUID();
    const created = await storage.createTestAssignment({
      testId, userId, assignedBy: "admin-1",
    } as never);

    expect(created.testId).toBe(testId);
    expect(created.userId).toBe(userId);
    expect(created.groupId).toBeNull(); // groupId || null branch
    expect(created.dueDate).toBeNull(); // dueDate || null branch
    expect(created.assignedBy).toBe("admin-1");
    expect(created.assignedAt).toBeInstanceOf(Date);

    const fetched = await storage.getAssignment(created.id);
    expect(fetched?.id).toBe(created.id);
    expect(fetched?.userId).toBe(userId);
  });

  it("createTestAssignment (group branch) leaves userId null", async () => {
    const testId = await insertTest();
    const groupId = randomUUID();
    const created = await storage.createTestAssignment({
      testId, groupId, assignedBy: "admin-1",
    } as never);

    expect(created.groupId).toBe(groupId);
    expect(created.userId).toBeNull(); // userId || null branch
  });

  it("createTestAssignment persists a provided dueDate", async () => {
    const testId = await insertTest();
    const due = new Date("2030-01-15T10:00:00.000Z");
    const created = await storage.createTestAssignment({
      testId, userId: randomUUID(), dueDate: due, assignedBy: "admin-1",
    } as never);

    expect(created.dueDate).toBeInstanceOf(Date);
    expect(created.dueDate!.getTime()).toBe(due.getTime());
  });

  it("getTestAssignments lists every assignment of a test", async () => {
    const testId = await insertTest();
    const otherTestId = await insertTest();
    await storage.createTestAssignment({ testId, userId: randomUUID(), assignedBy: "a" } as never);
    await storage.createTestAssignment({ testId, groupId: randomUUID(), assignedBy: "a" } as never);
    await storage.createTestAssignment({ testId: otherTestId, userId: randomUUID(), assignedBy: "a" } as never);

    const rows = await storage.getTestAssignments(testId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.testId === testId)).toBe(true);
  });

  it("getUserAssignments and getGroupAssignments read the matching branch only", async () => {
    const testId = await insertTest();
    const userId = randomUUID();
    const groupId = randomUUID();
    await storage.createTestAssignment({ testId, userId, assignedBy: "a" } as never);
    await storage.createTestAssignment({ testId, groupId, assignedBy: "a" } as never);

    const byUser = await storage.getUserAssignments(userId);
    expect(byUser).toHaveLength(1);
    expect(byUser[0].userId).toBe(userId);

    const byGroup = await storage.getGroupAssignments(groupId);
    expect(byGroup).toHaveLength(1);
    expect(byGroup[0].groupId).toBe(groupId);

    // A user-scoped read must not surface group assignments (and vice versa).
    expect(await storage.getUserAssignments(randomUUID())).toEqual([]);
    expect(await storage.getGroupAssignments(randomUUID())).toEqual([]);
  });

  it("deleteTestAssignment removes the row (observable effect) and reports false for a missing id", async () => {
    const testId = await insertTest();
    const created = await storage.createTestAssignment({
      testId, userId: randomUUID(), assignedBy: "a",
    } as never);

    // rowCount is not populated by pglite for DELETE-without-RETURNING, so assert
    // the row is gone rather than the returned boolean on the success path.
    await storage.deleteTestAssignment(created.id);
    expect(await storage.getAssignment(created.id)).toBeUndefined();

    // Deleting a non-existent row yields the false (rowCount 0) branch.
    expect(await storage.deleteTestAssignment(randomUUID())).toBe(false);
  });
});

describe("AssignmentsRepository — isTestAssignedToUser", () => {
  it("returns false when the user has neither a direct nor a group assignment", async () => {
    const testId = await insertTest();
    // No group memberships -> the groupIds.length === 0 short-circuit.
    expect(await storage.isTestAssignedToUser(testId, randomUUID())).toBe(false);
  });

  it("returns true on a direct assignment (cheapest branch)", async () => {
    const testId = await insertTest();
    const userId = randomUUID();
    await storage.createTestAssignment({ testId, userId, assignedBy: "a" } as never);
    expect(await storage.isTestAssignedToUser(testId, userId)).toBe(true);
  });

  it("returns true via one of the user's groups", async () => {
    const testId = await insertTest();
    const userId = randomUUID();
    const groupId = randomUUID();
    await storage.addUserToGroup(userId, groupId);
    await storage.createTestAssignment({ testId, groupId, assignedBy: "a" } as never);
    expect(await storage.isTestAssignedToUser(testId, userId)).toBe(true);
  });

  it("returns false when the user is in a group but the test is assigned to a different group", async () => {
    const testId = await insertTest();
    const userId = randomUUID();
    await storage.addUserToGroup(userId, randomUUID()); // user has a group…
    await storage.createTestAssignment({ testId, groupId: randomUUID(), assignedBy: "a" } as never); // …but not this one
    expect(await storage.isTestAssignedToUser(testId, userId)).toBe(false);
  });
});

describe("AssignmentsRepository — getAssignedTestsForUser", () => {
  it("returns an empty list when the user has no assignments", async () => {
    // No groups + no direct assignments -> testIds.length === 0 branch.
    expect(await storage.getAssignedTestsForUser(randomUUID())).toEqual([]);
  });

  it("loads directly-assigned tests for a user with no groups", async () => {
    const t1 = await insertTest();
    const userId = randomUUID();
    await storage.createTestAssignment({ testId: t1, userId, assignedBy: "a" } as never);

    const rows = await storage.getAssignedTestsForUser(userId);
    expect(rows.map((r) => r.id)).toEqual([t1]);
  });

  it("merges direct + group assignments and de-duplicates shared test ids", async () => {
    const t1 = await insertTest(); // assigned both directly and via group
    const t2 = await insertTest(); // assigned via group only
    const userId = randomUUID();
    const groupId = randomUUID();
    await storage.addUserToGroup(userId, groupId);
    await storage.createTestAssignment({ testId: t1, userId, assignedBy: "a" } as never);
    await storage.createTestAssignment({ testId: t1, groupId, assignedBy: "a" } as never);
    await storage.createTestAssignment({ testId: t2, groupId, assignedBy: "a" } as never);

    const ids = (await storage.getAssignedTestsForUser(userId)).map((r) => r.id).sort();
    expect(ids).toEqual([t1, t2].sort());
  });
});

describe("AssignmentsRepository — access tokens (magic links)", () => {
  it("createAssignmentAccessToken + getAssignmentAccessToken round-trip; unknown hash -> undefined", async () => {
    const token = await makeToken({ tokenHash: "hash-abc" });
    expect(token.id).toBeDefined();
    expect(token.revokedAt).toBeNull(); // active on creation

    const found = await storage.getAssignmentAccessToken("hash-abc");
    expect(found?.id).toBe(token.id);
    expect(await storage.getAssignmentAccessToken("nope")).toBeUndefined();
  });

  it("getAssignmentAccessTokensByAssignment lists every token of the assignment", async () => {
    const assignmentId = randomUUID();
    await makeToken({ assignmentId });
    await makeToken({ assignmentId });
    await makeToken({ assignmentId: randomUUID() }); // a different assignment

    const rows = await storage.getAssignmentAccessTokensByAssignment(assignmentId);
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.assignmentId === assignmentId)).toBe(true);
  });

  it("revokeAssignmentAccessToken soft-deletes by setting revokedAt", async () => {
    const token = await makeToken();
    await storage.revokeAssignmentAccessToken(token.id);

    const [after] = await h.current!.db.select().from(assignmentAccessTokens)
      .where(eq(assignmentAccessTokens.id, token.id));
    expect(after.revokedAt).toBeInstanceOf(Date); // soft revoke, row still present
  });

  it("revokeAssignmentAccessTokensByAssignment revokes only still-active tokens", async () => {
    const assignmentId = randomUUID();
    const active = await makeToken({ assignmentId });
    const already = await makeToken({ assignmentId });
    const other = await makeToken({ assignmentId: randomUUID() });

    // Pre-revoke one so we can prove its timestamp is preserved (revokedAt IS NULL guard).
    await storage.revokeAssignmentAccessToken(already.id);
    const [alreadyBefore] = await h.current!.db.select().from(assignmentAccessTokens)
      .where(eq(assignmentAccessTokens.id, already.id));

    await storage.revokeAssignmentAccessTokensByAssignment(assignmentId);
    const rows = await storage.getAssignmentAccessTokensByAssignment(assignmentId);

    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(active.id)!.revokedAt).toBeInstanceOf(Date); // newly revoked
    // The already-revoked token keeps its original revokedAt (not re-stamped).
    expect(byId.get(already.id)!.revokedAt!.getTime())
      .toBe(alreadyBefore.revokedAt!.getTime());

    // A token of another assignment is untouched.
    const [otherAfter] = await h.current!.db.select().from(assignmentAccessTokens)
      .where(eq(assignmentAccessTokens.id, other.id));
    expect(otherAfter.revokedAt).toBeNull();
  });

  it("revokeAssignmentAccessTokensByAssignmentAndUser revokes only the given user's active tokens", async () => {
    const assignmentId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    const aToken = await makeToken({ assignmentId, userId: userA });
    const bToken = await makeToken({ assignmentId, userId: userB });

    await storage.revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId, userA);
    const rows = await storage.getAssignmentAccessTokensByAssignment(assignmentId);
    const byId = new Map(rows.map((r) => [r.id, r]));

    expect(byId.get(aToken.id)!.revokedAt).toBeInstanceOf(Date); // user A revoked
    expect(byId.get(bToken.id)!.revokedAt).toBeNull(); // user B untouched
  });
});
