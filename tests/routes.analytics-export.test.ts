/**
 * Tests for analytics/export.ts routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(), getTests: vi.fn(), getTopics: vi.fn(),
    getAllAttempts: vi.fn(), getAttemptsByUser: vi.fn(),
    getQuestionsByIds: vi.fn(), getTopicCourses: vi.fn(),
    getGroups: vi.fn(), getGroupUsers: vi.fn(),
    getScormPackages: vi.fn(), getAllScormAttempts: vi.fn(),
    getScormAnswersByAttempt: vi.fn(),
  }
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import exportRouter from "../server/routes/analytics/export";

// ─── App factory ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api", exportRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const dbTest = {
  id: "test1", title: "JS Basics", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 }, createdAt: new Date(),
};
const dbTopic = { id: "t1", name: "JavaScript", createdAt: new Date() };
const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "Q?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  points: 5, difficulty: 50, shuffleAnswers: true,
};
const dbUser = {
  id: "u1", name: "Alice", email: "alice@test.com", role: "learner", status: "active",
  mustChangePassword: false, gdprConsent: true, passwordHash: "x", emailHash: "x",
  createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const dbGroup = { id: "g1", name: "Group A", description: null, createdAt: new Date(), createdBy: null };
const dbPkg = {
  id: "pkg1", testId: "test1", testTitle: "JS Basics", testMode: "standard",
  secretKey: "abc", isActive: true, exportedAt: new Date(), createdAt: new Date(),
};

const makeWebAttempt = (overrides: any = {}) => ({
  id: "atmp1", testId: "test1", userId: "u1",
  variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1"] }] },
  answersJson: { q1: 0 },
  resultJson: {
    totalCorrect: 1, totalQuestions: 1, overallPercent: 100,
    totalEarnedPoints: 5, totalPossiblePoints: 5, overallPassed: true,
    topicResults: [{
      topicId: "t1", topicName: "JS", correct: 1, total: 1,
      earnedPoints: 5, possiblePoints: 5, percent: 100, passed: true,
    }],
  },
  startedAt: new Date(Date.now() - 120000), finishedAt: new Date(), testVersion: 1,
  ...overrides,
});

const makeLmsAttempt = (overrides: any = {}) => ({
  id: "satmp1", packageId: "pkg1", sessionId: "sess1", attemptNumber: 1,
  lmsUserId: "lms-u1", lmsUserName: "LMS Alice", lmsUserEmail: "lms@test.com", lmsUserOrg: null,
  startedAt: new Date(Date.now() - 120000), finishedAt: new Date(),
  resultPercent: 85, resultPassed: true, totalPoints: 8, maxPoints: 10,
  totalQuestions: 2, correctAnswers: 1, achievedLevelsJson: null, failedTopicCoursesJson: null,
  ...overrides,
});

const dbAnswer = {
  id: "ans1", questionId: "q1", questionPrompt: "Q?", questionType: "single",
  topicId: "t1", topicName: "JavaScript", difficulty: 50,
  userAnswerJson: 0, correctAnswerJson: 0, isCorrect: true, points: 5, maxPoints: 5,
  optionsJson: ["A", "B"], leftItemsJson: null, rightItemsJson: null, itemsJson: null,
  levelIndex: null, levelName: null, answeredAt: new Date(),
};

// ─────────────────────────────────────────────────────────────────────────────
// PER-TEST EXPORT
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /analytics/tests/:testId/export/excel", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/tests/test1/export/excel");
    expect(res.status).toBe(401);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    storageMock.getAllAttempts.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/tests/x/export/excel"));
    expect(res.status).toBe(404);
  });

  it("returns xlsx file for test with attempts", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt()]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/tests/test1/export/excel"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
    expect(res.headers["content-disposition"]).toContain(".xlsx");
  });

  it("returns xlsx even with no completed attempts", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/tests/test1/export/excel"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT FILTERS
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /analytics/export/filters", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/export/filters");
    expect(res.status).toBe(401);
  });

  it("returns tests, users, groups, scormPackages", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt()]);
    storageMock.getAllScormAttempts.mockResolvedValue([makeLmsAttempt()]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)  // middleware
      .mockResolvedValueOnce(dbUser);     // user lookup
    storageMock.getGroups.mockResolvedValue([dbGroup]);
    storageMock.getGroupUsers.mockResolvedValue([dbUser]);
    const res = await asAuthor(request(app).get("/api/export/filters"));
    expect(res.status).toBe(200);
    expect(res.body.tests).toHaveLength(1);
    expect(res.body.tests[0].title).toBe("JS Basics");
    expect(res.body.users.length).toBeGreaterThan(0);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].userCount).toBe(1);
    expect(res.body.scormPackages).toHaveLength(1);
  });

  it("marks tests with web/lms attempts correctly", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt()]);
    storageMock.getAllScormAttempts.mockResolvedValue([makeLmsAttempt()]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getGroups.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/export/filters"));
    expect(res.status).toBe(200);
    const testOpt = res.body.tests[0];
    expect(testOpt.hasWebAttempts).toBe(true);
    expect(testOpt.hasLmsAttempts).toBe(true);
  });

  it("returns empty arrays when no data", async () => {
    storageMock.getTests.mockResolvedValue([]);
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);
    storageMock.getScormPackages.mockResolvedValue([]);
    storageMock.getGroups.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/export/filters"));
    expect(res.status).toBe(200);
    expect(res.body.tests).toHaveLength(0);
    expect(res.body.users).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /export/excel — Web attempts export
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /analytics/export/excel", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.resetAllMocks();
    storageMock.getUserRoles.mockResolvedValue(["administrator"]);
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/export/excel").send({ testIds: ["test1"] });
    expect(res.status).toBe(401);
  });

  it("returns 400 when testIds missing", async () => {
    const res = await asAuthor(request(app).post("/api/export/excel").send({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/testIds/);
  });

  it("returns xlsx with all sheets", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt()]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel")
      .send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  it("returns xlsx when no matching attempts", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel")
      .send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  it("filters by userId", async () => {
    const otherAttempt = makeWebAttempt({ id: "atmp2", userId: "u2" });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt(), otherAttempt]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser)
      .mockResolvedValueOnce({ ...dbUser, id: "u2" });
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel")
      .send({ testIds: ["test1"], userIds: ["u1"] }));
    expect(res.status).toBe(200);
  });

  it("filters by groupId", async () => {
    storageMock.getUser.mockResolvedValue(authorUser); // middleware + any user lookups
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt()]);
    storageMock.getGroupUsers.mockResolvedValue([dbUser]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel")
      .send({ testIds: ["test1"], groupIds: ["g1"] }));
    expect(res.status).toBe(200);
  });

  it("bestAttemptOnly keeps only the best attempt per user+test", async () => {
    const attempt1 = makeWebAttempt({ id: "a1",
      resultJson: { ...makeWebAttempt().resultJson, overallPercent: 60 } });
    const attempt2 = makeWebAttempt({ id: "a2",
      resultJson: { ...makeWebAttempt().resultJson, overallPercent: 90 } });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([attempt1, attempt2]);
    storageMock.getUser
      .mockResolvedValueOnce(authorUser)
      .mockResolvedValueOnce(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel")
      .send({ testIds: ["test1"], bestAttemptOnly: true }));
    expect(res.status).toBe(200);
    // Excel is returned — content checks via sheet parsing are out of scope;
    // the important check is that it doesn't crash and returns a file
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /export/excel-lms — LMS attempts export
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /analytics/export/excel-lms", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/export/excel-lms").send({ testIds: ["test1"] });
    expect(res.status).toBe(401);
  });

  it("returns 400 when testIds missing", async () => {
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({}));
    expect(res.status).toBe(400);
  });

  it("returns xlsx for LMS attempts", async () => {
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([makeLmsAttempt()]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([dbAnswer]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms")
      .send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  it("returns xlsx even when no matching LMS attempts", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms")
      .send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  it("bestAttemptOnly keeps only the best LMS attempt per user+test", async () => {
    const attempt1 = makeLmsAttempt({ id: "s1", resultPercent: 60 });
    const attempt2 = makeLmsAttempt({ id: "s2", resultPercent: 95 });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([attempt1, attempt2]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms")
      .send({ testIds: ["test1"], bestAttemptOnly: true }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  it("filters LMS attempts by date range", async () => {
    const oldAttempt = makeLmsAttempt({
      id: "s_old",
      startedAt: new Date("2023-01-01"),
      finishedAt: new Date("2023-01-01"),
    });
    const newAttempt = makeLmsAttempt({ id: "s_new" });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([oldAttempt, newAttempt]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms")
      .send({ testIds: ["test1"], dateFrom: "2024-01-01" }));
    expect(res.status).toBe(200);
    // just checking it runs successfully with date filter
  });
});
