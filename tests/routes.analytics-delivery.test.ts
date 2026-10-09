/**
 * @module tests/routes.analytics-delivery
 * @description PRD-56 FR-18 - FR-20: ручка вкладки «Выдача».
 *
 * Сами расчёты проверены на сервисе (`delivery-stats`); здесь — то, что относится к ручке:
 * состав ответа, выбор темы профиля и права.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { observationsDouble } from "./helpers/observations-double";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(), getTests: vi.fn().mockResolvedValue([]),
    getTestSections: vi.fn(),
    getTopics: vi.fn(),
    getSnapshotsForTest: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getTestQuestionScoring: vi.fn(),
    getDeliveryCountsForTest: vi.fn(),
    getAdaptiveLevelsByTest: vi.fn().mockResolvedValue([]),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import deliveryRouter from "../server/routes/analytics/delivery";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
};

/** Веб-попытка с пином варианта: ровно та форма, в какой её пишет старт попытки. */
function attempt(formId: string | null, passed: boolean, id: string) {
  return {
    id,
    userId: `u-${id}`,
    testId: "test1",
    snapshotId: "snap-2",
    variantJson: {
      sections: [{
        topicId: "tp-1",
        questionIds: ["q1"],
        ...(formId ? { formId } : {}),
      }],
    },
    resultJson: {
      overallPercent: passed ? 80 : 50,
      overallPassed: passed,
      totalPossiblePoints: 20,
      totalEarnedPoints: passed ? 16 : 10,
    },
    startedAt: new Date(),
    finishedAt: new Date(),
  };
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", deliveryRouter);
  return app;
}

const ask = (query = "") =>
  request(makeApp()).get(`/api/analytics/tests/test1/delivery${query}`).set("x-test-user", "a1");

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "a1", name: "Автор", email: "a@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTestSections.mockResolvedValue([
    {
      id: "s1", testId: "test1", topicId: "tp-1", drawCount: 2, drawAll: false,
      formSetJson: { forms: [
        { id: "form-a", label: "Форма A", questionIds: ["q1"] },
        { id: "form-b", label: "Форма B", questionIds: ["q2"] },
      ] },
    },
    { id: "s2", testId: "test1", topicId: "tp-2", drawCount: 1, drawAll: false, formSetJson: null },
  ]);
  storageMock.getTopics.mockResolvedValue([
    { id: "tp-1", name: "Право и комплаенс" },
    { id: "tp-2", name: "Охрана труда" },
  ]);
  storageMock.getSnapshotsForTest.mockResolvedValue([
    { id: "snap-1", version: 1, publishedAt: new Date("2026-01-02T00:00:00Z") },
    { id: "snap-2", version: 2, publishedAt: new Date("2026-07-01T00:00:00Z") },
  ]);
  storageMock.getQuestionsByTopic.mockResolvedValue([
    { id: "q1", prompt: "Первый", type: "single", topicId: "tp-1", tags: ["Антикоррупция"] },
    { id: "q2", prompt: "Второй", type: "single", topicId: "tp-1", tags: [] },
  ]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 8]]));
  storageMock.getAllAttempts.mockResolvedValue([]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
});

describe("GET /api/analytics/tests/:testId/delivery", () => {
  it("отдаёт варианты по разделам, версии и профиль экспозиции", async () => {
    storageMock.getAllAttempts.mockResolvedValue([
      attempt("form-a", true, "a1"),
      attempt("form-b", false, "a2"),
    ]);

    const res = await ask();

    expect(res.status).toBe(200);
    // Раздел без набора форм в таблицу вариантов не попадает: вариантов у него нет.
    expect(res.body.variants).toHaveLength(1);
    expect(res.body.variants[0].topicName).toBe("Право и комплаенс");
    expect(res.body.variants[0].rows.map((r: { label: string; attempts: number }) => [r.label, r.attempts]))
      .toEqual([["Форма A", 1], ["Форма B", 1]]);
    expect(res.body.versions.map((r: { version: number | null }) => r.version)).toEqual([2, 1]);
    expect(res.body.exposure[0].topicId).toBe("tp-1");
  });

  it("малая выборка печатает счёт, но не долю", async () => {
    // Порог наблюдений — десять; двух прохождений мало для любого вывода о варианте.
    storageMock.getAllAttempts.mockResolvedValue([attempt("form-a", true, "a1")]);

    const res = await ask();

    expect(res.body.variants[0].rows[0]).toMatchObject({
      attempts: 1, passRate: null, lowSample: true,
    });
    expect(res.body.minObservations).toBe(10);
  });

  it("профиль — по каждому разделу, в порядке разделов (решение владельца 2026-10-04)", async () => {
    const res = await ask();

    expect(res.body.exposure.map((p: { topicId: string; topicName: string }) => [p.topicId, p.topicName]))
      .toEqual([["tp-1", "Право и комплаенс"], ["tp-2", "Охрана труда"]]);
    expect(res.body.topics).toBeUndefined();
    // Раздел с вариантами квоту не читает; второй — со случайной выборкой одного задания.
    expect(res.body.exposure[0]).toMatchObject({ drawMode: "forms", drawCount: null });
    expect(res.body.exposure[1]).toMatchObject({ drawMode: "quota", drawCount: 1 });
  });

  it("у адаптивного теста квоты нет: вопросы выбирает уровень", async () => {
    storageMock.getTest.mockResolvedValue({ ...TEST, mode: "adaptive" });
    const res = await ask();

    expect(res.body.exposure[1]).toMatchObject({ drawMode: "adaptive", drawCount: null });
  });

  it("сбой счётчиков выдач не роняет экран", async () => {
    storageMock.getDeliveryCountsForTest.mockRejectedValue(new Error("база недоступна"));

    const res = await ask();

    expect(res.status).toBe(200);
    // Без счётчиков весь банк выглядит невыданным — это честнее выдуманных долей.
    expect(res.body.exposure[0].neverDelivered).toBe(2);
  });

  it("банк профиля — пул выдачи: исключённый вопрос не считается ни банком, ни простоем", async () => {
    // Решение владельца 2026-09-26: то же определение пула, что у «Качества вопросов» и проверки
    // публикации. q2 исключён и не выдавался — выдать его тест не может.
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "q2", excludedFromDelivery: true },
    ]);

    const res = await ask();

    expect(res.body.exposure[0].bankSize).toBe(1);
    expect(res.body.exposure[0].neverDelivered).toBe(0);
  });

  it("у раздела с вариантами банк профиля — вопросы вариантов", async () => {
    storageMock.getQuestionsByTopic.mockResolvedValue([
      { id: "q1", prompt: "Первый", type: "single", topicId: "tp-1", tags: [] },
      { id: "q2", prompt: "Второй", type: "single", topicId: "tp-1", tags: [] },
      { id: "q3", prompt: "Вне вариантов", type: "single", topicId: "tp-1", tags: [] },
    ]);

    const res = await ask();

    expect(res.body.exposure[0].bankSize).toBe(2);
    expect(res.body.exposure[0].neverDelivered).toBe(1);
  });

  it("несуществующий тест — 404", async () => {
    storageMock.getTest.mockResolvedValue(undefined);

    expect((await ask()).status).toBe(404);
  });
});
