/**
 * @module tests/routes.attempts-question-order
 * @description PRD-30 Э3: the web attempt builder delivers a topic's questions
 * in the author's order when the section runs in `fixed` mode.
 *
 * The three delivery paths of `server/routes/attempts.ts` are asserted through
 * the variant the route persists (`createAttempt.variantJson`), because that
 * array IS the delivery order — the web host renders it as given:
 *   1. plain draw          → ordered by `questions.order_index` (FR-03/04)
 *   2. variants (PRD-17)   → ordered by the VARIANT'S OWN LIST, index ignored (FR-07)
 *   3. adaptive levels     → ordered inside each level, level composition intact (§6.3)
 *
 * The banks below are handed to the route pre-sorted by index (that is what
 * `getQuestionsByTopic` now returns, PRD-30 FR-08) and every scenario delivers
 * the WHOLE bank, so the assertions test ordering alone — never the random
 * selection that precedes it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(), getTestSections: vi.fn(),
    getAttemptsByUserAndTest: vi.fn().mockResolvedValue([]),
    // PRD-31: the start routes pin the attempt to the CURRENT assignment;
    // `null` = the legacy bucket.
    getCurrentAssignmentId: vi.fn().mockResolvedValue(null),
    createAttempt: vi.fn(),
    getUser: vi.fn(), getUserRoles: vi.fn().mockResolvedValue(["learner"]),
    getTopics: vi.fn(), getQuestionsByTopic: vi.fn(), getQuestionsByIds: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(), getAdaptiveLevelsByTest: vi.fn(),
    getContentPages: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getTopicCourses: vi.fn().mockResolvedValue([]),
    getTopicEvents: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import attemptsRouter from "../server/routes/attempts";

const learnerUser = {
  id: "learner1", email: "l@test.com", name: "Learner", role: "learner",
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
  app.use("/api", attemptsRouter);
  return app;
}

const asLearner = (req: request.Test) => req.set("x-test-user", "learner1");

const dbTest = {
  id: "test1", title: "Test 1", mode: "standard", maxAttempts: null,
  timeLimitMinutes: null, showCorrectAnswers: false, version: 1,
  overallPassRuleJson: { type: "percent", value: 70 },
  createdAt: new Date(),
};

/** Bank question; `orderIndex` is the author's index inside the topic. */
function q(id: string, orderIndex: number | null, difficulty = 50) {
  return {
    id, topicId: "t1", type: "single", prompt: id,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    difficulty, shuffleAnswers: true, orderIndex,
    feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  };
}

/** Ids of the questions the route persisted for the first topic of the variant. */
function deliveredIds(): string[] {
  return storageMock.createAttempt.mock.calls[0][0].variantJson.sections[0].questionIds;
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(learnerUser);
  storageMock.getUserRoles.mockResolvedValue(["learner"]);
  storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
  storageMock.getContentPages.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
  storageMock.createAttempt.mockResolvedValue({
    id: "atmp1", userId: "learner1", testId: "test1",
    variantJson: { sections: [] }, answersJson: {}, resultJson: null,
    startedAt: new Date(), finishedAt: null, testVersion: 1,
  });
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  app = makeApp();
});

describe("start attempt — plain draw (PRD-30 FR-03/FR-04)", () => {
  // The bank arrives pre-sorted (10, 20, unset) — delivery must preserve it.
  const bank = [q("first", 10), q("second", 20), q("noIndex", null)];

  it("fixed: delivers the whole topic in index order, unindexed last", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([
      { topicId: "t1", drawCount: 3, questionOrder: "fixed" },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue(bank);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
    expect(deliveredIds()).toEqual(["first", "second", "noIndex"]);
  });

  it("fixed: an order-only rule — the whole bank is delivered, just sorted", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([
      { topicId: "t1", drawCount: 3, questionOrder: "fixed" },
    ]);
    // Bank handed in deliberately scrambled: sorting is the route's job.
    storageMock.getQuestionsByTopic.mockResolvedValue([bank[2], bank[1], bank[0]]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(deliveredIds()).toEqual(["first", "second", "noIndex"]);
  });

  it("random (default): the section without the setting keeps today's behaviour", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 3 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue(bank);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    // Order is random, so only the SET is asserted — the point is that a legacy
    // section still delivers every question and nothing throws on the missing column.
    expect(deliveredIds().slice().sort()).toEqual(["first", "noIndex", "second"]);
  });
});

describe("start attempt — variants mode (PRD-30 FR-07)", () => {
  it("fixed: the variant's own list is the order; order_index is ignored", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([
      {
        topicId: "t1", drawCount: 3, questionOrder: "fixed",
        // The variant lists c, a, b — deliberately AGAINST the indices below.
        formSetJson: { forms: [{ id: "f1", label: "Вариант 1", questionIds: ["c", "a", "b"] }] },
      },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("a", 10), q("b", 20), q("c", 30)]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(deliveredIds()).toEqual(["c", "a", "b"]);
  });

  it("fixed: a question dropped from the bank falls out without shifting the rest", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([
      {
        topicId: "t1", drawCount: 3, questionOrder: "fixed",
        formSetJson: { forms: [{ id: "f1", label: "Вариант 1", questionIds: ["c", "gone", "b"] }] },
      },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("b", 20), q("c", 30)]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(deliveredIds()).toEqual(["c", "b"]);
  });

  it("random: the variant is still shuffled — pre-PRD-30 behaviour is intact", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([
      {
        topicId: "t1", drawCount: 3,
        formSetJson: { forms: [{ id: "f1", label: "Вариант 1", questionIds: ["a", "b", "c"] }] },
      },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("a", 10), q("b", 20), q("c", 30)]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(deliveredIds().slice().sort()).toEqual(["a", "b", "c"]);
  });
});

describe("start adaptive — ordering inside a level (PRD-30 §6.3)", () => {
  /** Ids of the questions the route put into the level at `levelIndex`. */
  function levelIds(levelIndex: number): string[] {
    const variant = storageMock.createAttempt.mock.calls[0][0].variantJson;
    const level = variant.topics[0].levelsState.find(
      (l: { levelIndex: number }) => l.levelIndex === levelIndex,
    );
    return level.questionIds;
  }

  beforeEach(() => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, mode: "adaptive" });
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      {
        topicId: "t1", levelIndex: 0, levelName: "Лёгкий", minDifficulty: 0, maxDifficulty: 40,
        questionsCount: 2, passThreshold: 70, passThresholdType: "percent",
      },
      {
        topicId: "t1", levelIndex: 1, levelName: "Сложный", minDifficulty: 60, maxDifficulty: 100,
        questionsCount: 2, passThreshold: 70, passThresholdType: "percent",
      },
    ]);
  });

  it("fixed: each level is delivered in index order, levels stay separate", async () => {
    storageMock.getTestSections.mockResolvedValue([
      { topicId: "t1", drawCount: 4, questionOrder: "fixed" },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([
      q("easy1", 10, 20), q("easy2", 20, 30),
      q("hard1", 10, 80), q("hard2", 20, 90),
    ]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));

    expect(res.status).toBe(201);
    expect(levelIds(0)).toEqual(["easy1", "easy2"]);
    expect(levelIds(1)).toEqual(["hard1", "hard2"]);
  });

  it("random (default): composition of the level is unchanged", async () => {
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 4 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([
      q("easy1", 10, 20), q("easy2", 20, 30),
      q("hard1", 10, 80), q("hard2", 20, 90),
    ]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));

    expect(levelIds(0).slice().sort()).toEqual(["easy1", "easy2"]);
    expect(levelIds(1).slice().sort()).toEqual(["hard1", "hard2"]);
  });
});
