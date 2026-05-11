/**
 * Tests for attempts.ts and tests.ts routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(), getTests: vi.fn(), createTest: vi.fn(),
    updateTest: vi.fn(), deleteTest: vi.fn(), getTestSections: vi.fn(),
    patchTestStatus: vi.fn(),
    getAttempt: vi.fn(), createAttempt: vi.fn(), updateAttempt: vi.fn(),
    getAttemptsByUser: vi.fn(), getAttemptsByUserAndTest: vi.fn(),
    getUser: vi.fn(), getTopics: vi.fn(), getQuestionsByTopic: vi.fn(),
    getQuestionsByIds: vi.fn(), getTopicCourses: vi.fn(),
    getAssignedTestsForUser: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(), getAdaptiveLevelsByTest: vi.fn(),
    getAdaptiveLevelLinks: vi.fn(),
    deleteAdaptiveLevelLinksByTest: vi.fn(), deleteAdaptiveLevelsByTest: vi.fn(),
    deleteAdaptiveTopicSettingsByTest: vi.fn(),
    createAdaptiveTopicSettings: vi.fn(), createAdaptiveLevel: vi.fn(), createAdaptiveLevelLink: vi.fn(),
    getTopic: vi.fn(), getTopicCourses: vi.fn() as any,
    getScormPackagesByTest: vi.fn(), createScormPackage: vi.fn(),
  }
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/scorm/exporter", () => ({
  buildScormPackage: vi.fn().mockResolvedValue(Buffer.from("fake-zip")),
}));

import attemptsRouter from "../server/routes/attempts";
import testsRouter from "../server/routes/tests";

// ─── App factory ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const learnerUser = { ...authorUser, id: "learner1", role: "learner", email: "l@test.com" };

function makeApp(router: express.Router, path = "/api") {
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

function asLearner(req: request.Test) { return req.set("x-test-user", "learner1"); }
function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const dbTest = {
  id: "test1", title: "Test 1", mode: "standard", maxAttempts: null,
  timeLimitMinutes: null, showCorrectAnswers: false, version: 1,
  overallPassRuleJson: { type: "percent", value: 70 },
  createdAt: new Date(),
};
const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "Q?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  points: 1, difficulty: 50, shuffleAnswers: true,
  feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
};
const dbAttempt = {
  id: "atmp1", userId: "learner1", testId: "test1",
  variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1"] }] },
  answersJson: {}, resultJson: null,
  startedAt: new Date(), finishedAt: null, testVersion: 1,
};
const finishedAttempt = {
  ...dbAttempt, finishedAt: new Date(),
  resultJson: { totalCorrect: 1, totalQuestions: 1, overallPercent: 100, overallPassed: true, topicResults: [] },
};

// ─────────────────────────────────────────────────────────────────────────────
// ATTEMPTS ROUTES
// ─────────────────────────────────────────────────────────────────────────────
describe("Attempts routes — learner/tests", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(learnerUser);
    app = makeApp(attemptsRouter);
  });

  it("GET /learner/tests — returns assigned tests with sections", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 5 }]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    const res = await asLearner(request(app).get("/api/learner/tests"));
    expect(res.status).toBe(200);
    expect(res.body[0].sections[0].topicName).toBe("JS");
    expect(res.body[0].completedAttempts).toBe(0);
  });

  it("GET /learner/tests — returns 403 for author", async () => {
    storageMock.getUser.mockResolvedValue(authorUser);
    const res = await asAuthor(request(app).get("/api/learner/tests"));
    expect(res.status).toBe(403);
  });
});

describe("Attempts routes — start attempt", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(learnerUser);
    app = makeApp(attemptsRouter);
  });

  it("POST /tests/:testId/attempts/start — creates attempt", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(201);
    expect(res.body.testTitle).toBe("Test 1");
    expect(res.body.questions).toHaveLength(1);
    // correctJson hidden when showCorrectAnswers is false
    expect(res.body.questions[0].correctJson).toBeUndefined();
  });

  it("POST /tests/:testId/attempts/start — exposes correctJson when showCorrectAnswers is true", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, showCorrectAnswers: true });
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(201);
    expect(res.body.questions[0].correctJson).toBeDefined();
  });

  it("POST /tests/:testId/attempts/start — returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/tests/x/attempts/start"));
    expect(res.status).toBe(404);
  });

  it("POST /tests/:testId/attempts/start — returns 403 when attempts exhausted", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, maxAttempts: 2 });
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { ...finishedAttempt }, { ...finishedAttempt }
    ]);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ATTEMPTS_EXHAUSTED");
  });
});

describe("Attempts routes — save-progress, resume", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(learnerUser);
    app = makeApp(attemptsRouter);
  });

  it("POST /attempts/:id/save-progress — saves progress", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.updateAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/save-progress")
      .send({ answers: { q1: 0 }, currentIndex: 1 }));
    expect(res.status).toBe(200);
    expect(storageMock.updateAttempt).toHaveBeenCalled();
  });

  it("POST /attempts/:id/save-progress — returns 404 when not found", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/x/save-progress").send({}));
    expect(res.status).toBe(404);
  });

  it("POST /attempts/:id/save-progress — returns 403 when attempt belongs to another user", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, userId: "other" });
    const res = await asLearner(request(app).post("/api/attempts/atmp1/save-progress").send({}));
    expect(res.status).toBe(403);
  });

  it("GET /tests/:testId/resume — returns hasInProgress: true with questions", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([dbAttempt]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asLearner(request(app).get("/api/tests/test1/resume"));
    expect(res.status).toBe(200);
    expect(res.body.hasInProgress).toBe(true);
    expect(res.body.attempt.testTitle).toBe("Test 1");
  });

  it("GET /tests/:testId/resume — returns hasInProgress: false when no in-progress", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([finishedAttempt]);
    const res = await asLearner(request(app).get("/api/tests/test1/resume"));
    expect(res.status).toBe(200);
    expect(res.body.hasInProgress).toBe(false);
  });

  it("GET /tests/:testId/resume — returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asLearner(request(app).get("/api/tests/x/resume"));
    expect(res.status).toBe(404);
  });
});

describe("Attempts routes — finish attempt", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(learnerUser);
    app = makeApp(attemptsRouter);
  });

  it("POST /attempts/:id/finish — finishes attempt and returns result", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{
      topicId: "t1", topicPassRuleJson: { type: "percent", value: 70 }
    }]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    storageMock.updateAttempt.mockResolvedValue(finishedAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
      .send({ answers: { q1: 0 } }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.result.totalQuestions).toBe(1);
    expect(res.body.result.overallPassed).toBe(true);
  });

  it("POST /attempts/:id/finish — returns 404 when attempt not found", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/x/finish").send({ answers: {} }));
    expect(res.status).toBe(404);
  });

  it("POST /attempts/:id/finish — returns 403 when attempt belongs to another user", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, userId: "other" });
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish").send({ answers: {} }));
    expect(res.status).toBe(403);
  });

  it("POST /attempts/:id/finish — fails when pass threshold not met", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{
      topicId: "t1", topicPassRuleJson: { type: "percent", value: 70 }
    }]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    storageMock.updateAttempt.mockResolvedValue(finishedAttempt);
    // answer with wrong answer (index 1 instead of 0)
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
      .send({ answers: { q1: 1 } }));
    expect(res.status).toBe(200);
    expect(res.body.result.overallPassed).toBe(false);
  });
});

describe("Attempts routes — result and history", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(learnerUser);
    app = makeApp(attemptsRouter);
  });

  it("GET /attempts/:id/result — returns attempt result", async () => {
    storageMock.getAttempt.mockResolvedValue(finishedAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([finishedAttempt]);
    const res = await asLearner(request(app).get("/api/attempts/atmp1/result"));
    expect(res.status).toBe(200);
    expect(res.body.testTitle).toBe("Test 1");
    expect(res.body.canRetake).toBe(true);
  });

  it("GET /attempts/:id/result — canRetake is false when max attempts reached", async () => {
    storageMock.getAttempt.mockResolvedValue(finishedAttempt);
    storageMock.getTest.mockResolvedValue({ ...dbTest, maxAttempts: 1 });
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([finishedAttempt]);
    const res = await asLearner(request(app).get("/api/attempts/atmp1/result"));
    expect(res.status).toBe(200);
    expect(res.body.canRetake).toBe(false);
    expect(res.body.attemptsInfo).toEqual({ completed: 1, max: 1 });
  });

  it("GET /attempts/:id/result — returns 404 when not found", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await asLearner(request(app).get("/api/attempts/x/result"));
    expect(res.status).toBe(404);
  });

  it("GET /attempts/:id/result — returns 403 for other user's attempt", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...finishedAttempt, userId: "other" });
    const res = await asLearner(request(app).get("/api/attempts/atmp1/result"));
    expect(res.status).toBe(403);
  });

  it("GET /learner/attempts — returns attempt history grouped by test", async () => {
    storageMock.getAttemptsByUser.mockResolvedValue([finishedAttempt]);
    storageMock.getTests.mockResolvedValue([dbTest]);
    const res = await asLearner(request(app).get("/api/learner/attempts"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].testId).toBe("test1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS ROUTES
// ─────────────────────────────────────────────────────────────────────────────
describe("Tests routes", () => {
  let app: express.Express;
  const dbTestFull = {
    ...dbTest,
    description: null, feedback: null, webhookUrl: null,
    showDifficultyLevel: true, startPageContent: null,
  };
  const dbSection = { id: "sec1", testId: "test1", topicId: "t1", drawCount: 5, topicPassRuleJson: null };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp(testsRouter, "/api/tests");
  });

  it("GET / — returns tests with sections", async () => {
    storageMock.getTests.mockResolvedValue([dbTestFull]);
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelLinks.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/tests"));
    expect(res.status).toBe(200);
    expect(res.body[0].sections).toBeDefined();
  });

  it("GET / — returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/tests");
    expect(res.status).toBe(401);
  });

  it("POST / — creates test", async () => {
    storageMock.createTest.mockResolvedValue(dbTestFull);
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelLinks.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "Test 1",
      sections: [{ topicId: "t1", drawCount: 5 }],
      overallPassRuleJson: { type: "percent", value: 70 },
    }));
    expect(res.status).toBe(201);
    expect(storageMock.createTest).toHaveBeenCalled();
  });

  it("POST / — returns 400 when title missing", async () => {
    const res = await asAuthor(request(app).post("/api/tests").send({ sections: [] }));
    expect(res.status).toBe(400);
  });

  it("PUT /:id — updates test", async () => {
    storageMock.updateTest.mockResolvedValue(dbTestFull);
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelLinks.mockResolvedValue([]);
    const res = await asAuthor(request(app).put("/api/tests/test1").send({ title: "Updated" }));
    expect(res.status).toBe(200);
  });

  it("PUT /:id — returns 404 when not found", async () => {
    storageMock.updateTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/tests/x").send({ title: "X" }));
    expect(res.status).toBe(404);
  });

  it("DELETE /:id — deletes test with confirmTitle", async () => {
    storageMock.getTest.mockResolvedValue(dbTestFull);
    storageMock.deleteAdaptiveLevelLinksByTest.mockResolvedValue(undefined);
    storageMock.deleteAdaptiveLevelsByTest.mockResolvedValue(undefined);
    storageMock.deleteAdaptiveTopicSettingsByTest.mockResolvedValue(undefined);
    storageMock.deleteTest.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/tests/test1").send({ confirmTitle: "Test 1" }));
    expect(res.status).toBe(204);
  });

  it("DELETE /:id — returns 400 when confirmTitle mismatches", async () => {
    storageMock.getTest.mockResolvedValue(dbTestFull);
    const res = await asAuthor(request(app).delete("/api/tests/test1").send({ confirmTitle: "Wrong Title" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("title_mismatch");
  });

  it("DELETE /:id — returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).delete("/api/tests/x").send({ confirmTitle: "anything" }));
    expect(res.status).toBe(404);
  });

  it("GET /:id/adaptive-settings — returns adaptive settings", async () => {
    storageMock.getTest.mockResolvedValue(dbTestFull);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelLinks.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/tests/test1/adaptive-settings"));
    expect(res.status).toBe(200);
  });

  it("GET /:id/adaptive-settings — returns empty array when test has no adaptive settings", async () => {
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.getTopics.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/tests/x/adaptive-settings"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
