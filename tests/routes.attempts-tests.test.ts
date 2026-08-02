/**
 * Tests for attempts.ts and tests.ts routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, serviceMock } = vi.hoisted(() => ({
  serviceMock: { create: vi.fn(), save: vi.fn() },
  storageMock: {
    getTest: vi.fn(), getTests: vi.fn(),
    updateTest: vi.fn(), deleteTest: vi.fn(), getTestSections: vi.fn(),
    patchTestStatus: vi.fn(),
    getAttempt: vi.fn(), createAttempt: vi.fn(), updateAttempt: vi.fn(),
    getAttemptsByUser: vi.fn(), getAttemptsByUserAndTest: vi.fn(),
    // PRD-31: the attempt counter and the retake gate are scoped to the CURRENT
    // assignment, so every attempt route resolves it. `null` = the legacy bucket
    // these fixtures live in (see `dbAttempt.assignmentId`).
    getCurrentAssignmentId: vi.fn().mockResolvedValue(null),
    getUser: vi.fn(), getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getUsers: vi.fn().mockResolvedValue([]),
    setTestOwner: vi.fn().mockResolvedValue(undefined),
    getTopics: vi.fn(), getQuestionsByTopic: vi.fn(),
    getQuestionsByIds: vi.fn(), getTopicCourses: vi.fn(),
    getTopicEvents: vi.fn().mockResolvedValue([]),
    getAssignedTestsForUser: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(), getAdaptiveLevelsByTest: vi.fn(),
    // PRD-12 FR-6: attempt start/resume now deliver the author's structure
    // (content pages) so the web host builds the same run as the SCORM package.
    getContentPages: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    // PRD-15 block D: per-test scoring overrides (none by default).
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelLinks: vi.fn(),
    deleteAdaptiveLevelLinksByTest: vi.fn(), deleteAdaptiveLevelsByTest: vi.fn(),
    deleteAdaptiveTopicSettingsByTest: vi.fn(),
    createAdaptiveTopicSettings: vi.fn(), createAdaptiveLevel: vi.fn(), createAdaptiveLevelLink: vi.fn(),
    getTopic: vi.fn(), getTopicCourses: vi.fn() as any,
    getScormPackagesByTest: vi.fn(), createScormPackage: vi.fn(),
  }
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
// testsRouter pulls in TestSettingsService -> server/db, which throws at import
// unless DATABASE_URL is set. Stub db (and the service) so the router imports
// without a live database, mirroring tests/routes.tests.test.ts.
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/services/test-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/test-settings")>();
  return { ...actual, testSettingsService: serviceMock };
});
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
    if (req.headers["x-test-magic"]) req.session.magic = JSON.parse(req.headers["x-test-magic"]);
    next();
  });
  app.use(path, router);
  return app;
}

function asLearner(req: request.Test) { return req.set("x-test-user", "learner1"); }
function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }
/** Learner whose session was opened by an assignment link scoped to `testId`. */
function asScopedLearner(req: request.Test, testId: string) {
  return asLearner(req).set("x-test-magic", JSON.stringify({ assignmentId: "a1", testId }));
}

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
  // PRD-31: a real row always carries the column; `null` is the implicit legacy
  // bucket — the same value `getCurrentAssignmentId` returns here. Leaving it
  // undefined would put the attempt in a DIFFERENT bucket than the current
  // assignment and silently zero the per-assignment attempt counter.
  assignmentId: null,
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

  it("GET /learner/tests — narrows the list to the magic scope's test", async () => {
    const other = { ...dbTest, id: "test2", title: "Test 2" };
    storageMock.getAssignedTestsForUser.mockResolvedValue([dbTest, other]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 5 }]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);

    const res = await asScopedLearner(request(app).get("/api/learner/tests"), "test2");
    expect(res.status).toBe(200);
    expect(res.body.map((t: { id: string }) => t.id)).toEqual(["test2"]);
  });

  it("GET /learner/tests — accessible to any role (PRD-13 D1)", async () => {
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getAssignedTestsForUser.mockResolvedValue([]);
    const res = await asAuthor(request(app).get("/api/learner/tests"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });

  it("GET /learner/tests — exposes resume position and the last completed attempt", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 5 }]);
    const inProgress = {
      ...dbAttempt, id: "in-1",
      variantJson: { currentIndex: 2, sections: [{ topicId: "t1", questionIds: ["q1", "q2", "q3"] }] },
    };
    const completedOld = { ...finishedAttempt, id: "done-old", finishedAt: new Date("2026-01-01") };
    const completedNew = { ...finishedAttempt, id: "done-new", finishedAt: new Date("2026-06-01") };
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([completedOld, inProgress, completedNew]);

    const res = await asLearner(request(app).get("/api/learner/tests"));
    expect(res.status).toBe(200);
    expect(res.body[0]).toMatchObject({
      completedAttempts: 2,
      inProgressAttemptId: "in-1",
      resumeIndex: 2,
      resumeTotal: 3,
      lastCompletedAttemptId: "done-new",
    });
  });
});

describe("Attempts routes — start attempt", () => {
  let app: express.Express;
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(learnerUser);
    app = makeApp(attemptsRouter);
  });

  // PRD-12 FR-6: without the structure in the payload the web host can only ever
  // render the question stream, and every content page the author placed is
  // silently skipped at run time while «Структура» keeps promising it.
  it("POST /tests/:testId/attempts/start — delivers content pages and flow mode", async () => {
    storageMock.getTest.mockResolvedValue({
      ...dbTest,
      flowPolicyJson: { mode: "router_by_topics" },
    });
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    storageMock.getContentPages.mockResolvedValue([
      { id: "p1", kind: "info", type: "info", topicId: null, position: "before",
        sortOrder: 0, mode: "template", templateKey: "text", valuesJson: { values: {} },
        autoAdvance: false, autoAdvanceDelayMs: null },
    ]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(201);
    expect(res.body.flowMode).toBe("router_by_topics");
    expect(res.body.contentPages).toHaveLength(1);
    expect(res.body.contentPages[0]).toMatchObject({ id: "p1", position: "before", kind: "info" });
    // Read through the attempt's data source, so a snapshot-pinned attempt gets
    // the PUBLISHED structure rather than today's live edits.
    expect(storageMock.getContentPages).toHaveBeenCalledWith("test1");
  });

  it("POST /tests/:testId/attempts/start — defaults flowMode when the test declares none", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    // clearAllMocks resets calls, not implementations — re-arm explicitly so the
    // previous case's pages do not leak in.
    storageMock.getContentPages.mockResolvedValue([]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(201);
    expect(res.body.flowMode).toBe("linear_flat");
    expect(res.body.contentPages).toEqual([]);
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

  it("POST /tests/:testId/attempts/start — carries section timeLimitMinutes into the variant (PRD-4 v1.1 §3.2)", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([
      { topicId: "t1", drawCount: 1, timeLimitMinutes: 15 },
      { topicId: "t2", drawCount: 1 }, // no per-topic limit -> null in variant
    ]);
    storageMock.getTopics.mockResolvedValue([
      { id: "t1", name: "JS" },
      { id: "t2", name: "TS" },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    const variant = storageMock.createAttempt.mock.calls[0][0].variantJson;
    expect(variant.sections[0].timeLimitMinutes).toBe(15);
    expect(variant.sections[1].timeLimitMinutes).toBeNull();
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

  // ── PRD-17 (BR-12): variants mode ──
  const FORM_SET = {
    forms: [
      { id: "v1", label: "Вариант 1", questionIds: ["q1", "q2"] },
      { id: "v2", label: "Вариант 2", questionIds: ["q3", "q4"] },
    ],
  };
  const bankQuestions = ["q1", "q2", "q3", "q4"].map((id) => ({ ...dbQuestion, id }));

  it("POST .../start — variants mode: delivers ONE variant whole and pins its formId (PRD-17 FR-04/08)", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 2, formSetJson: FORM_SET }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue(bankQuestions);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    const section = storageMock.createAttempt.mock.calls[0][0].variantJson.sections[0];
    const byForm: Record<string, string[]> = { v1: ["q1", "q2"], v2: ["q3", "q4"] };
    expect(["v1", "v2"]).toContain(section.formId);
    // whole variant delivered (presentation order is randomised → compare as a set)
    expect([...section.questionIds].sort()).toEqual(byForm[section.formId]);
  });

  it("POST .../start — variants mode: rotates away from a variant seen in a prior completed attempt (PRD-17 FR-07)", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { ...finishedAttempt, variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1", "q2"], formId: "v1" }] } },
    ]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 2, formSetJson: FORM_SET }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue(bankQuestions);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    const section = storageMock.createAttempt.mock.calls[0][0].variantJson.sections[0];
    expect(section.formId).toBe("v2"); // v1 excluded by rotation → only v2 remains
    expect([...section.questionIds].sort()).toEqual(["q3", "q4"]);
  });

  it("POST .../start — variants mode: drops a variant question no longer in the bank, no dup/pad (PRD-17 FR-17)", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    // Exclude v2 via history so v1 is chosen deterministically.
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { ...finishedAttempt, variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: [], formId: "v2" }] } },
    ]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 2, formSetJson: FORM_SET }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    // q2 removed from the topic bank.
    storageMock.getQuestionsByTopic.mockResolvedValue([
      { ...dbQuestion, id: "q1" }, { ...dbQuestion, id: "q3" }, { ...dbQuestion, id: "q4" },
    ]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    const section = storageMock.createAttempt.mock.calls[0][0].variantJson.sections[0];
    expect(section.formId).toBe("v1");
    expect(section.questionIds).toEqual(["q1"]); // q2 dropped; no duplication, no padding
  });
});

// PRD-4 v1.1 §3.2 — adaptive per-topic timer: topic exposure + force transition.
describe("Attempts routes — adaptive topic timer", () => {
  let app: express.Express;
  const adaptiveTest = { ...dbTest, mode: "adaptive" };
  const dbQuestion2 = { ...dbQuestion, id: "q2", topicId: "t2", prompt: "Q2?" };

  const makeAdaptiveVariant = () => ({
    mode: "adaptive",
    currentTopicIndex: 0,
    currentQuestionId: "q1",
    topics: [
      {
        topicId: "t1", topicName: "JS", currentLevelIndex: 0, finalLevelIndex: null,
        status: "in_progress", timeLimitMinutes: 5,
        levelsState: [{
          levelIndex: 0, levelName: "L1", questionIds: ["q1"], answeredQuestionIds: [],
          correctCount: 0, status: "in_progress", passThreshold: 50, passThresholdType: "percent",
        }],
      },
      {
        topicId: "t2", topicName: "TS", currentLevelIndex: 0, finalLevelIndex: null,
        status: "pending", timeLimitMinutes: null,
        levelsState: [{
          levelIndex: 0, levelName: "L1", questionIds: ["q2"], answeredQuestionIds: [],
          correctCount: 0, status: "pending", passThreshold: 50, passThresholdType: "percent",
        }],
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(learnerUser);
    app = makeApp(attemptsRouter);
  });

  it("POST start-adaptive — exposes current topic's topicId + sectionTimeLimitMinutes", async () => {
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      { topicId: "t1", levelIndex: 0, levelName: "L1", minDifficulty: 0, maxDifficulty: 100, questionsCount: 1, passThreshold: 50, passThresholdType: "percent" },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", timeLimitMinutes: 7 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue({ ...dbAttempt, id: "atmp-ad" });
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(201);
    expect(res.body.currentQuestion.topicId).toBe("t1");
    expect(res.body.currentQuestion.sectionTimeLimitMinutes).toBe(7);
  });

  it("POST expire-topic-adaptive — force-advances to the next topic", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, variantJson: makeAdaptiveVariant() });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion2]);
    storageMock.updateAttempt.mockResolvedValue({});
    const res = await asLearner(
      request(app).post("/api/attempts/atmp1/expire-topic-adaptive").send({ topicId: "t1" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.isFinished).toBe(false);
    expect(res.body.topicTransition.toTopic).toBe("TS");
    expect(res.body.nextQuestion.topicId).toBe("t2");
    const saved = storageMock.updateAttempt.mock.calls[0][1].variantJson;
    expect(saved.currentTopicIndex).toBe(1);
  });

  it("POST expire-topic-adaptive — idempotent re-sync when the topic already advanced", async () => {
    const variant = makeAdaptiveVariant();
    variant.currentTopicIndex = 1; // already moved on to t2
    variant.currentQuestionId = "q2";
    variant.topics[1].status = "in_progress";
    variant.topics[1].levelsState[0].status = "in_progress";
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, variantJson: variant });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion2]);
    const res = await asLearner(
      request(app).post("/api/attempts/atmp1/expire-topic-adaptive").send({ topicId: "t1" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.topicTransition).toBeNull();
    expect(res.body.nextQuestion.topicId).toBe("t2");
    expect(storageMock.updateAttempt).not.toHaveBeenCalled();
  });

  it("POST expire-topic-adaptive — finishes when the last topic expires", async () => {
    const variant = makeAdaptiveVariant();
    variant.currentTopicIndex = 1; // t2 is the last topic
    variant.currentQuestionId = "q2";
    variant.topics[1].status = "in_progress";
    variant.topics[1].levelsState[0].status = "in_progress";
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, variantJson: variant });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.updateAttempt.mockResolvedValue({});
    const res = await asLearner(
      request(app).post("/api/attempts/atmp1/expire-topic-adaptive").send({ topicId: "t2" }),
    );
    expect(res.status).toBe(200);
    expect(res.body.isFinished).toBe(true);
    expect(res.body.nextQuestion).toBeNull();
    expect(storageMock.updateAttempt.mock.calls[0][1].finishedAt).not.toBeNull();
  });

  it("POST expire-topic-adaptive — 403 for another user's attempt", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, userId: "other", variantJson: makeAdaptiveVariant() });
    const res = await asLearner(
      request(app).post("/api/attempts/atmp1/expire-topic-adaptive").send({ topicId: "t1" }),
    );
    expect(res.status).toBe(403);
  });
});

// Adaptive answering: level transitions and the final result build. Block D:
// grading goes through the test-effective scoring chain (FR-32/FR-34).
describe("Attempts routes — answer-adaptive", () => {
  let app: express.Express;
  const adaptiveTest = { ...dbTest, mode: "adaptive" };
  const dbQuestion2 = { ...dbQuestion, id: "q2", topicId: "t2", prompt: "Q2?" };

  // One topic, two 1-question levels (threshold 50% => 1 correct passes a level).
  const twoLevelVariant = () => ({
    mode: "adaptive",
    currentTopicIndex: 0,
    currentQuestionId: "q1",
    topics: [
      {
        topicId: "t1", topicName: "JS", currentLevelIndex: 0, finalLevelIndex: null,
        status: "in_progress", timeLimitMinutes: null,
        levelsState: [
          {
            levelIndex: 0, levelName: "База", questionIds: ["q1"], answeredQuestionIds: [],
            correctCount: 0, status: "in_progress", passThreshold: 50, passThresholdType: "percent",
          },
          {
            levelIndex: 1, levelName: "Профи", questionIds: ["q1b"], answeredQuestionIds: [],
            correctCount: 0, status: "pending", passThreshold: 50, passThresholdType: "percent",
          },
        ],
      },
    ],
  });

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(learnerUser);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    app = makeApp(attemptsRouter);
  });

  it("correct answer passes the level and moves UP to the pending level", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, answersJson: {}, variantJson: twoLevelVariant() });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getQuestionsByIds
      .mockResolvedValueOnce([dbQuestion]) // graded question
      .mockResolvedValue([{ ...dbQuestion, id: "q1b" }]); // next-level question
    storageMock.updateAttempt.mockResolvedValue({});

    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive")
      .send({ questionId: "q1", answer: 0 }));
    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(true);
    expect(res.body.levelTransition).toMatchObject({ type: "up", toLevel: "Профи" });
    expect(res.body.nextQuestion.id).toBe("q1b");
    expect(res.body.isFinished).toBe(false);
  });

  it("wrong answer on a started upper level moves DOWN to the pending lower one", async () => {
    const variant = twoLevelVariant();
    variant.currentTopicIndex = 0;
    variant.currentQuestionId = "q1b";
    variant.topics[0].currentLevelIndex = 1;
    variant.topics[0].levelsState[0].status = "pending"; // lower level untouched
    variant.topics[0].levelsState[1].status = "in_progress";
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, answersJson: {}, variantJson: variant });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getQuestionsByIds
      .mockResolvedValueOnce([{ ...dbQuestion, id: "q1b" }])
      .mockResolvedValue([dbQuestion]);
    storageMock.updateAttempt.mockResolvedValue({});

    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive")
      .send({ questionId: "q1b", answer: 1 })); // wrong
    expect(res.status).toBe(200);
    expect(res.body.isCorrect).toBe(false);
    expect(res.body.levelTransition).toMatchObject({ type: "down", toLevel: "База" });
    expect(res.body.nextQuestion.id).toBe("q1");
  });

  it("failing the lowest level of the last topic finishes and builds the adaptive result", async () => {
    const variant = twoLevelVariant();
    variant.topics[0].levelsState.splice(1); // single level, no way down
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, answersJson: {}, variantJson: variant });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([
      { topicId: "t1", failureFeedback: "Подтяните основы" },
    ]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      { id: "lvl-0", topicId: "t1", levelIndex: 0, levelName: "База", feedback: "ОС уровня" },
    ]);
    storageMock.updateAttempt.mockResolvedValue({});

    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive")
      .send({ questionId: "q1", answer: 1 })); // wrong
    expect(res.status).toBe(200);
    expect(res.body.isFinished).toBe(true);
    expect(res.body.result).toMatchObject({ mode: "adaptive", overallPassed: false });
    expect(res.body.result.topicResults[0]).toMatchObject({
      topicId: "t1", achievedLevelIndex: null, feedback: "Подтяните основы",
    });
    expect(storageMock.updateAttempt.mock.calls[0][1].finishedAt).not.toBeNull();
  });

  it("passing the only level of the last topic finishes with the achieved level and its links", async () => {
    const variant = twoLevelVariant();
    variant.topics[0].levelsState.splice(1);
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, answersJson: {}, variantJson: variant });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1", failureFeedback: null }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      { id: "lvl-0", topicId: "t1", levelIndex: 0, levelName: "База", feedback: "Молодец" },
    ]);
    storageMock.getAdaptiveLevelLinks.mockResolvedValue([{ title: "Курс", url: "https://x" }]);
    storageMock.updateAttempt.mockResolvedValue({});

    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive")
      .send({ questionId: "q1", answer: 0 })); // correct
    expect(res.status).toBe(200);
    expect(res.body.isFinished).toBe(true);
    expect(res.body.result.overallPassed).toBe(true);
    expect(res.body.result.topicResults[0]).toMatchObject({
      achievedLevelName: "База", feedback: "Молодец",
      recommendedLinks: [{ title: "Курс", url: "https://x" }],
    });
  });

  it("rejects an unexpected questionId (400) and a foreign attempt (403)", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, answersJson: {}, variantJson: twoLevelVariant() });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTestSections.mockResolvedValue([]);
    const bad = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive")
      .send({ questionId: "q-not-current", answer: 0 }));
    expect(bad.status).toBe(400);

    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, userId: "other", variantJson: twoLevelVariant() });
    const foreign = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive")
      .send({ questionId: "q1", answer: 0 }));
    expect(foreign.status).toBe(403);
  });

  // PRD-15 block D (FR-34): the start draw filters levels by the EFFECTIVE difficulty.
  it("start-adaptive picks questions into levels by the overridden difficulty", async () => {
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      { topicId: "t1", levelIndex: 0, levelName: "Профи", minDifficulty: 80, maxDifficulty: 100, questionsCount: 1, passThreshold: 50, passThresholdType: "percent" },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", timeLimitMinutes: null }]);
    // Base difficulty 50 would never reach the 80..100 level...
    storageMock.getQuestionsByTopic.mockResolvedValue([{ ...dbQuestion, difficulty: 50 }]);
    // ...but THIS test re-pins q1 to 85.
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { id: "ov1", testId: "test1", questionId: "q1", points: null, scoringJson: null, difficulty: 85, pinnedContentHash: null },
    ]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue({ ...dbAttempt, id: "atmp-ad" });

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(201);
    const saved = storageMock.createAttempt.mock.calls[0][0].variantJson;
    expect(saved.topics[0].levelsState[0].questionIds).toEqual(["q1"]);
  });

  it("start-adaptive leaves a level empty when no effective difficulty matches", async () => {
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      { topicId: "t1", levelIndex: 0, levelName: "Профи", minDifficulty: 80, maxDifficulty: 100, questionsCount: 1, passThreshold: 50, passThresholdType: "percent" },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", timeLimitMinutes: null }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([{ ...dbQuestion, difficulty: 50 }]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.createAttempt.mockResolvedValue({ ...dbAttempt, id: "atmp-ad" });

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(201);
    const saved = storageMock.createAttempt.mock.calls[0][0].variantJson;
    expect(saved.topics[0].levelsState[0].questionIds).toEqual([]);
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

  // PRD-24: a topic in variants mode is gated by the threshold of the variant the
  // learner actually got (pinned in variant_json.sections[].formId), not by a single
  // rule shared by all variants.
  describe("POST .../finish — by_variant thresholds (PRD-24)", () => {
    const byVariantSection = {
      topicId: "t1",
      topicPassRuleJson: {
        source: "by_variant",
        byForm: { fA: { type: "percent", value: 50 }, fB: { type: "percent", value: 100 } },
      },
    };
    const q2 = { ...dbQuestion, id: "q2" };
    /** 1 correct of 2 → topic percent = 50. Overall 40 so an unpinned attempt would pass. */
    const attemptWithForm = (formId: string) => ({
      ...dbAttempt,
      variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1", "q2"], formId }] },
    });

    beforeEach(() => {
      storageMock.getTest.mockResolvedValue({ ...dbTest, overallPassRuleJson: { type: "percent", value: 40 } });
      storageMock.getTestSections.mockResolvedValue([byVariantSection]);
      storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion, q2]);
      storageMock.getTopicCourses.mockResolvedValue([]);
      storageMock.updateAttempt.mockResolvedValue(finishedAttempt);
    });

    it("passes the topic when the delivered variant's threshold is met", async () => {
      storageMock.getAttempt.mockResolvedValue(attemptWithForm("fA"));
      const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
        .send({ answers: { q1: 0, q2: 1 } }));
      expect(res.status).toBe(200);
      expect(res.body.result.topicResults[0].passed).toBe(true); // 50% >= 50 (fA)
    });

    it("fails the topic when the delivered variant demands more, though another variant would pass", async () => {
      storageMock.getAttempt.mockResolvedValue(attemptWithForm("fB"));
      const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
        .send({ answers: { q1: 0, q2: 1 } }));
      expect(res.status).toBe(200);
      expect(res.body.result.topicResults[0].passed).toBe(false); // 50% < 100 (fB)
    });

    it("degrades to the overall rule for a legacy attempt without a pinned variant", async () => {
      storageMock.getAttempt.mockResolvedValue({
        ...dbAttempt,
        variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1", "q2"] }] },
      });
      const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
        .send({ answers: { q1: 0, q2: 1 } }));
      expect(res.status).toBe(200);
      expect(res.body.result.topicResults[0].passed).toBe(true); // 50% >= 40 (overall)
    });
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

  // PRD-15 block D (FR-32): the web grading resolves the per-test override chain.
  it("POST /attempts/:id/finish — grades with the per-test points override", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", topicPassRuleJson: null }]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]); // own points = 1
    storageMock.getTopicCourses.mockResolvedValue([]);
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { id: "ov1", testId: "test1", questionId: "q1", points: 10, scoringJson: null, difficulty: null, pinnedContentHash: null },
    ]);
    storageMock.updateAttempt.mockResolvedValue(finishedAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
      .send({ answers: { q1: 0 } }));
    expect(res.status).toBe(200);
    expect(res.body.result.totalEarnedPoints).toBe(10);
    expect(res.body.result.totalPossiblePoints).toBe(10);
  });

  it("POST /attempts/:id/finish — a controls_status result variable overrides the pass flag", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", topicPassRuleJson: null }]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    // PRD-2: the variable demands an unreachable percent, so success = false
    // even though the answer below is correct (parity with the SCORM runtime).
    storageMock.getResultVariables.mockResolvedValue([
      { id: "rv1", testId: "test1", name: "ok", label: "OK", type: "boolean",
        formula: "percent >= 200", controlsStatus: "success", learnerVisibility: "hidden",
        scormTarget: "both", sortOrder: 0 },
    ]);
    storageMock.updateAttempt.mockResolvedValue(finishedAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
      .send({ answers: { q1: 0 } }));
    expect(res.status).toBe(200);
    expect(res.body.result.resultVariables.ok).toBe(false);
    expect(res.body.result.overallPassed).toBe(false);
    expect(res.body.result.status).toEqual({ success: false });
    storageMock.getResultVariables.mockResolvedValue([]);
  });

  it("POST /attempts/:id/finish — absolute pass rules count correct answers", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue({
      ...dbTest, overallPassRuleJson: { type: "absolute", value: 1 },
    });
    storageMock.getTestSections.mockResolvedValue([{
      topicId: "t1", topicPassRuleJson: { type: "absolute", value: 1 },
    }]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    storageMock.updateAttempt.mockResolvedValue(finishedAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
      .send({ answers: { q1: 0 } }));
    expect(res.status).toBe(200);
    expect(res.body.result.topicResults[0].passed).toBe(true);
    expect(res.body.result.overallPassed).toBe(true);
  });

  it("POST /attempts/:id/finish — an explicit exact override shadows graded scoring", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", topicPassRuleJson: null }]);
    // The question itself grants partial credit for the wrong option...
    storageMock.getQuestionsByIds.mockResolvedValue([
      { ...dbQuestion, scoringJson: { kind: "weighted", weights: [2, 1] } },
    ]);
    storageMock.getTopicCourses.mockResolvedValue([]);
    // ...but THIS test overrides it back to exact 0/1.
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { id: "ov1", testId: "test1", questionId: "q1", points: null, scoringJson: { kind: "exact" }, difficulty: null, pinnedContentHash: null },
    ]);
    storageMock.updateAttempt.mockResolvedValue(finishedAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish")
      .send({ answers: { q1: 1 } })); // wrong option
    expect(res.status).toBe(200);
    expect(res.body.result.totalEarnedPoints).toBe(0);
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
    // POST goes through TestSettingsService; loadFullTest then re-reads the row.
    serviceMock.create.mockResolvedValue(dbTestFull);
    storageMock.getTest.mockResolvedValue(dbTestFull);
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelLinks.mockResolvedValue([]);
    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "Test 1",
      sections: [{ topicId: "t1", drawCount: 5 }],
      overallPassRuleJson: { type: "percent", value: 70 },
    }));
    expect(res.status).toBe(201);
    expect(serviceMock.create).toHaveBeenCalled();
  });

  it("POST / — returns 400 when title missing", async () => {
    const res = await asAuthor(request(app).post("/api/tests").send({ sections: [] }));
    expect(res.status).toBe(400);
  });

  it("PUT /:id — updates test", async () => {
    serviceMock.save.mockResolvedValue(dbTestFull);
    storageMock.getTest.mockResolvedValue(dbTestFull);
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelLinks.mockResolvedValue([]);
    const res = await asAuthor(request(app).put("/api/tests/test1").send({ title: "Updated" }));
    expect(res.status).toBe(200);
  });

  it("PUT /:id — returns 404 when not found", async () => {
    // The service throws a 404-tagged error when the row is absent.
    serviceMock.save.mockRejectedValue(Object.assign(new Error("Test not found"), { status: 404 }));
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
