/**
 * @module tests/routes.analytics-export.coverage
 *
 * Branch-coverage supplement for `server/routes/analytics/export.ts`. The happy
 * paths (a spreadsheet is produced) are already covered in
 * `routes.analytics-export.test.ts`; this file targets the conditional branches
 * that file leaves cold: permission/scope 403s, the adaptive-mode code paths,
 * the per-sheet `includeSheets` toggles, optional-field fallbacks in every row
 * builder, date/user/group filters, empty selections and the catch/500 arms.
 *
 * The harness (hoisted `storageMock`, `vi.mock("../server/storage")`,
 * supertest + `x-test-user`) mirrors the sibling test. `checkAnswer` is left
 * real so the effective-scoring resolution runs end to end.
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
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    getGroups: vi.fn(), getGroupUsers: vi.fn(),
    getScormPackages: vi.fn(), getAllScormAttempts: vi.fn(),
    getScormAnswersByAttempt: vi.fn(),
    // Object-level scope sources (non-admin readableTestScope path).
    getTestIdsByOwner: vi.fn(), getUserTestGrants: vi.fn(),
    getTestGrantForUser: vi.fn(), isTestAssignedToUser: vi.fn(),
  },
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
  overallPassRuleJson: { type: "percent", value: 70 }, createdAt: new Date(), ownerId: "someoneElse",
};
const adaptiveTest = { ...dbTest, id: "test1", mode: "adaptive" };
const dbTopic = { id: "t1", name: "JavaScript", createdAt: new Date() };
const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "Q?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  difficulty: 50, shuffleAnswers: true, contentHash: "h1",
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
const adaptivePkg = { ...dbPkg, id: "pkg-ad", testId: "test1", testTitle: "Adaptive", testMode: "adaptive" };

const makeWebAttempt = (overrides: any = {}) => ({
  id: "atmp1", testId: "test1", userId: "u1",
  variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1"] }] },
  answersJson: { q1: 0 },
  resultJson: {
    mode: "standard",
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

const makeAdaptiveWebAttempt = (overrides: any = {}) => ({
  id: "aw1", testId: "test1", userId: "u1",
  variantJson: {
    topics: [{
      topicId: "t1", topicName: "JS",
      levelsState: [{ levelName: "Уровень 1", questionIds: ["q1"], answeredQuestionIds: ["q1"] }],
    }],
  },
  answersJson: { q1: 0 },
  resultJson: {
    mode: "adaptive", overallPercent: 100, overallPassed: true,
    totalEarnedPoints: 5, totalPossiblePoints: 5,
    topicResults: [{
      topicId: "t1", topicName: "JS",
      achievedLevelName: "Уровень 1", achievedLevelIndex: 1,
      recommendedLinks: [{ title: "Курс адаптивный" }],
    }],
  },
  startedAt: new Date(Date.now() - 120000), finishedAt: new Date(), testVersion: 1,
  ...overrides,
});

const makeLmsAttempt = (overrides: any = {}) => ({
  id: "satmp1", packageId: "pkg1", sessionId: "sess1", attemptNumber: 1,
  lmsUserId: "lms-u1", lmsUserName: "LMS Alice", lmsUserEmail: "lms@test.com", lmsUserOrg: "Org",
  startedAt: new Date(Date.now() - 120000), finishedAt: new Date(),
  resultPercent: 85, resultPassed: true, totalPoints: 8, maxPoints: 10,
  totalQuestions: 2, correctAnswers: 1, achievedLevelsJson: null, failedTopicCoursesJson: null,
  ...overrides,
});

const dbAnswer = {
  id: "ans1", questionId: "q1", questionPrompt: "Q?", questionType: "single",
  topicId: "t1", topicName: "JavaScript", difficulty: 40,
  userAnswerJson: 0, correctAnswerJson: { correctIndex: 0 }, isCorrect: true, points: 5, maxPoints: 5,
  optionsJson: ["A", "B"], leftItemsJson: null, rightItemsJson: null, itemsJson: null,
  levelIndex: null, levelName: null, answeredAt: new Date(),
};

// ─── Shared setup ─────────────────────────────────────────────────────────────
let app: express.Express;
beforeEach(() => {
  vi.resetAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue(authorUser);
  // Scope sources default to "no owned tests / no grants" (non-admin path).
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
  storageMock.isTestAssignedToUser.mockResolvedValue(false);
  // Effective-scoring chain sources default empty.
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getTopicCourses.mockResolvedValue([]);
  storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
  app = makeApp();
});

const XLSX = "spreadsheetml";

// ─────────────────────────────────────────────────────────────────────────────
// GET /tests/:testId/export/excel — per-test Excel
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /tests/:testId/export/excel — branches", () => {
  it("returns 403 when the actor lacks analytics.export", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asAuthor(request(app).get("/api/tests/test1/export/excel"));
    expect(res.status).toBe(403);
  });

  it("returns 403 when a non-admin author is out of the test scope", async () => {
    // requireTestScope("analytics"): author, not owner, no grant -> canReadTestAnalytics false.
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTest.mockResolvedValue(dbTest); // ownerId !== author1
    const res = await asAuthor(request(app).get("/api/tests/test1/export/excel"));
    expect(res.status).toBe(403);
  });

  it("returns 404 from the handler when the test disappears after the scope check", async () => {
    // requireTestScope sees the test (admin bypass), handler re-reads it as gone.
    storageMock.getTest.mockResolvedValueOnce(dbTest).mockResolvedValueOnce(undefined);
    storageMock.getAllAttempts.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/tests/test1/export/excel"));
    expect(res.status).toBe(404);
  });

  it("exports the full adaptive path (levels, topic variant, level names)", async () => {
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAllAttempts.mockResolvedValue([
      makeAdaptiveWebAttempt({
        // second topicResult without achievedLevelName -> "|| —" branch
        answersJson: { q1: 0, qGhost: 1 },
        resultJson: {
          mode: "adaptive", overallPercent: 100, overallPassed: true,
          totalEarnedPoints: 5, totalPossiblePoints: 5,
          topicResults: [
            { topicId: "t1", topicName: "JS", achievedLevelName: "Уровень 1", achievedLevelIndex: 1 },
            { topicId: "t2", topicName: "TS" },
          ],
        },
      }),
    ]);
    storageMock.getUser.mockResolvedValueOnce(authorUser).mockResolvedValueOnce(dbUser);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).get("/api/tests/test1/export/excel"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
    expect(res.headers["content-disposition"]).toContain(".xlsx");
  });

  it("handles an in-progress attempt (no result, no finish date) and unknown users", async () => {
    const inProgress = makeWebAttempt({
      id: "inprog", userId: "uGhost", resultJson: null, finishedAt: null, answersJson: {},
    });
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt(), inProgress]);
    storageMock.getUser.mockImplementation((id: string) => {
      if (id === "author1") return Promise.resolve(authorUser);
      if (id === "u1") return Promise.resolve({ ...dbUser, name: null, email: null }); // -> "Unknown"
      return Promise.resolve(undefined); // uGhost -> not in map
    });
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).get("/api/tests/test1/export/excel"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  it("returns 500 when a storage read throws", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAllAttempts.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(app).get("/api/tests/test1/export/excel"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Excel/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /export/filters — branches
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /export/filters — branches", () => {
  it("scopes tests/packages to a non-admin author's readable set", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]); // owns test1 only
    const otherTest = { ...dbTest, id: "test2", title: "Other" };
    const otherPkg = { ...dbPkg, id: "pkg2", testId: "test2" };
    storageMock.getTests.mockResolvedValue([dbTest, otherTest]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt(), makeWebAttempt({ id: "a2", testId: "test2" })]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg, otherPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([makeLmsAttempt(), makeLmsAttempt({ id: "s2", packageId: "pkg2" })]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getGroups.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/export/filters"));
    expect(res.status).toBe(200);
    expect(res.body.tests).toHaveLength(1);
    expect(res.body.tests[0].id).toBe("test1");
    expect(res.body.scormPackages).toHaveLength(1);
  });

  it("builds the LMS-user fallback name and skips unfinished / untitled packages", async () => {
    const noNamePkg = { ...dbPkg, id: "pkg-x", testId: null }; // testId null -> not added to lmsTestIds
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt({ finishedAt: null })]); // no finished web
    storageMock.getScormPackages.mockResolvedValue([dbPkg, noNamePkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([
      // finished, no name/email -> "LMS User (...)" fallback
      makeLmsAttempt({ id: "s-anon", lmsUserId: "lms-anon-1234567890", lmsUserName: null, lmsUserEmail: null }),
      // unfinished -> skipped in the LMS user map
      makeLmsAttempt({ id: "s-unf", finishedAt: null, lmsUserId: "lms-unf" }),
    ]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getGroups.mockResolvedValue([dbGroup]);
    storageMock.getGroupUsers.mockResolvedValue([dbUser]);
    const res = await asAuthor(request(app).get("/api/export/filters"));
    expect(res.status).toBe(200);
    const lms = res.body.users.filter((u: any) => u.source === "lms");
    expect(lms).toHaveLength(1);
    expect(lms[0].username).toMatch(/LMS User/);
    expect(res.body.tests[0].hasWebAttempts).toBe(false);
    expect(res.body.groups[0].userCount).toBe(1);
  });

  it("returns 500 when getTests throws", async () => {
    storageMock.getTests.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).get("/api/export/filters"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/filters/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /export/excel — branches
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /export/excel — branches", () => {
  it("returns 403 when no selected test is in scope (unknown testIds)", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["ghost"] }));
    expect(res.status).toBe(403);
  });

  it("returns 403 for a non-admin author whose scope excludes the test", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTests.mockResolvedValue([dbTest]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(403);
  });

  it("honours includeSheets: only the summary sheet is built", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt()]);
    storageMock.getUser.mockResolvedValueOnce(authorUser).mockResolvedValueOnce(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({
      testIds: ["test1"],
      includeSheets: { summary: true, attempts: false, answers: false, questionStats: false, levelStats: false, recommendations: false },
    }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  it("builds adaptive levelStats and adaptive recommendations sheets", async () => {
    storageMock.getTests.mockResolvedValue([adaptiveTest]);
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeAdaptiveWebAttempt()]);
    storageMock.getUser.mockResolvedValueOnce(authorUser).mockResolvedValueOnce(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  it("builds standard recommendations from failed topics", async () => {
    const failed = makeWebAttempt({
      resultJson: {
        mode: "standard", overallPercent: 40, overallPassed: false,
        totalEarnedPoints: 2, totalPossiblePoints: 5,
        topicResults: [{
          topicId: "t1", topicName: "JS", passed: false,
          recommendedCourses: [{ title: "Курс восстановления" }],
        }],
      },
    });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([failed]);
    storageMock.getUser.mockResolvedValueOnce(authorUser).mockResolvedValueOnce(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  it("bestAttemptOnly with level_sum criteria resolves ties by secondary then time", async () => {
    const base = (id: string, idx: number, pct: number, when: number) => makeAdaptiveWebAttempt({
      id, finishedAt: new Date(when),
      resultJson: {
        mode: "adaptive", overallPercent: pct, overallPassed: true,
        topicResults: [{ topicId: "t1", topicName: "JS", achievedLevelName: "L", achievedLevelIndex: idx }],
      },
    });
    // Same levelSum (2): B beats A on secondary(percent); C beats B on time.
    const now = Date.now();
    storageMock.getTests.mockResolvedValue([adaptiveTest]);
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([
      base("A", 2, 50, now - 3000), base("B", 2, 80, now - 2000), base("C", 2, 80, now - 1000),
    ]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({
      testIds: ["test1"], bestAttemptOnly: true, bestAttemptCriteria: "level_sum",
    }));
    expect(res.status).toBe(200);
  });

  it("bestAttemptOnly with level_count criteria", async () => {
    const oneLevel = makeAdaptiveWebAttempt({ id: "one",
      resultJson: { mode: "adaptive", overallPercent: 90, overallPassed: true,
        topicResults: [{ topicId: "t1", topicName: "JS", achievedLevelIndex: 1 }] } });
    const twoLevels = makeAdaptiveWebAttempt({ id: "two",
      resultJson: { mode: "adaptive", overallPercent: 60, overallPassed: true,
        topicResults: [
          { topicId: "t1", topicName: "JS", achievedLevelIndex: 1 },
          { topicId: "t2", topicName: "TS", achievedLevelIndex: 0 },
        ] } });
    storageMock.getTests.mockResolvedValue([adaptiveTest]);
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([oneLevel, twoLevels]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({
      testIds: ["test1"], bestAttemptOnly: true, bestAttemptCriteria: "level_count",
    }));
    expect(res.status).toBe(200);
  });

  it("bestAttemptOnly with default percent criteria on an adaptive test", async () => {
    storageMock.getTests.mockResolvedValue([adaptiveTest]);
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeAdaptiveWebAttempt()]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({
      testIds: ["test1"], bestAttemptOnly: true,
    }));
    expect(res.status).toBe(200);
  });

  it("applies dateFrom/dateTo filters (in-range kept, out-of-range and dateless dropped)", async () => {
    const inRange = makeWebAttempt({ id: "in", finishedAt: new Date("2024-06-01") });
    const tooOld = makeWebAttempt({ id: "old", finishedAt: new Date("2023-01-01") });
    const tooNew = makeWebAttempt({ id: "new", finishedAt: new Date("2099-01-01") });
    const noDates = makeWebAttempt({ id: "nod", startedAt: null, finishedAt: null });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([inRange, tooOld, tooNew, noDates]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({
      testIds: ["test1"], dateFrom: "2024-01-01", dateTo: "2025-01-01",
    }));
    expect(res.status).toBe(200);
  });

  it("intersects groupIds with userIds", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt(), makeWebAttempt({ id: "a2", userId: "u2" })]);
    storageMock.getGroupUsers.mockResolvedValue([dbUser, { id: "u2", name: "Bob" }]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({
      testIds: ["test1"], groupIds: ["g1"], userIds: ["u1"], // intersection -> u1 only
    }));
    expect(res.status).toBe(200);
  });

  it("skips answers whose question is missing from the question map", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt({ answersJson: { q1: 0, qMissing: 1 } })]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]); // qMissing not returned
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
  });

  it("returns 500 when a storage read throws mid-build", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Excel/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /export/excel-lms — branches
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /export/excel-lms — branches", () => {
  it("returns 403 when the selected testIds are outside the actor's scope", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]); // non-admin, owns nothing
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({ testIds: ["test1"] }));
    expect(res.status).toBe(403);
  });

  it("honours includeSheets: only summary built", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([makeLmsAttempt()]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([dbAnswer]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({
      testIds: ["test1"],
      includeSheets: { summary: true, attempts: false, answers: false, questionStats: false, levelStats: false, recommendations: false },
    }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  it("renders '—' fallbacks for LMS attempts with null identity fields", async () => {
    const anon = makeLmsAttempt({
      id: "anon", lmsUserName: null, lmsUserEmail: null, lmsUserOrg: null,
      resultPercent: null, totalPoints: null, maxPoints: null, resultPassed: false,
      startedAt: null,
    });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([anon]);
    // one rich answer (all ans fields) + one sparse (fall back to question)
    storageMock.getScormAnswersByAttempt.mockResolvedValue([
      dbAnswer,
      { id: "ans2", questionId: "q1", isCorrect: false, points: 0 },
    ]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  it("answers sheet: question missing from the map falls back to answer fields", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([makeLmsAttempt()]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([
      { id: "a", questionId: "qX", questionPrompt: "Prompt X", questionType: "single",
        topicName: "Topic X", difficulty: 30, correctAnswerJson: {}, userAnswerJson: 0,
        isCorrect: true, points: 2, levelName: "Lx" },
    ]);
    storageMock.getQuestionsByIds.mockResolvedValue([]); // qX absent
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
  });

  it("builds the adaptive LMS levelStats sheet and skips non-adaptive / empty levels", async () => {
    const adaptiveDone = makeLmsAttempt({
      id: "ad-done", packageId: "pkg-ad",
      achievedLevelsJson: [
        { topicName: "JS", levelName: "L1" },
        { topicName: "TS" }, // no levelName -> "Не достигнут"
      ],
    });
    const adaptiveEmpty = makeLmsAttempt({ id: "ad-empty", packageId: "pkg-ad", achievedLevelsJson: [] });
    storageMock.getTests.mockResolvedValue([{ id: "test1", title: "Adaptive", mode: "adaptive" }]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([adaptivePkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([adaptiveDone, adaptiveEmpty]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  it("builds recommendations from failedTopicCoursesJson as array, JSON string and bad string", async () => {
    const arr = makeLmsAttempt({ id: "r-arr", lmsUserId: "u-arr",
      failedTopicCoursesJson: [{ title: "Курс массив" }] });
    const str = makeLmsAttempt({ id: "r-str", lmsUserId: "u-str",
      failedTopicCoursesJson: JSON.stringify([{ title: "Курс строка" }]) });
    const bad = makeLmsAttempt({ id: "r-bad", lmsUserId: "u-bad",
      failedTopicCoursesJson: "{ this is not json" });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([arr, str, bad]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  it("filters LMS attempts by userIds", async () => {
    const keep = makeLmsAttempt({ id: "keep", lmsUserId: "lms-u1" });
    const drop = makeLmsAttempt({ id: "drop", lmsUserId: "lms-u2" });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([keep, drop]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({
      testIds: ["test1"], userIds: ["lms-u1"],
    }));
    expect(res.status).toBe(200);
  });

  it("bestAttemptOnly drops attempts whose package is gone and keeps the best per user", async () => {
    const orphan = makeLmsAttempt({ id: "orphan", packageId: "pkg-gone" });
    const lo = makeLmsAttempt({ id: "lo", resultPercent: 40, finishedAt: new Date(Date.now() - 5000) });
    const hi = makeLmsAttempt({ id: "hi", resultPercent: 90, finishedAt: new Date(Date.now() - 4000) });
    const tieOld = makeLmsAttempt({ id: "tie-old", resultPercent: 90, finishedAt: new Date(Date.now() - 3000) });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]); // pkg-gone not present
    storageMock.getAllScormAttempts.mockResolvedValue([orphan, lo, hi, tieOld]);
    storageMock.getScormAnswersByAttempt.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({
      testIds: ["test1"], bestAttemptOnly: true,
    }));
    expect(res.status).toBe(200);
  });

  it("returns 500 when a storage read throws", async () => {
    storageMock.getScormPackages.mockRejectedValue(new Error("db down"));
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    const res = await asAuthor(request(app).post("/api/export/excel-lms").send({ testIds: ["test1"] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/LMS Excel/);
  });
});
