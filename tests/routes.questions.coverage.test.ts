/**
 * Branch-coverage tests for server/routes/questions.ts.
 *
 * These target the ERROR and EDGE branches the existing suites
 * (routes.questions-users-assignments.test.ts and
 * routes.questions-import-export.test.ts) leave uncovered:
 *
 *   - base64 media rejection (413) on POST/PUT
 *   - topic-access denials (403 content_forbidden) on POST/PUT/DELETE/bulk
 *   - move-to-unmanaged-topic denial (403) on PUT
 *   - draw-feasibility blocking (409 content_in_use) on PUT/DELETE/bulk
 *   - dry-run previews (200 wouldBlock) on PUT/DELETE/bulk
 *   - feasibility warnings attached to the success payload (PUT)
 *   - the distinct "not found" branches (getQuestion undefined) on PUT/DELETE
 *   - duplicate route (201 / 404 / 500)
 *   - export scope filtering, filter merge, missing-test filename, 500
 *   - import missing-file (400) and malformed-buffer (500)
 *   - catch -> 500 on every mutating route
 *
 * Harness mirrors the two reference suites: hoisted storage mock,
 * vi.mock("../server/storage"), supertest + express-session with an
 * x-test-user shim. draw-feasibility is mocked so blocking/warnings can be
 * forced without provisioning published dependent tests; content-guard,
 * topic-access and upload run for real so the router's real branches execute.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
// DATABASE_URL keeps db.ts from throwing at module load (storage is mocked).
vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getQuestions: vi.fn(),
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    deleteQuestion: vi.fn(),
    deleteQuestionsBulk: vi.fn(),
    duplicateQuestion: vi.fn(),
    getTopics: vi.fn(),
    getTopic: vi.fn(),
    getTestSections: vi.fn(),
    getTest: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    // topic-access (visibleTopicScope / canManageTopicContent) storage deps
    getSharedTopicIds: vi.fn().mockResolvedValue([]),
    getTopicIdsByOwner: vi.fn().mockResolvedValue([]),
    getActiveTopicGrantsForGrantees: vi.fn().mockResolvedValue([]),
    // Медиатека Задача 15: canonicalizeEntityMedia resolves legacy addresses
    // through this before the entity is written; undefined = unresolved, left as-is.
    getMediaAssetByStorageKey: vi.fn().mockResolvedValue(undefined),
  },
}));

// draw-feasibility is mocked so the route's blocking/dry-run branches can be
// forced. content-guard imports only the type from it, so this is safe.
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

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

const dbTopic = { id: "t1", name: "JavaScript", description: null, folderId: null, ownerId: "author1", visibility: "shared", createdAt: new Date() };
// A topic the author neither owns nor is granted -> manage is denied.
const foreignTopic = { id: "t-foreign", name: "Секретная", description: null, folderId: null, ownerId: "other", visibility: "private", createdAt: new Date() };

const dbQuestion = {
  id: "q1", topicId: "t1", type: "single", prompt: "What is JS?",
  dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
  difficulty: 50, shuffleAnswers: true, tags: [],
  feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  mediaUrl: null, mediaType: null, createdAt: new Date(),
};

const EMPTY = { blocking: [], warnings: [] };
const BLOCKING = {
  blocking: [{ testId: "test1", title: "Опубликованный", status: "published", issues: [] }],
  warnings: [],
};
const WARN = {
  blocking: [],
  warnings: [{ testId: "test2", title: "Черновик", status: "draft", issues: [] }],
};

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

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(authorUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]); // admin by default
  storageMock.getSharedTopicIds.mockResolvedValue([]);
  storageMock.getTopicIdsByOwner.mockResolvedValue([]);
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getQuestion.mockResolvedValue(dbQuestion);
  storageMock.getTopic.mockResolvedValue(dbTopic);
  drawMock.assessQuestionsRemoval.mockResolvedValue(EMPTY);
  drawMock.assessQuestionChange.mockResolvedValue(EMPTY);
  app = makeApp();
});

// ─────────────────────────────────────────────────────────────────────────────
// GET / — list branches
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/questions — branches", () => {
  it("restricts the list to the visible scope for a non-admin author", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getSharedTopicIds.mockResolvedValue(["t1"]);
    storageMock.getQuestions.mockResolvedValue([
      dbQuestion,
      { ...dbQuestion, id: "q2", topicId: "t-hidden" },
    ]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    const res = await asAuthor(request(app).get("/api/questions"));
    expect(res.status).toBe(200);
    // Only the in-scope topic's question survives the filter.
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("q1");
  });

  it("500 when getQuestions throws", async () => {
    storageMock.getQuestions.mockRejectedValue(new Error("boom"));
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    const res = await asAuthor(request(app).get("/api/questions"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST / — create
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/questions — branches", () => {
  it("413 when mediaUrl is base64 (data:)", async () => {
    const res = await asAuthor(request(app).post("/api/questions").send({
      topicId: "t1", type: "single", prompt: "Q?",
      mediaUrl: "data:image/png;base64,AAAA",
    }));
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/base64/i);
  });

  it("403 content_forbidden when author cannot manage the target topic", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTopic.mockResolvedValue(foreignTopic);
    const res = await asAuthor(request(app).post("/api/questions").send({
      topicId: "t-foreign", type: "single", prompt: "Q?",
    }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
  });

  it("201 with all optional fields provided (covers default fallbacks)", async () => {
    storageMock.createQuestion.mockResolvedValue(dbQuestion);
    const res = await asAuthor(request(app).post("/api/questions").send({
      topicId: "t1", type: "single", prompt: "Q?",
      dataJson: { options: ["A"] }, correctJson: { correctIndex: 0 },
      difficulty: 80, mediaUrl: "/uploads/media/x.png", mediaType: "image",
      shuffleAnswers: false, feedback: "fb", feedbackMode: "conditional",
      feedbackCorrect: "ok", feedbackIncorrect: "no", tags: ["a", "b"],
    }));
    expect(res.status).toBe(201);
    expect(storageMock.createQuestion).toHaveBeenCalledWith(
      expect.objectContaining({ difficulty: 80, mediaType: "image", shuffleAnswers: false }),
    );
  });

  it("500 when createQuestion throws", async () => {
    storageMock.createQuestion.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(app).post("/api/questions").send({
      topicId: "t1", type: "single", prompt: "Q?",
    }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to create/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:id — update
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/questions/:id — branches", () => {
  it("413 when mediaUrl is base64", async () => {
    const res = await asAuthor(request(app).put("/api/questions/q1").send({
      mediaUrl: "data:image/png;base64,AAAA",
    }));
    expect(res.status).toBe(413);
  });

  it("404 when the question does not exist (getQuestion undefined)", async () => {
    storageMock.getQuestion.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/questions/ghost").send({ prompt: "X" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });

  it("403 when the actor cannot manage the question's topic", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getQuestion.mockResolvedValue({ ...dbQuestion, topicId: "t-foreign" });
    storageMock.getTopic.mockResolvedValue(foreignTopic);
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ prompt: "X" }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
  });

  it("403 when moving to a topic the actor cannot manage", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getQuestion.mockResolvedValue({ ...dbQuestion, topicId: "t1" });
    // manages source t1 (owner), not destination t-foreign
    storageMock.getTopic.mockImplementation((id: string) =>
      Promise.resolve(id === "t1" ? dbTopic : foreignTopic),
    );
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ topicId: "t-foreign" }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });

  it("403 for a non-admin on a dangling question (topicId null)", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getQuestion.mockResolvedValue({ ...dbQuestion, topicId: null });
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ prompt: "X" }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
  });

  it("403 for a non-admin when the question's topic no longer exists", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getQuestion.mockResolvedValue({ ...dbQuestion, topicId: "t-gone" });
    storageMock.getTopic.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ prompt: "X" }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
  });

  it("409 content_in_use when a grading/draw change blocks (published dependents)", async () => {
    drawMock.assessQuestionChange.mockResolvedValue(BLOCKING);
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ difficulty: 90 }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("content_in_use");
    expect(res.body.blocking).toHaveLength(1);
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });

  it("dry-run of a delivery-affecting edit returns wouldBlock without writing", async () => {
    drawMock.assessQuestionChange.mockResolvedValue(BLOCKING);
    const res = await asAuthor(
      request(app).put("/api/questions/q1?dryRun=true").send({ difficulty: 90 }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, wouldBlock: true });
    expect(storageMock.updateQuestion).not.toHaveBeenCalled();
  });

  it("dry-run of a topic move merges removal + change assessments", async () => {
    drawMock.assessQuestionChange.mockResolvedValue(EMPTY);
    drawMock.assessQuestionsRemoval.mockResolvedValue(EMPTY);
    const res = await asAuthor(
      request(app).put("/api/questions/q1?dryRun=true").send({ topicId: "t2", difficulty: 70 }),
    );
    expect(res.status).toBe(200);
    expect(res.body.dryRun).toBe(true);
    expect(drawMock.assessQuestionChange).toHaveBeenCalled();
    expect(drawMock.assessQuestionsRemoval).toHaveBeenCalled();
  });

  it("dry-run of a non-delivery edit short-circuits to a safe preview", async () => {
    const res = await asAuthor(
      request(app).put("/api/questions/q1?dryRun=true").send({ prompt: "only prompt" }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, wouldBlock: false });
    expect(drawMock.assessQuestionChange).not.toHaveBeenCalled();
  });

  it("attaches feasibility warnings to the success payload", async () => {
    drawMock.assessQuestionChange.mockResolvedValue(WARN);
    storageMock.updateQuestion.mockResolvedValue({ ...dbQuestion, difficulty: 90 });
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ difficulty: 90 }));
    expect(res.status).toBe(200);
    expect(res.body.warnings).toHaveLength(1);
  });

  it("404 when updateQuestion returns undefined", async () => {
    storageMock.updateQuestion.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ prompt: "X" }));
    expect(res.status).toBe(404);
  });

  it("500 when updateQuestion throws", async () => {
    storageMock.updateQuestion.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(app).put("/api/questions/q1").send({ prompt: "X" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to update/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id
// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/questions/:id — branches", () => {
  it("404 when the question does not exist (getQuestion undefined)", async () => {
    storageMock.getQuestion.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).delete("/api/questions/ghost"));
    expect(res.status).toBe(404);
  });

  it("403 when the actor cannot manage the question's topic", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getQuestion.mockResolvedValue({ ...dbQuestion, topicId: "t-foreign" });
    storageMock.getTopic.mockResolvedValue(foreignTopic);
    const res = await asAuthor(request(app).delete("/api/questions/q1"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
  });

  it("409 content_in_use when published tests depend on the question", async () => {
    drawMock.assessQuestionsRemoval.mockResolvedValue(BLOCKING);
    const res = await asAuthor(request(app).delete("/api/questions/q1"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("content_in_use");
    expect(storageMock.deleteQuestion).not.toHaveBeenCalled();
  });

  it("dry-run returns preview without deleting", async () => {
    drawMock.assessQuestionsRemoval.mockResolvedValue(BLOCKING);
    const res = await asAuthor(request(app).delete("/api/questions/q1?dryRun=true"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, wouldBlock: true });
    expect(storageMock.deleteQuestion).not.toHaveBeenCalled();
  });

  it("success carries feasibility warnings", async () => {
    drawMock.assessQuestionsRemoval.mockResolvedValue(WARN);
    storageMock.deleteQuestion.mockResolvedValue(true);
    const res = await asAuthor(request(app).delete("/api/questions/q1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.warnings).toHaveLength(1);
  });

  it("500 when deleteQuestion throws", async () => {
    storageMock.deleteQuestion.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(app).delete("/api/questions/q1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to delete/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-delete
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/questions/bulk-delete — branches", () => {
  it("400 when ids is not an array", async () => {
    const res = await asAuthor(request(app).post("/api/questions/bulk-delete").send({ ids: "q1" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ids/i);
  });

  it("403 when the actor cannot manage a question in the batch", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getQuestion.mockResolvedValue({ ...dbQuestion, topicId: "t-foreign" });
    storageMock.getTopic.mockResolvedValue(foreignTopic);
    const res = await asAuthor(request(app).post("/api/questions/bulk-delete").send({ ids: ["q1"] }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("content_forbidden");
    expect(storageMock.deleteQuestionsBulk).not.toHaveBeenCalled();
  });

  it("skips a missing question in the guard loop and still deletes", async () => {
    // First id resolves to undefined (guard skips), second resolves normally.
    storageMock.getQuestion
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(dbQuestion);
    storageMock.deleteQuestionsBulk.mockResolvedValue(1);
    const res = await asAuthor(
      request(app).post("/api/questions/bulk-delete").send({ ids: ["ghost", "q1"] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.deletedCount).toBe(1);
  });

  it("409 content_in_use when the batch hits published dependents", async () => {
    drawMock.assessQuestionsRemoval.mockResolvedValue(BLOCKING);
    const res = await asAuthor(request(app).post("/api/questions/bulk-delete").send({ ids: ["q1"] }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("content_in_use");
    expect(storageMock.deleteQuestionsBulk).not.toHaveBeenCalled();
  });

  it("dry-run returns preview without deleting", async () => {
    drawMock.assessQuestionsRemoval.mockResolvedValue(BLOCKING);
    const res = await asAuthor(
      request(app).post("/api/questions/bulk-delete?dryRun=true").send({ ids: ["q1"] }),
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ dryRun: true, wouldBlock: true });
    expect(storageMock.deleteQuestionsBulk).not.toHaveBeenCalled();
  });

  it("500 when deleteQuestionsBulk throws", async () => {
    storageMock.deleteQuestionsBulk.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(app).post("/api/questions/bulk-delete").send({ ids: ["q1"] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to delete/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/duplicate
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/questions/:id/duplicate — branches", () => {
  it("201 with the duplicated question", async () => {
    storageMock.duplicateQuestion.mockResolvedValue({ ...dbQuestion, id: "q1-copy" });
    const res = await asAuthor(request(app).post("/api/questions/q1/duplicate"));
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("q1-copy");
  });

  it("404 when the source question does not exist", async () => {
    storageMock.duplicateQuestion.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/questions/ghost/duplicate"));
    expect(res.status).toBe(404);
  });

  it("500 when duplicateQuestion throws", async () => {
    storageMock.duplicateQuestion.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(app).post("/api/questions/q1/duplicate"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to duplicate/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /export — extra branches
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/questions/export — branches", () => {
  it("merges testId and topicIds filters", async () => {
    storageMock.getQuestions.mockResolvedValue([
      dbQuestion,
      { ...dbQuestion, id: "q2", topicId: "t2" },
    ]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getTest.mockResolvedValue({ id: "test1", title: "My Test", createdAt: new Date() });
    const res = await asAuthor(request(app).get("/api/questions/export?testId=test1&topicIds=t2"));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("My_Test");
  });

  it("keeps the default filename when the test is not found", async () => {
    storageMock.getQuestions.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    storageMock.getTestSections.mockResolvedValue([{ topicId: "t1" }]);
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).get("/api/questions/export?testId=missing"));
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toContain("questions_");
  });

  it("empty topicIds param (only separators) is ignored", async () => {
    storageMock.getQuestions.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    const res = await asAuthor(request(app).get("/api/questions/export?topicIds=%20%2C%20"));
    expect(res.status).toBe(200);
  });

  it("restricts export to the visible scope for a non-admin author", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    // Author owns no topics and holds no grants -> t1 is out of scope, filtered out.
    storageMock.getQuestions.mockResolvedValue([dbQuestion]);
    storageMock.getTopics.mockResolvedValue([dbTopic]);
    const res = await asAuthor(request(app).get("/api/questions/export"));
    expect(res.status).toBe(200);
  });

  it("500 when getQuestions throws", async () => {
    storageMock.getQuestions.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(app).get("/api/questions/export"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to export/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /import — error branches
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/questions/import — error branches", () => {
  it("400 when no file is attached", async () => {
    const res = await asAuthor(request(app).post("/api/questions/import"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/file required/i);
  });

  it("500 when the uploaded buffer is not a valid workbook", async () => {
    const garbage = Buffer.from("not an xlsx file at all");
    const res = await asAuthor(
      request(app).post("/api/questions/import").attach("file", garbage, "broken.xlsx"),
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to import/i);
  });
});
