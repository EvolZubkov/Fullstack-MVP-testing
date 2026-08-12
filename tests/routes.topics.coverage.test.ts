/**
 * Branch-coverage tests for `server/routes/topics.ts` — the error / permission /
 * validation / edge paths not exercised by the happy-path suites
 * (`routes.topics-folders-groups.test.ts`, `routes.topics-folders-bulk.test.ts`).
 *
 * Harness mirrors those suites: a hoisted `storageMock` for `../server/storage`
 * and an `assessMock` for `../server/services/draw-feasibility`
 * (`assessTopicDeletion`). The real `topic-access` and `content-guard` services
 * run unmocked; object-level permission is driven by flipping the actor's
 * effective roles (`getUserRoles`) and the topic `ownerId`:
 *
 * - administrator (`getUserRoles -> ["administrator"]`) passes every object check;
 * - a plain author (`["author"]`) that neither owns the topic nor holds a manage
 *   grant fails `canManageTopicContent` / `canDeleteTopic` / `canGrantTopicAccess`,
 *   hitting the 403 branches.
 *
 * Each case targets one uncovered branch and asserts status + error body.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoisted mocks ─────────────────────────────────────────────────────────────
const { storageMock, assessMock } = vi.hoisted(() => ({
  storageMock: {
    // topics core
    getTopics: vi.fn(), getTopic: vi.fn(), getQuestionsByTopic: vi.fn(),
    createTopic: vi.fn(), updateTopic: vi.fn(), renameTopicInFormulas: vi.fn(),
    deleteTopic: vi.fn(), deleteTopicsBulk: vi.fn(), duplicateTopicWithQuestions: vi.fn(),
    moveTopicsToFolder: vi.fn(), setTopicVisibility: vi.fn(), setTopicOwner: vi.fn(),
    // grants
    getTopicGrants: vi.fn(), getTopicGrantForGrantee: vi.fn(), upsertTopicGrant: vi.fn(),
    setTopicGrantState: vi.fn(), removeTopicGrant: vi.fn(),
    // access-scope resolution (topic-access service)
    getActiveTopicGrantsForGrantees: vi.fn(), getSharedTopicIds: vi.fn(),
    getTopicIdsByOwner: vi.fn(), getTestsUsingTopic: vi.fn(),
    // folders
    getFolder: vi.fn(),
    // auth
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
  },
  assessMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/draw-feasibility", () => ({ assessTopicDeletion: assessMock }));

import topicsRouter from "../server/routes/topics";

// ─── Fixtures ──────────────────────────────────────────────────────────────────
const user = {
  id: "u1", email: "u1@test.com", name: "User One",
  status: "active", mustChangePassword: false,
  gdprConsent: true, passwordHash: "x", emailHash: "x",
  createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

const NO_CONFLICT = { blocking: [], warnings: [] };
const BLOCKED = { blocking: [{ testId: "T1", issues: [] }], warnings: [] };

/** A topic reduced to the fields the routes/services read. */
const topic = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: `T-${id}`, description: "", ownerId: "u1", visibility: "private",
  folderId: null, createdAt: new Date(), ...over,
});

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/topics", topicsRouter);
  return app;
}

let app: express.Express;

/** Authenticated request (single test user; roles flipped via getUserRoles). */
const asUser = (req: request.Test) => req.set("x-test-user", "u1");
/** Downgrade the actor to a plain author to reach object-level 403 branches. */
const asAuthor = () => storageMock.getUserRoles.mockResolvedValue(["author"]);

beforeEach(() => {
  // resetAllMocks (not clearAllMocks) so a `mockRejectedValue` set by a 500-path
  // test does not leak its implementation into the next test's success path.
  vi.resetAllMocks();
  storageMock.getUser.mockResolvedValue(user);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]); // admin by default
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getSharedTopicIds.mockResolvedValue([]);
  storageMock.getTopicIdsByOwner.mockResolvedValue([]);
  storageMock.getTestsUsingTopic.mockResolvedValue([]);
  assessMock.mockResolvedValue(NO_CONFLICT);
  app = makeApp();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /  (list)
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/topics — list branches", () => {
  it("author sees only topics in their visible scope (scope.all=false filter)", async () => {
    asAuthor();
    storageMock.getSharedTopicIds.mockResolvedValue(["s1"]);
    storageMock.getTopicIdsByOwner.mockResolvedValue([]);
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
    storageMock.getTopics.mockResolvedValue([topic("s1"), topic("hidden")]);
    const res = await asUser(request(app).get("/api/topics"));
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => t.id)).toEqual(["s1"]);
  });

  it("500 when the store throws", async () => {
    storageMock.getTopics.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).get("/api/topics"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get topics");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /name-check
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/topics/name-check", () => {
  it("blank name returns the empty shape without querying", async () => {
    const res = await asUser(request(app).get("/api/topics/name-check?name=%20%20"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ normalized: "", sameOwner: null, duplicates: [] });
  });

  it("reports the same-owner clash and cross-owner duplicates (with excludeId)", async () => {
    storageMock.getTopics.mockResolvedValue([topic("t2", { name: "JS", ownerId: "u1" })]);
    const res = await asUser(
      request(app).get("/api/topics/name-check?name=JS&excludeId=t9"),
    );
    expect(res.status).toBe(200);
    expect(res.body.sameOwner).toEqual({ id: "t2", name: "JS" });
    expect(res.body.duplicates.map((d: any) => d.id)).toContain("t2");
    expect(res.body.normalized).toBe("js");
  });

  it("500 when the store throws", async () => {
    storageMock.getTopics.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).get("/api/topics/name-check?name=JS"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to check topic name");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /duplicates-report
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/topics/duplicates-report", () => {
  it("403 for a non-admin author", async () => {
    asAuthor();
    const res = await asUser(request(app).get("/api/topics/duplicates-report"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("admin gets same-name groups", async () => {
    storageMock.getTopics.mockResolvedValue([
      topic("a", { name: "X", ownerId: "u1" }),
      topic("b", { name: "X", ownerId: "u2" }),
    ]);
    const res = await asUser(request(app).get("/api/topics/duplicates-report"));
    expect(res.status).toBe(200);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].topics).toHaveLength(2);
  });

  it("500 when the store throws", async () => {
    storageMock.getTopics.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).get("/api/topics/duplicates-report"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to build duplicates report");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /  (create)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics — create branches", () => {
  it("400 invalid_topic_code on a malformed code", async () => {
    const res = await asUser(
      request(app).post("/api/topics").send({ name: "JS", code: "1bad" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_topic_code");
    expect(storageMock.createTopic).not.toHaveBeenCalled();
  });

  it("409 duplicate_topic_name when the owner already has that name", async () => {
    storageMock.getTopics.mockResolvedValue([topic("ex", { name: "JavaScript", ownerId: "u1" })]);
    const res = await asUser(
      request(app).post("/api/topics").send({ name: "JavaScript" }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_topic_name");
    expect(res.body.topicId).toBe("ex");
    expect(storageMock.createTopic).not.toHaveBeenCalled();
  });

  it("201 with a cross-owner duplicate_name warning", async () => {
    // No same-owner clash, but another owner's visible topic shares the name.
    storageMock.getTopics.mockResolvedValue([topic("other1", { name: "JavaScript", ownerId: "other", visibility: "shared" })]);
    storageMock.createTopic.mockResolvedValue(topic("new1", { name: "JavaScript" }));
    const res = await asUser(
      request(app).post("/api/topics").send({ name: "JavaScript" }),
    );
    expect(res.status).toBe(201);
    expect(res.body.warnings).toEqual([
      expect.objectContaining({ kind: "duplicate_name" }),
    ]);
  });

  it("500 when createTopic throws", async () => {
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.createTopic.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics").send({ name: "JS" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to create topic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:id  (update)
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/topics/:id — update branches", () => {
  it("403 content_forbidden for an author who is not the owner", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).put("/api/topics/t1").send({ name: "New" }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
    expect(storageMock.updateTopic).not.toHaveBeenCalled();
  });

  it("400 invalid_topic_code on a malformed code", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    const res = await asUser(
      request(app).put("/api/topics/t1").send({ name: "New", code: "1bad" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_topic_code");
  });

  it("409 duplicate_topic_name when renaming into an existing same-owner name", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1", { name: "Old", ownerId: "u1" }));
    storageMock.getTopics.mockResolvedValue([topic("t2", { name: "New", ownerId: "u1" })]);
    const res = await asUser(request(app).put("/api/topics/t1").send({ name: "New" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("duplicate_topic_name");
    expect(res.body.topicId).toBe("t2");
    expect(storageMock.updateTopic).not.toHaveBeenCalled();
  });

  it("200 with a cross-owner duplicate_name warning after rename", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1", { name: "Old", ownerId: "u1" }));
    storageMock.getTopics.mockResolvedValue([topic("o1", { name: "New", ownerId: "other", visibility: "shared" })]);
    storageMock.updateTopic.mockResolvedValue(topic("t1", { name: "New" }));
    const res = await asUser(request(app).put("/api/topics/t1").send({ name: "New" }));
    expect(res.status).toBe(200);
    expect(res.body.warnings).toEqual([expect.objectContaining({ kind: "duplicate_name" })]);
    expect(storageMock.renameTopicInFormulas).toHaveBeenCalledWith("t1", "Old", "New");
  });

  it("500 when updateTopic throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.updateTopic.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).put("/api/topics/t1").send({ description: "x" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update topic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/topics/:id — delete branches", () => {
  it("404 when the topic does not exist", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).delete("/api/topics/x"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Topic not found");
    expect(storageMock.deleteTopic).not.toHaveBeenCalled();
  });

  it("403 content_forbidden for an author who is not the owner", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).delete("/api/topics/t1"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
    expect(storageMock.deleteTopic).not.toHaveBeenCalled();
  });

  it("dry-run previews without deleting", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    const res = await asUser(request(app).delete("/api/topics/t1?dryRun=true"));
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(res.body.wouldBlock).toBe(false);
    expect(storageMock.deleteTopic).not.toHaveBeenCalled();
  });

  it("409 content_in_use when a published test depends on the topic", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    assessMock.mockResolvedValue(BLOCKED);
    const res = await asUser(request(app).delete("/api/topics/t1"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("content_in_use");
    expect(storageMock.deleteTopic).not.toHaveBeenCalled();
  });

  it("admin ?force=true overrides the block and deletes", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    assessMock.mockResolvedValue(BLOCKED);
    storageMock.deleteTopic.mockResolvedValue({ deleted: true, questionIds: [], contentPageIds: [] });
    const res = await asUser(request(app).delete("/api/topics/t1?force=true"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.deleteTopic).toHaveBeenCalledWith("t1");
  });

  it("500 when deleteTopic throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.deleteTopic.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).delete("/api/topics/t1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete topic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-delete
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics/bulk-delete — partition edges", () => {
  it("lists forbidden topics the actor may not delete, deletes none", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    storageMock.deleteTopicsBulk.mockResolvedValue({ count: 0, questionIds: [], contentPageIds: [] });
    const res = await asUser(request(app).post("/api/topics/bulk-delete").send({ ids: ["t1"] }));
    expect(res.status).toBe(200);
    expect(storageMock.deleteTopicsBulk).toHaveBeenCalledWith([]);
    expect(res.body.skipped).toEqual([expect.objectContaining({ topicId: "t1", reason: "forbidden" })]);
  });

  it("silently skips ids with no matching topic", async () => {
    storageMock.getTopic.mockImplementation(async (id: string) => (id === "t1" ? topic("t1") : undefined));
    storageMock.deleteTopicsBulk.mockResolvedValue({ count: 1, questionIds: [], contentPageIds: [] });
    const res = await asUser(request(app).post("/api/topics/bulk-delete").send({ ids: ["t1", "miss"] }));
    expect(res.status).toBe(200);
    expect(storageMock.deleteTopicsBulk).toHaveBeenCalledWith(["t1"]);
  });

  it("500 when deleteTopicsBulk throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.deleteTopicsBulk.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics/bulk-delete").send({ ids: ["t1"] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete topics");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-move
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics/bulk-move — edges", () => {
  it("skips a topic the author cannot manage", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    storageMock.moveTopicsToFolder.mockResolvedValue(0);
    const res = await asUser(request(app).post("/api/topics/bulk-move").send({ ids: ["t1"], folderId: null }));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual([expect.objectContaining({ topicId: "t1", reason: "forbidden" })]);
    expect(storageMock.moveTopicsToFolder).toHaveBeenCalledWith([], null);
  });

  it("skips ids with no matching topic", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    storageMock.moveTopicsToFolder.mockResolvedValue(0);
    const res = await asUser(request(app).post("/api/topics/bulk-move").send({ ids: ["miss"], folderId: null }));
    expect(res.status).toBe(200);
    expect(res.body.movedIds).toEqual([]);
  });

  it("500 when moveTopicsToFolder throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.moveTopicsToFolder.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics/bulk-move").send({ ids: ["t1"], folderId: null }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to move topics");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-visibility
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics/bulk-visibility — edges", () => {
  it("400 when ids missing", async () => {
    const res = await asUser(request(app).post("/api/topics/bulk-visibility").send({ visibility: "shared" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("IDs array required");
  });

  it("skips a topic the author cannot grant on", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).post("/api/topics/bulk-visibility").send({ ids: ["t1"], visibility: "shared" }));
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(0);
    expect(res.body.skipped).toEqual([expect.objectContaining({ topicId: "t1", reason: "forbidden" })]);
    expect(storageMock.setTopicVisibility).not.toHaveBeenCalled();
  });

  it("skips ids with no matching topic", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).post("/api/topics/bulk-visibility").send({ ids: ["miss"], visibility: "private" }));
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(0);
  });

  it("500 when setTopicVisibility throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.setTopicVisibility.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics/bulk-visibility").send({ ids: ["t1"], visibility: "shared" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to set visibility");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-owner  (admin-gated by middleware; canChangeTopicOwner 403 is
// unreachable — the capability is admin/super-only, so this covers the handler
// validation + edge branches only)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics/bulk-owner — validation & edges", () => {
  it("400 when ids missing", async () => {
    const res = await asUser(request(app).post("/api/topics/bulk-owner").send({ ownerId: null }));
    expect(res.status).toBe(400);
  });

  it("400 when ownerId is neither string nor null", async () => {
    const res = await asUser(request(app).post("/api/topics/bulk-owner").send({ ids: ["t1"], ownerId: 5 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ownerId must be a string or null");
  });

  it("skips ids with no matching topic", async () => {
    storageMock.getUser.mockResolvedValue(user);
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).post("/api/topics/bulk-owner").send({ ids: ["miss"], ownerId: "u1" }));
    expect(res.status).toBe(200);
    expect(res.body.updatedCount).toBe(0);
    expect(storageMock.setTopicOwner).not.toHaveBeenCalled();
  });

  it("500 when setTopicOwner throws", async () => {
    storageMock.getUser.mockResolvedValue(user);
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.setTopicOwner.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics/bulk-owner").send({ ids: ["t1"], ownerId: "u1" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to set owner");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-grant
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics/bulk-grant — validation & edges", () => {
  it("400 when ids missing", async () => {
    const res = await asUser(request(app).post("/api/topics/bulk-grant").send({ granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(400);
  });

  it("400 when granteeId missing", async () => {
    const res = await asUser(request(app).post("/api/topics/bulk-grant").send({ ids: ["t1"], accessLevel: "use" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("granteeId required");
  });

  it("skips a topic the author cannot grant on", async () => {
    asAuthor();
    storageMock.getUser.mockResolvedValue(user);
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).post("/api/topics/bulk-grant").send({ ids: ["t1"], granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(200);
    expect(res.body.grantedCount).toBe(0);
    expect(res.body.skipped).toEqual([expect.objectContaining({ topicId: "t1", reason: "forbidden" })]);
  });

  it("skips ids with no matching topic", async () => {
    storageMock.getUser.mockResolvedValue(user);
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).post("/api/topics/bulk-grant").send({ ids: ["miss"], granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(200);
    expect(res.body.grantedCount).toBe(0);
  });

  it("500 when upsertTopicGrant throws", async () => {
    storageMock.getUser.mockResolvedValue(user);
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.upsertTopicGrant.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics/bulk-grant").send({ ids: ["t1"], granteeId: "u2", accessLevel: "manage" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to grant access");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-revoke
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics/bulk-revoke — validation & edges", () => {
  it("400 when ids missing", async () => {
    const res = await asUser(request(app).post("/api/topics/bulk-revoke").send({ granteeId: "u2" }));
    expect(res.status).toBe(400);
  });

  it("400 when granteeId missing", async () => {
    const res = await asUser(request(app).post("/api/topics/bulk-revoke").send({ ids: ["t1"] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("granteeId required");
  });

  it("soft: skips a topic the author cannot grant on", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).post("/api/topics/bulk-revoke").send({ ids: ["t1"], granteeId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("soft");
    expect(res.body.skipped).toEqual([expect.objectContaining({ topicId: "t1", reason: "forbidden" })]);
  });

  it("soft: skips ids with no matching topic", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).post("/api/topics/bulk-revoke").send({ ids: ["miss"], granteeId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.revokedCount).toBe(0);
  });

  it("hard: skips ids with no matching topic", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).post("/api/topics/bulk-revoke?mode=hard").send({ ids: ["miss"], granteeId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("hard");
    expect(res.body.revokedCount).toBe(0);
  });

  it("hard: skips a topic where the grantee has no grant", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getTopicGrantForGrantee.mockResolvedValue(undefined);
    const res = await asUser(request(app).post("/api/topics/bulk-revoke?mode=hard").send({ ids: ["t1"], granteeId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.skipped).toEqual([expect.objectContaining({ topicId: "t1", reason: "no_grant" })]);
  });

  it("hard ?force=true removes even blocked grants", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getTopicGrantForGrantee.mockResolvedValue({ id: "g1" });
    storageMock.getTestsUsingTopic.mockResolvedValue([{ id: "T", title: "Exam", ownerId: "u2", status: "published" }]);
    const res = await asUser(request(app).post("/api/topics/bulk-revoke?mode=hard&force=true").send({ ids: ["t1"], granteeId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.revokedCount).toBe(1);
    expect(storageMock.removeTopicGrant).toHaveBeenCalledWith("g1");
  });

  it("500 when a store call throws", async () => {
    storageMock.getTopic.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics/bulk-revoke").send({ ids: ["t1"], granteeId: "u2" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to revoke access");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/duplicate
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics/:id/duplicate", () => {
  it("404 when the source topic is missing", async () => {
    storageMock.duplicateTopicWithQuestions.mockResolvedValue(undefined);
    const res = await asUser(request(app).post("/api/topics/x/duplicate"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Topic not found");
  });

  it("201 with the duplicated topic", async () => {
    storageMock.duplicateTopicWithQuestions.mockResolvedValue(topic("copy1"));
    const res = await asUser(request(app).post("/api/topics/t1/duplicate"));
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("copy1");
  });

  it("500 when duplication throws", async () => {
    storageMock.duplicateTopicWithQuestions.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics/t1/duplicate"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to duplicate topic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id/access
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/topics/:id/access", () => {
  it("404 when the topic is missing", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).get("/api/topics/x/access"));
    expect(res.status).toBe(404);
  });

  it("403 for an author who is not the owner", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).get("/api/topics/t1/access"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("200 with grants and resolved grantee names", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getTopicGrants.mockResolvedValue([{ id: "g1", granteeId: "u2", accessLevel: "use" }]);
    storageMock.getUser.mockImplementation(async (id: string) => (id === "u2" ? { ...user, id: "u2", name: "Grantee" } : user));
    const res = await asUser(request(app).get("/api/topics/t1/access"));
    expect(res.status).toBe(200);
    expect(res.body.grants[0].granteeName).toBe("Grantee");
  });

  it("500 when getTopicGrants throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getTopicGrants.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).get("/api/topics/t1/access"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get topic access");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/access
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/topics/:id/access", () => {
  it("404 when the topic is missing", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).post("/api/topics/x/access").send({ granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(404);
  });

  it("403 for an author who is not the owner", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).post("/api/topics/t1/access").send({ granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(403);
  });

  it("400 when granteeId missing", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    const res = await asUser(request(app).post("/api/topics/t1/access").send({ accessLevel: "use" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("granteeId required");
  });

  it("400 on an invalid access level", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    const res = await asUser(request(app).post("/api/topics/t1/access").send({ granteeId: "u2", accessLevel: "admin" }));
    expect(res.status).toBe(400);
  });

  it("404 when the grantee does not exist", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getUser.mockImplementation(async (id: string) => (id === "u2" ? undefined : user));
    const res = await asUser(request(app).post("/api/topics/t1/access").send({ granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Grantee not found");
  });

  it("201 on a successful grant", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getUser.mockResolvedValue(user);
    storageMock.upsertTopicGrant.mockResolvedValue({ id: "g1", topicId: "t1", granteeId: "u2", accessLevel: "use" });
    const res = await asUser(request(app).post("/api/topics/t1/access").send({ granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("g1");
  });

  it("500 when upsertTopicGrant throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getUser.mockResolvedValue(user);
    storageMock.upsertTopicGrant.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).post("/api/topics/t1/access").send({ granteeId: "u2", accessLevel: "use" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to grant topic access");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id/access/:grantId
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/topics/:id/access/:grantId", () => {
  it("404 when the topic is missing", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).delete("/api/topics/x/access/g1"));
    expect(res.status).toBe(404);
  });

  it("403 for an author who is not the owner", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).delete("/api/topics/t1/access/g1"));
    expect(res.status).toBe(403);
  });

  it("404 when the grant does not exist", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getTopicGrants.mockResolvedValue([]);
    const res = await asUser(request(app).delete("/api/topics/t1/access/g1"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Grant not found");
  });

  it("soft revoke flips the grant state", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getTopicGrants.mockResolvedValue([{ id: "g1", topicId: "t1", granteeId: "u2" }]);
    const res = await asUser(request(app).delete("/api/topics/t1/access/g1"));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("soft");
    expect(storageMock.setTopicGrantState).toHaveBeenCalledWith("g1", "revoked_in_use");
  });

  it("hard revoke is administrator-only (owner author gets 403)", async () => {
    asAuthor(); // author owns the topic -> passes canGrantTopicAccess, fails admin gate
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "u1" }));
    storageMock.getTopicGrants.mockResolvedValue([{ id: "g1", topicId: "t1", granteeId: "u2" }]);
    const res = await asUser(request(app).delete("/api/topics/t1/access/g1?mode=hard"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("hard_revoke_admin_only");
  });

  it("hard revoke blocked by a published dependent (409 grant_in_use)", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getTopicGrants.mockResolvedValue([{ id: "g1", topicId: "t1", granteeId: "u2" }]);
    storageMock.getTestsUsingTopic.mockResolvedValue([{ id: "T", title: "Exam", ownerId: "u2", status: "published" }]);
    const res = await asUser(request(app).delete("/api/topics/t1/access/g1?mode=hard"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("grant_in_use");
    expect(storageMock.removeTopicGrant).not.toHaveBeenCalled();
  });

  it("hard revoke removes the grant when nothing blocks", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getTopicGrants.mockResolvedValue([{ id: "g1", topicId: "t1", granteeId: "u2" }]);
    storageMock.getTestsUsingTopic.mockResolvedValue([]);
    const res = await asUser(request(app).delete("/api/topics/t1/access/g1?mode=hard"));
    expect(res.status).toBe(200);
    expect(res.body.mode).toBe("hard");
    expect(res.body.removed).toBe(true);
    expect(storageMock.removeTopicGrant).toHaveBeenCalledWith("g1");
  });

  it("500 when a store call throws", async () => {
    storageMock.getTopic.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).delete("/api/topics/t1/access/g1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to revoke topic access");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id/visibility
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/topics/:id/visibility", () => {
  it("404 when the topic is missing", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).patch("/api/topics/x/visibility").send({ visibility: "shared" }));
    expect(res.status).toBe(404);
  });

  it("403 for an author who is not the owner", async () => {
    asAuthor();
    storageMock.getTopic.mockResolvedValue(topic("t1", { ownerId: "other" }));
    const res = await asUser(request(app).patch("/api/topics/t1/visibility").send({ visibility: "shared" }));
    expect(res.status).toBe(403);
  });

  it("400 on an invalid visibility value", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    const res = await asUser(request(app).patch("/api/topics/t1/visibility").send({ visibility: "public" }));
    expect(res.status).toBe(400);
  });

  it("200 sets the visibility", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    const res = await asUser(request(app).patch("/api/topics/t1/visibility").send({ visibility: "shared" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ topicId: "t1", visibility: "shared" });
    expect(storageMock.setTopicVisibility).toHaveBeenCalledWith("t1", "shared");
  });

  it("500 when setTopicVisibility throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.setTopicVisibility.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).patch("/api/topics/t1/visibility").send({ visibility: "private" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to set topic visibility");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id/owner  (admin-gated; canChangeTopicOwner 403 unreachable)
// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/topics/:id/owner", () => {
  it("404 when the topic is missing", async () => {
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asUser(request(app).patch("/api/topics/x/owner").send({ ownerId: "u2" }));
    expect(res.status).toBe(404);
  });

  it("400 when ownerId is neither string nor null", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    const res = await asUser(request(app).patch("/api/topics/t1/owner").send({ ownerId: 5 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ownerId must be a string or null");
  });

  it("404 when the new owner does not exist", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getUser.mockImplementation(async (id: string) => (id === "u9" ? undefined : user));
    const res = await asUser(request(app).patch("/api/topics/t1/owner").send({ ownerId: "u9" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("200 reassigns the owner", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getUser.mockResolvedValue(user);
    const res = await asUser(request(app).patch("/api/topics/t1/owner").send({ ownerId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ topicId: "t1", ownerId: "u2" });
    expect(storageMock.setTopicOwner).toHaveBeenCalledWith("t1", "u2");
  });

  it("500 when setTopicOwner throws", async () => {
    storageMock.getTopic.mockResolvedValue(topic("t1"));
    storageMock.getUser.mockResolvedValue(user);
    storageMock.setTopicOwner.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).patch("/api/topics/t1/owner").send({ ownerId: null }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to set topic owner");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:topicId/difficulty-distribution — warning branches
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/topics/:topicId/difficulty-distribution — warnings", () => {
  it("empty topic warns about no questions and empty levels", async () => {
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
    const res = await asUser(request(app).get("/api/topics/t1/difficulty-distribution"));
    expect(res.status).toBe(200);
    expect(res.body.totalQuestions).toBe(0);
    expect(res.body.warnings).toContain("В теме нет вопросов");
    expect(res.body.warnings.some((w: string) => w.startsWith("Нет вопросов для уровней"))).toBe(true);
  });

  it("few questions concentrated in one level warns on count and empty levels", async () => {
    storageMock.getQuestionsByTopic.mockResolvedValue([
      { difficulty: 20 }, { difficulty: 25 }, { difficulty: 10 },
    ]);
    const res = await asUser(request(app).get("/api/topics/t1/difficulty-distribution"));
    expect(res.status).toBe(200);
    expect(res.body.warnings.some((w: string) => w.includes("Мало вопросов"))).toBe(true);
    expect(res.body.warnings.some((w: string) => w.includes("Средний"))).toBe(true);
  });

  it("500 when the store throws", async () => {
    storageMock.getQuestionsByTopic.mockRejectedValue(new Error("db down"));
    const res = await asUser(request(app).get("/api/topics/t1/difficulty-distribution"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get difficulty distribution");
  });
});
