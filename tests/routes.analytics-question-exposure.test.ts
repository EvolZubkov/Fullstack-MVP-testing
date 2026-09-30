/**
 * @module tests/routes.analytics-question-exposure
 * @description PRD-55 (FR-31, FR-31a, FR-32): аналитика теста отдаёт по каждому заданию
 * экспозицию, показы в других тестах и медиану времени.
 *
 * Отдельная проверка нужна из-за ПУСТЫХ значений. «Счётчик пуст» и «ноль показов» — разные
 * утверждения, и если маршрут отдаст ноль вместо `null`, экран честно нарисует «0%» там, где
 * данных нет вовсе, а отличить это от действительно невыдаваемого задания будет нельзя.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import { observationsDouble } from "./helpers/observations-double";
import express from "express";
import session from "express-session";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getAllAttempts: vi.fn(),
    // PRD-56 FR-33: страница теста читает прохождения через выборку DAL.
    selectObservations: vi.fn(),
    // PRD-56 FR-25: ответы прохождений из LMS — часть выборки страницы теста.
    selectAnswersForTest: vi.fn().mockResolvedValue([]),
    getTestSections: vi.fn().mockResolvedValue([]),
    getTopics: vi.fn().mockResolvedValue([{ id: "t1", name: "Финансы" }]),
    getQuestionsByIds: vi.fn(),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getDeliveryCountsForTest: vi.fn(),
    getDeliveryCounts: vi.fn(),
    getOtherTestsCount: vi.fn(),
    getLatencyStats: vi.fn(),
    getAllScormAttempts: vi.fn().mockResolvedValue([]),
    getScormPackages: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import testDetailsRouter from "../server/routes/analytics/test-details";

const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "administrator",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => { req.session.userId = "author1"; next(); });
  app.use("/api/analytics", testDetailsRouter);
  return app;
}

const dbTest = {
  id: "test1", title: "Тест", mode: "standard", version: 1,
  overallPassRuleJson: { type: "percent", value: 70 },
  createdAt: new Date(),
};

const question = (id: string) => ({
  id, topicId: "t1", type: "single", prompt: `Вопрос ${id}`,
  dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
  difficulty: 50, tags: [],
});

/** Одна завершённая попытка с ответами на оба задания. */
const attempt = (id: string) => ({
  id, userId: `u-${id}`, testId: "test1", snapshotId: null,
  variantJson: { sections: [{ topicId: "t1", questionIds: ["q1", "q2"] }] },
  answersJson: { q1: { index: 0 }, q2: { index: 1 } },
  resultJson: { totalCorrect: 1, totalQuestions: 2, overallPercent: 50, overallPassed: false, topicResults: [] },
  startedAt: new Date("2026-09-01T10:00:00"),
  finishedAt: new Date("2026-09-01T10:10:00"),
  testVersion: 1,
});

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTest.mockResolvedValue(dbTest);
  storageMock.getAllAttempts.mockResolvedValue([attempt("a1"), attempt("a2")]);
  // `clearAllMocks` подставленных значений не сбрасывает: без этой строки прохождения из LMS
  // одного теста перетекали бы в следующие.
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getQuestionsByIds.mockResolvedValue([question("q1"), question("q2")]);
  storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 2 }]);
  storageMock.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 46]]));
  storageMock.getDeliveryCounts.mockResolvedValue(new Map([["q1", 318]]));
  storageMock.getOtherTestsCount.mockResolvedValue(new Map([["q1", 2]]));
  storageMock.getLatencyStats.mockResolvedValue(new Map([["q1", { medianMs: 84000, sampleSize: 31 }]]));
  app = makeApp();
});

/** Запись статистики по заданию из ответа маршрута. */
async function statsFor(id: string) {
  const res = await request(app).get("/api/analytics/test1");
  expect(res.status).toBe(200);
  return res.body.questionStats.find((q: { questionId: string }) => q.questionId === id);
}

describe("аналитика теста: экспозиция и время задания", () => {
  it("отдаёт экспозицию, показы в других тестах и медиану времени", async () => {
    expect(await statsFor("q1")).toMatchObject({
      exposureCount: 46,
      globalExposureCount: 318,
      otherTestsCount: 2,
      latencyMedianMs: 84000,
      latencySampleSize: 31,
    });
  });

  it("доля считается от числа попыток теста", async () => {
    storageMock.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 1]]));
    const q1 = await statsFor("q1");
    expect(q1.exposurePercent).toBe(50); // одна выдача из двух попыток
  });

  it("прохождения из выгрузок LMS входят в знаменатель — их выдачи уже в числителе (PRD-55 FR-08)", async () => {
    // Тест прошли в LMS: одна веб-попытка и три импортированных прохождения, все четыре
    // выдали q1. Знаменатель только по вебу дал бы 400 % — на стенде было «23 500 %».
    const imported = (id: string) => ({
      id, testId: "test1", origin: "import", packageId: null, participantKey: id,
      startedAt: new Date("2026-09-02T10:00:00"), finishedAt: new Date("2026-09-02T10:00:00"),
      lastActivityAt: new Date("2026-09-02T10:00:00"),
    });
    storageMock.getAllAttempts.mockResolvedValue([attempt("a1")]);
    storageMock.getAllScormAttempts.mockResolvedValue([imported("i1"), imported("i2"), imported("i3")]);
    storageMock.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 4]]));

    const q1 = await statsFor("q1");
    expect(q1.exposurePercent).toBe(100);
  });

  it("БРОШЕННАЯ попытка входит в знаменатель", async () => {
    // Счётчик выдач пополняется на СТАРТЕ попытки (FR-02): брошенная попытка показала задание
    // так же, как доведённая до конца. Знаменатель из одних завершённых давал бы долю больше
    // ста процентов ровно на число брошенных — «выдано 3 из 2» на первой же приёмке.
    const abandoned = { ...attempt("a3"), resultJson: null, finishedAt: null };
    storageMock.getAllAttempts.mockResolvedValue([attempt("a1"), attempt("a2"), abandoned]);
    storageMock.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 3]]));

    const q1 = await statsFor("q1");

    expect(q1.exposurePercent).toBe(100);
  });

  it("попытка старше окна наблюдения в знаменатель не идёт", async () => {
    const old = { ...attempt("a0"), startedAt: new Date("2020-01-01"), finishedAt: new Date("2020-01-01") };
    storageMock.getAllAttempts.mockResolvedValue([attempt("a1"), attempt("a2"), old]);
    storageMock.getDeliveryCountsForTest.mockResolvedValue(new Map([["q1", 2]]));

    const q1 = await statsFor("q1");

    expect(q1.exposurePercent).toBe(100); // 2 выдачи из 2 попыток окна, а не из трёх
  });

  it("знаменатель доли отдаётся явно: он не равен ни одному числу сводки", async () => {
    const abandoned = { ...attempt("a3"), resultJson: null, finishedAt: null };
    storageMock.getAllAttempts.mockResolvedValue([attempt("a1"), attempt("a2"), abandoned]);

    const res = await request(app).get("/api/analytics/test1");

    // Сводка считает завершённые (2), знаменатель — все начатые за окно (3). Считая его на
    // клиенте по сводке, экран подписал бы «выдано 3 из 2».
    expect(res.body.summary.completedAttempts).toBe(2);
    expect(res.body.exposureAttempts).toBe(3);
  });

  it("пустой счётчик даёт null, а не ноль", async () => {
    const q2 = await statsFor("q2");
    expect(q2.exposureCount).toBe(0);
    expect(q2.exposurePercent).toBeNull();
  });

  it("отсутствие измерений времени даёт null и нулевую выборку", async () => {
    const q2 = await statsFor("q2");
    expect(q2.latencyMedianMs).toBeNull();
    expect(q2.latencySampleSize).toBe(0);
  });

  it("счётчики читаются ОДНИМ запросом на тест, а не по заданию", async () => {
    await request(app).get("/api/analytics/test1");
    expect(storageMock.getDeliveryCountsForTest).toHaveBeenCalledTimes(1);
    expect(storageMock.getLatencyStats).toHaveBeenCalledTimes(1);
    const [ids] = storageMock.getDeliveryCountsForTest.mock.calls[0];
    expect([...ids].sort()).toEqual(["q1", "q2"]);
  });

  it("сбой чтения счётчиков не роняет страницу аналитики", async () => {
    storageMock.getDeliveryCountsForTest.mockRejectedValue(new Error("база недоступна"));

    const res = await request(app).get("/api/analytics/test1");

    expect(res.status).toBe(200);
    const q1 = res.body.questionStats.find((q: { questionId: string }) => q.questionId === "q1");
    expect(q1.exposurePercent).toBeNull();
    // Остальная статистика на месте: экспозиция — дополнение, а не условие работы экрана.
    expect(q1.correctPercent).toBeDefined();
  });
});
