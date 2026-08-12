/**
 * Write-path normalisation of question texts on the question routes.
 *
 * The value that reaches storage must already be canonical (LF endings, no edge
 * whitespace, at most one blank line): the content hash and the publication
 * snapshots are computed from it, so a paste from Word must not produce a row
 * that differs from the same text typed by hand.
 *
 * Harness mirrors tests/routes.questions.coverage.test.ts: hoisted storage mock,
 * supertest + express-session with an x-test-user shim.
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
  id: "q1", topicId: "t1", type: "single", prompt: "Вопрос",
  dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
  difficulty: 50, shuffleAnswers: true, tags: [],
  feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  mediaUrl: null, mediaType: null, createdAt: new Date(),
};

const EMPTY = { blocking: [], warnings: [] };

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

describe("POST /api/questions — canonical text", () => {
  it("stores the prompt in canonical form", async () => {
    const res = await request(app)
      .post("/api/questions")
      .set("x-test-user", "author1")
      .send({
        topicId: "t1",
        type: "single",
        prompt: "  Первая строка \r\n\r\n\r\n  Вторая строка  ",
        dataJson: { options: ["А", "Б"] },
        correctJson: { correctIndex: 0 },
      });

    expect(res.status).toBe(201);
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Первая строка\n\nВторая строка" }),
    );
  });

  it("stores the answer options in canonical form", async () => {
    await request(app)
      .post("/api/questions")
      .set("x-test-user", "author1")
      .send({
        topicId: "t1",
        type: "single",
        prompt: "Вопрос",
        dataJson: { options: ["  Первый  ", "Второй\r\n"] },
        correctJson: { correctIndex: 0 },
      });

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ dataJson: { options: ["Первый", "Второй"] } }),
    );
  });

  it("stores the feedback texts in canonical form", async () => {
    await request(app)
      .post("/api/questions")
      .set("x-test-user", "author1")
      .send({
        topicId: "t1",
        type: "single",
        prompt: "Вопрос",
        dataJson: { options: ["А", "Б"] },
        correctJson: { correctIndex: 0 },
        feedback: " Общий  \r\n комментарий ",
        feedbackCorrect: " Верно ",
        feedbackIncorrect: " Неверно ",
      });

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({
        feedback: "Общий\nкомментарий",
        feedbackCorrect: "Верно",
        feedbackIncorrect: "Неверно",
      }),
    );
  });
});

describe("PUT /api/questions/:id — canonical text", () => {
  it("stores the edited prompt and options in canonical form", async () => {
    const res = await request(app)
      .put("/api/questions/q1")
      .set("x-test-user", "author1")
      .send({
        prompt: " Изменённый \r\n вопрос ",
        dataJson: { options: [" А ", "Б\r\n"] },
      });

    expect(res.status).toBe(200);
    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({
        prompt: "Изменённый\nвопрос",
        dataJson: { options: ["А", "Б"] },
      }),
    );
  });

  it("leaves a field the client did not send undefined, so a partial update cannot wipe it", async () => {
    await request(app)
      .put("/api/questions/q1")
      .set("x-test-user", "author1")
      .send({ difficulty: 70 });

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ prompt: undefined, feedback: undefined, dataJson: undefined }),
    );
  });
});
