/**
 * @module tests/routes.questions-short-answer-limit
 *
 * PRD-57 FR-28v: авторский предел длины короткого ответа не может превышать системный
 * потолок инстанса.
 *
 * Проверка живёт на СЕРВЕРЕ, потому что настройку инстанса знает только он: канала
 * серверных настроек к браузеру в продукте нет, и редактор числа потолка не видит. Значит
 * сервер обязан не пустить такой вопрос и назвать число в ошибке — иначе автор поставит
 * предел 4000, а участник упрётся в 250 и не поймёт почему.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getUserGroups: vi.fn(),
    getActiveTopicGrantsForGrantees: vi.fn(),
    getTopic: vi.fn(),
    getTopics: vi.fn(),
    getQuestion: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    getTestsUsingTopic: vi.fn(),
    getTestSectionsByTopic: vi.fn(),
    getMeasurementsForQuestions: vi.fn(),
    getTestQuestionScoring: vi.fn(),
    getAdaptiveLevels: vi.fn(),
    getTopicPageRefs: vi.fn(),
    getResultVariables: vi.fn(),
    getTest: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import questionsRouter from "../server/routes/questions";
import { config } from "../server/config";

const TOPIC = { id: "t1", name: "Охрана труда", ownerId: "author1", visibility: "private" };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = "author1";
    next();
  });
  app.use("/api/questions", questionsRouter);
  return app;
}

const app = makeApp();

const body = (maxLength?: number) => ({
  topicId: TOPIC.id,
  type: "short",
  prompt: "Кто выдаёт наряд-допуск?",
  dataJson: maxLength === undefined ? {} : { maxLength },
  correctJson: {
    answerKind: "text",
    join: "any",
    rules: [{ kind: "text", match: "wildcard", value: "РТН" }],
  },
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue({ id: "author1", status: "active" });
  storageMock.getUserRoles.mockResolvedValue(["author"]);
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getTopic.mockResolvedValue(TOPIC);
  storageMock.getTopics.mockResolvedValue([TOPIC]);
  storageMock.createQuestion.mockImplementation(async (input: unknown) => ({ id: "q1", ...(input as object) }));
});

describe("POST /api/questions — предел длины короткого ответа", () => {
  it("предел в рамках потолка принимается", async () => {
    const res = await request(app).post("/api/questions").send(body(40));
    expect(res.status).toBe(201);
    expect(storageMock.createQuestion).toHaveBeenCalled();
  });

  it("вопрос без предела принимается — действует системный потолок", async () => {
    const res = await request(app).post("/api/questions").send(body());
    expect(res.status).toBe(201);
  });

  it("предел выше потолка отклоняется, и число названо в ошибке", async () => {
    const res = await request(app).post("/api/questions").send(body(4000));
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("dataJson");
    expect(res.body.error).toContain(String(config.limits.shortAnswerMaxLength));
    expect(storageMock.createQuestion).not.toHaveBeenCalled();
  });

  it("нулевой и отрицательный предел отклоняются", async () => {
    expect((await request(app).post("/api/questions").send(body(0))).status).toBe(422);
    expect((await request(app).post("/api/questions").send(body(-5))).status).toBe(422);
  });

  it("у прочих типов поле не проверяется: предел — свойство текстового ввода", async () => {
    const other = { ...body(4000), type: "single", dataJson: { options: ["а", "б"], maxLength: 4000 },
      correctJson: { correctIndex: 0 } };
    const res = await request(app).post("/api/questions").send(other);
    expect(res.status).toBe(201);
  });
});
