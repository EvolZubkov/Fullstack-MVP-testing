// @vitest-environment node
/**
 * @module tests/storage/access-repository.test
 * @description DAL coverage for {@link module:server/storage/access-repository}
 * against a real (pglite) database. The repository is a thin data-access layer —
 * mocking drizzle would assert query shape, not behaviour — so these specs drive
 * the actual SQL through the same in-process Postgres harness the integration
 * suite uses. Runs in the `node` environment (per-file override) so pglite works
 * under the otherwise-jsdom unit run, and because it lives under `tests/` (not
 * `tests/it/`) its coverage counts toward the reported total.
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

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { AccessRepository } from "../../server/storage/access-repository";
// eslint-disable-next-line import/first
import { tests, topics, userRoles } from "@shared/schema";

let repo: AccessRepository;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new AccessRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
});

/** Insert a minimal `tests` row directly (bypasses createTest defaults/Zod). */
async function insertTest(ownerId: string | null): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(tests).values({
    id,
    title: "T",
    overallPassRuleJson: {},
    ownerId,
  } as never);
  return id;
}

/** Insert a minimal `topics` row directly. */
async function insertTopic(
  ownerId: string | null,
  visibility: "private" | "shared" = "private",
): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(topics).values({
    id,
    name: "Topic",
    ownerId,
    visibility,
  } as never);
  return id;
}

describe("AccessRepository — user roles", () => {
  it("returns an empty role set for an unknown user", async () => {
    expect(await repo.getUserRoles(randomUUID())).toEqual([]);
  });

  it("setUserRoles inserts a de-duplicated set and getUserRoles reads it back", async () => {
    const userId = randomUUID();
    await repo.setUserRoles(userId, ["author", "author", "manager"], "admin-1");
    expect((await repo.getUserRoles(userId)).sort()).toEqual(["author", "manager"]);
  });

  it("setUserRoles replaces the previous set atomically", async () => {
    const userId = randomUUID();
    await repo.setUserRoles(userId, ["author"]);
    await repo.setUserRoles(userId, ["manager", "learner"]);
    expect((await repo.getUserRoles(userId)).sort()).toEqual(["learner", "manager"]);
  });

  it("setUserRoles with an empty array clears the set (no insert branch)", async () => {
    const userId = randomUUID();
    await repo.setUserRoles(userId, ["author"]);
    await repo.setUserRoles(userId, []);
    expect(await repo.getUserRoles(userId)).toEqual([]);
    // The delete really ran — no orphan rows for this user.
    const rows = await h.current!.db.select().from(userRoles).where(eq(userRoles.userId, userId));
    expect(rows).toHaveLength(0);
  });

  it("addUserRole is idempotent (onConflictDoNothing on the unique index)", async () => {
    const userId = randomUUID();
    await repo.addUserRole(userId, "author", "admin-1");
    await repo.addUserRole(userId, "author");
    expect(await repo.getUserRoles(userId)).toEqual(["author"]);
  });

  it("removeUserRole drops only the named role", async () => {
    const userId = randomUUID();
    await repo.setUserRoles(userId, ["author", "manager"]);
    await repo.removeUserRole(userId, "author");
    expect(await repo.getUserRoles(userId)).toEqual(["manager"]);
  });
});

describe("AccessRepository — test ownership & grants", () => {
  it("setTestOwner + getTestIdsByOwner round-trip", async () => {
    const owner = randomUUID();
    const testId = await insertTest(null);
    expect(await repo.getTestIdsByOwner(owner)).toEqual([]);
    await repo.setTestOwner(testId, owner);
    expect(await repo.getTestIdsByOwner(owner)).toEqual([testId]);
    // Clearing the owner removes it from the owner index.
    await repo.setTestOwner(testId, null);
    expect(await repo.getTestIdsByOwner(owner)).toEqual([]);
  });

  it("upsertTestAccessGrant inserts, then updates on the (test,user) conflict", async () => {
    const testId = randomUUID();
    const userId = randomUUID();
    const created = await repo.upsertTestAccessGrant({
      testId, userId, accessLevel: "edit", grantedBy: "admin-1",
    } as never);
    expect(created.accessLevel).toBe("edit");

    const updated = await repo.upsertTestAccessGrant({
      testId, userId, accessLevel: "assign",
    } as never);
    expect(updated.id).toBe(created.id); // same row, upserted
    expect(updated.accessLevel).toBe("assign");
    expect(updated.grantedBy).toBeNull(); // grantedBy ?? null branch
  });

  it("getTestAccessGrants / getUserTestGrants / getTestGrantForUser read back grants", async () => {
    const testId = randomUUID();
    const userA = randomUUID();
    const userB = randomUUID();
    await repo.upsertTestAccessGrant({ testId, userId: userA, accessLevel: "edit" } as never);
    await repo.upsertTestAccessGrant({ testId, userId: userB, accessLevel: "assign" } as never);

    expect(await repo.getTestAccessGrants(testId)).toHaveLength(2);
    expect((await repo.getUserTestGrants(userA)).map((g) => g.testId)).toEqual([testId]);

    const grant = await repo.getTestGrantForUser(testId, userA);
    expect(grant?.accessLevel).toBe("edit");
    expect(await repo.getTestGrantForUser(testId, randomUUID())).toBeUndefined();
  });

  it("removeTestAccessGrant deletes the grant row", async () => {
    const testId = randomUUID();
    const userId = randomUUID();
    await repo.upsertTestAccessGrant({ testId, userId, accessLevel: "edit" } as never);
    // pglite does not report rowCount for DELETE without RETURNING (harness
    // caveat), so assert the observable effect rather than the boolean.
    await repo.removeTestAccessGrant(testId, userId);
    expect(await repo.getTestGrantForUser(testId, userId)).toBeUndefined();
  });
});

describe("AccessRepository — topic ownership, visibility & grants", () => {
  it("setTopicOwner + getTopicIdsByOwner round-trip", async () => {
    const owner = randomUUID();
    const topicId = await insertTopic(null);
    await repo.setTopicOwner(topicId, owner);
    expect(await repo.getTopicIdsByOwner(owner)).toEqual([topicId]);
  });

  it("setTopicVisibility flips the shared index membership", async () => {
    const topicId = await insertTopic(randomUUID(), "private");
    expect(await repo.getSharedTopicIds()).toEqual([]);
    await repo.setTopicVisibility(topicId, "shared");
    expect(await repo.getSharedTopicIds()).toEqual([topicId]);
    await repo.setTopicVisibility(topicId, "private");
    expect(await repo.getSharedTopicIds()).toEqual([]);
  });

  it("upsertTopicGrant inserts then updates; state and level are readable", async () => {
    const topicId = randomUUID();
    const granteeId = randomUUID();
    const created = await repo.upsertTopicGrant({
      topicId, granteeId, accessLevel: "use", grantedBy: "admin-1",
    });
    expect(created.accessLevel).toBe("use");
    expect(created.state).toBe("active");

    const updated = await repo.upsertTopicGrant({
      topicId, granteeId, accessLevel: "manage", grantedBy: null,
    });
    expect(updated.id).toBe(created.id);
    expect(updated.accessLevel).toBe("manage");
  });

  it("getTopicGrants / getTopicGrantForGrantee / active-grantee reads", async () => {
    const topicId = randomUUID();
    const granteeId = randomUUID();
    await repo.upsertTopicGrant({ topicId, granteeId, accessLevel: "use", grantedBy: null });

    expect(await repo.getTopicGrants(topicId)).toHaveLength(1);
    expect((await repo.getTopicGrantForGrantee(topicId, granteeId))?.accessLevel).toBe("use");
    expect(await repo.getTopicGrantForGrantee(topicId, randomUUID())).toBeUndefined();
    expect((await repo.getActiveTopicGrantsForGrantees(granteeId)).map((g) => g.topicId)).toEqual([topicId]);
  });

  it("setTopicGrantState hides a revoked grant from the active-grantee query", async () => {
    const topicId = randomUUID();
    const granteeId = randomUUID();
    const grant = await repo.upsertTopicGrant({ topicId, granteeId, accessLevel: "use", grantedBy: null });
    await repo.setTopicGrantState(grant.id, "revoked_in_use");
    expect(await repo.getActiveTopicGrantsForGrantees(granteeId)).toEqual([]);
    // But it still exists and is fetchable by id-scoped reads.
    expect(await repo.getTopicGrantForGrantee(topicId, granteeId)).toBeDefined();
  });

  it("removeTopicGrant deletes the grant row", async () => {
    const topicId = randomUUID();
    const granteeId = randomUUID();
    const grant = await repo.upsertTopicGrant({ topicId, granteeId, accessLevel: "use", grantedBy: null });
    await repo.removeTopicGrant(grant.id);
    expect(await repo.getTopicGrantForGrantee(topicId, granteeId)).toBeUndefined();
  });
});
