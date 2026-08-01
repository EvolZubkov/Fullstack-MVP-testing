/**
 * @module tests/routes.questions-order-index
 *
 * PRD-30 Э5: the author's index inside the topic («Индекс в теме») has to be
 * accepted by the question API. The route builds its storage payload from an
 * EXPLICIT list of fields — a column the list forgets is silently dropped, and
 * the editor would appear to save an index that never reaches the database.
 *
 * Two rules are pinned besides the plain round-trip:
 *   - `null` CLEARS the index («не задано»), it is not «leave unchanged»;
 *   - a field the client did not send leaves the stored value alone (`undefined`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getQuestions: vi.fn(),
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    getTopics: vi.fn(),
    getTopic: vi.fn(),
    getTestSections: vi.fn(),
    getTest: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getSharedTopicIds: vi.fn().mockResolvedValue([]),
    getTopicIdsByOwner: vi.fn().mockResolvedValue([]),
    getActiveTopicGrantsForGrantees: vi.fn().mockResolvedValue([]),
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

// eslint-disable-next-line import/first -- must import AFTER vi.mock
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
  id: "q1", topicId: "t1", type: "single", prompt: "What is JS?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  difficulty: 50, shuffleAnswers: true, tags: [], orderIndex: 20,
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
const asAuthor = (req: request.Test) => req.set("x-test-user", "author1");

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTopic.mockResolvedValue(dbTopic);
  storageMock.getTopics.mockResolvedValue([dbTopic]);
  storageMock.getQuestion.mockResolvedValue(dbQuestion);
  storageMock.createQuestion.mockResolvedValue(dbQuestion);
  storageMock.updateQuestion.mockResolvedValue(dbQuestion);
  drawMock.assessQuestionChange.mockResolvedValue(EMPTY);
  drawMock.assessQuestionsRemoval.mockResolvedValue(EMPTY);
  app = makeApp();
});

describe("POST /api/questions — «Индекс в теме» (PRD-30 FR-01)", () => {
  it("passes the index through to storage", async () => {
    const res = await asAuthor(request(app).post("/api/questions").send({
      topicId: "t1", type: "single", prompt: "Q?",
      dataJson: { options: ["A"] }, correctJson: { correctIndex: 0 },
      orderIndex: 20,
    }));

    expect(res.status).toBe(201);
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ orderIndex: 20 }),
    );
  });

  it("keeps zero — it is an ordinary index, not «not set»", async () => {
    await asAuthor(request(app).post("/api/questions").send({
      topicId: "t1", type: "single", prompt: "Q?",
      dataJson: { options: ["A"] }, correctJson: { correctIndex: 0 },
      orderIndex: 0,
    }));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ orderIndex: 0 }),
    );
  });

  it("a question created without an index gets null", async () => {
    await asAuthor(request(app).post("/api/questions").send({
      topicId: "t1", type: "single", prompt: "Q?",
      dataJson: { options: ["A"] }, correctJson: { correctIndex: 0 },
    }));

    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ orderIndex: null }),
    );
  });
});

describe("PUT /api/questions/:id — «Индекс в теме» (PRD-30 FR-01)", () => {
  it("updates the index", async () => {
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ orderIndex: 30 }));

    expect(res.status).toBe(200);
    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ orderIndex: 30 }),
    );
  });

  it("null clears the index — «не задано» is a value, not a no-op", async () => {
    await asAuthor(request(app).put("/api/questions/q1").send({ orderIndex: null }));

    expect(storageMock.updateQuestion).toHaveBeenCalledWith(
      "q1",
      expect.objectContaining({ orderIndex: null }),
    );
  });

  it("a request that does not mention the index leaves it unchanged", async () => {
    await asAuthor(request(app).put("/api/questions/q1").send({ prompt: "Changed" }));

    const payload = storageMock.updateQuestion.mock.calls[0][1];
    expect(payload.orderIndex).toBeUndefined();
  });

  it("re-indexing is not a delivery-affecting change: no feasibility check runs", async () => {
    // The index changes the ORDER, never the composition of a draw (FR-06), so
    // it must not drag the author through the PRD-15 dependent-tests dialog.
    await asAuthor(request(app).put("/api/questions/q1").send({ orderIndex: 40 }));

    expect(drawMock.assessQuestionChange).not.toHaveBeenCalled();
  });
});
