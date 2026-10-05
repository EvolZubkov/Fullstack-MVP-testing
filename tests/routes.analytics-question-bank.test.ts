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
  },
  refreshMock: { testQualities: vi.fn(), testPools: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/routes/analytics/suspicious-refresh", () => refreshMock);

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
