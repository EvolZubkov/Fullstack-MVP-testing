/**
 * @module tests/media-usage-on-cascade-delete
 * @description Covers the media-usage-index (`media_usages`) cleanup gap on the CASCADE
 * delete paths that remove questions/content pages directly via SQL (bypassing their own
 * save/delete route handler), and the analogous bulk-delete-questions path that never
 * cleaned up at all:
 *
 *   - `DELETE /api/topics/:id` — the full-cascade topic delete (questions, content pages).
 *   - `POST /api/topics/bulk-delete` — same cascade, batched.
 *   - `DELETE /api/folders/:id` (`mode: "folder-and-content"`) — folder cascade, which
 *     itself deletes topics in bulk and inherits the same gap.
 *   - `POST /api/questions/bulk-delete` — never synced the index for the removed questions.
 *
 * Without this, a topic/folder/bulk-question delete leaves `media_usages` rows pointing at
 * ids that no longer exist. Those rows are not merely useless: `DELETE /api/media/:id`
 * refuses (`409 media_in_use`) as long as ANY row references the asset, so a stale row holds
 * a file hostage forever — worse than a missing row, which just fails safe and heals on the
 * next `POST /api/media/reindex`.
 *
 * `server/services/media/usage-index.ts`'s `clearCascadedUsages` is mocked here (its own
 * behaviour — clearing one entity's rows, swallowing a failed one — is covered by
 * `tests/media-usage-index.test.ts`); these tests only check that each route hands it the
 * RIGHT entries, derived from the repository's cascaded ids.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { clearCascadedUsagesMock } = vi.hoisted(() => ({
  clearCascadedUsagesMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/services/media/usage-index", () => ({
  clearCascadedUsages: clearCascadedUsagesMock,
  syncEntityUsages: vi.fn().mockResolvedValue(undefined),
  canonicalizeEntityMedia: vi.fn().mockImplementation(async (entity: unknown) => entity),
}));

const { storageMock, assessTopicDeletionMock, assessQuestionsRemovalMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getTopic: vi.fn(),
    getTopics: vi.fn(),
    deleteTopic: vi.fn(),
    deleteTopicsBulk: vi.fn(),
    getQuestion: vi.fn(),
    deleteQuestionsBulk: vi.fn(),
    getFolder: vi.fn(),
    getFolderSubtreeIds: vi.fn(),
    deleteFoldersBulk: vi.fn(),
    moveTopicsToFolder: vi.fn(),
  },
  assessTopicDeletionMock: vi.fn(),
  assessQuestionsRemovalMock: vi.fn(),
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/draw-feasibility", () => ({
  assessTopicDeletion: assessTopicDeletionMock,
  assessQuestionsRemoval: assessQuestionsRemovalMock,
}));

import topicsRouter from "../server/routes/topics";
import foldersRouter from "../server/routes/folders";
import questionsRouter from "../server/routes/questions";

const adminUser = {
  id: "admin1", email: "admin@test.com", name: "Admin",
  role: "administrator", status: "active", mustChangePassword: false,
  gdprConsent: true, passwordHash: "x", emailHash: "x",
  createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp(router: express.Router, mount: string) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res, next) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use(mount, router);
  return app;
}
const asAdmin = (req: request.Test) => req.set("x-test-user", "admin1");

const NO_CONFLICT = { blocking: [], warnings: [] };

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(adminUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  assessTopicDeletionMock.mockResolvedValue(NO_CONFLICT);
  assessQuestionsRemovalMock.mockResolvedValue(NO_CONFLICT);
});

describe("DELETE /api/topics/:id -> cascaded media cleanup", () => {
  it("clears the index rows of every cascaded question and content page", async () => {
    storageMock.getTopic.mockResolvedValue({ id: "t1", name: "T1", ownerId: "admin1" });
    storageMock.deleteTopic.mockResolvedValue({
      deleted: true,
      questionIds: ["q1", "q2"],
      contentPageIds: ["p1"],
    });

    const app = makeApp(topicsRouter, "/api/topics");
    const res = await asAdmin(request(app).delete("/api/topics/t1"));

    expect(res.status).toBe(200);
    expect(clearCascadedUsagesMock).toHaveBeenCalledWith([
      { entityType: "question", entityId: "q1" },
      { entityType: "question", entityId: "q2" },
      { entityType: "content_page", entityId: "p1" },
    ]);
  });

  it("a topic with nothing to cascade still calls the cleanup, with an empty list", async () => {
    storageMock.getTopic.mockResolvedValue({ id: "t1", name: "T1", ownerId: "admin1" });
    storageMock.deleteTopic.mockResolvedValue({ deleted: true, questionIds: [], contentPageIds: [] });

    const app = makeApp(topicsRouter, "/api/topics");
    const res = await asAdmin(request(app).delete("/api/topics/t1"));

    expect(res.status).toBe(200);
    expect(clearCascadedUsagesMock).toHaveBeenCalledWith([]);
  });

  it("404 (topic already gone) skips the cleanup entirely", async () => {
    storageMock.getTopic.mockResolvedValue({ id: "t1", name: "T1", ownerId: "admin1" });
    storageMock.deleteTopic.mockResolvedValue({ deleted: false, questionIds: [], contentPageIds: [] });

    const app = makeApp(topicsRouter, "/api/topics");
    const res = await asAdmin(request(app).delete("/api/topics/t1"));

    expect(res.status).toBe(404);
    expect(clearCascadedUsagesMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/topics/bulk-delete -> cascaded media cleanup", () => {
  it("clears the index rows cascaded across every deleted topic in the batch", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => ({ id, name: id, ownerId: "admin1" }));
    storageMock.deleteTopicsBulk.mockResolvedValue({
      count: 2,
      questionIds: ["q1", "q2", "q3"],
      contentPageIds: ["p1"],
    });

    const app = makeApp(topicsRouter, "/api/topics");
    const res = await asAdmin(request(app).post("/api/topics/bulk-delete").send({ ids: ["t1", "t2"] }));

    expect(res.status).toBe(200);
    expect(clearCascadedUsagesMock).toHaveBeenCalledWith([
      { entityType: "question", entityId: "q1" },
      { entityType: "question", entityId: "q2" },
      { entityType: "question", entityId: "q3" },
      { entityType: "content_page", entityId: "p1" },
    ]);
  });
});

describe("DELETE /api/folders/:id (folder-and-content) -> cascaded media cleanup", () => {
  it("clears the index rows of questions/pages cascaded via the folder's topic delete", async () => {
    storageMock.getFolder.mockResolvedValue({ id: "f1", name: "F1", parentId: null });
    storageMock.getFolderSubtreeIds.mockResolvedValue(["f1"]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "T1", ownerId: "admin1", folderId: "f1" }]);
    storageMock.deleteTopicsBulk.mockResolvedValue({
      count: 1,
      questionIds: ["q1"],
      contentPageIds: ["p1", "p2"],
    });
    storageMock.deleteFoldersBulk.mockResolvedValue(1);

    const app = makeApp(foldersRouter, "/api/folders");
    const res = await asAdmin(
      request(app).delete("/api/folders/f1").send({ mode: "folder-and-content", confirmName: "F1" }),
    );

    expect(res.status).toBe(200);
    expect(clearCascadedUsagesMock).toHaveBeenCalledWith([
      { entityType: "question", entityId: "q1" },
      { entityType: "content_page", entityId: "p1" },
      { entityType: "content_page", entityId: "p2" },
    ]);
  });
});

describe("POST /api/questions/bulk-delete -> media cleanup", () => {
  it("clears the index rows of every requested question id", async () => {
    storageMock.getQuestion.mockImplementation(async (id: string) => ({ id, topicId: "t1" }));
    storageMock.deleteQuestionsBulk.mockResolvedValue(2);

    const app = makeApp(questionsRouter, "/api/questions");
    const res = await asAdmin(request(app).post("/api/questions/bulk-delete").send({ ids: ["q1", "q2"] }));

    expect(res.status).toBe(200);
    expect(clearCascadedUsagesMock).toHaveBeenCalledWith([
      { entityType: "question", entityId: "q1" },
      { entityType: "question", entityId: "q2" },
    ]);
  });

  it("a blocked batch (409) never reaches storage or the cleanup", async () => {
    storageMock.getQuestion.mockImplementation(async (id: string) => ({ id, topicId: "t1" }));
    assessQuestionsRemovalMock.mockResolvedValue({ blocking: [{ testId: "pub1", issues: [] }], warnings: [] });

    const app = makeApp(questionsRouter, "/api/questions");
    const res = await asAdmin(request(app).post("/api/questions/bulk-delete").send({ ids: ["q1"] }));

    expect(res.status).toBe(409);
    expect(storageMock.deleteQuestionsBulk).not.toHaveBeenCalled();
    expect(clearCascadedUsagesMock).not.toHaveBeenCalled();
  });
});
