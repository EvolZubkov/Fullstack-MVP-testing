/**
 * Tests for /api/questions, /api/users, assignments routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getQuestions: vi.fn(), getQuestion: vi.fn(), createQuestion: vi.fn(),
    updateQuestion: vi.fn(), deleteQuestion: vi.fn(), deleteQuestionsBulk: vi.fn(),
    getQuestionsByTopic: vi.fn(), getTestSections: vi.fn(), getTest: vi.fn(),
    getTopics: vi.fn(),
    getUsers: vi.fn(), getUser: vi.fn(), getUserByEmail: vi.fn(), createUser: vi.fn(),
    updateUser: vi.fn(), updateUserPassword: vi.fn(), deactivateUser: vi.fn(),
    activateUser: vi.fn(), deleteAttemptsByUserAndTest: vi.fn(),
    getAttemptsByUser: vi.fn(), getTests: vi.fn(),
    getUserGroups: vi.fn(), setUserGroups: vi.fn(),
    getTestAssignments: vi.fn(), createTestAssignment: vi.fn(),
    deleteTestAssignment: vi.fn(), getAssignedTestsForUser: vi.fn(),
    getGroup: vi.fn(), getGroupUsers: vi.fn(),
    createAssignmentAccessToken: vi.fn(),
    getAssignmentAccessTokensByAssignment: vi.fn(),
    revokeAssignmentAccessToken: vi.fn(),
    revokeAssignmentAccessTokensByAssignment: vi.fn(),
    revokeAssignmentAccessTokensByAssignmentAndUser: vi.fn(),
  }
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/middleware/upload", () => ({
  memoryUpload: { single: () => (_req: any, _res: any, next: any) => next() },
  rejectBase64MediaUrl: () => false,
}));

import questionsRouter from "../server/routes/questions";
import usersRouter from "../server/routes/users";
import assignmentsRouter from "../server/routes/assignments";

// ─── App factory ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const learnerUser = { ...authorUser, id: "learner1", role: "learner", email: "l@test.com" };

function makeApp(router: express.Router, path: string) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (uid) req.session.userId = uid;
    next();
  });
  app.use(path, router);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }
function asLearner(req: request.Test) { return req.set("x-test-user", "learner1"); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "What is JS?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  points: 1, difficulty: 50, shuffleAnswers: true,
  feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  mediaUrl: null, mediaType: null, createdAt: new Date(),
};
const dbTopic = { id: "t1", name: "JavaScript", description: null, folderId: null, createdAt: new Date() };
const dbTest = { id: "test1", title: "Test 1", mode: "standard", maxAttempts: null, createdAt: new Date() };
const dbUser = {
  id: "u1", email: "user@test.com", name: "User", role: "learner", status: "active",
  mustChangePassword: false, gdprConsent: true, passwordHash: "x", emailHash: "x",
  createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const dbAssignment = {
  id: "asgn1", testId: "test1", userId: "u1", groupId: null,
  dueDate: null, assignedAt: new Date(), assignedBy: "author1",
};

// ─────────────────────────────────────────────────────────────────────────────
// QUESTIONS ROUTES
// ─────────────────────────────────────────────────────────────────────────────
describe("Questions routes", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp(questionsRouter, "/api/questions");
  });

  it("GET / — returns questions with topic names", async () => {
    storageMock.getQuestions.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    const res = await asAuthor(request(app).get("/api/questions"));
    expect(res.status).toBe(200);
    expect(res.body[0].topicName).toBe("JavaScript");
  });

  it("GET / — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/questions");
    expect(res.status).toBe(401);
  });

  it("GET / — topicName is Unknown for missing topic", async () => {
    storageMock.getQuestions.mockResolvedValue([{ ...dbQuestion, topicId: "missing" }]);
    storageMock.getTopics.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/questions"));
    expect(res.body[0].topicName).toBe("Unknown");
  });

  it("POST / — creates question", async () => {
    storageMock.createQuestion.mockResolvedValue(dbQuestion);
    const res = await asAuthor(request(app).post("/api/questions").send({
      topicId: "t1", type: "single", prompt: "What is JS?",
      dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    }));
    expect(res.status).toBe(201);
    expect(res.body.prompt).toBe("What is JS?");
  });

  it("POST / — returns 400 when required fields missing", async () => {
    const res = await asAuthor(request(app).post("/api/questions").send({ topicId: "t1" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("POST / — returns 403 when learner tries to create", async () => {
    storageMock.getUser.mockResolvedValue(learnerUser);
    const res = await asLearner(request(app).post("/api/questions").send({
      topicId: "t1", type: "single", prompt: "Q?",
    }));
    expect(res.status).toBe(403);
  });

  it("PUT /:id — updates question", async () => {
    storageMock.updateQuestion.mockResolvedValue({ ...dbQuestion, prompt: "Updated?" });
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ prompt: "Updated?" }));
    expect(res.status).toBe(200);
    expect(res.body.prompt).toBe("Updated?");
  });

  it("PUT /:id — returns 404 when not found", async () => {
    storageMock.updateQuestion.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/questions/x").send({ prompt: "X" }));
    expect(res.status).toBe(404);
  });

  it("DELETE /:id — deletes question", async () => {
    storageMock.deleteQuestion.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/questions/q1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /:id — returns 404 when not found", async () => {
    storageMock.deleteQuestion.mockResolvedValue(false);
    const res = await asAuthor(request(app).delete("/api/questions/x"));
    expect(res.status).toBe(404);
  });

  it("POST /bulk-delete — deletes multiple questions", async () => {
    storageMock.deleteQuestionsBulk.mockResolvedValue(3);
    const res = await asAuthor(request(app).post("/api/questions/bulk-delete").send({ ids: ["q1", "q2", "q3"] }));
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(3);
  });

  it("POST /bulk-delete — returns 400 when ids empty", async () => {
    const res = await asAuthor(request(app).post("/api/questions/bulk-delete").send({ ids: [] }));
    expect(res.status).toBe(400);
  });

  it("GET /export — returns xlsx buffer", async () => {
    storageMock.getQuestions.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    const res = await asAuthor(request(app).get("/api/questions/export"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  it("GET /export — filters by topicIds param", async () => {
    storageMock.getQuestions.mockResolvedValue([dbQuestion, { ...dbQuestion, id: "q2", topicId: "t2" }]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    const res = await asAuthor(request(app).get("/api/questions/export?topicIds=t1"));
    expect(res.status).toBe(200);
  });

  it("GET /export — filters by testId param", async () => {
    storageMock.getQuestions.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(request(app).get("/api/questions/export?testId=test1"));
    expect(res.status).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// USERS ROUTES
// ─────────────────────────────────────────────────────────────────────────────
describe("Users routes", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp(usersRouter, "/api/users");
  });

  it("GET / — returns users with groups", async () => {
    storageMock.getUsers.mockResolvedValue([dbUser]);
    storageMock.getUserGroups.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/users"));
    expect(res.status).toBe(200);
    expect(res.body[0].email).toBe("user@test.com");
    expect(res.body[0].groups).toEqual([]);
  });

  it("GET / — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(401);
  });

  it("GET /:id — returns user with groups", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)  // middleware
      .mockResolvedValueOnce(dbUser);     // route handler
    storageMock.getUserGroups.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/users/u1"));
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("u1");
  });

  it("GET /:id — returns 404 when not found", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(undefined);
    const res = await asAuthor(request(app).get("/api/users/ghost"));
    expect(res.status).toBe(404);
  });

  it("POST / — creates user", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.createUser.mockResolvedValue(dbUser);
    storageMock.getUserGroups.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/users")
      .send({ email: "new@test.com", password: "pass123", name: "New User" }));
    expect(res.status).toBe(201);
    expect(storageMock.createUser).toHaveBeenCalled();
  });

  it("POST / — returns 400 when email missing", async () => {
    const res = await asAuthor(request(app).post("/api/users").send({ password: "pass123" }));
    expect(res.status).toBe(400);
  });

  it("POST / — returns 400 when email already exists", async () => {
    storageMock.getUserByEmail.mockResolvedValue(dbUser);
    const res = await asAuthor(request(app).post("/api/users")
      .send({ email: "user@test.com", password: "pass123" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already exists/);
  });

  it("POST / — sets groups when groupIds provided", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.createUser.mockResolvedValue(dbUser);
    storageMock.setUserGroups.mockResolvedValue(undefined);
    storageMock.getUserGroups.mockResolvedValue([]);
    await asAuthor(request(app).post("/api/users")
      .send({ email: "new@test.com", password: "pass123", groupIds: ["g1"] }));
    expect(storageMock.setUserGroups).toHaveBeenCalledWith("u1", ["g1"]);
  });

  it("PUT /:id — updates user", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)   // middleware
      .mockResolvedValueOnce(dbUser);      // existing check
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.updateUser.mockResolvedValue({ ...dbUser, name: "Updated" });
    storageMock.getUserGroups.mockResolvedValue([]);
    const res = await asAuthor(request(app).put("/api/users/u1").send({ name: "Updated" }));
    expect(res.status).toBe(200);
  });

  it("PUT /:id — returns 404 when user not found", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(undefined);
    const res = await asAuthor(request(app).put("/api/users/ghost").send({ name: "X" }));
    expect(res.status).toBe(404);
  });

  it("PUT /:id — returns 400 when email already taken by another user", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getUserByEmail.mockResolvedValue({ ...dbUser, id: "other" });
    const res = await asAuthor(request(app).put("/api/users/u1").send({ email: "taken@test.com" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already in use/);
  });

  it("POST /:id/reset-password — resets password", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.updateUserPassword.mockResolvedValue(undefined);
    storageMock.updateUser.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/users/u1/reset-password")
      .send({ newPassword: "newpass123" }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.updateUserPassword).toHaveBeenCalledWith("u1", "newpass123");
  });

  it("POST /:id/reset-password — returns 400 when password missing", async () => {
    const res = await asAuthor(request(app).post("/api/users/u1/reset-password").send({}));
    expect(res.status).toBe(400);
  });

  it("POST /:id/deactivate — deactivates learner", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.deactivateUser.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/users/u1/deactivate"));
    expect(res.status).toBe(200);
    expect(storageMock.deactivateUser).toHaveBeenCalledWith("u1");
  });

  it("POST /:id/deactivate — returns 400 when trying to deactivate author", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)      // middleware
      .mockResolvedValueOnce({ ...dbUser, role: "author" }); // target user
    const res = await asAuthor(request(app).post("/api/users/u1/deactivate"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/author/);
  });

  it("POST /:id/activate — activates user", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.activateUser.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/users/u1/activate"));
    expect(res.status).toBe(200);
    expect(storageMock.activateUser).toHaveBeenCalledWith("u1");
  });

  it("POST /:id/reset-attempts — resets attempts for specific test", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.deleteAttemptsByUserAndTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/users/u1/reset-attempts")
      .send({ testId: "test1" }));
    expect(res.status).toBe(200);
    expect(storageMock.deleteAttemptsByUserAndTest).toHaveBeenCalledWith("u1", "test1");
  });

  it("POST /:id/reset-attempts — resets all attempts when no testId", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getAttemptsByUser.mockResolvedValue([
      { testId: "test1" }, { testId: "test2" }
    ]);
    storageMock.deleteAttemptsByUserAndTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/users/u1/reset-attempts").send({}));
    expect(res.status).toBe(200);
    expect(storageMock.deleteAttemptsByUserAndTest).toHaveBeenCalledTimes(2);
  });

  it("GET /:id/attempts-summary — returns summary per test", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getAttemptsByUser.mockResolvedValue([
      { testId: "test1", finishedAt: new Date(), resultJson: { percent: 80 } }
    ]);
    storageMock.getTests.mockResolvedValue([dbTest]);
    const res = await asAuthor(request(app).get("/api/users/u1/attempts-summary"));
    expect(res.status).toBe(200);
    expect(res.body[0].testId).toBe("test1");
    expect(res.body[0].bestScore).toBe(80);
  });

  it("GET /:id/attempts-summary — filters out tests with no attempts", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getAttemptsByUser.mockResolvedValue([]);
    storageMock.getTests.mockResolvedValue([dbTest]);
    const res = await asAuthor(request(app).get("/api/users/u1/attempts-summary"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("GET /:id/groups — returns user groups", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getUserGroups.mockResolvedValue([{ id: "g1", name: "Group A" }]);
    const res = await asAuthor(request(app).get("/api/users/u1/groups"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("PUT /:id/groups — updates user groups", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.setUserGroups.mockResolvedValue(undefined);
    storageMock.getUserGroups.mockResolvedValue([]);
    const res = await asAuthor(request(app).put("/api/users/u1/groups").send({ groupIds: ["g1"] }));
    expect(res.status).toBe(200);
    expect(storageMock.setUserGroups).toHaveBeenCalledWith("u1", ["g1"]);
  });

  it("PUT /:id/groups — returns 400 when groupIds not array", async () => {
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    const res = await asAuthor(request(app).put("/api/users/u1/groups").send({ groupIds: "g1" }));
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENTS ROUTES
// ─────────────────────────────────────────────────────────────────────────────
describe("Assignments routes", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getGroupUsers.mockResolvedValue([]);
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([]);
    storageMock.createAssignmentAccessToken.mockImplementation((data: any) =>
      Promise.resolve({ id: "tok1", createdAt: new Date(), revokedAt: null, ...data })
    );
    storageMock.revokeAssignmentAccessTokensByAssignment.mockResolvedValue(undefined);
    storageMock.revokeAssignmentAccessTokensByAssignmentAndUser.mockResolvedValue(undefined);
    storageMock.revokeAssignmentAccessToken.mockResolvedValue(undefined);
    app = makeApp(assignmentsRouter, "/api");
  });

  it("GET /tests/:id/assignments — returns enriched assignments", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([dbAssignment]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)    // middleware
      .mockResolvedValueOnce(dbUser);       // assignment enrichment
    const res = await asAuthor(request(app).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(200);
    expect(res.body[0].user).toBeDefined();
    expect(res.body[0].user.email).toBe("user@test.com");
    // passwordHash should be stripped
    expect(res.body[0].user.passwordHash).toBeUndefined();
  });

  it("GET /tests/:id/assignments — returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/tests/x/assignments"));
    expect(res.status).toBe(404);
  });

  it("POST /tests/:id/assignments — creates assignment for user", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)   // middleware
      .mockResolvedValueOnce(dbUser);      // user validation
    storageMock.createTestAssignment.mockResolvedValue(dbAssignment);
    const res = await asAuthor(request(app).post("/api/tests/test1/assignments")
      .send({ userId: "u1" }));
    expect(res.status).toBe(201);
    expect(storageMock.createTestAssignment).toHaveBeenCalled();
  });

  it("POST /tests/:id/assignments — creates assignment for group", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getGroup.mockResolvedValue({ id: "g1", name: "Group A" });
    storageMock.createTestAssignment.mockResolvedValue({ ...dbAssignment, groupId: "g1", userId: null });
    const res = await asAuthor(request(app).post("/api/tests/test1/assignments")
      .send({ groupId: "g1" }));
    expect(res.status).toBe(201);
  });

  it("POST /tests/:id/assignments — returns 400 when no userId or groupId", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(request(app).post("/api/tests/test1/assignments").send({}));
    expect(res.status).toBe(400);
  });

  it("POST /tests/:id/assignments — returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/tests/x/assignments").send({ userId: "u1" }));
    expect(res.status).toBe(404);
  });

  it("POST /tests/:id/assignments — returns 404 when user not found", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(undefined);
    const res = await asAuthor(request(app).post("/api/tests/test1/assignments")
      .send({ userId: "ghost" }));
    expect(res.status).toBe(404);
  });

  it("POST /tests/:id/assignments/bulk — creates multiple assignments", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockResolvedValue(dbAssignment);
    const res = await asAuthor(request(app).post("/api/tests/test1/assignments/bulk")
      .send({ userIds: ["u1", "u2"], groupIds: ["g1"] }));
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);
    expect(storageMock.createTestAssignment).toHaveBeenCalledTimes(3);
  });

  it("POST /tests/:id/assignments/bulk — returns 400 when no ids provided", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(request(app).post("/api/tests/test1/assignments/bulk").send({}));
    expect(res.status).toBe(400);
  });

  it("DELETE /assignments/:id — deletes assignment", async () => {
    storageMock.deleteTestAssignment.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/assignments/asgn1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("DELETE /assignments/:id — returns 404 when not found", async () => {
    storageMock.deleteTestAssignment.mockResolvedValue(false);
    const res = await asAuthor(request(app).delete("/api/assignments/x"));
    expect(res.status).toBe(404);
  });

  it("GET /learner/assigned-tests — returns assigned tests for learner", async () => {
    storageMock.getUser.mockResolvedValue(learnerUser);
    storageMock.getAssignedTestsForUser.mockResolvedValue([dbTest]);
    const res = await asLearner(request(app).get("/api/learner/assigned-tests"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].title).toBe("Test 1");
  });

  it("GET /learner/assigned-tests — returns 403 for author", async () => {
    const res = await asAuthor(request(app).get("/api/learner/assigned-tests"));
    expect(res.status).toBe(403);
  });
});
