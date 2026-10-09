/**
 * @module tests/routes.attempts-excluded-questions
 * @description PRD-56 FR-17a: задание, исключённое из выдачи, участнику не достаётся.
 *
 * Исключение — СОСТОЯНИЕ вопроса внутри теста, а не разовая команда: выдача перестаёт его
 * брать, пока признак стоит. Проверяется на старте живой попытки, потому что ошибка здесь
 * ломает не экран, а прохождение: участник получит задание, которое автор снял.
 *
 * Обратная сторона того же правила: прохождение ПО СНИМКУ состав не меняет (PRD-15). Пока тест
 * не опубликован заново, и веб, и выгруженный пакет продолжают выдавать вопрос — об этом
 * говорит окно подтверждения (FR-17b), и здесь это проверяется прямо.
 *
 * Оба пути выдачи проверяются здесь: обычный и АДАПТИВНЫЙ. Уровни адаптивного теста
 * собираются своим обработчиком, мимо `drawSection`, и правило «исключённое не выдаётся» туда
 * сначала не доехало вовсе — черновик выдавал снятое задание.
 *
 * Обвязка скопирована из tests/routes.attempts-exposure.test.ts, чтобы файлы оставались
 * независимыми.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
    getLatestSnapshot: vi.fn().mockResolvedValue(undefined),
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

/** Состав выданной формы — то, что записано в попытку. */
function deliveredIds(): string[] {
  const variant = storageMock.createAttempt.mock.calls[0][0].variantJson as {
    sections?: Array<{ questionIds?: string[] }>;
  };
  return (variant.sections ?? []).flatMap(section => section.questionIds ?? []);
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(learnerUser);
  storageMock.getUserRoles.mockResolvedValue(["learner"]);
  storageMock.getAttemptsByUserAndTest.mockResolvedValue([]);
  storageMock.getContentPages.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
  storageMock.getLatestSnapshot.mockResolvedValue(undefined);
  storageMock.recordDeliveries.mockResolvedValue(undefined);
  storageMock.getDeliveryCounts.mockResolvedValue(new Map());
  storageMock.getQuestionsByIds.mockResolvedValue([]);
  storageMock.createAttempt.mockResolvedValue({
    id: "atmp1", userId: "learner1", testId: "test1",
    variantJson: { sections: [] }, answersJson: {}, resultJson: null,
    startedAt: new Date(), finishedAt: null, testVersion: 1,
  });
  storageMock.getTest.mockResolvedValue(dbTest);
  storageMock.getTestSections.mockResolvedValue([{ topicId: "t1", drawCount: 2 }]);
  storageMock.getQuestionsByTopic.mockResolvedValue([q("a"), q("b"), q("c")]);
  app = makeApp();
});

describe("исключённое задание не выдаётся", () => {
  it("не берёт в выдачу задание с признаком исключения", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", excludedFromDelivery: true },
    ]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(res.status).toBe(201);
    expect(deliveredIds()).not.toContain("b");
    expect(deliveredIds()).toHaveLength(2);
  });

  it("оставляет задание в выдаче, пока признак не поставлен", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      // Строка настроек есть (переопределена цена), но из выдачи задание не исключено.
      { testId: "test1", questionId: "b", points: 3, excludedFromDelivery: false },
    ]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(deliveredIds()).toHaveLength(2);
  });

  it("не пополняет счётчик выдач исключённым заданием", async () => {
    // Экспозиция — учёт ПОКАЗОВ: задание, которого никто не видел, не может их накапливать.
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", excludedFromDelivery: true },
    ]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    const [questionIds] = storageMock.recordDeliveries.mock.calls[0];
    expect(questionIds).not.toContain("b");
  });

  it("исключает из выдачи только СВОЙ тест", async () => {
    // Признак живёт в настройках вопроса ВНУТРИ теста: негодное здесь задание может быть
    // годно в другом, и чужая строка настроек к этой выдаче отношения не имеет.
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "other-test", questionId: "b", excludedFromDelivery: true },
    ]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start"));

    expect(deliveredIds()).toHaveLength(2);
  });
});

describe("исключённое задание не выдаётся адаптивным тестом", () => {
  /** Задание с трудностью: уровень отбирает по её полосе. */
  const qd = (id: string, difficulty: number) => ({ ...q(id), difficulty });

  /** Состав уровней адаптивной попытки — то, что записано в вариант. */
  function levelIds(): string[] {
    const variant = storageMock.createAttempt.mock.calls[0][0].variantJson as {
      topics?: Array<{ levelsState?: Array<{ questionIds?: string[] }> }>;
    };
    return (variant.topics ?? []).flatMap(topic =>
      (topic.levelsState ?? []).flatMap(level => level.questionIds ?? []));
  }

  beforeEach(() => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, mode: "adaptive" });
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([
      {
        topicId: "t1", levelIndex: 0, levelName: "Лёгкий", minDifficulty: 0, maxDifficulty: 100,
        questionsCount: 3, passThreshold: 70, passThresholdType: "percent",
      },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([qd("a", 50), qd("b", 50), qd("c", 50)]);
  });

  it("не берёт в уровень задание с признаком исключения", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", excludedFromDelivery: true },
    ]);

    const res = await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));

    expect(res.status).toBe(201);
    expect(levelIds()).not.toContain("b");
    expect(levelIds().sort()).toEqual(["a", "c"]);
  });

  it("оставляет задание в уровне, пока признак не поставлен", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", points: 3, excludedFromDelivery: false },
    ]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));

    expect(levelIds().sort()).toEqual(["a", "b", "c"]);
  });

  it("прохождение ПО СНИМКУ состав не меняет", async () => {
    // Та же обратная сторона правила, что и у обычной выдачи (PRD-15): опубликованная
    // версия — обещание тем, кто её уже проходит, и сегодняшнее исключение не переписывает
    // вчерашнюю публикацию. Снимок несёт свой состав, живые настройки к нему не применяются.
    storageMock.getLatestSnapshot.mockResolvedValue({
      id: "snap-1",
      contentJson: {
        test: { ...dbTest, mode: "adaptive", status: "published" },
        sections: [{ topicId: "t1", drawCount: 3 }],
        topics: [{ id: "t1", name: "JS" }],
        questionsByTopic: { t1: [qd("a", 50), qd("b", 50), qd("c", 50)] },
        topicCoursesByTopic: { t1: [] },
        topicEventsByTopic: { t1: [] },
        adaptiveSettings: [{ topicId: "t1" }],
        adaptiveLevels: [{
          topicId: "t1", levelIndex: 0, levelName: "Лёгкий", minDifficulty: 0, maxDifficulty: 100,
          questionsCount: 3, passThreshold: 70, passThresholdType: "percent",
        }],
        adaptiveLevelLinksByLevel: {},
        scales: [], measurements: [], resultVariables: [], contentPages: [], questionScoring: [],
      },
    });
    storageMock.getTest.mockResolvedValue({ ...dbTest, mode: "adaptive", status: "published" });
    storageMock.getTestQuestionScoring.mockResolvedValue([
      { testId: "test1", questionId: "b", excludedFromDelivery: true },
    ]);

    await asLearner(request(app).post("/api/tests/test1/attempts/start-adaptive"));

    expect(levelIds().sort()).toEqual(["a", "b", "c"]);
  });
});
