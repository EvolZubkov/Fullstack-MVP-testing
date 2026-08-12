/**
 * @module tests/it/dal-transactions.it.test
 * @description Multi-step DAL mutations are now wrapped in a transaction. These
 * specs prove atomicity on a real DB (a mid-operation failure rolls back the
 * earlier writes) and that wrapping did not change the happy-path behaviour.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
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

describe("setUserGroups — atomic replace", () => {
  it("rolls back the delete when the insert fails, preserving the old set", async () => {
    const userId = randomUUID();
    const g1 = await storage.createGroup({ name: "G1" } as never);
    const g2 = await storage.createGroup({ name: "G2" } as never);

    await storage.setUserGroups(userId, [g1.id]);
    expect((await storage.getUserGroups(userId)).map((g) => g.id)).toEqual([g1.id]);

    // Duplicate group ids violate the (user_id, group_id) unique index — the
    // insert fails after the delete. With a transaction the delete rolls back.
    await expect(storage.setUserGroups(userId, [g2.id, g2.id])).rejects.toThrow();

    // The original membership survived (not wiped by a committed delete).
    expect((await storage.getUserGroups(userId)).map((g) => g.id)).toEqual([g1.id]);
  });

  it("replaces the whole set on the happy path", async () => {
    const userId = randomUUID();
    const g1 = await storage.createGroup({ name: "A" } as never);
    const g2 = await storage.createGroup({ name: "B" } as never);

    await storage.setUserGroups(userId, [g1.id]);
    await storage.setUserGroups(userId, [g2.id]);

    expect((await storage.getUserGroups(userId)).map((g) => g.id)).toEqual([g2.id]);
  });
});

describe("deleteGroup — memberships + group as one unit", () => {
  it("removes the group and its user memberships", async () => {
    const userId = randomUUID();
    const g = await storage.createGroup({ name: "G" } as never);
    await storage.addUserToGroup(userId, g.id);

    expect(await storage.deleteGroup(g.id)).toBe(true);
    expect(await storage.getGroup(g.id)).toBeUndefined();
    expect(await storage.getUserGroups(userId)).toHaveLength(0);
  });
});

describe("deleteFolder — reparent then delete", () => {
  it("reparents the folder's topics to the destination, then drops the folder", async () => {
    const folder = await storage.createFolder({ name: "F" } as never);
    const topic = await storage.createTopic({ name: "T", folderId: folder.id } as never);

    expect(await storage.deleteFolder(folder.id, null)).toBe(true);
    expect(await storage.getFolder(folder.id)).toBeUndefined();
    expect((await storage.getTopic(topic.id))?.folderId).toBeNull();
  });
});
