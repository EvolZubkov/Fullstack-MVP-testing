/**
 * Branch-coverage tests for server/routes/attempts.ts.
 *
 * The happy paths live in tests/routes.attempts-tests.test.ts; this file targets
 * the error/edge branches: 400/403/404 guards, retake-cooldown gates, adaptive
 * validation branches, the untested section-result endpoint, and every catch
 * block (500). The harness (mocks + app factory + fixtures) is copied from the
 * sibling test so the two files stay independent.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(), getTests: vi.fn(),
    getTestSections: vi.fn(),
    getAttempt: vi.fn(), createAttempt: vi.fn(), updateAttempt: vi.fn(),
    getAttemptsByUser: vi.fn(), getAttemptsByUserAndTest: vi.fn(),
    getUser: vi.fn(), getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getUsers: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([]), getQuestionsByTopic: vi.fn(),
    // «Оценивает ли тест хоть что-нибудь» для обложки списка (пусто = нет).
    getGradingTraitsByTopics: vi.fn().mockResolvedValue([]),
    getQuestionsByIds: vi.fn(), getTopicCourses: vi.fn().mockResolvedValue([]),
    getTopicEvents: vi.fn().mockResolvedValue([]),
    getAssignedTestsForUser: vi.fn(),
    // PRD-31: the assignment is the unit of access. These cases exercise the barriers
    // and the counter, not the assignment lookup, so every attempt lands in the
    // implicit legacy bucket (null) — which behaves as one assignment of its own.
    getCurrentAssignmentId: vi.fn().mockResolvedValue(null),
    getAdaptiveTopicSettingsByTest: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelsByTest: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelLinks: vi.fn().mockResolvedValue([]),
    getContentPages: vi.fn().mockResolvedValue([]),
    getTopic: vi.fn(),
    // PRD-15 block B: snapshot resolution for published tests / pinned attempts.
    getLatestSnapshot: vi.fn().mockResolvedValue(undefined),
    getSnapshot: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));

import attemptsRouter from "../server/routes/attempts";

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

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const dbTest = {
  id: "test1", title: "Test 1", mode: "standard", maxAttempts: null,
  timeLimitMinutes: null, showCorrectAnswers: false, version: 1,
  overallPassRuleJson: { type: "percent", value: 70 },
  createdAt: new Date(),
};
const adaptiveTest = { ...dbTest, mode: "adaptive", showDifficultyLevel: true };
const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "Q?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  difficulty: 50, shuffleAnswers: true, contentHash: "h1",
  feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
};
const dbAttempt = {
  id: "atmp1", userId: "learner1", testId: "test1", snapshotId: null,
  // PRD-31: a real row always carries the column; null = the implicit legacy bucket,
  // which is also what `getCurrentAssignmentId` returns in these tests. Leaving it
  // undefined would put the attempt in a DIFFERENT bucket than the current
  // assignment and quietly defeat the per-assignment counter.
  assignmentId: null,
  variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["q1"] }] },
  answersJson: {}, resultJson: null,
  startedAt: new Date(), finishedAt: null, testVersion: 1,
};
const finishedAttempt = {
  ...dbAttempt, finishedAt: new Date(),
  resultJson: { totalCorrect: 1, totalQuestions: 1, overallPercent: 100, overallPassed: true, topicResults: [] },
};

/** Minimal single-topic single-level adaptive variant (currentQuestionId=q1). */
function minimalAdaptiveVariant() {
  return {
    mode: "adaptive",
    currentTopicIndex: 0,
    currentQuestionId: "q1",
    topics: [
      {
        topicId: "t1", topicName: "JS", currentLevelIndex: 0, finalLevelIndex: null,
        status: "in_progress", timeLimitMinutes: null,
        levelsState: [{
          levelIndex: 0, levelName: "L1", questionIds: ["q1"], answeredQuestionIds: [],
          correctCount: 0, status: "in_progress", passThreshold: 50, passThresholdType: "percent",
        }],
      },
    ],
  };
}

/** A publication snapshot content blob good enough for a standard start draw. */
function snapshotContent(test: any) {
  return {
    test,
    sections: [{ topicId: "t1", drawCount: 1 }],
    topics: [{ id: "t1", name: "JS" }],
    questionsByTopic: { t1: [dbQuestion] },
    topicCoursesByTopic: {}, topicEventsByTopic: {},
    adaptiveSettings: [], adaptiveLevels: [], adaptiveLevelLinksByLevel: {},
    scales: [], measurements: [], resultVariables: [], contentPages: [],
    questionScoring: [],
  };
}

let app: express.Express;
beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(learnerUser);
  // `clearAllMocks` wipes CALLS, not implementations, so a per-case override of the
  // current assignment would leak into every later case and silently change which
  // bucket its attempts fall into. Restore the default (the legacy NULL bucket).
  storageMock.getCurrentAssignmentId.mockResolvedValue(null);
  app = makeApp(attemptsRouter);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /learner/tests
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /learner/tests — branches", () => {
  it("exposes a cooldown retakeGate and 'Unknown' topic fallback", async () => {
    const cooledTest = {
      ...dbTest,
      retakePolicyJson: { enabled: true, cooldownPeriodDays: 30 },
    };
    storageMock.getAssignedTestsForUser.mockResolvedValue([cooledTest]);
    // Section on a topic missing from getTopics -> topicName "Unknown".
    storageMock.getTopics.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 5 }]);
    // A completed attempt today keeps the 30-day cooldown active — but PRD-31 §3
    // scopes barrier A to the boundary BETWEEN assignments, so that attempt must
    // belong to the PREVIOUS one while the learner is now on a fresh assignment.
    storageMock.getCurrentAssignmentId.mockResolvedValue("a-new");
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      {
        ...finishedAttempt,
        assignmentId: "a-old",
        finishedAt: new Date(),
        resultJson: { overallPercent: 42, overallPassed: false, topicResults: [] },
      },
    ]);
    const res = await asLearner(request(app).get("/api/learner/tests"));
    expect(res.status).toBe(200);
    expect(res.body[0].sections[0].topicName).toBe("Unknown");
    expect(res.body[0].retakeGate).toMatchObject({ cooldownPeriodDays: 30 });
    expect(res.body[0].priorResult).toMatchObject({ percent: 42, passed: false });
  });

  it("отвечает, оценивает ли тест: измерительная методика — нет", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Стили" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 5 }]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getGradingTraitsByTopics.mockResolvedValue([
      { topicId: "t1", type: "allocation", correctJson: {} },
      { topicId: "t1", type: "scale", correctJson: {} },
    ]);
    const res = await asLearner(request(app).get("/api/learner/tests"));
    expect(res.status).toBe(200);
    expect(res.body[0].hasGradedContent).toBe(false);
  });

  it("один проверяемый вопрос в теме — тест оценивает", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([dbTest]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Стили" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 5 }]);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getGradingTraitsByTopics.mockResolvedValue([
      { topicId: "t1", type: "allocation", correctJson: {} },
      { topicId: "t1", type: "single", correctJson: { correctIndex: 0 } },
    ]);
    const res = await asLearner(request(app).get("/api/learner/tests"));
    expect(res.body[0].hasGradedContent).toBe(true);
  });

  it("returns 500 when the store throws", async () => {
    storageMock.getAssignedTestsForUser.mockRejectedValue(new Error("db down"));
    const res = await asLearner(request(app).get("/api/learner/tests"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch tests");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /tests/:testId/attempts/start
// ─────────────────────────────────────────────────────────────────────────────
describe("POST .../attempts/start — branches", () => {
  it("delivers a published test from its snapshot and echoes PRD-19 nav flags", async () => {
    const publishedTest = {
      ...dbTest, status: "published",
      allowReturnToUnanswered: false, allowAnswerChange: true, showSectionResults: false,
      flowPolicyJson: { mode: "linear_flat" },
    };
    storageMock.getTest.mockResolvedValue(publishedTest);
    storageMock.getLatestSnapshot.mockResolvedValue({ id: "snap1", contentJson: snapshotContent(publishedTest) });
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(201);
    expect(storageMock.getLatestSnapshot).toHaveBeenCalledWith("test1");
    expect(res.body.allowReturnToUnanswered).toBe(false);
    expect(res.body.allowAnswerChange).toBe(true);
    expect(res.body.showSectionResults).toBe(false);
  });

  it("falls back to live storage when a published test has no snapshot", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "published" });
    storageMock.getLatestSnapshot.mockResolvedValue(undefined);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(201);
    expect(storageMock.getLatestSnapshot).toHaveBeenCalled();
  });

  it("returns 403 RETAKE_COOLDOWN on the first attempt of a NEW assignment", async () => {
    storageMock.getTest.mockResolvedValue({
      ...dbTest, retakePolicyJson: { enabled: true, cooldownPeriodDays: 30 },
    });
    // PRD-31 §3: barrier A guards the boundary BETWEEN assignments — the recent
    // attempt belongs to the previous one, the learner is starting a fresh one.
    storageMock.getCurrentAssignmentId.mockResolvedValue("a-new");
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { ...finishedAttempt, assignmentId: "a-old", finishedAt: new Date() },
    ]);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RETAKE_COOLDOWN");
    expect(res.body.blockedBy).toBe("cooldown");
  });

  it("does NOT apply the cooldown to a repeat inside the SAME assignment", async () => {
    // The defect PRD-31 fixes: the learner still has attempts left in the assignment
    // they were given, so the between-assignments cooldown must not stop them.
    storageMock.getTest.mockResolvedValue({
      ...dbTest, maxAttempts: 3, retakePolicyJson: { enabled: true, cooldownPeriodDays: 30 },
    });
    storageMock.getCurrentAssignmentId.mockResolvedValue("a-1");
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { ...finishedAttempt, assignmentId: "a-1", finishedAt: new Date() },
    ]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(201);
  });

  it("pins a started attempt to the current assignment", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getCurrentAssignmentId.mockResolvedValue("a-42");
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([dbQuestion]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.createAttempt.mockResolvedValue(dbAttempt);
    await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(storageMock.createAttempt.mock.calls[0][0].assignmentId).toBe("a-42");
  });

  it("returns 500 when a store read throws", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to start attempt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /tests/:testId/attempts/start-adaptive
// ─────────────────────────────────────────────────────────────────────────────
describe("POST .../attempts/start-adaptive — branches", () => {
  it("returns 404 when the test is missing", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/tests/x/attempts/start-adaptive"));
    expect(res.status).toBe(404);
  });

  it("returns 403 RETAKE_COOLDOWN for an adaptive test on a new assignment", async () => {
    storageMock.getTest.mockResolvedValue({
      ...adaptiveTest, retakePolicyJson: { enabled: true, cooldownPeriodDays: 30 },
    });
    // Same framing as the standard start: barrier A is a between-assignments rule.
    storageMock.getCurrentAssignmentId.mockResolvedValue("a-new");
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([
      { ...finishedAttempt, assignmentId: "a-old", finishedAt: new Date() },
    ]);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("RETAKE_COOLDOWN");
  });

  it("returns 403 ATTEMPTS_EXHAUSTED when the adaptive cap is reached", async () => {
    storageMock.getTest.mockResolvedValue({ ...adaptiveTest, maxAttempts: 1 });
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([{ ...finishedAttempt }]);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ATTEMPTS_EXHAUSTED");
  });

  it("returns 400 when the test is not adaptive", async () => {
    storageMock.getTest.mockResolvedValue(dbTest); // standard
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This is not an adaptive test");
  });

  it("returns 400 when the adaptive test has no settings", async () => {
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1" }]);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Adaptive test has no settings configured");
  });

  it("returns 400 when a topic has no levels (no valid adaptive topics)", async () => {
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]); // topicLevels empty -> continue
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1" }]);
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("No valid adaptive topics configured");
  });

  it("leaves the level empty when a question has no difficulty (PRD-16)", async () => {
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      { topicId: "t1", levelIndex: 0, levelName: "L1", minDifficulty: 0, maxDifficulty: 100, questionsCount: 1, passThreshold: 50, passThresholdType: "percent" },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", timeLimitMinutes: null }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([{ ...dbQuestion, difficulty: null }]);
    storageMock.getQuestionsByIds.mockResolvedValue([]);
    storageMock.createAttempt.mockResolvedValue({ ...dbAttempt, id: "atmp-ad" });
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(201);
    expect(res.body.currentQuestion).toBeNull();
    const saved = storageMock.createAttempt.mock.calls[0][0].variantJson;
    expect(saved.topics[0].levelsState[0].questionIds).toEqual([]);
  });

  it("returns 500 when adaptive config read throws", async () => {
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getAdaptiveTopicSettingsByTest.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to start adaptive attempt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/answer-adaptive
// ─────────────────────────────────────────────────────────────────────────────
describe("POST .../answer-adaptive — branches", () => {
  it("returns 404 when the attempt is missing", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/x/answer-adaptive").send({ questionId: "q1", answer: 0 }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the attempt is already finished", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, finishedAt: new Date(), variantJson: minimalAdaptiveVariant() });
    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive").send({ questionId: "q1", answer: 0 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Attempt already finished");
  });

  it("returns 400 when the attempt is not adaptive", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, variantJson: { mode: "standard" } });
    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive").send({ questionId: "q1", answer: 0 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This is not an adaptive attempt");
  });

  it("returns 404 when the test is missing", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, variantJson: minimalAdaptiveVariant() });
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive").send({ questionId: "q1", answer: 0 }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Test not found");
  });

  it("returns 404 when the question is not found", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, variantJson: minimalAdaptiveVariant() });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([]); // no such question
    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive").send({ questionId: "q1", answer: 0 }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Question not found");
  });

  it("echoes correctAnswer/feedback when showCorrectAnswers is on (mid-level advance)", async () => {
    const variant = minimalAdaptiveVariant();
    // Two-question absolute-2 level -> a single correct answer stays in the level.
    variant.topics[0].levelsState[0] = {
      levelIndex: 0, levelName: "L1", questionIds: ["q1", "q1b"], answeredQuestionIds: [],
      correctCount: 0, status: "in_progress", passThreshold: 2, passThresholdType: "absolute",
    } as any;
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, answersJson: {}, variantJson: variant });
    storageMock.getTest.mockResolvedValue({ ...adaptiveTest, showCorrectAnswers: true });
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getQuestionsByIds
      .mockResolvedValueOnce([dbQuestion])
      .mockResolvedValue([{ ...dbQuestion, id: "q1b" }]);
    storageMock.updateAttempt.mockResolvedValue({});
    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive").send({ questionId: "q1", answer: 0 }));
    expect(res.status).toBe(200);
    expect(res.body.isFinished).toBe(false);
    expect(res.body.nextQuestion.id).toBe("q1b");
    expect(res.body.correctAnswer).toBeDefined();
  });

  it("returns 500 when the store throws", async () => {
    storageMock.getAttempt.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).post("/api/attempts/atmp1/answer-adaptive").send({ questionId: "q1", answer: 0 }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to process answer");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/expire-topic-adaptive
// ─────────────────────────────────────────────────────────────────────────────
describe("POST .../expire-topic-adaptive — branches", () => {
  it("returns 404 when the attempt is missing", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/x/expire-topic-adaptive").send({ topicId: "t1" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the attempt is not adaptive", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, variantJson: { mode: "standard" } });
    const res = await asLearner(request(app).post("/api/attempts/atmp1/expire-topic-adaptive").send({ topicId: "t1" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("This is not an adaptive attempt");
  });

  it("returns 404 when the test is missing", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, variantJson: minimalAdaptiveVariant() });
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/expire-topic-adaptive").send({ topicId: "t1" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Test not found");
  });

  it("is idempotent on an already-finished attempt", async () => {
    const done = { totalQuestions: 1, overallPassed: true, topicResults: [] };
    storageMock.getAttempt.mockResolvedValue({
      ...dbAttempt, finishedAt: new Date(), resultJson: done, variantJson: minimalAdaptiveVariant(),
    });
    storageMock.getTest.mockResolvedValue(adaptiveTest);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/expire-topic-adaptive").send({ topicId: "t1" }));
    expect(res.status).toBe(200);
    expect(res.body.isFinished).toBe(true);
    expect(res.body.result).toEqual(done);
    expect(storageMock.updateAttempt).not.toHaveBeenCalled();
  });

  it("returns 500 when the store throws", async () => {
    storageMock.getAttempt.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).post("/api/attempts/atmp1/expire-topic-adaptive").send({ topicId: "t1" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to expire topic");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/save-progress
// ─────────────────────────────────────────────────────────────────────────────
describe("POST .../save-progress — branches", () => {
  it("returns 400 when the attempt is already finished", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, finishedAt: new Date() });
    const res = await asLearner(request(app).post("/api/attempts/atmp1/save-progress").send({ answers: {} }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Attempt already finished");
  });

  it("persists shuffleMappings and questionStatus into the variant", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.updateAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/save-progress").send({
      answers: { q1: 0 }, currentIndex: 1,
      shuffleMappings: { q1: [1, 0] }, questionStatus: { q1: "answered" },
    }));
    expect(res.status).toBe(200);
    const savedVariant = storageMock.updateAttempt.mock.calls[0][1].variantJson;
    expect(savedVariant.shuffleMappings).toEqual({ q1: [1, 0] });
    expect(savedVariant.questionStatus).toEqual({ q1: "answered" });
  });

  it("returns 500 when the update throws", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.updateAttempt.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).post("/api/attempts/atmp1/save-progress").send({ answers: {} }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to save progress");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /tests/:testId/resume
// ─────────────────────────────────────────────────────────────────────────────
describe("GET .../resume — branches", () => {
  it("exposes correctJson when showCorrectAnswers is on", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, showCorrectAnswers: true });
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([dbAttempt]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asLearner(request(app).get("/api/tests/test1/resume"));
    expect(res.status).toBe(200);
    expect(res.body.hasInProgress).toBe(true);
    expect(res.body.attempt.questions[0].correctJson).toBeDefined();
  });

  it("returns 500 when the store throws", async () => {
    storageMock.getTest.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).get("/api/tests/test1/resume"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to resume attempt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/section-result (untested endpoint)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST .../section-result — branches", () => {
  it("computes a section verdict through the shared engine", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", topicPassRuleJson: { type: "percent", value: 70 } }]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/section-result")
      .send({ topicId: "t1", answers: { q1: 0 } }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ topicId: "t1", correct: 1, total: 1, percent: 100, passed: true });
  });

  it("returns 404 when the attempt is missing", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/x/section-result").send({ topicId: "t1" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for another user's attempt", async () => {
    storageMock.getAttempt.mockResolvedValue({ ...dbAttempt, userId: "other" });
    const res = await asLearner(request(app).post("/api/attempts/atmp1/section-result").send({ topicId: "t1" }));
    expect(res.status).toBe(403);
  });

  it("returns 400 when topicId is missing", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/section-result").send({ answers: {} }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("topicId required");
  });

  it("returns 404 when the topic is not in the attempt variant", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/section-result").send({ topicId: "tZ" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Section not found in attempt");
  });

  it("returns 404 when the test is missing", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/section-result").send({ topicId: "t1" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Test not found");
  });

  it("returns 500 when grading throws", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", topicPassRuleJson: null }]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    storageMock.getQuestionsByIds.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).post("/api/attempts/atmp1/section-result").send({ topicId: "t1", answers: {} }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to compute section result");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /attempts/:id/finish
// ─────────────────────────────────────────────────────────────────────────────
describe("POST .../finish — branches", () => {
  it("returns 404 when the test is missing", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish").send({ answers: {} }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Test not found");
  });

  it("returns 500 when persisting the result throws", async () => {
    storageMock.getAttempt.mockResolvedValue(dbAttempt);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", topicPassRuleJson: null }]);
    storageMock.getQuestionsByIds.mockResolvedValue([dbQuestion]);
    storageMock.getTestQuestionScoring.mockResolvedValue([]);
    storageMock.updateAttempt.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).post("/api/attempts/atmp1/finish").send({ answers: { q1: 0 } }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to finish attempt");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /attempts/:id/result
// ─────────────────────────────────────────────────────────────────────────────
describe("GET .../result — branches", () => {
  it("skips render and uses 'Unknown Test' when the test row is gone", async () => {
    // resultJson without a topicResults array -> render branch stays null.
    storageMock.getAttempt.mockResolvedValue({ ...finishedAttempt, resultJson: { overallPercent: 80 } });
    storageMock.getTest.mockResolvedValue(undefined);
    storageMock.getAttemptsByUserAndTest.mockResolvedValue([finishedAttempt]);
    const res = await asLearner(request(app).get("/api/attempts/atmp1/result"));
    expect(res.status).toBe(200);
    expect(res.body.testTitle).toBe("Unknown Test");
    expect(res.body.render).toBeNull();
    expect(res.body.canRetake).toBe(true);
  });

  it("returns 500 when the store throws", async () => {
    storageMock.getAttempt.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).get("/api/attempts/atmp1/result"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch result");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /learner/attempts
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /learner/attempts — branches", () => {
  it("computes delta/isOutdated/improvement and adaptive achievement", async () => {
    const newer = {
      ...finishedAttempt, id: "a-new", testVersion: 2, finishedAt: new Date("2026-06-02"),
      resultJson: { overallPercent: 80, overallPassed: true, totalEarnedPoints: 8, totalPossiblePoints: 10 },
    };
    const olderAdaptive = {
      ...finishedAttempt, id: "a-old", testVersion: 1, finishedAt: new Date("2026-06-01"),
      resultJson: { mode: "adaptive", overallPercent: 50, overallPassed: false,
        topicResults: [{ achievedLevelIndex: 1 }, { achievedLevelIndex: null }] },
    };
    storageMock.getAttemptsByUser.mockResolvedValue([olderAdaptive, newer]);
    storageMock.getTests.mockResolvedValue([{ ...dbTest, version: 2 }]);
    const res = await asLearner(request(app).get("/api/learner/attempts"));
    expect(res.status).toBe(200);
    const group = res.body[0];
    expect(group.attemptCount).toBe(2);
    expect(group.overallImprovement).toBe(30);
    // Sorted newest-first: index 0 is the newer attempt.
    expect(group.attempts[0].delta).toBe(30);
    expect(group.attempts[0].isOutdated).toBe(false);
    expect(group.attempts[1].delta).toBeNull();
    expect(group.attempts[1].isOutdated).toBe(true);
    expect(group.attempts[1].isAdaptive).toBe(true);
    expect(group.attempts[1].achievedCount).toBe(1);
    expect(group.attempts[1].totalTopics).toBe(2);
  });

  it("falls back to 'Unknown Test' when the test row is absent", async () => {
    storageMock.getAttemptsByUser.mockResolvedValue([finishedAttempt]);
    storageMock.getTests.mockResolvedValue([]); // empty map
    const res = await asLearner(request(app).get("/api/learner/attempts"));
    expect(res.status).toBe(200);
    expect(res.body[0].testTitle).toBe("Unknown Test");
    expect(res.body[0].currentVersion).toBe(1);
  });

  it("returns 500 when the store throws", async () => {
    storageMock.getAttemptsByUser.mockRejectedValue(new Error("boom"));
    const res = await asLearner(request(app).get("/api/learner/attempts"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch attempt history");
  });
});
