/**
 * @module tests/routes.attempts-exposure-weights
 * @description PRD-55 (FR-26): веб-выдача учитывает накопленную экспозицию — счётчики читаются
 * ОДИН раз за попытку, и внутри пула горячее задание выпадает реже свежего.
 *
 * Статистическая проверка здесь неизбежна: отбор остаётся случайным, и утверждать можно только
 * распределение. Зато она проверяет ровно то, ради чего задача существует, — что горячее задание
 * выпадает реже, но НЕ исчезает: предел отношения весов на то и заведён.
 *
 * Оба режима выдачи проверяются здесь. Адаптивный собирает уровни своим обработчиком, мимо
 * `drawSection`, и поправка туда сначала не доехала вовсе: банк уровня вырабатывался головой,
 * а хвост не показывался никогда — ровно та беда, ради которой PRD-55 и затевался.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
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

function q(id: string) {
  return {
    id, topicId: "t1", type: "single", prompt: id,
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    difficulty: 50, shuffleAnswers: true, orderIndex: null,
    feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  };
}

/** Id заданий, которые маршрут записал в вариант попытки. */
function deliveredIds(callIndex = 0): string[] {
  return storageMock.createAttempt.mock.calls[callIndex][0].variantJson.sections[0].questionIds;
}

let app: express.Express;

/**
 * Генератор с зерном (mulberry32): распределение выдачи настоящее, но воспроизводимое. С
 * `Math.random` проверки долей по 120 стартам изредка падали на границе коридора (42 из 120
 * при пороге «больше 42») — тест решал удачу, а не поправку.
 */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let randomSpy: MockInstance<() => number>;

afterEach(() => {
  randomSpy.mockRestore();
});

beforeEach(() => {
  vi.clearAllMocks();
  randomSpy = vi.spyOn(Math, "random").mockImplementation(seeded(20261006));
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
  app = makeApp();
});

describe("старт попытки учитывает экспозицию", () => {
  it("читает счётчики ОДИН раз за попытку, по всем заданиям теста", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("hot"), q("fresh")]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
    expect(storageMock.getDeliveryCounts).toHaveBeenCalledTimes(1);
    const [questionIds, since] = storageMock.getDeliveryCounts.mock.calls[0];
    expect([...questionIds].sort()).toEqual(["fresh", "hot"]);
    expect(since).toBeInstanceOf(Date);
    // Окно по умолчанию — 12 месяцев назад, а не «от начала времён».
    expect(since.getTime()).toBeLessThan(Date.now());
  });

  // Таймаут задан явно: проверка гоняет сотню полных стартов попытки через express, и на
  // умолчании в 5 секунд она зелёная только на свободной машине — в общем прогоне на четырёх
  // воркерах падала по таймауту, читаясь как сломанная поправка.
  it("горячее задание выпадает реже свежего, но не исчезает", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("hot"), q("fresh")]);
    storageMock.getDeliveryCounts.mockResolvedValue(new Map([["hot", 100], ["fresh", 0]]));

    const RUNS = 120;
    for (let i = 0; i < RUNS; i += 1) {
      await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    }

    let fresh = 0;
    for (let i = 0; i < RUNS; i += 1) {
      if (deliveredIds(i)[0] === "fresh") fresh += 1;
    }
    // Предел отношения весов 4:1 → доля свежего около 0.8, но обе границы важны:
    // ниже — поправка не работает, выше — она выродилась в детерминированный обход.
    expect(fresh).toBeGreaterThan(RUNS * 0.6);
    expect(fresh).toBeLessThan(RUNS * 0.95);
  }, 30000);

  it("без накопленных данных выдача остаётся равномерной", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("a"), q("b")]);
    storageMock.getDeliveryCounts.mockResolvedValue(new Map());

    const RUNS = 120;
    for (let i = 0; i < RUNS; i += 1) {
      await asLearner(request(app).post("/api/tests/test1/attempts/start"));
    }

    let a = 0;
    for (let i = 0; i < RUNS; i += 1) {
      if (deliveredIds(i)[0] === "a") a += 1;
    }
    expect(a).toBeGreaterThan(RUNS * 0.35);
    expect(a).toBeLessThan(RUNS * 0.65);
  }, 30000);

  it("сбой чтения счётчиков не роняет старт попытки", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([q("a"), q("b")]);
    storageMock.getDeliveryCounts.mockRejectedValue(new Error("база недоступна"));

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
    expect(deliveredIds()).toHaveLength(1);
  });
});

describe("адаптивный старт учитывает экспозицию", () => {
  /** Задание с трудностью: уровень отбирает по её полосе. */
  const qd = (id: string, difficulty: number) => ({ ...q(id), difficulty });

  /** Id заданий уровня — то, что маршрут записал в вариант адаптивной попытки. */
  function levelIds(callIndex = 0): string[] {
    const variant = storageMock.createAttempt.mock.calls[callIndex][0].variantJson as {
      topics: Array<{ levelsState: Array<{ questionIds: string[] }> }>;
    };
    return variant.topics[0].levelsState[0].questionIds;
  }

  beforeEach(() => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, mode: "adaptive" });
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 1 }]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      {
        topicId: "t1", levelIndex: 0, levelName: "Единственный",
        minDifficulty: 0, maxDifficulty: 100, questionsCount: 1,
        passThreshold: 70, passThresholdType: "percent",
      },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([qd("hot", 50), qd("fresh", 50)]);
  });

  it("читает счётчики ОДИН раз за попытку, по заданиям тем", async () => {
    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));

    expect(res.status).toBe(201);
    expect(storageMock.getDeliveryCounts).toHaveBeenCalledTimes(1);
    const [questionIds, since] = storageMock.getDeliveryCounts.mock.calls[0];
    expect([...questionIds].sort()).toEqual(["fresh", "hot"]);
    expect(since).toBeInstanceOf(Date);
  });

  it("горячее задание выпадает реже свежего, но не исчезает", async () => {
    storageMock.getDeliveryCounts.mockResolvedValue(new Map([["hot", 100], ["fresh", 0]]));

    const RUNS = 120;
    for (let i = 0; i < RUNS; i += 1) {
      await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    }

    let fresh = 0;
    for (let i = 0; i < RUNS; i += 1) {
      if (levelIds(i)[0] === "fresh") fresh += 1;
    }
    // Те же границы, что у обычной выдачи: ниже — поправка не работает, выше — выродилась
    // в детерминированный обход банка.
    expect(fresh).toBeGreaterThan(RUNS * 0.6);
    expect(fresh).toBeLessThan(RUNS * 0.95);
  }, 30000);

  it("без накопленных данных выдача уровня остаётся равномерной", async () => {
    storageMock.getDeliveryCounts.mockResolvedValue(new Map());

    const RUNS = 120;
    for (let i = 0; i < RUNS; i += 1) {
      await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));
    }

    let hot = 0;
    for (let i = 0; i < RUNS; i += 1) {
      if (levelIds(i)[0] === "hot") hot += 1;
    }
    expect(hot).toBeGreaterThan(RUNS * 0.35);
    expect(hot).toBeLessThan(RUNS * 0.65);
  }, 30000);

  it("вес считается ВНУТРИ уровня, а не по всей теме", async () => {
    // Полосы трудности не пересекаются: горячее задание нижнего уровня не имеет права
    // отодвинуть свежее задание верхнего — они никогда не конкурируют между собой.
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      {
        topicId: "t1", levelIndex: 0, levelName: "Лёгкий", minDifficulty: 0, maxDifficulty: 40,
        questionsCount: 1, passThreshold: 70, passThresholdType: "percent",
      },
      {
        topicId: "t1", levelIndex: 1, levelName: "Сложный", minDifficulty: 60, maxDifficulty: 100,
        questionsCount: 1, passThreshold: 70, passThresholdType: "percent",
      },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([qd("easy", 20), qd("hard", 80)]);
    storageMock.getDeliveryCounts.mockResolvedValue(new Map([["easy", 500], ["hard", 0]]));

    await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));

    const variant = storageMock.createAttempt.mock.calls[0][0].variantJson as {
      topics: Array<{ levelsState: Array<{ questionIds: string[] }> }>;
    };
    expect(variant.topics[0].levelsState[0].questionIds).toEqual(["easy"]);
    expect(variant.topics[0].levelsState[1].questionIds).toEqual(["hard"]);
  });

  it("сбой чтения счётчиков не роняет адаптивный старт", async () => {
    storageMock.getDeliveryCounts.mockRejectedValue(new Error("база недоступна"));

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));

    expect(res.status).toBe(201);
    expect(levelIds()).toHaveLength(1);
  });
});
