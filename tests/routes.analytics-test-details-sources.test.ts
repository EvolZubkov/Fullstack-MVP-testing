/**
 * @module tests/routes.analytics-test-details-sources
 * @description PRD-56 FR-25: экран теста считает ВСЕ свои блоки по всем источникам.
 *
 * Плитки перевели на слой наблюдений первыми, и на живом экране стало видно расхождение
 * внутри одной страницы: «18 прохождений» в плитке и гистограмма, построенная по пятнадцати
 * веб-попыткам. Распределение и динамика не требуют ответов на вопросы — только процент и
 * даты, — поэтому считаются оттуда же, откуда плитки.
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
    getTest: vi.fn(), getTopics: vi.fn(), getQuestionsByIds: vi.fn(),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    getScales: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(), selectAnswersForTest: vi.fn(),
    // План оргструктуры: хранящиеся написания оргполей.
    selectOrgSpellings: vi.fn().mockResolvedValue({
      organization: [], unit: ["Отдел продаж", "ОТДЕЛ ПРОДАЖ"], position: [],
    }),
    // PRD-55: экспозиция и время задания — их читает та же ручка.
    getDeliveryCountsForTest: vi.fn(), getDeliveryCounts: vi.fn(),
    getOtherTestsCount: vi.fn(), getLatencyStats: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import testDetailsRouter from "../server/routes/analytics/test-details";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics/tests", testDetailsRouter);
  return app;
}

const recently = (daysAgo: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u1", name: "Морозова Анна", email: "a@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTopics.mockResolvedValue([]);
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.selectAnswersForTest.mockResolvedValue([]);
  for (const fn of [storageMock.getDeliveryCountsForTest, storageMock.getDeliveryCounts,
    storageMock.getOtherTestsCount, storageMock.getLatencyStats]) {
    fn.mockResolvedValue(new Map());
  }
  storageMock.getAllAttempts.mockResolvedValue([{
    id: "web-1", testId: "test1", userId: "u1",
    startedAt: recently(2), finishedAt: recently(2),
    variantJson: { sections: [] }, answersJson: {},
    resultJson: { overallPercent: 25, overallPassed: false, totalPossiblePoints: 20, totalEarnedPoints: 5 },
  }]);
  storageMock.getAllScormAttempts.mockResolvedValue([{
    id: "lms-1", testId: "test1", packageId: null, origin: "telemetry",
    userId: null, participantKey: null, groupId: null, lmsUserId: "lms-1", lmsUserName: "Пётр",
    startedAt: recently(1), finishedAt: recently(1),
    resultPercent: 95, resultPassed: true, maxPoints: 20, totalPoints: 19,
  }]);
});

describe("GET /api/analytics/tests/:testId — оргусловия (FR-06b)", () => {
  it("считает «Обзор» по отобранному подразделению, а не по всему тесту", async () => {
    await request(makeApp())
      .get(`/api/analytics/tests/test1?unit=${encodeURIComponent("отдел продаж")}`)
      .set("x-test-user", "a1");

    const query = storageMock.selectObservations.mock.calls[0][0];
    expect(query.orgValues).toEqual({ unit: ["Отдел продаж", "ОТДЕЛ ПРОДАЖ"] });
  });
});

describe("GET /api/analytics/tests/:testId — «Прохождения с ошибкой» (Э3.1)", () => {
  it("считает «Обзор» по прохождениям с ошибкой на вопросе, а не по всему тесту", async () => {
    const res = await request(makeApp())
      .get("/api/analytics/tests/test1?wrongQuestionId=q1")
      .set("x-test-user", "a1");

    expect(res.status).toBe(200);
    // Ответов с ошибкой в двойнике нет: отбор поимённый и пустой — ни одного прохождения.
    const narrowed = storageMock.selectObservations.mock.calls
      .map(call => call[0])
      .find(query => query.attemptIds !== undefined);
    expect(narrowed?.attemptIds).toEqual([]);
    expect(res.body.summary.completedAttempts).toBe(0);
  });
});

describe("GET /api/analytics/tests/:testId — блоки экрана", () => {
  it("строит распределение результатов по всем источникам", async () => {
    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    expect(res.status).toBe(200);
    const byLabel = Object.fromEntries(
      res.body.scoreDistribution.map((b: { label: string; count: number }) => [b.label, b.count]),
    );
    expect(byLabel["20–29"]).toBe(1);
    expect(byLabel["90–100"]).toBe(1);
  });

  it("красит корзины распределения по проходному баллу", async () => {
    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const buckets = res.body.scoreDistribution as Array<{ label: string; tone: string }>;
    expect(buckets.find(b => b.label === "20–29")?.tone).toBe("error");
    expect(buckets.find(b => b.label === "90–100")?.tone).toBe("success");
  });

  it("называет проходной балл числом, а не границей корзины", async () => {
    // Приёмка Э4: клиент выводил порог из `from` жёлтой корзины и подписывал «порог 70 %»
    // там, где он 75 — вертикаль вставала на границе, а не на своём месте.
    storageMock.getTest.mockResolvedValue({
      ...TEST, overallPassRuleJson: { type: "percent", value: 75 },
    });

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    expect(res.body.thresholdPercent).toBe(75);
  });

  it("не рисует порога, заданного в баллах", async () => {
    // Сколько это процентов — зависит от достижимых баллов прохождения, а они у разных
    // вариантов выдачи разные: одна вертикаль показала бы линию, которой ни для кого нет.
    storageMock.getTest.mockResolvedValue({
      ...TEST, overallPassRuleJson: { type: "count", value: 14 },
    });

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const buckets = res.body.scoreDistribution as Array<{ tone: string; holdsThreshold: boolean }>;
    expect(buckets.every(b => b.tone === "neutral")).toBe(true);
    expect(buckets.some(b => b.holdsThreshold)).toBe(false);
  });

  it("строит динамику по всем источникам", async () => {
    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const total = res.body.passTrend.reduce((sum: number, d: { attempts: number }) => sum + d.attempts, 0);
    expect(total).toBe(2);
  });

  it("считает статистику вопроса по ответам обоих источников", async () => {
    // Веб ответил верно, LMS — неверно. Пока страница читала одни веб-попытки, у вопроса
    // значилось «100 % верных» — при том, что половина отвечавших ошиблась.
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "Вопрос", type: "single", topicId: "t1", difficulty: 50,
        optionsJson: ["а", "б"], correctJson: { correctIndex: 0 } },
    ]);
    storageMock.getAllAttempts.mockResolvedValue([{
      id: "web-1", testId: "test1", userId: "u1",
      startedAt: recently(2), finishedAt: recently(2),
      variantJson: { sections: [{ questionIds: ["q1"] }] },
      answersJson: { q1: 0 },
      resultJson: { overallPercent: 100, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 20 },
    }]);
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "q1", result: "incorrect", latencyMs: 42_000, origin: "telemetry" },
    ]);

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const question = res.body.questionStats.find((q: { questionId: string }) => q.questionId === "q1");
    expect(question).toMatchObject({ totalAnswers: 2, correctAnswers: 1, correctPercent: 50 });
  });

  it("не теряет вопрос, который встречался только в прохождениях из LMS", async () => {
    // Набор вопросов собирался из вариантов веб-попыток: заданий, выданных только в пакете,
    // в нём нет — и их ответы отбрасывались молча.
    storageMock.getQuestionsByIds.mockImplementation(async (ids: string[]) =>
      ids.map(id => ({
        id, prompt: "Вопрос " + id, type: "single", topicId: "t1", difficulty: 50,
        optionsJson: ["а", "б"], correctJson: { correctIndex: 0 },
      })));
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "only-lms", result: "correct", latencyMs: null, origin: "import" },
    ]);

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    expect(res.body.questionStats.map((q: { questionId: string }) => q.questionId))
      .toContain("only-lms");
  });

  it("считает долю пропусков по выданным, но не отвеченным заданиям", async () => {
    // Пропуск — это выданное задание БЕЗ ответа. Состав выдачи известен у веб-попытки
    // (`variantJson`), поэтому доля считается по ней: пакет состава по попытке не сообщает.
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "В1", type: "single", topicId: "t1", difficulty: 50, tags: [], correctJson: { correctIndex: 0 } },
      { id: "q2", prompt: "В2", type: "single", topicId: "t1", difficulty: 50, tags: [], correctJson: { correctIndex: 0 } },
    ]);
    const attempt = (id: string, answers: Record<string, number>) => ({
      id, testId: "test1", userId: id,
      startedAt: recently(2), finishedAt: recently(2),
      variantJson: { sections: [{ questionIds: ["q1", "q2"] }] },
      answersJson: answers,
      resultJson: { overallPercent: 50, overallPassed: false, totalPossiblePoints: 2, totalEarnedPoints: 1 },
    });
    // q1 отвечен в обеих попытках, q2 — только в одной: половина выдач пропущена.
    storageMock.getAllAttempts.mockResolvedValue([
      attempt("a1", { q1: 0, q2: 0 }),
      attempt("a2", { q1: 0 }),
    ]);

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const byId = Object.fromEntries(
      res.body.questionStats.map((q: { questionId: string }) => [q.questionId, q]),
    );
    expect(byId.q1).toMatchObject({ deliveredWeb: 2, skippedWeb: 0, skipShare: 0 });
    expect(byId.q2).toMatchObject({ deliveredWeb: 2, skippedWeb: 1, skipShare: 50 });
  });

  it("метит задание, у которого сошлись признаки ревизии", async () => {
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "В1", type: "single", topicId: "t1", difficulty: 50, tags: [], correctJson: { correctIndex: 0 } },
    ]);
    // Двенадцать ответов мимо — выше порога наблюдений, доля верных 0 %.
    storageMock.selectAnswersForTest.mockResolvedValue(
      Array.from({ length: 12 }, (_, i) => ({
        questionId: "q1", attemptId: `lms-${i}`, result: "incorrect",
        latencyMs: 3_000, points: 0, maxPoints: 1, origin: "telemetry",
      })),
    );
    storageMock.getLatencyStats.mockResolvedValue(
      new Map([["q1", { medianMs: 3_000, sampleSize: 12 }]]),
    );

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const question = res.body.questionStats.find((q: { questionId: string }) => q.questionId === "q1");
    // FR-16: признак назван словами и несёт числа, которые его вызвали.
    expect(question.reviewFlags[0].kind).toBe("fast-and-wrong");
    expect(question.reviewFlags[0].reason).toMatch(/не читают/);
  });

  it("говорит, что задание исключено из выдачи", async () => {
    // PRD-56 FR-17a: состояние видно там же, где назначено — в таблице заданий аналитики.
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "В1", type: "single", topicId: "t1", difficulty: 50, tags: [], correctJson: { correctIndex: 0 } },
    ]);
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "q1", attemptId: "lms-1", result: "correct", latencyMs: null, points: 1, maxPoints: 1, origin: "telemetry" },
    ]);
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "q1", excludedFromDelivery: true },
    ]);

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const question = res.body.questionStats.find((q: { questionId: string }) => q.questionId === "q1");
    expect(question.excludedFromDelivery).toBe(true);
  });

  it("не считает измерительный ответ ни верным, ни неверным", async () => {
    storageMock.getQuestionsByIds.mockResolvedValue([
      { id: "q1", prompt: "Шкальный", type: "scale", topicId: "t1", difficulty: 50 },
    ]);
    storageMock.selectAnswersForTest.mockResolvedValue([
      { questionId: "q1", result: "neutral", latencyMs: null, origin: "telemetry" },
      { questionId: "q1", result: "neutral", latencyMs: null, origin: "telemetry" },
    ]);

    const res = await request(makeApp()).get("/api/analytics/tests/test1").set("x-test-user", "a1");

    const question = res.body.questionStats.find((q: { questionId: string }) => q.questionId === "q1");
    // Доля верных у опросника не «ноль», а «неприменимо»: эталона у него нет (PRD-26 FR-08).
    expect(question).toMatchObject({ totalAnswers: 2, gradedAnswers: 0, correctPercent: null });
  });
});
