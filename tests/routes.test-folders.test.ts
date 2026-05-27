/**
 * Tests for /api/test-folders routes:
 * - GET  /
 * - POST /
 * - PUT  /:id
 * - DELETE /:id
 * - PATCH /move/:testId
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTestFolders: vi.fn(),
    createTestFolder: vi.fn(),
    updateTestFolder: vi.fn(),
    deleteTestFolder: vi.fn(),
    moveTestToFolder: vi.fn(),
    getUser: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import testFoldersRouter from "../server/routes/test-folders";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const learnerUser = { ...authorUser, id: "learner1", role: "learner" };

const folder1 = { id: "f1", name: "Математика", parentId: null, createdAt: new Date() };
const folder2 = { id: "f2", name: "Физика", parentId: null, createdAt: new Date() };
const childFolder = { id: "f3", name: "Алгебра", parentId: "f1", createdAt: new Date() };

// ─── App factory ──────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/test-folders", testFoldersRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }
function asLearner(req: request.Test) { return req.set("x-test-user", "learner1"); }

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockImplementation((id: string) => {
    if (id === "author1") return Promise.resolve(authorUser);
    if (id === "learner1") return Promise.resolve(learnerUser);
    return Promise.resolve(undefined);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/test-folders", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/test-folders");
    expect(res.status).toBe(401);
  });

  it("returns folders list for learner (requireAuth)", async () => {
    storageMock.getTestFolders.mockResolvedValue([folder1, folder2]);
    const res = await asLearner(request(makeApp()).get("/api/test-folders"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].id).toBe("f1");
  });

  it("returns folders list for author", async () => {
    storageMock.getTestFolders.mockResolvedValue([folder1, childFolder]);
    const res = await asAuthor(request(makeApp()).get("/api/test-folders"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  it("returns 500 on storage error", async () => {
    storageMock.getTestFolders.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).get("/api/test-folders"));
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/test-folders", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).post("/api/test-folders").send({ name: "Новая" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for learner", async () => {
    const res = await asLearner(request(makeApp()).post("/api/test-folders").send({ name: "Новая" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when name is missing", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/test-folders").send({}));
    expect(res.status).toBe(400);
  });

  it("returns 400 when name is blank", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/test-folders").send({ name: "   " }));
    expect(res.status).toBe(400);
  });

  it("creates root folder (no parentId)", async () => {
    storageMock.createTestFolder.mockResolvedValue(folder1);
    const res = await asAuthor(request(makeApp()).post("/api/test-folders").send({ name: "Математика" }));
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("f1");
    expect(storageMock.createTestFolder).toHaveBeenCalledWith({ name: "Математика", parentId: null });
  });

  it("creates nested folder with parentId", async () => {
    storageMock.createTestFolder.mockResolvedValue(childFolder);
    const res = await asAuthor(request(makeApp()).post("/api/test-folders").send({ name: "Алгебра", parentId: "f1" }));
    expect(res.status).toBe(201);
    expect(res.body.parentId).toBe("f1");
    expect(storageMock.createTestFolder).toHaveBeenCalledWith({ name: "Алгебра", parentId: "f1" });
  });

  it("trims whitespace from name", async () => {
    storageMock.createTestFolder.mockResolvedValue(folder1);
    await asAuthor(request(makeApp()).post("/api/test-folders").send({ name: "  Математика  " }));
    expect(storageMock.createTestFolder).toHaveBeenCalledWith(expect.objectContaining({ name: "Математика" }));
  });

  it("returns 500 on storage error", async () => {
    storageMock.createTestFolder.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).post("/api/test-folders").send({ name: "Test" }));
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/test-folders/:id", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).put("/api/test-folders/f1").send({ name: "Переименовано" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for learner", async () => {
    const res = await asLearner(request(makeApp()).put("/api/test-folders/f1").send({ name: "Переименовано" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when folder not found", async () => {
    storageMock.updateTestFolder.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp()).put("/api/test-folders/nonexistent").send({ name: "X" }));
    expect(res.status).toBe(404);
  });

  it("renames folder", async () => {
    const updated = { ...folder1, name: "Переименовано" };
    storageMock.updateTestFolder.mockResolvedValue(updated);
    const res = await asAuthor(request(makeApp()).put("/api/test-folders/f1").send({ name: "Переименовано" }));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Переименовано");
    expect(storageMock.updateTestFolder).toHaveBeenCalledWith("f1", { name: "Переименовано", parentId: undefined });
  });

  it("reparents folder (changes parentId)", async () => {
    const updated = { ...childFolder, parentId: "f2" };
    storageMock.updateTestFolder.mockResolvedValue(updated);
    const res = await asAuthor(request(makeApp()).put("/api/test-folders/f3").send({ name: "Алгебра", parentId: "f2" }));
    expect(res.status).toBe(200);
    expect(res.body.parentId).toBe("f2");
  });

  it("returns 500 on storage error", async () => {
    storageMock.updateTestFolder.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).put("/api/test-folders/f1").send({ name: "X" }));
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/test-folders/:id", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).delete("/api/test-folders/f1");
    expect(res.status).toBe(401);
  });

  it("returns 403 for learner", async () => {
    const res = await asLearner(request(makeApp()).delete("/api/test-folders/f1"));
    expect(res.status).toBe(403);
  });

  it("returns 404 when folder not found", async () => {
    // The route resolves the folder via getTestFolders() before deleting.
    storageMock.getTestFolders.mockResolvedValue([folder1, folder2]);
    const res = await asAuthor(request(makeApp()).delete("/api/test-folders/nonexistent"));
    expect(res.status).toBe(404);
  });

  it("deletes folder (folder-only) and returns 204", async () => {
    storageMock.getTestFolders.mockResolvedValue([folder1, folder2]);
    storageMock.deleteTestFolder.mockResolvedValue(true);
    const res = await asAuthor(request(makeApp()).delete("/api/test-folders/f1"));
    expect(res.status).toBe(204);
    // Default "folder-only" mode moves contained tests/sub-folders to root (null).
    expect(storageMock.deleteTestFolder).toHaveBeenCalledWith("f1", null);
  });

  it("returns 500 on storage error", async () => {
    storageMock.getTestFolders.mockResolvedValue([folder1]);
    storageMock.deleteTestFolder.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).delete("/api/test-folders/f1"));
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/test-folders/move/:testId", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).patch("/api/test-folders/move/test1").send({ folderId: "f1" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for learner", async () => {
    const res = await asLearner(request(makeApp()).patch("/api/test-folders/move/test1").send({ folderId: "f1" }));
    expect(res.status).toBe(403);
  });

  it("returns 404 when test not found", async () => {
    storageMock.moveTestToFolder.mockResolvedValue(false);
    const res = await asAuthor(request(makeApp()).patch("/api/test-folders/move/nonexistent").send({ folderId: "f1" }));
    expect(res.status).toBe(404);
  });

  it("moves test to folder", async () => {
    storageMock.moveTestToFolder.mockResolvedValue(true);
    const res = await asAuthor(request(makeApp()).patch("/api/test-folders/move/test1").send({ folderId: "f1" }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.moveTestToFolder).toHaveBeenCalledWith("test1", "f1");
  });

  it("moves test to root (folderId: null)", async () => {
    storageMock.moveTestToFolder.mockResolvedValue(true);
    const res = await asAuthor(request(makeApp()).patch("/api/test-folders/move/test1").send({ folderId: null }));
    expect(res.status).toBe(200);
    expect(storageMock.moveTestToFolder).toHaveBeenCalledWith("test1", null);
  });

  it("returns 500 on storage error", async () => {
    storageMock.moveTestToFolder.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).patch("/api/test-folders/move/test1").send({ folderId: "f1" }));
    expect(res.status).toBe(500);
  });
});
