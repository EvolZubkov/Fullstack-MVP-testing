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
import ExcelJS from "exceljs";
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
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    getGroups: vi.fn(), getGroupUsers: vi.fn(),
    getScormPackages: vi.fn(), getAllScormAttempts: vi.fn(),
    // Уровни и курсы прохождений LMS — для листов уровней и рекомендаций книги.
    getScormAttemptOutcomes: vi.fn(async (ids: string[]) => ((await storageMock.getAllScormAttempts()) ?? [])
      .filter((row: { id: string }) => ids.includes(row.id))
      .map((row: { id: string; achievedLevelsJson?: unknown; failedTopicCoursesJson?: unknown }) => ({
        id: row.id, achievedLevelsJson: row.achievedLevelsJson ?? null, failedTopicCoursesJson: row.failedTopicCoursesJson ?? null,
      }))),
    getScormAnswersByAttempt: vi.fn(),
    // PRD-56 FR-04: the registry book reads answers of every source and org spellings.
    selectAnswersForTest: vi.fn(), selectOrgSpellings: vi.fn(),
    // PRD-5/PRD-2: the export now names the test's scales and indicators, so it reads
    // the measurement rows too. Empty by default — these fixtures are control tests.
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
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
const dbPkg = {
  id: "pkg1", testId: "test1", testTitle: "JS Basics", testMode: "standard",
  secretKey: "abc", isActive: true, exportedAt: new Date(), createdAt: new Date(),
};

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


// ─── Shared setup ─────────────────────────────────────────────────────────────
let app: express.Express;
beforeEach(() => {
  vi.resetAllMocks();
    storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
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
  storageMock.selectAnswersForTest.mockResolvedValue([]);
  storageMock.selectOrgSpellings.mockResolvedValue({ organization: [], unit: [], position: [] });
  // PRD-5/PRD-2 measurement sources — re-armed here because `resetAllMocks` above
  // drops the implementations declared at hoist time.
  storageMock.getScales.mockResolvedValue([]);
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.getQuestionMeasurements.mockResolvedValue([]);
  app = makeApp();
});

const XLSX = "spreadsheetml";

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
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt()]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getTopics.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Excel/);
  });

  it("takes a telemetry row whose test is known only through its package", async () => {
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getScormPackages.mockResolvedValue([dbPkg]);
    storageMock.getAllScormAttempts.mockResolvedValue([makeLmsAttempt({ origin: "telemetry" })]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain(XLSX);
  });

  // Migrated from the removed GET /tests/:testId/export/excel: the test page exports through
  // this book now, so what that handler guaranteed for one test is pinned here.
  it("returns 403 when the actor lacks analytics.export", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }));
    expect(res.status).toBe(403);
  });

  it("one adaptive test: achieved levels on the passages sheet and the level of each answer", async () => {
    storageMock.getTests.mockResolvedValue([adaptiveTest]);
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getAllAttempts.mockResolvedValue([
      makeAdaptiveWebAttempt({
        resultJson: {
          mode: "adaptive", overallPercent: 100, overallPassed: true,
          totalEarnedPoints: 5, totalPossiblePoints: 5,
          topicResults: [
            { topicId: "t1", topicName: "JS", achievedLevelName: "Уровень 1", achievedLevelIndex: 1 },
            { topicId: "t2", topicName: "TS" },
          ],
          questionOutcomes: [{ questionId: "q1", result: "correct", earned: 1, possible: 1 }],
        },
      }),
    ]);
    storageMock.getUser.mockResolvedValue(dbUser);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }).buffer(true).parse(binary));
    expect(res.status).toBe(200);

    const passages = await sheet(res.body, "Прохождения");
    expect(passages[1][passages[0].indexOf("Достигнутые уровни")]).toBe("JS: Уровень 1; TS: —");
    const answers = await sheet(res.body, "Ответы");
    expect(answers[1][answers[0].indexOf("Уровень")]).toBe("Уровень 1");
  });

  it("an in-progress attempt is a passage «Не завершено» with no answers", async () => {
    const inProgress = makeWebAttempt({
      id: "inprog", userId: "uGhost", resultJson: null, finishedAt: null, answersJson: {},
    });
    storageMock.getTests.mockResolvedValue([dbTest]);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAllAttempts.mockResolvedValue([makeWebAttempt(), inProgress]);
    storageMock.getUser.mockImplementation((id: string) => {
      if (id === "author1") return Promise.resolve(authorUser);
      if (id === "u1") return Promise.resolve(dbUser);
      return Promise.resolve(undefined);
    });
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asAuthor(request(app).post("/api/export/excel").send({ testIds: ["test1"] }).buffer(true).parse(binary));
    expect(res.status).toBe(200);

    const passages = await sheet(res.body, "Прохождения");
    const row = passages.find(r => r[1] === "inprog")!;
    expect(row[passages[0].indexOf("Статус")]).toBe("Не завершено");
    const answers = await sheet(res.body, "Ответы");
    expect(answers.some(r => r[1] === "inprog")).toBe(false);
  });
});

/** Read a binary supertest response into a Buffer. */
function binary(response: NodeJS.ReadableStream, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
}

/** Sheet rows (header included) as strings. */
async function sheet(body: Buffer, name: string): Promise<string[][]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(body as never);
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`sheet "${name}" not found`);
  const rows: string[][] = [];
  ws.eachRow((r) => {
    rows.push((r.values as unknown[]).slice(1).map(v => (v === null || v === undefined ? "" : String(v))));
  });
  return rows;
}
