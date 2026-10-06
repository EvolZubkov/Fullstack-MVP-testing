/**
 * Per-option feedback texts on the question write path (`optionFeedbackJson`).
 *
 * The routes store the column in its canonical form (shared/questions/option-feedback):
 * texts aligned by position with the options, NULL for any type but single choice, and
 * re-derived whenever the type or the options change so no text outlives its option.
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
  optionFeedbackJson: [null, "Почему Б"],
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

const base = {
  topicId: "t1",
  type: "single",
  prompt: "Вопрос",
  dataJson: { options: ["А", "Б", "В"] },
  correctJson: { correctIndex: 0 },
};

describe("POST /api/questions — option feedback", () => {
  it("stores option texts in canonical form, aligned with the options", async () => {
    const res = await request(app)
      .post("/api/questions")
      .set("x-test-user", "author1")
      .send({ ...base, optionFeedbackJson: ["", "  Почему \r\n Б ", null] });

    expect(res.status).toBe(201);
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ optionFeedbackJson: [null, "Почему\nБ"] }),
    );
  });

  it("stores NULL for a type other than single choice", async () => {
    await request(app)
      .post("/api/questions")
      .set("x-test-user", "author1")
      .send({ ...base, type: "multiple", correctJson: { correctIndices: [0] }, optionFeedbackJson: ["A"] });

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ optionFeedbackJson: null }),
    );
  });

  it("stores NULL when the client sends no texts", async () => {
    await request(app).post("/api/questions").set("x-test-user", "author1").send(base);

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ optionFeedbackJson: null }),
    );
  });
});

describe("PUT /api/questions/:id — option feedback", () => {
  it("replaces the texts the client sent", async () => {
    await request(app)
      .put("/api/questions/q1")
      .set("x-test-user", "author1")
      .send({ optionFeedbackJson: ["Почему А", null] });

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ optionFeedbackJson: ["Почему А"] }),
    );
  });

  it("leaves the texts alone when nothing they depend on is sent", async () => {
    await request(app).put("/api/questions/q1").set("x-test-user", "author1").send({ difficulty: 70 });

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ optionFeedbackJson: undefined }),
    );
  });

  it("clears the texts when the question stops being single choice", async () => {
    await request(app)
      .put("/api/questions/q1")
      .set("x-test-user", "author1")
      .send({ type: "multiple", correctJson: { correctIndices: [0] } });

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ optionFeedbackJson: null }),
    );
  });

  it("drops the stored text of an option that no longer exists", async () => {
    await request(app)
      .put("/api/questions/q1")
      .set("x-test-user", "author1")
      .send({ dataJson: { options: ["А"] } });

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ optionFeedbackJson: null }),
    );
  });
});
