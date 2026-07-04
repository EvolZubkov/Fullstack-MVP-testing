/**
 * @module server/storage/folders-repository
 * @description Data access for the two organizational folder trees: content
 * folders (`folders`, holding topics) and test folders (`test_folders`, holding
 * tests). Folders are purely organizational and carry no permissions, so no
 * content-guard is involved. Delete variants relocate or cascade the folder's
 * contents as one unit: the "folder only" deletes reparent topics/tests and
 * child folders to a destination (root by default), while
 * `deleteTestFolderCascade` removes every test in the subtree together with the
 * folders. Because the folder is the aggregate root of these operations, the
 * `topics`/`tests` tables are written here directly (boundary rule). Test-side
 * soft cleanup (adaptive rows) stays the route handler's responsibility. Exposed
 * through the `IStorage` facade, never imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, inArray } from "drizzle-orm";
import { db } from "../db";
import {
  folders, testFolders, topics, tests,
  type Folder, type InsertFolder,
  type TestFolder, type InsertTestFolder,
} from "@shared/schema";

/** Repository for the `folders` and `test_folders` organizational trees. */
export class FoldersRepository {
  // ─── Content folders (`folders`) ────────────────────────────────────────────

  async getFolders(): Promise<Folder[]> {
    return db.select().from(folders);
  }

  async getFolder(id: string): Promise<Folder | undefined> {
    const [folder] = await db.select().from(folders).where(eq(folders.id, id));
    return folder || undefined;
  }

  async createFolder(folder: InsertFolder): Promise<Folder> {
    const id = randomUUID();
    const [newFolder] = await db.insert(folders).values({
      id,
      name: folder.name,
      parentId: folder.parentId || null,
      createdBy: folder.createdBy || null,
    }).returning();
    return newFolder;
  }

  async updateFolder(id: string, updates: Partial<InsertFolder>): Promise<Folder | undefined> {
    const [updated] = await db.update(folders).set(updates).where(eq(folders.id, id)).returning();
    return updated || undefined;
  }

  async deleteFolder(id: string, moveTo: string | null = null): Promise<boolean> {
    // "Folder only" mode: reparent the folder's topics and direct sub-folders to
    // the chosen destination (`moveTo`, default null = root), then drop the row —
    // as one unit. Purely organizational — folders carry no ownership.
    return db.transaction(async (tx) => {
      await tx.update(topics).set({ folderId: moveTo }).where(eq(topics.folderId, id));
      await tx.update(folders).set({ parentId: moveTo }).where(eq(folders.parentId, id));
      const result = await tx.delete(folders).where(eq(folders.id, id)).returning();
      return result.length > 0;
    });
  }

  async getFolderSubtreeIds(id: string): Promise<string[]> {
    const all = await db.select({ id: folders.id, parentId: folders.parentId }).from(folders);
    const childrenByParent = new Map<string | null, string[]>();
    for (const f of all) {
      const key = f.parentId ?? null;
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(f.id);
    }
    const out: string[] = [];
    const queue: string[] = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      out.push(current);
      queue.push(...(childrenByParent.get(current) ?? []));
    }
    return out;
  }

  async deleteFoldersBulk(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const result = await db.delete(folders).where(inArray(folders.id, ids)).returning();
    return result.length;
  }

  // ─── Test folders (`test_folders`) ──────────────────────────────────────────

  async getTestFolders(): Promise<TestFolder[]> {
    return db.select().from(testFolders).orderBy(testFolders.name);
  }

  async createTestFolder(folder: InsertTestFolder): Promise<TestFolder> {
    const id = randomUUID();
    const [newFolder] = await db.insert(testFolders).values({
      id,
      name: folder.name,
      parentId: folder.parentId || null,
      createdBy: folder.createdBy || null,
    }).returning();
    return newFolder;
  }

  async updateTestFolder(id: string, updates: Partial<InsertTestFolder>): Promise<TestFolder | undefined> {
    const [updated] = await db.update(testFolders).set(updates).where(eq(testFolders.id, id)).returning();
    return updated || undefined;
  }

  async deleteTestFolder(id: string, moveTo: string | null = null): Promise<boolean> {
    // Move direct tests + reparent child folders to the destination, then drop
    // the row — as one unit (root by default).
    return db.transaction(async (tx) => {
      await tx.update(tests).set({ folderId: moveTo }).where(eq(tests.folderId, id));
      await tx.update(testFolders).set({ parentId: moveTo }).where(eq(testFolders.parentId, id));
      const result = await tx.delete(testFolders).where(eq(testFolders.id, id)).returning();
      return result.length > 0;
    });
  }

  /**
   * Recursively delete a folder, its sub-folders and every test inside them.
   * Test-side soft cleanup (adaptive levels/links/topic-settings) is the
   * caller's responsibility (route handler), keeping this method focused on
   * the folder/test row deletion.
   */
  async deleteTestFolderCascade(id: string): Promise<boolean> {
    // Collect all descendant folder ids breadth-first.
    const allFolders = await db.select().from(testFolders);
    const childrenByParent = new Map<string | null, string[]>();
    for (const f of allFolders) {
      const key = f.parentId ?? null;
      if (!childrenByParent.has(key)) childrenByParent.set(key, []);
      childrenByParent.get(key)!.push(f.id);
    }
    const descendantIds: string[] = [];
    const queue: string[] = [id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      descendantIds.push(current);
      const children = childrenByParent.get(current) ?? [];
      queue.push(...children);
    }

    // Delete every test in any of those folders, then the folders — as one unit.
    // Adaptive children rows are assumed cleaned up by the route handler first.
    // `descendantIds` always contains at least `id` (the BFS seed), so an unknown
    // id still runs the delete and reports false via the empty RETURNING set.
    return db.transaction(async (tx) => {
      await tx.delete(tests).where(inArray(tests.folderId, descendantIds));
      const result = await tx.delete(testFolders).where(inArray(testFolders.id, descendantIds)).returning();
      return result.length > 0;
    });
  }

  async moveTestToFolder(testId: string, folderId: string | null): Promise<boolean> {
    const result = await db.update(tests).set({ folderId }).where(eq(tests.id, testId)).returning();
    return result.length > 0;
  }
}
