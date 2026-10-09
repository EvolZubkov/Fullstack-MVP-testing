/**
 * @module tests/routes.attempts-exposure
 * @description PRD-55 (FR-01, FR-02, FR-07): старт веб-попытки пополняет счётчик выдач.
 *
 * Учитывается НАЧАТАЯ попытка со ВСЕМ выданным составом, а не отвеченные задания: брошенная
 * попытка показала содержание ровно так же, как доведённая до конца, и именно показ — предмет
 * учёта. Обвязка скопирована из tests/routes.attempts-question-order.test.ts, чтобы файлы
 * оставались независимыми.
 *
 * Отдельно проверяется, что сбой счётчика не роняет старт попытки: экспозиция — статистика, а
 * не условие прохождения, и участник не должен терять попытку из-за неё.
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
    recordDeliveries: vi.fn().mockResolvedValue(undefined),
    getDeliveryCounts: vi.fn().mockResolvedValue(new Map()),
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

function q(id: string) {
  return {
    id, topicId: "t1", type: "single", prompt: id,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    difficulty: 50, shuffleAnswers: true, orderIndex: null,
    feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  };
}

/** Аргументы единственного вызова счётчика. */
function recordedCall() {
  return storageMock.recordDeliveries.mock.calls[0];
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(learnerUser);
  storageMock.getUserRoles.mockResolvedValue(["learner"]);
  storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
  storageMock.getContentPages.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
  storageMock.recordDeliveries.mockResolvedValue(undefined);
  storageMock.getDeliveryCounts.mockResolvedValue(new Map());
  storageMock.createAttempt.mockResolvedValue({
    id: "atmp1", userId: "learner1", testId: "test1",
    variantJson: { sections: [] }, answersJson: {}, resultJson: null,
    startedAt: new Date(), finishedAt: null, testVersion: 1,
  });
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  app = makeApp();
});

describe("старт попытки пополняет счётчик выдач", () => {
  it("передаёт ВСЕ выданные задания и id теста", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 3 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("a"), q("b"), q("c")]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
    expect(storageMock.recordDeliveries).toHaveBeenCalledTimes(1);
    const [questionIds, testId, at] = recordedCall();
    expect([...questionIds].sort()).toEqual(["a", "b", "c"]);
    expect(testId).toBe("test1");
    expect(at).toBeInstanceOf(Date);
  });

  it("невыданное задание в счётчик не идёт", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("a"), q("b"), q("c")]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    const [questionIds] = recordedCall();
    expect(questionIds).toHaveLength(1);
  });

  it("сбой счётчика не роняет старт попытки", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("a")]);
    storageMock.recordDeliveries.mockRejectedValue(new Error("база недоступна"));

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
  });
});
