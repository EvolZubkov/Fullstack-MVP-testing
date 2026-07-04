/**
 * @module tests/it/mass-assignment.it.test
 * @description The update* DAL methods now whitelist writable columns, so a broad
 * Partial<Row> cannot mass-assign fields the caller must not touch. These specs
 * insert a row, call update* with a forbidden field alongside an allowed one, and
 * assert the forbidden column is untouched while the allowed one is applied.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { users, groups, attempts } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));
// Deterministic, config-free email crypto so createUser/updateUser work here.
vi.mock("../../server/utils/crypto", () => ({
  encryptEmail: async (e: string) => `enc:${e}`,
  decryptEmail: async (e: string) => e.replace(/^enc:/, ""),
  hashEmail: (e: string) => `hash:${e}`,
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

describe("update* — whitelist blocks mass-assignment", () => {
  it("updateUser applies name/status, ignores passwordHash/createdBy/emailHash", async () => {
    const user = await storage.createUser({
      email: "a@b.com", passwordHash: "pw", name: "Orig", status: "pending",
    } as never);
    const [before] = await h.current!.db.select().from(users).where(eq(users.id, user.id));

    const updated = await storage.updateUser(user.id, {
      name: "New", status: "active",
      passwordHash: "HACKED", createdBy: "evil", emailHash: "evil",
    } as never);

    expect(updated!.name).toBe("New");
    expect(updated!.status).toBe("active");

    const [after] = await h.current!.db.select().from(users).where(eq(users.id, user.id));
    expect(after.passwordHash).toBe(before.passwordHash); // still bcrypt("pw")
    expect(after.passwordHash).not.toBe("HACKED");
    expect(after.createdBy).toBe(before.createdBy);
    expect(after.emailHash).toBe(before.emailHash); // not clobbered by a forbidden value
  });

  it("updateGroup applies name, ignores createdBy/id", async () => {
    const g = await storage.createGroup({ name: "G", description: "d", createdBy: "orig" } as never);

    await storage.updateGroup(g.id, { name: "New", createdBy: "evil", id: "hacked" } as never);

    const [after] = await h.current!.db.select().from(groups).where(eq(groups.id, g.id));
    expect(after.name).toBe("New");
    expect(after.createdBy).toBe("orig");
    expect(after.id).toBe(g.id);
  });

  it("updateAttempt applies finishedAt, ignores userId/testId", async () => {
    const a = await storage.createAttempt({
      userId: "u1", testId: "t1", variantJson: {}, startedAt: new Date("2024-01-01"),
    } as never);

    await storage.updateAttempt(a.id, {
      finishedAt: new Date("2024-06-01"), userId: "EVIL", testId: "EVIL",
    } as never);

    const [after] = await h.current!.db.select().from(attempts).where(eq(attempts.id, a.id));
    expect(after.finishedAt).not.toBeNull();
    expect(after.userId).toBe("u1");
    expect(after.testId).toBe("t1");
  });
});
