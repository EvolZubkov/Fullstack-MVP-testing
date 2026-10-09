/**
 * @module tests/routes.analytics-answer-slices
 * @description PRD-56 FR-07k - FR-07n: ручка сравнения срезов «Ответы, шкалы и показатели».
 *
 * Расчёт разброса и профиля шкал проверен у своих функций; здесь — то, что относится к ручке:
 * какие срезы попадают в ответ, что каждый срез режет своими прохождениями ответы и значения
 * шкал, а «Тест целиком» не режет ничего, и порядок вопросов — порядок теста.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock, loadObservations, loadTestAnswerFacts } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getTest: vi.fn(),
    getTests: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    getSlices: vi.fn(),
    getAttemptsByTests: vi.fn(),
    getTestSections: vi.fn(),
    getScales: vi.fn(),
    selectScaleValuesForTest: vi.fn(),
    getResultVariables: vi.fn(),
    selectIndicatorValuesForTest: vi.fn(),
  },
  loadObservations: vi.fn(),
  loadTestAnswerFacts: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/services/analytics/observations", () => ({ loadObservations }));
vi.mock("../server/services/analytics/test-answer-facts", () => ({ loadTestAnswerFacts }));
vi.mock("../server/services/analytics/scale-ramp", () => ({ scaleRampOf: vi.fn().mockResolvedValue({}) }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import answerSlicesRouter from "../server/routes/analytics/answer-slices";

const QUESTIONS = [
  // Порядок в ответе обязан быть порядком теста, а не порядком ключей карты.
  { id: "q2", topicId: "t1", type: "scale", prompt: "Второй", orderIndex: 2, dataJson: { options: ["Нет", "Да"] } },
  { id: "q1", topicId: "t1", type: "scale", prompt: "Первый", orderIndex: 1, dataJson: { options: ["Нет", "Да"] } },
];

/** Ответы трёх прохождений: a1 и a2 из группы, a3 — нет. */
const FACTS = [
  { attemptId: "a1", questionId: "q1", answer: 1 },
  { attemptId: "a2", questionId: "q1", answer: 1 },
  { attemptId: "a3", questionId: "q1", answer: 0 },
  { attemptId: "a3", questionId: "q2", answer: 0 },
];

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = "admin";
    next();
  });
  app.use("/api/analytics", answerSlicesRouter);
  return app;
}

const ask = (query: string) => request(makeApp()).get(`/api/analytics/tests/test1/answer-slices${query}`);

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue({ id: "admin", name: "Админ", email: "a@b.c" });
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTest.mockResolvedValue({ id: "test1", createdBy: "admin", designSettingsJson: {} });
  storageMock.getSlices.mockResolvedValue([
    { id: "s-hrbp", name: "HRBP", conditionsJson: { groupIds: ["g1"] } },
    { id: "s-other", name: "Другой", conditionsJson: { groupIds: ["g2"] } },
  ]);
  storageMock.getAttemptsByTests.mockResolvedValue([]);
  storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", sortOrder: 0 }]);
  storageMock.getScales.mockResolvedValue([{ key: "focus", label: "Фокус", configJson: {} }]);
  storageMock.selectScaleValuesForTest.mockResolvedValue([
    { attemptId: "a1", source: "web", values: { focus: 30 } },
    { attemptId: "a3", source: "web", values: { focus: 10 } },
  ]);
  storageMock.getResultVariables.mockResolvedValue([
    { name: "idx", label: "Индекс", type: "number", configJson: {}, sortOrder: 0 },
  ]);
  storageMock.selectIndicatorValuesForTest.mockResolvedValue([
    { attemptId: "a1", source: "web", values: { idx: 70 } },
    { attemptId: "a3", source: "import", values: { idx: "30" } },
  ]);
  loadTestAnswerFacts.mockResolvedValue({
    facts: FACTS,
    questionById: new Map(QUESTIONS.map(q => [q.id, q])),
    topicNameById: new Map([["t1", "ЧИЛ"]]),
  });
  // Срез группы g1 — прохождения a1 и a2; «Тест целиком» — все три.
  loadObservations.mockImplementation(async (filter: { groupIds?: string[] }) => ({
    rows: filter.groupIds?.includes("g1")
      ? [{ id: "a1" }, { id: "a2" }]
      : [{ id: "a1" }, { id: "a2" }, { id: "a3" }],
  }));
});

describe("GET /analytics/tests/:testId/answer-slices", () => {
  it("каждый срез считает разброс по своим прохождениям, «Тест целиком» — по всем", async () => {
    const res = await ask("?withWhole=1&sliceId=s-hrbp");

    expect(res.status).toBe(200);
    const [whole, hrbp] = res.body.slices;
    expect(whole).toMatchObject({ id: "whole", name: "Тест целиком", respondents: 3 });
    expect(hrbp).toMatchObject({ id: "s-hrbp", name: "HRBP", respondents: 2 });
    // У «Теста целиком» на q1 три ответа, треть — «Нет»; у среза — два ответа, оба «Да».
    const q1Whole = whole.questions.find((q: { questionId: string }) => q.questionId === "q1");
    const q1Hrbp = hrbp.questions.find((q: { questionId: string }) => q.questionId === "q1");
    expect(q1Whole.answered).toBe(3);
    expect(q1Hrbp.answered).toBe(2);
    expect(q1Hrbp.options.find((o: { label: string }) => o.label === "Да").share).toBe(100);
    // На q2 отвечало только прохождение вне среза.
    expect(hrbp.questions.some((q: { questionId: string }) => q.questionId === "q2")).toBe(false);
  });

  it("шкалы режутся теми же прохождениями среза", async () => {
    const res = await ask("?withWhole=1&sliceId=s-hrbp");

    const [whole, hrbp] = res.body.slices;
    expect(whole.scales[0]).toMatchObject({ key: "focus", average: 20, sampleSize: 2 });
    expect(hrbp.scales[0]).toMatchObject({ key: "focus", average: 30, sampleSize: 1 });
  });

  it("indicators are cut by the same runs of the slice", async () => {
    const res = await ask("?withWhole=1&sliceId=s-hrbp");

    const [whole, hrbp] = res.body.slices;
    expect(whole.indicators[0]).toMatchObject({ name: "idx", average: 50, sampleSize: 2 });
    expect(hrbp.indicators[0]).toMatchObject({ name: "idx", average: 70, sampleSize: 1 });
  });

  it("временный отбор приходит срезом `adhoc` со своим именем", async () => {
    const conditions = encodeURIComponent(JSON.stringify({ groupIds: ["g1"] }));
    const res = await ask(`?conditions=${conditions}&conditionsName=${encodeURIComponent("Отбор")}&sliceId=none`);

    expect(res.body.slices.map((s: { id: string; name: string }) => [s.id, s.name])).toEqual([["adhoc", "Отбор"]]);
    expect(res.body.slices[0].respondents).toBe(2);
  });

  it("вопросы — в порядке теста, с подписью темы и минимумом наблюдений", async () => {
    const res = await ask("?withWhole=1");

    expect(res.body.questions.map((q: { questionId: string }) => q.questionId)).toEqual(["q1", "q2"]);
    expect(res.body.questions[0]).toMatchObject({ prompt: "Первый", topicName: "ЧИЛ", type: "scale" });
    expect(typeof res.body.minObservations).toBe("number");
  });
});
