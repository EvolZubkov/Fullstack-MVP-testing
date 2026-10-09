/**
 * @module tests/routes.attempts-question-time
 * @description PRD-66 FR-37a: веб-попытка хранит время, проведённое на каждом задании.
 *
 * Время — материал анализа пунктов: оно отличает задание, над которым думают, от того, что
 * пролистывают не читая. Пакет мерил его с 2026-09-12, веб не мерил вовсе, и половина
 * наблюдений приходила без этой величины.
 *
 * Хранится в форме попытки, рядом с составом выдачи и штампами редакций: карта ответов —
 * плоская «задание -> значение ответа», и второй величине в ней места нет.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAttempt: vi.fn(), updateAttempt: vi.fn(),
    getUser: vi.fn(), getUserRoles: vi.fn().mockResolvedValue(["learner"]),
    getTestSections: vi.fn().mockResolvedValue([]),
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

const attempt = {
  id: "atmp1", userId: "learner1", testId: "test1", testVersion: 1, snapshotId: null,
  variantJson: { sections: [{ topicId: "t1", topicName: "JS", questionIds: ["a"] }] },
  answersJson: null, resultJson: null, startedAt: new Date(), finishedAt: null,
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

const save = (body: object) =>
  request(makeApp()).post("/api/attempts/atmp1/save-progress").set("x-test-user", "learner1").send(body);

/** Форма, записанная последним сохранением. */
function storedVariant(): any {
  return storageMock.updateAttempt.mock.calls.at(-1)?.[1].variantJson;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(learnerUser);
  storageMock.getUserRoles.mockResolvedValue(["learner"]);
  storageMock.getAttempt.mockResolvedValue(attempt);
  storageMock.updateAttempt.mockImplementation(async (_id: string, patch: Record<string, unknown>) => patch);
});

describe("сохранение прогресса несёт время на заданиях", () => {
  it("кладёт время в форму попытки", async () => {
    const res = await save({ answers: { a: 0 }, currentIndex: 1, latencyMs: { a: 7000 } });

    expect(res.status).toBe(200);
    expect(storedVariant().latencyMs).toEqual({ a: 7000 });
  });

  it("сохранение без времени прежде измеренное не стирает", async () => {
    // Старый клиент поля не шлёт вовсе, и молчание не должно означать «обнулить».
    storageMock.getAttempt.mockResolvedValue({
      ...attempt,
      variantJson: { ...attempt.variantJson, latencyMs: { a: 7000 } },
    });

    await save({ answers: { a: 0 }, currentIndex: 1 });

    expect(storedVariant().latencyMs).toEqual({ a: 7000 });
  });

  it("не принимает нечисловое и отрицательное время", async () => {
    // Значение приходит от клиента, как и у пакета. Отсеивается то, что не может быть
    // измерением: подделка чисел в ту или другую сторону — отдельный разговор, а мусор в
    // выборке отравил бы медиану времени молча.
    const res = await save({
      answers: { a: 0 },
      currentIndex: 1,
      latencyMs: { a: 7000, b: "долго", c: -5, d: Number.NaN },
    });

    expect(res.status).toBe(200);
    expect(storedVariant().latencyMs).toEqual({ a: 7000 });
  });
});

describe("сохранение прогресса несёт состояние хаба роутера", () => {
  it("кладёт состояние хаба в форму попытки, отсекая то, чем оно быть не может", async () => {
    await save({
      answers: {},
      currentIndex: 0,
      routerState: {
        topicStates: { t1: "completed", t2: "inProgress", t3: "notStarted", t4: 7 },
        committed: { t1: true, t2: "yes" },
        current: null,
      },
    });

    expect(storedVariant().routerState).toEqual({
      topicStates: { t1: "completed", t2: "inProgress" },
      committed: { t1: true },
      current: null,
    });
  });

  it("сохранение без состояния хаба прежнее не стирает", async () => {
    const routerState = { topicStates: { t1: "completed" }, committed: { t1: true }, current: null };
    storageMock.getAttempt.mockResolvedValue({ ...attempt, variantJson: { ...attempt.variantJson, routerState } });

    await save({ answers: {}, currentIndex: 0 });

    expect(storedVariant().routerState).toEqual(routerState);
  });
});
