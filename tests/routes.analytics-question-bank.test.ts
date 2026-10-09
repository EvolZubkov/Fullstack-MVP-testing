/**
 * @module tests/routes.analytics-question-bank
 * @description PRD-70 FR-13, FR-14: ручки оси банка вопросов — качество для дерева банка по тестам
 * читателя и ориентир сложности для ящика вопроса по всем тестам. Обе читают готовое.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock, refreshMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTests: vi.fn().mockResolvedValue([]),
    getQuestionsByIds: vi.fn(),
    getTopics: vi.fn(),
  },
  refreshMock: { testQualities: vi.fn(), testPools: vi.fn() },
}));
const statsMock = vi.hoisted(() => ({ bankQuestionStats: vi.fn() }));
const topicAccessMock = vi.hoisted(() => ({ visibleTopic: vi.fn() }));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/routes/analytics/suspicious-refresh", () => refreshMock);
vi.mock("../server/services/analytics/bank-question-stats", () => statsMock);
vi.mock("../server/services/topic-access", () => topicAccessMock);

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import questionBankRouter from "../server/routes/analytics/question-bank";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", questionBankRouter);
  return app;
}

const SUSPICIOUS = {
  questionId: "q1", flag: { tone: "error", title: "Сильные ошибаются чаще", detail: "" }, suspicious: true, rank: 1,
  enoughData: true, observations: 214, hardness: 42, delivered: 214, overexposure: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue({ id: "a1", name: "Автор", email: "a@b.c" });
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  refreshMock.testQualities.mockReturnValue([
    { testId: "t1", items: [SUSPICIOUS], pool: ["q1"], suspicious: 1, itemCount: 1 },
    { testId: "t2", items: [{ ...SUSPICIOUS, flag: null, suspicious: false, rank: 50, hardness: 39, observations: 412 }], pool: ["q1"], suspicious: 0, itemCount: 1 },
  ]);
  refreshMock.testPools.mockReturnValue(new Map([["t1", ["q1"]], ["t2", ["q1"]]]));
});

describe("GET /api/analytics/bank/quality", () => {
  it("сводит признаки вопроса по тестам читателя", async () => {
    const res = await request(makeApp()).get("/api/analytics/bank/quality").set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([expect.objectContaining({
      questionId: "q1",
      review: { tone: "error", title: "Сильные ошибаются чаще", tests: 1, of: 2, more: 0 },
      neverDelivered: false,
      testIds: ["t1", "t2"],
    })]);
  });

  it("автор видит только свои тесты", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["t2"]);

    const res = await request(makeApp()).get("/api/analytics/bank/quality").set("x-test-user", "a1");

    expect(res.body.questions[0]).toMatchObject({ review: null, testIds: ["t2"] });
  });

  it("без входа — отказ", async () => {
    expect((await request(makeApp()).get("/api/analytics/bank/quality")).status).toBe(401);
  });
});

describe("GET /api/analytics/questions/:id/difficulty-landmark", () => {
  it("ориентир — по всем тестам, взвешенно, без названий тестов", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue([]);

    const res = await request(makeApp())
      .get("/api/analytics/questions/q1/difficulty-landmark")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ landmark: { hardness: 40, tests: 2, observations: 626 } });
  });

  it("нет данных — ориентира нет", async () => {
    const res = await request(makeApp())
      .get("/api/analytics/questions/q9/difficulty-landmark")
      .set("x-test-user", "a1");

    expect(res.body).toEqual({ landmark: null });
  });
});

describe("GET /api/analytics/questions/:id", () => {
  beforeEach(() => {
    storageMock.getQuestionsByIds.mockResolvedValue([{ id: "q1", topicId: "tp1" }]);
    storageMock.getTopics.mockResolvedValue([{ id: "tp1", ownerId: "a1", visibility: "private" }]);
    topicAccessMock.visibleTopic.mockResolvedValue(true);
    statsMock.bankQuestionStats.mockResolvedValue({ question: { id: "q1" }, rows: [], versions: [], minObservations: 10 });
  });

  it("отдаёт статистику вопроса и передаёт редакцию из адреса (FR-10, FR-11)", async () => {
    const res = await request(makeApp()).get("/api/analytics/questions/q1?version=h-old").set("x-test-user", "a1");

    expect(res.status).toBe(200);
    expect(res.body.question.id).toBe("q1");
    expect(statsMock.bankQuestionStats).toHaveBeenCalledWith("q1", expect.any(Array), expect.any(Function), "h-old");
  });

  it("пустая редакция — серия «версия неизвестна»", async () => {
    await request(makeApp()).get("/api/analytics/questions/q1?version=").set("x-test-user", "a1");
    expect(statsMock.bankQuestionStats).toHaveBeenCalledWith("q1", expect.any(Array), expect.any(Function), null);
  });

  it("вопрос темы, которую читатель не видит, — 404 (FR-16)", async () => {
    topicAccessMock.visibleTopic.mockResolvedValue(false);
    const res = await request(makeApp()).get("/api/analytics/questions/q1").set("x-test-user", "a1");

    expect(res.status).toBe(404);
    expect(statsMock.bankQuestionStats).not.toHaveBeenCalled();
  });
});
