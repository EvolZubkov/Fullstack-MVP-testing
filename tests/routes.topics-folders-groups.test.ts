/**
 * Tests for /api/topics, /api/folders, /api/groups routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    // topics
    getTopics: vi.fn(), getTopic: vi.fn(), createTopic: vi.fn(),
    updateTopic: vi.fn(), deleteTopic: vi.fn(), deleteTopicsBulk: vi.fn(),
    getTopicCourses: vi.fn(), createTopicCourse: vi.fn(), deleteTopicCourse: vi.fn(),
    getTopicEvents: vi.fn(), createTopicEvent: vi.fn(), deleteTopicEvent: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    // referential protection (PRD-15 FR-03..FR-05)
    getTestsUsingTopic: vi.fn(), getTestSectionsByTopic: vi.fn(),
    getMeasurementsForQuestions: vi.fn(), getTopicPageRefs: vi.fn(),
    getTest: vi.fn(), getAdaptiveLevels: vi.fn(),
    // folders
    getFolders: vi.fn(), getFolder: vi.fn(), createFolder: vi.fn(),
    updateFolder: vi.fn(), deleteFolder: vi.fn(),
    // groups
    getGroups: vi.fn(), getGroup: vi.fn(), createGroup: vi.fn(),
    updateGroup: vi.fn(), deleteGroup: vi.fn(),
    getGroupUsers: vi.fn(), addUserToGroup: vi.fn(), removeUserFromGroup: vi.fn(),
    // auth middleware needs getUser; requirePermission also reads user roles
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
  }
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import topicsRouter from "../server/routes/topics";
import foldersRouter from "../server/routes/folders";
import groupsRouter from "../server/routes/groups";

// ─── App factory ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author",
  role: "author", status: "active", mustChangePassword: false,
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

// Shorthand: authenticated author request
function asAuthor(req: request.Test) {
  return req.set("x-test-user", "author1");
}

// ─────────────────────────────────────────────────────────────────────────────
// TOPICS
// ─────────────────────────────────────────────────────────────────────────────
describe("Topics routes", () => {
  let app: express.Express;
  const topic = { id: "t1", name: "JavaScript", description: "JS basics", folderId: null, createdAt: new Date() };
  const course = { id: "c1", topicId: "t1", title: "Course 1", url: "https://example.com", createdAt: new Date() };
  const event = { id: "e1", topicId: "t1", title: "Мастер-класс по JS" };
  const question = { id: "q1", topicId: "t1", type: "single", difficulty: 50 };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopicEvents.mockResolvedValue([]);
    // PRD-15 FR-05 defaults: the topic exists and has no dependent tests, so
    // the referential protection lets destructive operations through.
    storageMock.getTopic.mockResolvedValue(topic);
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
    storageMock.getTestsUsingTopic.mockResolvedValue([]);
    storageMock.getTestSectionsByTopic.mockResolvedValue([]);
    storageMock.getMeasurementsForQuestions.mockResolvedValue([]);
    storageMock.getTopicPageRefs.mockResolvedValue([]);
    app = makeApp(topicsRouter, "/api/topics");
  });

  it("GET / — returns topics with courses, events and questionCount", async () => {
    storageMock.getTopics.mockResolvedValue([topic]);
    storageMock.getTopicCourses.mockResolvedValue([course]);
    storageMock.getTopicEvents.mockResolvedValue([event]);
    storageMock.getQuestionsByTopic.mockResolvedValue([question, question]);
    const res = await asAuthor(request(app).get("/api/topics"));
    expect(res.status).toBe(200);
    expect(res.body[0].questionCount).toBe(2);
    expect(res.body[0].courses).toHaveLength(1);
    expect(res.body[0].events).toHaveLength(1);
    expect(res.body[0].events[0].title).toBe("Мастер-класс по JS");
  });

  it("GET / — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/topics");
    expect(res.status).toBe(401);
  });

  it("POST / — creates topic", async () => {
    storageMock.createTopic.mockResolvedValue(topic);
    const res = await asAuthor(request(app).post("/api/topics").send({ name: "JavaScript", description: "JS basics" }));
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("JavaScript");
  });

  it("POST / — returns 400 when name missing", async () => {
    const res = await asAuthor(request(app).post("/api/topics").send({ description: "no name" }));
    expect(res.status).toBe(400);
  });

  it("PUT /:id — updates topic", async () => {
    storageMock.updateTopic.mockResolvedValue({ ...topic, name: "TypeScript" });
    const res = await asAuthor(request(app).put("/api/topics/t1").send({ name: "TypeScript" }));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("TypeScript");
  });

  it("PUT /:id — returns 404 when topic not found", async () => {
    storageMock.updateTopic.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/topics/x").send({ name: "X" }));
    expect(res.status).toBe(404);
  });

  it("DELETE /:id — deletes topic", async () => {
    storageMock.deleteTopic.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/topics/t1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /:id — returns 404 when topic not found", async () => {
    storageMock.deleteTopic.mockResolvedValue(false);
    const res = await asAuthor(request(app).delete("/api/topics/x"));
    expect(res.status).toBe(404);
  });

  it("POST /bulk-delete — deletes multiple topics", async () => {
    storageMock.deleteTopicsBulk.mockResolvedValue(2);
    const res = await asAuthor(request(app).post("/api/topics/bulk-delete").send({ ids: ["t1", "t2"] }));
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(2);
  });

  it("POST /bulk-delete — returns 400 when ids missing", async () => {
    const res = await asAuthor(request(app).post("/api/topics/bulk-delete").send({ ids: [] }));
    expect(res.status).toBe(400);
  });

  it("POST /:topicId/courses — creates course", async () => {
    storageMock.createTopicCourse.mockResolvedValue(course);
    const res = await asAuthor(request(app).post("/api/topics/t1/courses")
      .send({ title: "Course 1", url: "https://example.com" }));
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Course 1");
  });

  it("POST /:topicId/courses — returns 400 when url missing", async () => {
    const res = await asAuthor(request(app).post("/api/topics/t1/courses").send({ title: "Course 1" }));
    expect(res.status).toBe(400);
  });

  it("DELETE /courses/:id — deletes course", async () => {
    storageMock.deleteTopicCourse.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/topics/courses/c1"));
    expect(res.status).toBe(200);
  });

  it("DELETE /courses/:id — returns 404 when course not found", async () => {
    storageMock.deleteTopicCourse.mockResolvedValue(false);
    const res = await asAuthor(request(app).delete("/api/topics/courses/x"));
    expect(res.status).toBe(404);
  });

  // ── Events ──────────────────────────────────────────────────────────────────

  it("POST /:topicId/events — creates event with title only", async () => {
    storageMock.createTopicEvent.mockResolvedValue(event);
    const res = await asAuthor(request(app).post("/api/topics/t1/events")
      .send({ title: "Мастер-класс по JS" }));
    expect(res.status).toBe(201);
    expect(res.body.title).toBe("Мастер-класс по JS");
    expect(storageMock.createTopicEvent).toHaveBeenCalledWith({
      topicId: "t1",
      title: "Мастер-класс по JS",
    });
  });

  it("POST /:topicId/events — returns 400 when title missing", async () => {
    const res = await asAuthor(request(app).post("/api/topics/t1/events").send({}));
    expect(res.status).toBe(400);
  });

  it("POST /:topicId/events — returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/topics/t1/events").send({ title: "Test" });
    expect(res.status).toBe(401);
  });

  it("DELETE /events/:id — deletes event", async () => {
    storageMock.deleteTopicEvent.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/topics/events/e1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.deleteTopicEvent).toHaveBeenCalledWith("e1");
  });

  it("DELETE /events/:id — returns 404 when event not found", async () => {
    storageMock.deleteTopicEvent.mockResolvedValue(false);
    const res = await asAuthor(request(app).delete("/api/topics/events/x"));
    expect(res.status).toBe(404);
  });

  it("DELETE /events/:id — does NOT call deleteTopic", async () => {
    storageMock.deleteTopicEvent.mockResolvedValue(true);
    await asAuthor(request(app).delete("/api/topics/events/e1"));
    expect(storageMock.deleteTopic).not.toHaveBeenCalled();
  });

  it("GET /:topicId/difficulty-distribution — returns distribution", async () => {
    storageMock.getQuestionsByTopic.mockResolvedValue([
      { difficulty: 20 }, // easy (≤33)
      { difficulty: 50 }, // medium (34–66)
      { difficulty: 80 }, // hard (>66)
      { difficulty: null }, // defaults to 50 → medium
    ]);
    const res = await asAuthor(request(app).get("/api/topics/t1/difficulty-distribution"));
    expect(res.status).toBe(200);
    expect(res.body.totalQuestions).toBe(4);
    expect(res.body.histogram).toHaveLength(10);
    const easy = res.body.suggestedLevels.find((l: any) => l.levelName === "Лёгкий");
    const medium = res.body.suggestedLevels.find((l: any) => l.levelName === "Средний");
    const hard = res.body.suggestedLevels.find((l: any) => l.levelName === "Сложный");
    expect(easy.questionCount).toBe(1);
    expect(medium.questionCount).toBe(2);
    expect(hard.questionCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FOLDERS
// ─────────────────────────────────────────────────────────────────────────────
describe("Folders routes", () => {
  let app: express.Express;
  const folder = { id: "f1", name: "Folder 1", parentId: null };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp(foldersRouter, "/api/folders");
  });

  it("GET / — returns folders list", async () => {
    storageMock.getFolders.mockResolvedValue([folder]);
    const res = await asAuthor(request(app).get("/api/folders"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe("Folder 1");
  });

  it("GET / — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/folders");
    expect(res.status).toBe(401);
  });

  it("POST / — creates folder", async () => {
    storageMock.createFolder.mockResolvedValue(folder);
    const res = await asAuthor(request(app).post("/api/folders").send({ name: "Folder 1" }));
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Folder 1");
  });

  it("POST / — returns 400 when name missing", async () => {
    const res = await asAuthor(request(app).post("/api/folders").send({}));
    expect(res.status).toBe(400);
  });

  it("PUT /:id — updates folder", async () => {
    storageMock.updateFolder.mockResolvedValue({ ...folder, name: "Renamed" });
    const res = await asAuthor(request(app).put("/api/folders/f1").send({ name: "Renamed" }));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Renamed");
  });

  it("PUT /:id — returns 404 when not found", async () => {
    storageMock.updateFolder.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/folders/x").send({ name: "X" }));
    expect(res.status).toBe(404);
  });

  it("DELETE /:id — deletes folder", async () => {
    storageMock.deleteFolder.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/folders/f1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /:id — returns 404 when not found", async () => {
    storageMock.deleteFolder.mockResolvedValue(false);
    const res = await asAuthor(request(app).delete("/api/folders/x"));
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GROUPS
// ─────────────────────────────────────────────────────────────────────────────
describe("Groups routes", () => {
  let app: express.Express;
  const group = { id: "g1", name: "Group A", description: null, createdAt: new Date(), createdBy: null };
  const groupUser = { id: "u2", email: "user@test.com", name: "User", role: "learner", status: "active" };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp(groupsRouter, "/api/groups");
  });

  it("GET / — returns groups with users", async () => {
    storageMock.getGroups.mockResolvedValue([group]);
    storageMock.getGroupUsers.mockResolvedValue([groupUser]);
    const res = await asAuthor(request(app).get("/api/groups"));
    expect(res.status).toBe(200);
    expect(res.body[0].userCount).toBe(1);
    expect(res.body[0].users[0].email).toBe("user@test.com");
  });

  it("GET /:id — returns group by id with users", async () => {
    storageMock.getGroup.mockResolvedValue(group);
    storageMock.getGroupUsers.mockResolvedValue([groupUser]);
    const res = await asAuthor(request(app).get("/api/groups/g1"));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("g1");
    expect(res.body.users).toHaveLength(1);
  });

  it("GET /:id — returns 404 when group not found", async () => {
    storageMock.getGroup.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/groups/x"));
    expect(res.status).toBe(404);
  });

  it("POST / — creates group", async () => {
    storageMock.createGroup.mockResolvedValue(group);
    const res = await asAuthor(request(app).post("/api/groups").send({ name: "Group A" }));
    expect(res.status).toBe(201);
    expect(res.body.name).toBe("Group A");
    expect(res.body.users).toEqual([]);
  });

  it("POST / — returns 400 when name missing", async () => {
    const res = await asAuthor(request(app).post("/api/groups").send({}));
    expect(res.status).toBe(400);
  });

  it("PUT /:id — updates group", async () => {
    storageMock.updateGroup.mockResolvedValue({ ...group, name: "Group B" });
    const res = await asAuthor(request(app).put("/api/groups/g1").send({ name: "Group B" }));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe("Group B");
  });

  it("PUT /:id — returns 404 when not found", async () => {
    storageMock.updateGroup.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/groups/x").send({ name: "X" }));
    expect(res.status).toBe(404);
  });

  it("DELETE /:id — deletes group", async () => {
    storageMock.deleteGroup.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/groups/g1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /:id — returns 404 when not found", async () => {
    storageMock.deleteGroup.mockResolvedValue(false);
    const res = await asAuthor(request(app).delete("/api/groups/x"));
    expect(res.status).toBe(404);
  });

  it("POST /:id/users — adds users to group (userIds array)", async () => {
    storageMock.getGroup.mockResolvedValue(group);
    storageMock.getGroupUsers.mockResolvedValueOnce([]).mockResolvedValueOnce([groupUser]);
    storageMock.addUserToGroup.mockResolvedValue({});
    const res = await asAuthor(request(app).post("/api/groups/g1/users")
      .send({ userIds: ["u2"] }));
    expect(res.status).toBe(200);
    expect(storageMock.addUserToGroup).toHaveBeenCalledWith("u2", "g1");
  });

  it("POST /:id/users — adds user to group (single userId)", async () => {
    storageMock.getGroup.mockResolvedValue(group);
    storageMock.getGroupUsers.mockResolvedValueOnce([]).mockResolvedValueOnce([groupUser]);
    storageMock.addUserToGroup.mockResolvedValue({});
    const res = await asAuthor(request(app).post("/api/groups/g1/users")
      .send({ userId: "u2" }));
    expect(res.status).toBe(200);
    expect(storageMock.addUserToGroup).toHaveBeenCalledWith("u2", "g1");
  });

  it("POST /:id/users — skips already-present users", async () => {
    storageMock.getGroup.mockResolvedValue(group);
    storageMock.getGroupUsers.mockResolvedValue([groupUser]); // user already in group
    storageMock.addUserToGroup.mockResolvedValue({});
    const res = await asAuthor(request(app).post("/api/groups/g1/users")
      .send({ userId: "u2" }));
    expect(res.status).toBe(200);
    expect(storageMock.addUserToGroup).not.toHaveBeenCalled();
  });

  it("POST /:id/users — returns 400 when no userId(s) provided", async () => {
    storageMock.getGroup.mockResolvedValue(group);
    const res = await asAuthor(request(app).post("/api/groups/g1/users").send({}));
    expect(res.status).toBe(400);
  });

  it("POST /:id/users — returns 404 when group not found", async () => {
    storageMock.getGroup.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/groups/x/users").send({ userId: "u2" }));
    expect(res.status).toBe(404);
  });

  it("DELETE /:id/users/:userId — removes user from group", async () => {
    storageMock.removeUserFromGroup.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/groups/g1/users/u2"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /:id/users/:userId — returns 404 when user not in group", async () => {
    storageMock.removeUserFromGroup.mockResolvedValue(false);
    const res = await asAuthor(request(app).delete("/api/groups/g1/users/x"));
    expect(res.status).toBe(404);
  });
});
