// @vitest-environment node
/**
 * @module tests/storage/folders-repository.test
 * @description DAL coverage for {@link module:server/storage/folders-repository}
 * driven through the {@link module:server/storage} `DatabaseStorage` facade (so
 * the delegating facade methods are exercised too) against a real (pglite)
 * database. The repository is a thin data-access layer — mocking drizzle would
 * assert query shape, not behaviour — so these specs run the actual SQL through
 * the same in-process Postgres harness the integration suite uses. Runs in the
 * `node` environment (per-file override) so pglite works under the otherwise
 * jsdom unit run, and because it lives under `tests/` (not `tests/it/`) its
 * coverage counts toward the reported total. Both folder trees are covered:
 * content folders (`folders`, reparenting topics) and test folders
 * (`test_folders`, reparenting/cascading tests), including root vs nested and
 * empty vs populated branches.
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
import { DatabaseStorage } from "../../server/storage";
// eslint-disable-next-line import/first
import { folders, testFolders, topics, tests } from "@shared/schema";

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

/** Insert a minimal `topics` row directly, optionally inside a folder. */
async function insertTopic(folderId: string | null = null): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(topics).values({
    id,
    name: "Topic",
    folderId,
  } as never);
  return id;
}

/** Insert a minimal `tests` row directly, optionally inside a test folder. */
async function insertTest(folderId: string | null = null): Promise<string> {
  const id = randomUUID();
  await h.current!.db.insert(tests).values({
    id,
    title: "T",
    overallPassRuleJson: {},
    folderId,
  } as never);
  return id;
}

/** Read a topic's current `folderId`. */
async function topicFolderId(id: string): Promise<string | null> {
  const [row] = await h.current!.db.select().from(topics).where(eq(topics.id, id));
  return row?.folderId ?? null;
}

/** Read a test's current `folderId`. */
async function testFolderId(id: string): Promise<string | null> {
  const [row] = await h.current!.db.select().from(tests).where(eq(tests.id, id));
  return row?.folderId ?? null;
}

describe("FoldersRepository — content folders (folders)", () => {
  it("createFolder + getFolders + getFolder round-trip (root and nested)", async () => {
    expect(await storage.getFolders()).toEqual([]);

    const root = await storage.createFolder({ name: "Root", createdBy: "admin-1" } as never);
    expect(root.parentId).toBeNull(); // no parentId => root branch
    expect(root.createdBy).toBe("admin-1");

    const child = await storage.createFolder({ name: "Child", parentId: root.id } as never);
    expect(child.parentId).toBe(root.id); // nested branch
    expect(child.createdBy).toBeNull(); // createdBy ?? null branch

    expect(await storage.getFolders()).toHaveLength(2);
    expect((await storage.getFolder(root.id))?.name).toBe("Root");
    expect(await storage.getFolder(randomUUID())).toBeUndefined(); // not-found branch
  });

  it("updateFolder renames an existing folder; returns undefined for an unknown id", async () => {
    const folder = await storage.createFolder({ name: "Before" } as never);
    const updated = await storage.updateFolder(folder.id, { name: "After" });
    expect(updated?.name).toBe("After");
    expect((await storage.getFolder(folder.id))?.name).toBe("After");

    expect(await storage.updateFolder(randomUUID(), { name: "X" })).toBeUndefined();
  });

  it("deleteFolder (folder only) reparents topics + child folders to root when moveTo is null", async () => {
    const parent = await storage.createFolder({ name: "Parent" } as never);
    const child = await storage.createFolder({ name: "Child", parentId: parent.id } as never);
    const topicId = await insertTopic(parent.id);

    expect(await storage.deleteFolder(parent.id)).toBe(true);

    // Row gone, its topic and sub-folder relocated to root (null).
    expect(await storage.getFolder(parent.id)).toBeUndefined();
    expect(await topicFolderId(topicId)).toBeNull();
    expect((await storage.getFolder(child.id))?.parentId).toBeNull();
  });

  it("deleteFolder reparents topics + child folders to an explicit destination", async () => {
    const dest = await storage.createFolder({ name: "Dest" } as never);
    const parent = await storage.createFolder({ name: "Parent" } as never);
    const child = await storage.createFolder({ name: "Child", parentId: parent.id } as never);
    const topicId = await insertTopic(parent.id);

    expect(await storage.deleteFolder(parent.id, dest.id)).toBe(true);

    expect(await topicFolderId(topicId)).toBe(dest.id);
    expect((await storage.getFolder(child.id))?.parentId).toBe(dest.id);
  });

  it("deleteFolder returns false for an unknown id (nothing deleted)", async () => {
    expect(await storage.deleteFolder(randomUUID())).toBe(false);
  });

  it("getFolderSubtreeIds returns the node and all descendants (BFS); a leaf returns only itself", async () => {
    const root = await storage.createFolder({ name: "Root" } as never);
    const a = await storage.createFolder({ name: "A", parentId: root.id } as never);
    const b = await storage.createFolder({ name: "B", parentId: root.id } as never);
    const a1 = await storage.createFolder({ name: "A1", parentId: a.id } as never);

    const subtree = await storage.getFolderSubtreeIds(root.id);
    expect(subtree).toHaveLength(4);
    expect(new Set(subtree)).toEqual(new Set([root.id, a.id, b.id, a1.id]));
    expect(subtree[0]).toBe(root.id); // node itself first

    expect(await storage.getFolderSubtreeIds(b.id)).toEqual([b.id]); // leaf branch
  });

  it("deleteFoldersBulk returns 0 for an empty list and the deleted count otherwise", async () => {
    expect(await storage.deleteFoldersBulk([])).toBe(0); // empty-array short-circuit

    const f1 = await storage.createFolder({ name: "F1" } as never);
    const f2 = await storage.createFolder({ name: "F2" } as never);
    const keep = await storage.createFolder({ name: "Keep" } as never);

    expect(await storage.deleteFoldersBulk([f1.id, f2.id])).toBe(2);
    expect(await storage.getFolders()).toHaveLength(1);
    expect((await storage.getFolder(keep.id))?.name).toBe("Keep");
  });
});

describe("FoldersRepository — test folders (test_folders)", () => {
  it("createTestFolder + getTestFolders round-trip, ordered by name (root and nested)", async () => {
    expect(await storage.getTestFolders()).toEqual([]);

    const beta = await storage.createTestFolder({ name: "Beta", createdBy: "admin-1" } as never);
    expect(beta.parentId).toBeNull(); // root branch
    expect(beta.createdBy).toBe("admin-1");

    const alpha = await storage.createTestFolder({ name: "Alpha" } as never);
    expect(alpha.createdBy).toBeNull(); // createdBy ?? null branch

    const child = await storage.createTestFolder({ name: "Zeta", parentId: beta.id } as never);
    expect(child.parentId).toBe(beta.id); // nested branch

    // orderBy(name): Alpha, Beta, Zeta.
    expect((await storage.getTestFolders()).map((f) => f.name)).toEqual(["Alpha", "Beta", "Zeta"]);
  });

  it("updateTestFolder renames an existing folder; returns undefined for an unknown id", async () => {
    const folder = await storage.createTestFolder({ name: "Before" } as never);
    const updated = await storage.updateTestFolder(folder.id, { name: "After" });
    expect(updated?.name).toBe("After");

    expect(await storage.updateTestFolder(randomUUID(), { name: "X" })).toBeUndefined();
  });

  it("deleteTestFolder (folder only) moves tests + reparents child folders to root when moveTo is null", async () => {
    const parent = await storage.createTestFolder({ name: "Parent" } as never);
    const child = await storage.createTestFolder({ name: "Child", parentId: parent.id } as never);
    const testId = await insertTest(parent.id);

    expect(await storage.deleteTestFolder(parent.id)).toBe(true);

    // Folder gone, its test and sub-folder relocated to root.
    expect((await storage.getTestFolders()).map((f) => f.id)).not.toContain(parent.id);
    expect(await testFolderId(testId)).toBeNull();
    const childRow = (await storage.getTestFolders()).find((f) => f.id === child.id);
    expect(childRow?.parentId).toBeNull();
  });

  it("deleteTestFolder moves tests + reparents child folders to an explicit destination", async () => {
    const dest = await storage.createTestFolder({ name: "Dest" } as never);
    const parent = await storage.createTestFolder({ name: "Parent" } as never);
    const child = await storage.createTestFolder({ name: "Child", parentId: parent.id } as never);
    const testId = await insertTest(parent.id);

    expect(await storage.deleteTestFolder(parent.id, dest.id)).toBe(true);

    expect(await testFolderId(testId)).toBe(dest.id);
    const childRow = (await storage.getTestFolders()).find((f) => f.id === child.id);
    expect(childRow?.parentId).toBe(dest.id);
  });

  it("deleteTestFolder returns false for an unknown id (nothing deleted)", async () => {
    expect(await storage.deleteTestFolder(randomUUID())).toBe(false);
  });

  it("deleteTestFolderCascade removes the whole subtree of folders and every test inside", async () => {
    const parent = await storage.createTestFolder({ name: "Parent" } as never);
    const child = await storage.createTestFolder({ name: "Child", parentId: parent.id } as never);
    const grandchild = await storage.createTestFolder({ name: "Grandchild", parentId: child.id } as never);
    const sibling = await storage.createTestFolder({ name: "Sibling" } as never);

    const inParent = await insertTest(parent.id);
    const inGrandchild = await insertTest(grandchild.id);
    const inSibling = await insertTest(sibling.id);

    expect(await storage.deleteTestFolderCascade(parent.id)).toBe(true);

    // Whole subtree of folders gone; the sibling and its test survive.
    const remaining = (await storage.getTestFolders()).map((f) => f.id);
    expect(remaining).toEqual([sibling.id]);

    // Tests inside the subtree are deleted; the sibling's test is untouched.
    expect(await h.current!.db.select().from(tests).where(eq(tests.id, inParent))).toHaveLength(0);
    expect(await h.current!.db.select().from(tests).where(eq(tests.id, inGrandchild))).toHaveLength(0);
    expect(await h.current!.db.select().from(tests).where(eq(tests.id, inSibling))).toHaveLength(1);
  });

  it("deleteTestFolderCascade returns false for an unknown id (no rows removed)", async () => {
    const survivor = await storage.createTestFolder({ name: "Survivor" } as never);
    expect(await storage.deleteTestFolderCascade(randomUUID())).toBe(false);
    expect((await storage.getTestFolders()).map((f) => f.id)).toEqual([survivor.id]);
  });

  it("moveTestToFolder moves a test into a folder and back to root; unknown test id returns false", async () => {
    const folder = await storage.createTestFolder({ name: "Folder" } as never);
    const testId = await insertTest(null);

    expect(await storage.moveTestToFolder(testId, folder.id)).toBe(true);
    expect(await testFolderId(testId)).toBe(folder.id);

    expect(await storage.moveTestToFolder(testId, null)).toBe(true); // back to root
    expect(await testFolderId(testId)).toBeNull();

    expect(await storage.moveTestToFolder(randomUUID(), folder.id)).toBe(false); // unknown test
  });
});
