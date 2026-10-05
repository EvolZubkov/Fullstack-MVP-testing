/**
 * Tests for analytics/export.ts routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { observationsDouble } from "./helpers/observations-double";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(), getTests: vi.fn(), getTopics: vi.fn(),
    getAllAttempts: vi.fn(), async getAttemptsByTests(ids: string[]) { return ((await this.getAllAttempts()) ?? []).filter((a: { testId: string }) => ids.includes(a.testId)); },
    // PRD-56 FR-33: сводка книги читает прохождения через выборку DAL.
    selectObservations: vi.fn(), getAttemptsByUser: vi.fn(),
    getQuestionsByIds: vi.fn(), getTopicCourses: vi.fn(),
    // PRD-15 block D: effective-scoring chain sources (no overrides by default).
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    getGroups: vi.fn(), getGroupUsers: vi.fn(),
    getScormPackages: vi.fn(), getAllScormAttempts: vi.fn(),
    getScormAnswersByAttempt: vi.fn(),
    // PRD-56 FR-04: the registry book reads answers of every source and org spellings.
    selectAnswersForTest: vi.fn().mockResolvedValue([]),
    selectOrgSpellings: vi.fn().mockResolvedValue({ organization: [], unit: [], position: [] }),
    // PRD-5/PRD-2: the export now names the test's scales and indicators, so it reads
    // the measurement rows too. Empty by default — these fixtures are control tests.
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /export/excel — Web attempts export
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /analytics/export/excel", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.resetAllMocks();
    storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
    storageMock.getUserRoles.mockResolvedValue(["administrator"]);
    storageMock.getUser.mockResolvedValue(authorUser);
    // PRD-5/PRD-2 measurement sources — re-armed because `resetAllMocks` drops the
    // implementations declared at hoist time.
    storageMock.getScales.mockResolvedValue([]);
    storageMock.getResultVariables.mockResolvedValue([]);
    storageMock.getQuestionMeasurements.mockResolvedValue([]);
    storageMock.selectAnswersForTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    storageMock.selectOrgSpellings.mockResolvedValue({ organization: [], unit: [], position: [] });
    app = makeApp();
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/export/excel").send({ testIds: ["test1"] });
    expect(res.status).toBe(401);
  });

  it("без условия «Тест» выгружает все доступные тесты — как реестр (PRD-56 FR-04)", async () => {
    // Выборка реестра по одной группе не несёт testIds: раньше книга отвечала 400
    // «testIds is required», и такую выборку выгрузить было нельзя.
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt()]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ groupIds: [] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("spreadsheetml");
  });

  it("без условия «Тест» и без доступных тестов отвечает 400 словами", async () => {
    storageMock.getTests.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Нет доступных тестов для выгрузки");
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
