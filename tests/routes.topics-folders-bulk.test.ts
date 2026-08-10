/**
 * Tests for the group (bulk) operations added for the «Папки и темы» content
 * axis (Р-2..Р-8): topic bulk-delete (partial-batch) / bulk-move / bulk-visibility
 * / bulk-owner / bulk-grant / bulk-revoke, and the two-mode folder DELETE +
 * folder bulk-reparent. `assessTopicDeletion` is mocked so the content-guard
 * partition (deletable / blocked) can be driven per test.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock, assessMock } = vi.hoisted(() => ({
  storageMock: {
    getTopic: vi.fn(), getTopics: vi.fn(), getUser: vi.fn(),
    getFolder: vi.fn(), getFolders: vi.fn(),
    getFolderSubtreeIds: vi.fn(), deleteFoldersBulk: vi.fn(), moveTopicsToFolder: vi.fn(),
    deleteFolder: vi.fn(), updateFolder: vi.fn(),
    deleteTopicsBulk: vi.fn(),
    setTopicVisibility: vi.fn(), setTopicOwner: vi.fn(),
    upsertTopicGrant: vi.fn(), setTopicGrantState: vi.fn(), removeTopicGrant: vi.fn(),
    getTopicGrantForGrantee: vi.fn(), getTestsUsingTopic: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
  },
  assessMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/draw-feasibility", () => ({ assessTopicDeletion: assessMock }));

import topicsRouter from "../server/routes/topics";
import foldersRouter from "../server/routes/folders";

const adminUser = {
  id: "admin1", email: "admin@test.com", name: "Admin",
  role: "administrator", status: "active", mustChangePassword: false,
  gdprConsent: true, passwordHash: "x", emailHash: "x",
  createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp(router: express.Router, path: string) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use(path, router);
  return app;
}
const asAdmin = (req: request.Test) => req.set("x-test-user", "admin1");

const NO_CONFLICT = { blocking: [], warnings: [] };
const topic = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `T-${id}`, ownerId: "admin1", visibility: "private", folderId: null, ...over,
});

let topicsApp: express.Express;
let foldersApp: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(adminUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  assessMock.mockResolvedValue(NO_CONFLICT);
  topicsApp = makeApp(topicsRouter, "/api/topics");
  foldersApp = makeApp(foldersRouter, "/api/folders");
});

// ─── Topics: bulk-delete (partial-batch) ───────────────────────────────────────
describe("POST /api/topics/bulk-delete (partial-batch)", () => {
  it("400 when ids missing", async () => {
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-delete").send({ ids: [] }));
    expect(res.status).toBe(400);
  });

  it("deletes all when nothing is blocked", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    storageMock.deleteTopicsBulk.mockResolvedValue({ count: 2, questionIds: [], contentPageIds: [] });
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-delete").send({ ids: ["t1", "t2"] }));
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(2);
    expect(res.body.deletedIds).toEqual(["t1", "t2"]);
    expect(res.body.skipped).toEqual([]);
    expect(storageMock.deleteTopicsBulk).toHaveBeenCalledWith(["t1", "t2"]);
  });

  it("dry-run returns the partition without mutating", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    assessMock.mockImplementation(async (id: string) => (id === "t2" ? { blocking: [{ testId: "x", issues: [] }], warnings: [] } : NO_CONFLICT));
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-delete?dryRun=true").send({ ids: ["t1", "t2"] }));
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.deletable.map((d: any) => d.topicId)).toEqual(["t1"]);
    expect(res.body.blocked.map((b: any) => b.topicId)).toEqual(["t2"]);
    expect(storageMock.deleteTopicsBulk).not.toHaveBeenCalled();
  });

  it("skips blocked topics, deletes the rest", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    assessMock.mockImplementation(async (id: string) => (id === "t2" ? { blocking: [{ testId: "x", issues: [] }], warnings: [] } : NO_CONFLICT));
    storageMock.deleteTopicsBulk.mockResolvedValue({ count: 1, questionIds: [], contentPageIds: [] });
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-delete").send({ ids: ["t1", "t2"] }));
    expect(res.status).toBe(200);
    expect(storageMock.deleteTopicsBulk).toHaveBeenCalledWith(["t1"]);
    expect(res.body.skipped).toEqual([expect.objectContaining({ topicId: "t2", reason: "in_use" })]);
  });

  it("admin ?force=true deletes blocked topics too", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    assessMock.mockResolvedValue({ blocking: [{ testId: "x", issues: [] }], warnings: [] });
    storageMock.deleteTopicsBulk.mockResolvedValue({ count: 2, questionIds: [], contentPageIds: [] });
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-delete?force=true").send({ ids: ["t1", "t2"] }));
    expect(res.status).toBe(200);
    expect(storageMock.deleteTopicsBulk).toHaveBeenCalledWith(["t1", "t2"]);
    expect(res.body.skipped).toEqual([]);
  });
});

// ─── Topics: bulk-move ─────────────────────────────────────────────────────────
describe("POST /api/topics/bulk-move", () => {
  it("400 when ids missing", async () => {
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-move").send({ folderId: null }));
    expect(res.status).toBe(400);
  });

  it("400 when folderId is not a string or null", async () => {
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-move").send({ ids: ["t1"], folderId: 5 }));
    expect(res.status).toBe(400);
  });

  it("404 when destination folder is missing", async () => {
    storageMock.getFolder.mockResolvedValue(undefined);
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-move").send({ ids: ["t1"], folderId: "f9" }));
    expect(res.status).toBe(404);
  });

  it("moves manageable topics to a folder", async () => {
    storageMock.getFolder.mockResolvedValue({ id: "f1", name: "F", parentId: null });
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    storageMock.moveTopicsToFolder.mockResolvedValue(2);
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-move").send({ ids: ["t1", "t2"], folderId: "f1" }));
    expect(res.status).toBe(200);
    expect(res.body.movedCount).toBe(2);
    expect(storageMock.moveTopicsToFolder).toHaveBeenCalledWith(["t1", "t2"], "f1");
  });

  it("moves to root when folderId is null", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    storageMock.moveTopicsToFolder.mockResolvedValue(1);
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-move").send({ ids: ["t1"], folderId: null }));
    expect(res.status).toBe(200);
    expect(storageMock.moveTopicsToFolder).toHaveBeenCalledWith(["t1"], null);
  });
});

// ─── Topics: bulk-visibility / bulk-owner ──────────────────────────────────────
describe("POST /api/topics/bulk-visibility", () => {
  it("400 on invalid visibility", async () => {
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-visibility").send({ ids: ["t1"], visibility: "public" }));
    expect(res.status).toBe(400);
  });

  it("sets visibility on each topic", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-visibility").send({ ids: ["t1", "t2"], visibility: "shared" }));
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(2);
    expect(storageMock.setTopicVisibility).toHaveBeenCalledTimes(2);
    expect(storageMock.setTopicVisibility).toHaveBeenCalledWith("t1", "shared");
  });
});

describe("POST /api/topics/bulk-owner", () => {
  it("404 when new owner does not exist", async () => {
    storageMock.getUser.mockImplementation(async (id: string) => (id === "u9" ? undefined : adminUser));
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-owner").send({ ids: ["t1"], ownerId: "u9" }));
    expect(res.status).toBe(404);
  });

  it("reassigns owner on each topic", async () => {
    storageMock.getUser.mockResolvedValue(adminUser);
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-owner").send({ ids: ["t1", "t2"], ownerId: "admin1" }));
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(2);
    expect(storageMock.setTopicOwner).toHaveBeenCalledWith("t2", "admin1");
  });
});

// ─── Topics: bulk-grant / bulk-revoke ──────────────────────────────────────────
describe("POST /api/topics/bulk-grant", () => {
  it("400 on invalid access level", async () => {
    storageMock.getUser.mockResolvedValue(adminUser);
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-grant").send({ ids: ["t1"], granteeId: "u2", accessLevel: "admin" }));
    expect(res.status).toBe(400);
  });

  it("404 when grantee does not exist", async () => {
    storageMock.getUser.mockImplementation(async (id: string) => (id === "u2" ? undefined : adminUser));
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-grant").send({ ids: ["t1"], granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(404);
  });

  it("upserts a grant on each topic", async () => {
    storageMock.getUser.mockResolvedValue(adminUser);
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-grant").send({ ids: ["t1", "t2"], granteeId: "u2", accessLevel: "manage" }));
    expect(res.status).toBe(200);
    expect(res.body.grantedCount).toBe(2);
    expect(storageMock.upsertTopicGrant).toHaveBeenCalledWith(expect.objectContaining({ topicId: "t1", granteeId: "u2", accessLevel: "manage" }));
  });
});

describe("POST /api/topics/bulk-revoke", () => {
  it("soft revoke flips existing grants, skips topics without a grant", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    storageMock.getTopicGrantForGrantee.mockImplementation(async (topicId: string) => (topicId === "t1" ? { id: "g1" } : undefined));
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-revoke").send({ ids: ["t1", "t2"], granteeId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("soft");
    expect(res.body.revokedCount).toBe(1);
    expect(storageMock.setTopicGrantState).toHaveBeenCalledWith("g1", "revoked_in_use");
    expect(res.body.skipped).toEqual([expect.objectContaining({ topicId: "t2", reason: "no_grant" })]);
  });

  it("hard revoke is administrator-only", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    const res = await request(topicsApp)
      .post("/api/topics/bulk-revoke?mode=hard")
      .set("x-test-user", "admin1")
      .send({ ids: ["t1"], granteeId: "u2" });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hard_revoke_admin_only");
  });

  it("hard revoke dry-run partitions revocable vs blocked (published dependents)", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    storageMock.getTopicGrantForGrantee.mockResolvedValue({ id: "g" });
    storageMock.getTestsUsingTopic.mockImplementation(async (topicId: string) =>
      topicId === "t2" ? [{ id: "T", title: "Exam", ownerId: "u2", status: "published" }] : [],
    );
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-revoke?mode=hard&dryRun=true").send({ ids: ["t1", "t2"], granteeId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.revocable.map((r: any) => r.topicId)).toEqual(["t1"]);
    expect(res.body.blocked.map((b: any) => b.topicId)).toEqual(["t2"]);
    expect(storageMock.removeTopicGrant).not.toHaveBeenCalled();
  });

  it("hard revoke removes non-blocked grants", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => topic(id));
    storageMock.getTopicGrantForGrantee.mockImplementation(async (topicId: string) => ({ id: `g-${topicId}` }));
    storageMock.getTestsUsingTopic.mockResolvedValue([]);
    const res = await asAdmin(request(topicsApp).post("/api/topics/bulk-revoke?mode=hard").send({ ids: ["t1"], granteeId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.revokedCount).toBe(1);
    expect(storageMock.removeTopicGrant).toHaveBeenCalledWith("g-t1");
  });
});

// ─── Folders: two-mode DELETE ──────────────────────────────────────────────────
describe("DELETE /api/folders/:id", () => {
  it("404 when the folder is missing", async () => {
    storageMock.getFolder.mockResolvedValue(undefined);
    const res = await asAdmin(request(foldersApp).delete("/api/folders/x").send({}));
    expect(res.status).toBe(404);
  });

  it("folder-only (empty body) reparents contents to root", async () => {
    storageMock.getFolder.mockResolvedValue({ id: "f1", name: "F1", parentId: null });
    storageMock.deleteFolder.mockResolvedValue(true);
    const res = await asAdmin(request(foldersApp).delete("/api/folders/f1"));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("folder-only");
    expect(storageMock.deleteFolder).toHaveBeenCalledWith("f1", null);
  });

  it("folder-only rejects a destination inside the deleted subtree", async () => {
    storageMock.getFolder.mockResolvedValue({ id: "f1", name: "F1", parentId: null });
    storageMock.getFolderSubtreeIds.mockResolvedValue(["f1", "f2"]);
    const res = await asAdmin(request(foldersApp).delete("/api/folders/f1").send({ mode: "folder-only", moveContentsTo: "f2" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_destination");
  });

  it("folder-and-content requires the exact name", async () => {
    storageMock.getFolder.mockResolvedValue({ id: "f1", name: "F1", parentId: null });
    const res = await asAdmin(request(foldersApp).delete("/api/folders/f1").send({ mode: "folder-and-content", confirmName: "wrong" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("name_mismatch");
  });

  it("folder-and-content dry-run returns the partition", async () => {
    storageMock.getFolder.mockResolvedValue({ id: "f1", name: "F1", parentId: null });
    storageMock.getFolderSubtreeIds.mockResolvedValue(["f1"]);
    storageMock.getTopics.mockResolvedValue([topic("t1", { folderId: "f1" }), topic("t2", { folderId: "f1" })]);
    assessMock.mockImplementation(async (id: string) => (id === "t2" ? { blocking: [{ testId: "x", issues: [] }], warnings: [] } : NO_CONFLICT));
    const res = await asAdmin(request(foldersApp).delete("/api/folders/f1?dryRun=true").send({ mode: "folder-and-content", confirmName: "F1" }));
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.deletable.map((d: any) => d.topicId)).toEqual(["t1"]);
    expect(res.body.blocked.map((b: any) => b.topicId)).toEqual(["t2"]);
    expect(storageMock.deleteFoldersBulk).not.toHaveBeenCalled();
  });

  it("folder-and-content deletes deletable topics, survivors go to root, folders dropped", async () => {
    storageMock.getFolder.mockResolvedValue({ id: "f1", name: "F1", parentId: null });
    storageMock.getFolderSubtreeIds.mockResolvedValue(["f1"]);
    storageMock.getTopics.mockResolvedValue([topic("t1", { folderId: "f1" }), topic("t2", { folderId: "f1" })]);
    assessMock.mockImplementation(async (id: string) => (id === "t2" ? { blocking: [{ testId: "x", issues: [] }], warnings: [] } : NO_CONFLICT));
    storageMock.deleteTopicsBulk.mockResolvedValue({ count: 1, questionIds: [], contentPageIds: [] });
    storageMock.deleteFoldersBulk.mockResolvedValue(1);
    const res = await asAdmin(request(foldersApp).delete("/api/folders/f1").send({ mode: "folder-and-content", confirmName: "F1" }));
    expect(res.status).toBe(200);
    expect(storageMock.deleteTopicsBulk).toHaveBeenCalledWith(["t1"]);
    expect(storageMock.moveTopicsToFolder).toHaveBeenCalledWith(["t2"], null);
    expect(storageMock.deleteFoldersBulk).toHaveBeenCalledWith(["f1"]);
    expect(res.body.deletedTopics).toBe(1);
  });
});

// ─── Folders: bulk-reparent (cycle guard) ──────────────────────────────────────
describe("POST /api/folders/bulk-reparent", () => {
  it("400 when ids missing", async () => {
    const res = await asAdmin(request(foldersApp).post("/api/folders/bulk-reparent").send({ parentId: null }));
    expect(res.status).toBe(400);
  });

  it("404 when the parent folder does not exist", async () => {
    storageMock.getFolder.mockResolvedValue(undefined);
    const res = await asAdmin(request(foldersApp).post("/api/folders/bulk-reparent").send({ ids: ["f1"], parentId: "f9" }));
    expect(res.status).toBe(404);
  });

  it("rejects moving a folder into its own descendant (cycle)", async () => {
    storageMock.getFolder.mockResolvedValue({ id: "f2", name: "F2", parentId: null });
    storageMock.getFolderSubtreeIds.mockResolvedValue(["f1", "f2"]);
    const res = await asAdmin(request(foldersApp).post("/api/folders/bulk-reparent").send({ ids: ["f1"], parentId: "f2" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_parent");
  });

  it("reparents folders to a new parent", async () => {
    storageMock.getFolder.mockImplementation(async (id: string) => ({ id, name: id, parentId: null }));
    storageMock.getFolderSubtreeIds.mockResolvedValue(["f1"]);
    const res = await asAdmin(request(foldersApp).post("/api/folders/bulk-reparent").send({ ids: ["f1"], parentId: "fp" }));
    expect(res.status).toBe(200);
    expect(res.body.movedCount).toBe(1);
    expect(storageMock.updateFolder).toHaveBeenCalledWith("f1", { parentId: "fp" });
  });

  it("reparents folders to root when parentId is null", async () => {
    storageMock.getFolder.mockImplementation(async (id: string) => ({ id, name: id, parentId: "old" }));
    const res = await asAdmin(request(foldersApp).post("/api/folders/bulk-reparent").send({ ids: ["f1"], parentId: null }));
    expect(res.status).toBe(200);
    expect(storageMock.updateFolder).toHaveBeenCalledWith("f1", { parentId: null });
  });
});
