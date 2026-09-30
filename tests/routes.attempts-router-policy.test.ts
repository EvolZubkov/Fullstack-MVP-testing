/**
 * @module tests/routes.attempts-router-policy
 * @description PRD-4 v1.1 §4.7 — what the WEB run receives about the router.
 *
 * The web learner host builds its hub from the attempt payload; the SCORM package
 * builds the same hub from `TEST_DATA`. Everything the shared rules read has to reach
 * BOTH, and it used not to: the payload carried the raw `flowMode` and nothing else,
 * so on the web a section locked behind a prerequisite was open, «Завершить» under
 * `all_required_passed` unlocked as soon as the sections were merely finished, and an
 * OPTIONAL section blocked finishing altogether.
 *
 * Asserted on the START response and on the variant the route persists — those two are
 * the whole of what the host gets.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(), getTestSections: vi.fn(),
    getAttemptsByUserAndTest: vi.fn().mockResolvedValue([]),
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

const UNLOCK_RULES = { t2: { mode: "after_sections_completed", sectionIds: ["t1"] } };

function testRow(flowPolicyJson: unknown) {
  return {
    id: "test1", title: "Test 1", mode: "standard", maxAttempts: null,
    timeLimitMinutes: null, showCorrectAnswers: false, version: 1,
    overallPassRuleJson: { type: "percent", value: 70 },
    flowPolicyJson,
    createdAt: new Date(),
  };
}

function q(id: string, topicId: string) {
  return {
    id, topicId, type: "single", prompt: id,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    difficulty: 50, shuffleAnswers: true, orderIndex: 1,
    feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  };
}

/** The variant the route persisted. */
function persistedVariant(): any {
  return storageMock.createAttempt.mock.calls[0][0].variantJson;
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(learnerUser);
  storageMock.getUserRoles.mockResolvedValue(["learner"]);
  storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
  storageMock.getContentPages.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([
    { id: "t1", name: "О компании" },
    { id: "t2", name: "Финансы" },
  ]);
  storageMock.getQuestionsByTopic.mockImplementation(async (topicId: string) => [q(`${topicId}-q`, topicId)]);
  storageMock.createAttempt.mockResolvedValue({
    id: "atmp1", userId: "learner1", testId: "test1",
    variantJson: { sections: [] }, answersJson: {}, resultJson: null,
    startedAt: new Date(), finishedAt: null, testVersion: 1,
  });
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  app = makeApp();
});

describe("start attempt — router gating reaches the web host", () => {
  it("delivers the unlock rules and the completion policy of a router test", async () => {
    // The shape the EDITOR stores: the router's settings nested under `router`.
    storageMock.getTest.mockResolvedValue(
      testRow({
        mode: "router_by_topics",
        router: {
          completionPolicy: "all_required_passed",
          sectionUnlockRules: UNLOCK_RULES,
        },
      }),
    );
    storageMock.getTestSections.mockResolvedValue([
      { topicId: "t1", drawCount: 1 },
      { topicId: "t2", drawCount: 1 },
    ]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
    expect(res.body.flowMode).toBe("router_by_topics");
    expect(res.body.routerPolicy).toEqual({
      completionPolicy: "all_required_passed",
      sectionUnlockRules: UNLOCK_RULES,
    });
  });

  it("defaults a router test without authored gating to the softer policy and no rules", async () => {
    // What the editor saves for a router test the author never gated.
    storageMock.getTest.mockResolvedValue(
      testRow({
        mode: "router_by_topics",
        router: { completionPolicy: "all_required_completed", sectionUnlockRules: {} },
      }),
    );
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.body.routerPolicy).toEqual({
      completionPolicy: "all_required_completed",
      sectionUnlockRules: {},
    });
  });

  // Outside router mode the fields describe a screen the run never reaches.
  it("omits routerPolicy entirely for a non-router test", async () => {
    storageMock.getTest.mockResolvedValue(
      testRow({
        mode: "linear_by_topics",
        router: { completionPolicy: "all_required_passed", sectionUnlockRules: UNLOCK_RULES },
      }),
    );
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.body.flowMode).toBe("linear_by_topics");
    expect("routerPolicy" in res.body).toBe(false);
  });

  // The bake clamps an unreadable mode to linear_flat (FR-40); the web must agree,
  // or the same test runs as two different tests.
  it("clamps an unknown mode to linear_flat, exactly as the package bake does", async () => {
    storageMock.getTest.mockResolvedValue(testRow({ mode: "from_the_future" }));
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.body.flowMode).toBe("linear_flat");
  });
});

describe("start attempt — the section intro's pass condition reaches the web host", () => {
  it("resolves each delivered topic's rule and the delivered points, with the policy", async () => {
    storageMock.getTest.mockResolvedValue({
      ...testRow({ mode: "linear_by_topics" }),
      passDecisionPolicy: "required_topics_only",
    });
    storageMock.getTestSections.mockResolvedValue([
      { topicId: "t1", drawCount: 1, topicPassRuleJson: { source: "custom", type: "absolute", value: 1 } },
      { topicId: "t2", drawCount: 1, required: false, topicPassRuleJson: { source: "inherit_overall" } },
    ]);
    storageMock.getQuestionsByIds.mockImplementation(async (ids: string[]) =>
      ids.map((id) => q(id, id.split("-")[0])),
    );

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
    expect(res.body.passDecisionPolicy).toBe("required_topics_only");
    expect(res.body.sectionConditions).toEqual({
      // One delivered question at the system default price of 1 point.
      t1: { passRule: { type: "count", value: 1 }, possiblePoints: 1, required: true },
      t2: { passRule: { type: "percent", value: 70 }, possiblePoints: 1, required: false },
    });
  });
});

describe("start attempt — section obligation reaches the web host", () => {
  it("carries `required` per delivered section, optional stays optional", async () => {
    storageMock.getTest.mockResolvedValue(testRow({ mode: "router_by_topics" }));
    storageMock.getTestSections.mockResolvedValue([
      { topicId: "t1", drawCount: 1 },
      { topicId: "t2", drawCount: 1, required: false },
    ]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    const sections = persistedVariant().sections;
    expect(sections.map((s: any) => [s.topicId, s.required])).toEqual([
      ["t1", true],
      ["t2", false],
    ]);
  });
});
