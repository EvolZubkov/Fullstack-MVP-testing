/**
 * @module tests/routes.analytics-question-card
 * @description Э3.3: блок «Вопрос в этом тесте» и «Этот вопрос в других тестах».
 *
 * Цена, правило начисления и сложность — из цепочки «Оценки» теста, с пометкой, что задано в
 * тесте; верный ответ словами — только у типов без таблицы вариантов; другие тесты — только
 * видимые читателю, с трудностью по ответам или «мало данных» ниже порога.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock, factsMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    getTest: vi.fn(), getTopic: vi.fn(), getQuestion: vi.fn(),
    getTestSections: vi.fn(), getTestQuestionScoring: vi.fn(),
    getOtherTests: vi.fn(), selectObservations: vi.fn(),
  },
  factsMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/analytics/test-answer-facts", () => ({ loadTestAnswerFacts: factsMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import questionCardRouter from "../server/routes/analytics/question-card";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", questionCardRouter);
  return app;
}

const ask = (path = "/api/analytics/tests/t1/questions/q1/card") =>
  request(makeApp()).get(path).set("x-test-user", "a1");

const QUESTION = {
  id: "q1", topicId: "top1", type: "single", prompt: "Какая мера относится к антикоррупционным?",
  dataJson: { options: ["Проверка контрагента", "Подарок"] }, correctJson: { correctIndex: 0 },
  difficulty: 60, tags: ["Антикоррупция"], mediaUrl: null, mediaType: null, contentHash: "h1",
};

/** Ответы на вопрос в другом тесте: `n` оценённых, половина верных. */
function facts(n: number) {
  return {
    facts: Array.from({ length: n }, (_, i) => ({
      questionId: "q1", attemptId: `a${i}`, result: i % 2 ? "incorrect" : "correct", source: "web",
      latencyMs: null, earnedPoints: i % 2 ? 0 : 1, possiblePoints: 1, answer: null,
    })),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "a1", name: "Автор", email: "a@b.c" });
  storageMock.getTest.mockImplementation((id: string) => Promise.resolve({ id, title: id === "t2" ? "Антикоррупционный минимум" : "Сертификация", defaultQuestionPoints: 1 }));
  storageMock.getQuestion.mockResolvedValue(QUESTION);
  storageMock.getTopic.mockResolvedValue({ id: "top1", name: "Право и комплаенс" });
  storageMock.getTestSections.mockResolvedValue([{ topicId: "top1", defaultPoints: null }]);
  storageMock.getTestQuestionScoring.mockResolvedValue([
    { questionId: "q1", points: 2, scoringJson: null, difficulty: null, pinnedContentHash: "h1", excludedFromDelivery: false },
  ]);
  storageMock.getOtherTests.mockResolvedValue([{ testId: "t2", delivered: 412 }]);
  storageMock.selectObservations.mockResolvedValue({ web: [], lms: [], order: [], total: 0 });
  factsMock.mockResolvedValue(facts(40));
});

describe("GET /api/analytics/tests/:testId/questions/:questionId/card (Э3.3)", () => {
  it("отдаёт вопрос и его настройки из «Оценки» теста с пометкой, что задано в тесте", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      prompt: "Какая мера относится к антикоррупционным?",
      questionType: "single",
      topicName: "Право и комплаенс",
      tags: ["Антикоррупция"],
      excluded: false,
      points: 2,
      pointsInTest: true,
      scoringKind: "exact",
      scoringInTest: false,
      difficulty: 60,
      difficultyInTest: false,
    });
    // У одиночного выбора верный ответ виден в таблице вариантов — словами его здесь нет.
    expect(res.body.correctAnswer).toBeNull();
  });

  it("у ранжирования верный порядок — словами: таблицы вариантов у него нет", async () => {
    storageMock.getQuestion.mockResolvedValue({
      ...QUESTION, type: "ranking",
      dataJson: { items: ["Заявка", "Проверка", "Договор"] }, correctJson: { correctOrder: [0, 1, 2] },
    });

    const res = await ask();
    expect(res.body.correctAnswer).toContain("Заявка");
  });

  it("другие тесты — с трудностью по ответам; ниже порога — «мало данных»", async () => {
    let res = await ask();
    expect(res.body.otherTests).toEqual([
      { testId: "t2", title: "Антикоррупционный минимум", delivered: 412, observations: 40, difficulty: 0.5 },
    ]);

    factsMock.mockResolvedValue(facts(3));
    res = await ask();
    expect(res.body.otherTests[0]).toMatchObject({ observations: 3, difficulty: null });
  });

  it("чужой тест в списке не называется", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["t1"]);
    storageMock.getTest.mockImplementation((id: string) => Promise.resolve({ id, title: id, ownerId: id === "t1" ? "a1" : "x", defaultQuestionPoints: 1 }));

    const res = await ask();
    expect(res.status).toBe(200);
    expect(res.body.otherTests).toEqual([]);
  });

  it("вопрос не из этого теста — 404", async () => {
    storageMock.getTestSections.mockResolvedValue([{ topicId: "другая тема", defaultPoints: null }]);
    const res = await ask();
    expect(res.status).toBe(404);
  });
});
