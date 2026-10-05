/**
 * @module tests/routes.analytics-attention
 * @description PRD-56 FR-10, FR-11: ручка очереди «требует внимания».
 *
 * Правила отбора проверены на сервисе; здесь — то, что относится к ручке: область видимости,
 * подпись теста и счётчики рядом с позициями.
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
    getTests: vi.fn(), getTest: vi.fn(),
    getAllAssignments: vi.fn(),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([]),
    getTopicIdsByOwner: vi.fn().mockResolvedValue([]),
    getActiveTopicGrantsForGrantees: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import attentionRouter from "../server/routes/analytics/attention";
// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { refreshSuspicious, resetSuspiciousEntries } from "../server/routes/analytics/suspicious-refresh";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard", maxAttempts: 3,
  overallPassRuleJson: { type: "percent", value: 70 },
};
const OTHER_TEST = { ...TEST, id: "test2", title: "Чужой тест" };

const daysAgo = (days: number) => new Date(Date.now() - days * 24 * 60 * 60 * 1000);

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", attentionRouter);
  return app;
}

const ask = () => request(makeApp()).get("/api/analytics/attention").set("x-test-user", "a1");

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u2", name: "Сафин Ильдар", email: "s@b.c" });
  storageMock.getTests.mockResolvedValue([TEST, OTHER_TEST]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getAllAssignments.mockResolvedValue([]);
  resetSuspiciousEntries();
});

describe("GET /api/analytics/attention", () => {
  it("собирает просроченные назначения и подписывает тест", async () => {
    storageMock.getAllAssignments.mockResolvedValue([
      { id: "a1", testId: "test1", userId: "u2", groupId: null, dueDate: daysAgo(3) },
    ]);

    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      kind: "overdue",
      participant: "Сафин Ильдар",
      testTitle: "Сертификация",
    });
    expect(res.body.counts.overdue).toBe(1);
  });

  it("не показывает дела по тестам вне области видимости", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]);
    storageMock.getAllAssignments.mockResolvedValue([
      { id: "a1", testId: "test1", userId: "u2", groupId: null, dueDate: daysAgo(3) },
      { id: "a2", testId: "test2", userId: "u2", groupId: null, dueDate: daysAgo(3) },
    ]);

    const res = await ask();

    expect(res.body.items.map((item: { testId: string }) => item.testId)).toEqual(["test1"]);
  });

  it("ставит в очередь не сдавшего и считает его в своей корзине", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "web-1", testId: "test1", userId: "u1",
      startedAt: daysAgo(5), finishedAt: daysAgo(5),
      variantJson: {}, answersJson: {},
      resultJson: { overallPercent: 40, overallPassed: false, totalPossiblePoints: 20, totalEarnedPoints: 8 },
    }]);

    const res = await ask();

    expect(res.body.counts).toMatchObject({ failed: 1, overdue: 0 });
    expect(res.body.items[0].observationId).toBe("web-1");
  });

  it("несёт порог теста: без него процент прохождения не с чем сравнить", async () => {
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "web-1", testId: "test1", userId: "u1",
      startedAt: daysAgo(5), finishedAt: daysAgo(5),
      variantJson: {}, answersJson: {},
      resultJson: { overallPercent: 58, overallPassed: false, totalPossiblePoints: 20, totalEarnedPoints: 12 },
    }]);

    const res = await ask();

    // «58 %» само по себе не говорит, насколько человек промахнулся: у одного теста это
    // почти порог, у другого — половина требуемого.
    expect(res.body.items[0]).toMatchObject({ percent: 58, threshold: 70, attemptLimit: 3 });
  });

  it("не выдумывает порога там, где тест его не объявил", async () => {
    storageMock.getTests.mockResolvedValue([
      { ...TEST, overallPassRuleJson: { type: "none", value: 0 } },
    ]);
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "web-1", testId: "test1", userId: "u1",
      startedAt: daysAgo(5), finishedAt: daysAgo(5),
      variantJson: {}, answersJson: {},
      resultJson: { mode: "adaptive", overallPassed: false, topicResults: [] },
    }]);

    const res = await ask();

    expect(res.body.items[0].threshold).toBeNull();
  });

  it("отвечает пустой очередью, когда дел нет", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    expect(res.body.counts).toEqual({ overdue: 0, failed: 0, abandoned: 0, exhausted: 0 });
  });
});

/** Период вкладки (решение владельца 2026-09-25): по умолчанию месяц. */
// Э3.4: корзина «Тесты с вопросами под подозрением» — из фонового пересчёта.
describe("GET /api/analytics/attention — тесты с вопросами под подозрением (Э3.4)", () => {
  beforeEach(async () => {
    storageMock.getAllAttempts.mockResolvedValue(["test1", "test2"].map(testId => ({
      id: `web-${testId}`, testId, userId: "u1",
      startedAt: daysAgo(5), finishedAt: daysAgo(5), variantJson: {}, answersJson: {},
      resultJson: { overallPercent: 80, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 16 },
    })));
    await refreshSuspicious(
      async testId => ({ testId, items: [], pool: [], suspicious: testId === "test1" ? 8 : 2, itemCount: 42 }),
      async () => [],
    );
  });

  it("называет тесты с числом под подозрением, больше — выше", async () => {
    const res = await ask();
    expect(res.body.suspiciousTests.map((t: { testId: string; count: number }) => [t.testId, t.count]))
      .toEqual([["test1", 8], ["test2", 2]]);
    expect(res.body.suspiciousTests[0]).toMatchObject({ title: "Сертификация", items: 42, passages: 1 });
    expect(typeof res.body.suspiciousTests[0].computedAt).toBe("string");
  });

  it("чужие тесты не называет", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]);
    const res = await ask();
    expect(res.body.suspiciousTests.map((t: { testId: string }) => t.testId)).toEqual(["test1"]);
  });
});

describe("GET /api/analytics/attention — период", () => {
  const assignments = [
    { id: "a1", testId: "test1", userId: "u2", groupId: null, dueDate: daysAgo(3) },
    { id: "a2", testId: "test1", userId: "u1", groupId: null, dueDate: daysAgo(20) },
    { id: "a3", testId: "test1", userId: "u3", groupId: null, dueDate: daysAgo(60) },
  ];

  it("по умолчанию — за месяц: срок два месяца назад не попадает", async () => {
    storageMock.getAllAssignments.mockResolvedValue(assignments);
    const res = await ask();
    expect(res.body.period).toBe("month");
    expect(res.body.counts.overdue).toBe(2);
  });

  it("за неделю — только свежие дела", async () => {
    storageMock.getAllAssignments.mockResolvedValue(assignments);
    const res = await request(makeApp()).get("/api/analytics/attention?period=week").set("x-test-user", "a1");
    expect(res.body.period).toBe("week");
    expect(res.body.counts.overdue).toBe(1);
  });

  it("за квартал — все три", async () => {
    storageMock.getAllAssignments.mockResolvedValue(assignments);
    const res = await request(makeApp()).get("/api/analytics/attention?period=quarter").set("x-test-user", "a1");
    expect(res.body.counts.overdue).toBe(3);
  });

  it("неизвестный период — умолчание, а не ошибка", async () => {
    storageMock.getAllAssignments.mockResolvedValue(assignments);
    const res = await request(makeApp()).get("/api/analytics/attention?period=year").set("x-test-user", "a1");
    expect(res.body.period).toBe("month");
  });
});

// PRD-70 FR-60: «Вопросы банка на ревизию» — признак хотя бы в одном тесте читателя, только
// вопросы тем, которыми читатель управляет.
describe("GET /api/analytics/attention — вопросы банка на ревизию (PRD-70 FR-60)", () => {
  const KEY = { tone: "error", title: "Сильные ошибаются чаще", detail: "" };
  const EASY = { tone: "warning", title: "Слишком лёгкий", detail: "" };
  /** Вопрос в тесте из фонового пересчёта. */
  const item = (questionId: string, flag: unknown) => ({
    questionId, flag, suspicious: flag !== null, rank: flag === KEY ? 1 : 7, enoughData: true, observations: 100,
    hardness: 40, delivered: 100, drawMode: "quota", sharePercent: 50, expectedPercent: 40, overexposure: null,
  });

  beforeEach(async () => {
    storageMock.getAllAttempts.mockResolvedValue(["test1", "test2"].map(testId => ({
      id: `web-${testId}`, testId, userId: "u1",
      startedAt: daysAgo(5), finishedAt: daysAgo(5), variantJson: {}, answersJson: {},
      resultJson: { overallPercent: 80, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 16 },
    })));
    await refreshSuspicious(
      async testId => ({
        testId,
        items: testId === "test1" ? [item("q1", EASY), item("q2", KEY)] : [item("q1", null)],
        pool: ["q1", "q2"],
        suspicious: testId === "test1" ? 2 : 0,
        itemCount: 2,
      }),
      async () => [],
    );
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "Что считается подарком?", topicId: "tp-own", promptFormat: "plain" },
      { id: "q2", prompt: "Какой срок хранения журнала?", topicId: "tp-other", promptFormat: "plain" },
    ]);
    storageMock.getTopics.mockResolvedValue([{ id: "tp-own", name: "Право и комплаенс" }, { id: "tp-other", name: "Охрана труда" }]);
  });

  it("администратору — все вопросы на ревизии; прямые дефекты — выше", async () => {
    const res = await ask();
    expect(res.body.bankReview.map((r: { questionId: string }) => r.questionId)).toEqual(["q2", "q1"]);
    expect(res.body.bankReview[1]).toMatchObject({
      prompt: "Что считается подарком?",
      topicName: "Право и комплаенс",
      review: { title: "Слишком лёгкий", tests: 1, of: 2 },
    });
  });

  it("автору — только вопросы тем, которыми он управляет", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1", "test2"]);
    storageMock.getTopicIdsByOwner.mockResolvedValue(["tp-own"]);

    const res = await ask();

    expect(res.body.bankReview.map((r: { questionId: string }) => r.questionId)).toEqual(["q1"]);
  });

  it("грант «использовать» темой не управляет, «управлять» — управляет", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1", "test2"]);
    storageMock.getTopicIdsByOwner.mockResolvedValue([]);
    storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([
      { topicId: "tp-own", accessLevel: "use" },
      { topicId: "tp-other", accessLevel: "manage" },
    ]);

    const res = await ask();

    expect(res.body.bankReview.map((r: { questionId: string }) => r.questionId)).toEqual(["q2"]);
  });
});
