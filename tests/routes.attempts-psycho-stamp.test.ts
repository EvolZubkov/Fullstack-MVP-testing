/**
 * @module tests/routes.attempts-psycho-stamp
 * @description PRD-66 (FR-09b): веб-попытка запоминает, КАКУЮ РЕДАКЦИЮ задания видел участник.
 *
 * Штамп снимается в момент ВЫДАЧИ, а не в момент ответа, и это содержательное отличие. Веб
 * отдаёт содержание заданий один раз — на старте, — и дальше участник отвечает на то, что у него
 * уже на экране. Если автор правит задание посреди чужого прохождения, «текущая редакция в момент
 * ответа» назовёт ту, которой участник не видел, и наблюдение уйдёт не в свою серию. Редакция
 * выдачи называет ровно ту, на которую отвечали.
 *
 * Обвязка скопирована из tests/routes.attempts-exposure.test.ts, чтобы файлы оставались
 * независимыми.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import { computePsychoHash } from "@shared/questions/psycho-hash";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getAttempt: vi.fn(), updateAttempt: vi.fn(),
    getTopic: vi.fn().mockResolvedValue(null),
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

/** Задание банка; `psychoHash` передаётся отдельно, чтобы проверять и его отсутствие. */
function q(id: string, psychoHash: string | null = `hash-${id}`) {
  return {
    id, topicId: "t1", type: "single", prompt: id,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    difficulty: 50, shuffleAnswers: true, orderIndex: null,
    feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
    psychoHash,
  };
}

/** Форма, с которой попытка ушла в базу. */
function storedVariant(): any {
  return storageMock.createAttempt.mock.calls[0][0].variantJson;
}

/** Банк темы: и выдача, и последующее чтение выданного состава идут из него. */
function bank(...pool: ReturnType<typeof q>[]) {
  storageMock.getQuestionsByTopic.mockResolvedValue(pool);
  storageMock.getQuestionsByIds.mockImplementation(async (ids: string[]) =>
    pool.filter((item) => ids.includes(item.id)),
  );
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
  storageMock.getTopic.mockResolvedValue(null);
  storageMock.updateAttempt.mockImplementation(async (_id: string, patch: Record<string, unknown>) => patch);
  app = makeApp();
});

describe("старт попытки запоминает редакцию выданных заданий", () => {
  it("кладёт отпечаток каждого выданного задания в форму попытки", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 2 }]);
    bank(q("a"), q("b"));

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
    expect(storedVariant().psychoHashes).toEqual({ a: "hash-a", b: "hash-b" });
  });

  it("невыданное задание в форму не попадает", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    bank(q("a"), q("b"), q("c"));

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(Object.keys(storedVariant().psychoHashes)).toHaveLength(1);
  });

  it("задание без отпечатка получает его по содержанию, а не пустоту", async () => {
    // Так ведут себя снимок публикации, сделанный до появления колонки, и строка,
    // ещё не прошедшая засыпку: содержание на руках, значит отпечаток вычислим, и
    // серия наблюдений не теряется на ровном месте.
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    bank(q("a", null));

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(storedVariant().psychoHashes.a).toBe(
      computePsychoHash({
        type: "single", prompt: "a",
        dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
      }),
    );
  });
});

/** Попытка в работе с уже снятым штампом выдачи. */
function startedAttempt(psychoHashes: Record<string, string> | undefined) {
  return {
    id: "atmp1", userId: "learner1", testId: "test1", testVersion: 1, snapshotId: null,
    variantJson: {
      sections: [{ topicId: "t1", topicName: "JS", questionIds: ["a"] }],
      ...(psychoHashes ? { psychoHashes } : {}),
    },
    answersJson: null, resultJson: null, startedAt: new Date(), finishedAt: null,
  };
}

/** Форма, записанная при завершении попытки. */
function finishedVariant(): any {
  return storageMock.updateAttempt.mock.calls.at(-1)?.[1].variantJson;
}

async function finish(attempt: ReturnType<typeof startedAttempt>) {
  storageMock.getAttempt.mockResolvedValue(attempt);
  storageMock.getTest.mockResolvedValue(dbTest);
  storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", topicPassRuleJson: null }]);
  return asLearner(request(app).post("/api/attempts/atmp1/finish").send({ answers: { a: 0 } }));
}

describe("завершение попытки сверяет редакцию с выданной", () => {
  it("редакция та же — штамп выдачи сохраняется", async () => {
    bank(q("a"));

    const res = await finish(startedAttempt({ a: "hash-a" }));

    expect(res.status).toBe(200);
    expect(finishedVariant().psychoHashes).toEqual({ a: "hash-a" });
  });

  it("задание правили по ходу прохождения — штамп становится неизвестным", async () => {
    // Участник отвечал на одну редакцию, а к завершению задание стало другим. Такое
    // наблюдение не принадлежит чисто ни одной редакции: приписать его новой значит
    // испортить её статистику ответами, которых по ней не давали, а оставить за старой —
    // сделать вид, что правки не было. Обе серии его теряют, и это честно.
    bank(q("a", "hash-a-после-правки"));

    await finish(startedAttempt({ a: "hash-a" }));

    expect(finishedVariant().psychoHashes).toEqual({ a: null });
  });

  it("попытка, начатая до появления штампа, его не выдумывает", async () => {
    bank(q("a"));

    await finish(startedAttempt(undefined));

    expect(finishedVariant()).toBeUndefined();
  });
});
