/**
 * @module tests/routes.questions-sanitize-report
 * @description Что санитайзер вырезал из текста задания — в ответе маршрута
 * (PRD-57, согласованный эскиз `prd57-question-text.html`, состояние `s-diag`).
 *
 * Небезопасное снималось молча: текст сохранялся очищенным, а автор видел только, что
 * «текст изменился сам». Проверяется ровно то, на чём это молчание держалось, — доходит ли
 * список находок до ответа, и не появляется ли он там, где терять нечего: пустое поле у
 * каждого сохранения означало бы, что ящик показывает баннер о пустоте.
 *
 * Harness повторяет tests/routes.questions-text-normalize.test.ts: поднятый мок хранилища,
 * supertest + express-session с подменой пользователя через `x-test-user`.
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
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    getTopic: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    getSharedTopicIds: vi.fn(),
    getTopicIdsByOwner: vi.fn(),
    getActiveTopicGrantsForGrantees: vi.fn(),
  },
}));

const { drawMock } = vi.hoisted(() => ({
  drawMock: {
    assessQuestionsRemoval: vi.fn(),
    assessQuestionChange: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/draw-feasibility", () => ({
  assessQuestionsRemoval: drawMock.assessQuestionsRemoval,
  assessQuestionChange: drawMock.assessQuestionChange,
  EMPTY_ASSESSMENT: { blocking: [], warnings: [] },
}));

import questionsRouter from "../server/routes/questions";

const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

const dbTopic = {
  id: "t1", name: "JavaScript", description: null, folderId: null,
  ownerId: "author1", visibility: "shared", createdAt: new Date(),
};

const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "<p>Вопрос</p>", promptFormat: "html",
  dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
  difficulty: 50, shuffleAnswers: true, tags: [],
  feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  mediaUrl: null, mediaType: null, createdAt: new Date(),
};

const EMPTY = { blocking: [], warnings: [] };

/** Текст, в котором есть что вырезать всеми тремя видами правил. */
const DIRTY_PROMPT =
  '<p onclick="steal()">Что выведет запрос?</p>'
  + '<script>fetch("//evil")</script>'
  + '<img src="https://cdn.example.com/a.png">';

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"];
    if (uid) req.session.userId = uid;
    next();
  });
  app.use("/api/questions", questionsRouter);
  return app;
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getSharedTopicIds.mockResolvedValue([]);
  storageMock.getTopicIdsByOwner.mockResolvedValue([]);
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getTopic.mockResolvedValue(dbTopic);
  storageMock.getQuestion.mockResolvedValue(dbQuestion);
  storageMock.createQuestion.mockImplementation(async (q: unknown) => ({ id: "new", ...(q as object) }));
  storageMock.updateQuestion.mockImplementation(async (_id: string, q: unknown) => ({ id: "q1", ...(q as object) }));
  drawMock.assessQuestionsRemoval.mockResolvedValue(EMPTY);
  drawMock.assessQuestionChange.mockResolvedValue(EMPTY);
  app = makeApp();
});

describe("POST /api/questions — вырезанное в ответе", () => {
  it("называет каждое сработавшее правило и число срабатываний", async () => {
    const res = await request(app)
      .post("/api/questions")
      .set("x-test-user", "author1")
      .send({
        topicId: "t1",
        type: "single",
        prompt: DIRTY_PROMPT,
        promptFormat: "html",
        dataJson: { options: ["А", "Б"] },
        correctJson: { correctIndex: 0 },
      });

    expect(res.status).toBe(201);
    const labels = (res.body.promptSanitizeRemoved ?? []).map((r: { label: string }) => r.label);
    expect(labels).toContain("<script>");
    expect(labels).toContain("onclick");
    expect(labels).toContain("external src/href");
    // Ответ описывает ЭТО сохранение: сохранённый текст уже без вырезанного.
    expect(res.body.prompt).not.toContain("<script>");
    expect(res.body.prompt).not.toContain("onclick");
  });

  it("у чистого текста поля нет вовсе: пустая находка выглядела бы как находка", async () => {
    const res = await request(app)
      .post("/api/questions")
      .set("x-test-user", "author1")
      .send({
        topicId: "t1",
        type: "single",
        prompt: "<p>Обычный вопрос</p>",
        promptFormat: "html",
        dataJson: { options: ["А", "Б"] },
        correctJson: { correctIndex: 0 },
      });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("promptSanitizeRemoved");
  });

  it("у разметки поля нет: санитайзер по ней не ходит", async () => {
    const res = await request(app)
      .post("/api/questions")
      .set("x-test-user", "author1")
      .send({
        topicId: "t1",
        type: "single",
        prompt: "Текст с **выделением** и <script>",
        dataJson: { options: ["А", "Б"] },
        correctJson: { correctIndex: 0 },
      });

    expect(res.status).toBe(201);
    expect(res.body).not.toHaveProperty("promptSanitizeRemoved");
  });
});

describe("PUT /api/questions/:id — вырезанное в ответе", () => {
  it("правка отчитывается так же, как создание", async () => {
    const res = await request(app)
      .put("/api/questions/q1")
      .set("x-test-user", "author1")
      .send({ prompt: DIRTY_PROMPT, promptFormat: "html" });

    expect(res.status).toBe(200);
    const labels = (res.body.promptSanitizeRemoved ?? []).map((r: { label: string }) => r.label);
    expect(labels).toContain("<script>");
    expect(labels).toContain("onclick");
  });

  it("правка без текста отчёта не несёт: вырезать было нечего", async () => {
    const res = await request(app)
      .put("/api/questions/q1")
      .set("x-test-user", "author1")
      .send({ difficulty: 70 });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("promptSanitizeRemoved");
  });

  it("пробный запуск отвечает оценкой, а не заданием: отчёт появится у настоящего сохранения", async () => {
    drawMock.assessQuestionChange.mockResolvedValue({ blocking: [], warnings: [] });
    const res = await request(app)
      .put("/api/questions/q1?dryRun=true")
      .set("x-test-user", "author1")
      .send({ prompt: DIRTY_PROMPT, promptFormat: "html", difficulty: 70 });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("promptSanitizeRemoved");
  });
});
