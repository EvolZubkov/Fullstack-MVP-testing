/**
 * @module tests/media-usage-on-bulk-paths
 * @description Covers the media usage index (`media_usages`) on the write paths that
 * bypass the single-entity route handlers already covered by
 * `tests/media-usage-on-question-save.test.ts` / `media-usage-on-content-save.test.ts`:
 *
 *   - Excel question import (`server/services/questions-import.ts`) — creates/updates
 *     questions directly via `storage`, never through `POST/PUT /api/questions`.
 *   - Question duplication (`POST /api/questions/:id/duplicate`) — the copy is a NEW
 *     entity with its own id; it must be indexed under THAT id, not the original's.
 *   - Topic duplication (`POST /api/topics/:id/duplicate`) — duplicates every question
 *     of the topic in one call; each copy must be indexed under its own id.
 *
 * Without this, a learner is refused a picture that an imported/duplicated question
 * DOES have — the delivery rule (`server/services/media/asset-access.ts`) grants access
 * only through a `media_usages` row, and the public `/uploads` static fallback is off.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// `server/db.ts` throws at import time without DATABASE_URL; storage is mocked below
// so the real module never runs, but questions.ts/topics.ts import it transitively.
vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { syncEntityUsagesMock } = vi.hoisted(() => ({
  syncEntityUsagesMock: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../server/services/media/usage-index", () => ({
  syncEntityUsages: syncEntityUsagesMock,
  // canonicalizeEntityMedia is imported by routes/questions.ts alongside
  // syncEntityUsages; pass payloads through unchanged.
  canonicalizeEntityMedia: vi.fn().mockImplementation(async (entity: unknown) => entity),
}));

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    // Excel import (questions-import.ts)
    getTopics: vi.fn(),
    getContentHashesByTopic: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getQuestion: vi.fn(),
    createQuestion: vi.fn(),
    updateQuestion: vi.fn(),
    createTopic: vi.fn(),
    // Route auth (requirePermission -> getEffectiveRoles)
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
    // Duplication routes
    duplicateQuestion: vi.fn(),
    duplicateTopicWithQuestions: vi.fn(),
  },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { importQuestionRows } from "../server/services/questions-import";
import questionsRouter from "../server/routes/questions";
import topicsRouter from "../server/routes/topics";

const author = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};

function makeApp(router: express.Router, mount: string) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res, next) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use(mount, router);
  return app;
}

function asAuthor(req: request.Test) {
  return req.set("x-test-user", "author1");
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(author);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Excel import — server/services/questions-import.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("questions-import.ts -> media usage index", () => {
  beforeEach(() => {
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "Тема" }]);
    storageMock.getContentHashesByTopic.mockResolvedValue(new Set());
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
  });

  const row = (overrides: Record<string, unknown> = {}) => ({
    "Тема": "Тема",
    "Тип вопроса": "multiple_choice",
    "Текст вопроса": "Что на картинке?",
    "Сложность": 50,
    "Тексты вариантов ответа": "A#B",
    "Номера правильных ответов": "1",
    "Следование вариантов ответов": "Random",
    ...overrides,
  });

  it("indexes a newly created question carrying media", async () => {
    const created = {
      id: "q-new-1",
      topicId: "t1",
      type: "single",
      prompt: "Что на картинке?",
      dataJson: { options: ["A", "B"] },
      mediaUrl: "/api/media/11111111-1111-1111-1111-111111111111",
    };
    storageMock.createQuestion.mockResolvedValue(created);

    const result = await importQuestionRows(
      [row()],
      new Set(Object.keys(row())),
      { dryRun: false },
    );

    expect(result.created).toBe(1);
    expect(syncEntityUsagesMock).toHaveBeenCalledWith("question", "q-new-1", created);
  });

  it("does not index anything in a dry run (nothing was actually written)", async () => {
    await importQuestionRows([row()], new Set(Object.keys(row())), { dryRun: true });

    expect(storageMock.createQuestion).not.toHaveBeenCalled();
    expect(syncEntityUsagesMock).not.toHaveBeenCalled();
  });

  it("indexes an updated question (import row carries an existing ID)", async () => {
    // difficulty matches the row's "Сложность" (50) so the update does not
    // touch grading/draw fields and skip the draw-feasibility check (not the
    // concern of this test — see routes.questions-import-export.test.ts).
    const existing = { id: "q1", topicId: "t1", type: "single", prompt: "Old", tags: [], difficulty: 50, contentHash: "old-hash" };
    const updated = {
      ...existing,
      prompt: "Что на картинке?",
      mediaUrl: "/api/media/22222222-2222-2222-2222-222222222222",
    };
    storageMock.getQuestion.mockResolvedValue(existing);
    storageMock.updateQuestion.mockResolvedValue(updated);

    const result = await importQuestionRows(
      [row({ "ID": "q1" })],
      new Set(Object.keys(row({ "ID": "q1" }))),
      { dryRun: false },
    );

    expect(result.updated).toBe(1);
    expect(syncEntityUsagesMock).toHaveBeenCalledWith("question", "q1", updated);
  });

  it("a sync failure is logged, not thrown — the import result is unaffected", async () => {
    storageMock.createQuestion.mockResolvedValue({ id: "q-new-2", topicId: "t1" });
    syncEntityUsagesMock.mockRejectedValueOnce(new Error("index write failed"));

    const result = await importQuestionRows([row()], new Set(Object.keys(row())), { dryRun: false });

    expect(result.created).toBe(1);
    expect(result.errors).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/questions/:id/duplicate — server/routes/questions.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/questions/:id/duplicate -> media usage index", () => {
  it("indexes the duplicate under ITS OWN id, not the original question's id", async () => {
    const duplicate = {
      id: "q-copy-1",
      topicId: "t1",
      prompt: "Original (копия)",
      mediaUrl: "/api/media/33333333-3333-3333-3333-333333333333",
    };
    storageMock.duplicateQuestion.mockResolvedValue(duplicate);

    const app = makeApp(questionsRouter, "/api/questions");
    const res = await asAuthor(request(app).post("/api/questions/q-original/duplicate"));

    expect(res.status).toBe(201);
    expect(storageMock.duplicateQuestion).toHaveBeenCalledWith("q-original");
    expect(syncEntityUsagesMock).toHaveBeenCalledWith("question", "q-copy-1", duplicate);
    // Never indexed under the source question's id.
    expect(syncEntityUsagesMock).not.toHaveBeenCalledWith("question", "q-original", expect.anything());
  });

  it("404 when the source question is gone — nothing to index", async () => {
    storageMock.duplicateQuestion.mockResolvedValue(undefined);

    const app = makeApp(questionsRouter, "/api/questions");
    const res = await asAuthor(request(app).post("/api/questions/missing/duplicate"));

    expect(res.status).toBe(404);
    expect(syncEntityUsagesMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/topics/:id/duplicate — server/routes/topics.ts
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/topics/:id/duplicate -> media usage index", () => {
  it("indexes every duplicated question under its OWN new id", async () => {
    const dup1 = { id: "q-copy-1", topicId: "t-copy", mediaUrl: "/api/media/44444444-4444-4444-4444-444444444444" };
    const dup2 = { id: "q-copy-2", topicId: "t-copy", mediaUrl: null };
    storageMock.duplicateTopicWithQuestions.mockResolvedValue({
      topic: { id: "t-copy", name: "Тема (копия)" },
      questions: [dup1, dup2],
    });

    const app = makeApp(topicsRouter, "/api/topics");
    const res = await asAuthor(request(app).post("/api/topics/t-original/duplicate"));

    expect(res.status).toBe(201);
    expect(syncEntityUsagesMock).toHaveBeenCalledWith("question", "q-copy-1", dup1);
    expect(syncEntityUsagesMock).toHaveBeenCalledWith("question", "q-copy-2", dup2);
    // The copy is a NEW topic pointing at the same feedback files, so it needs its own
    // `topic_feedback` row (PRD-32) — here the source carries no feedback, so the row set
    // is empty, but the call must happen or the copy's attachments would be refused.
    expect(syncEntityUsagesMock).toHaveBeenCalledWith("topic_feedback", "t-copy", null);
    expect(syncEntityUsagesMock).toHaveBeenCalledTimes(3);
  });

  it("404 when the source topic is gone — nothing to index", async () => {
    storageMock.duplicateTopicWithQuestions.mockResolvedValue(undefined);

    const app = makeApp(topicsRouter, "/api/topics");
    const res = await asAuthor(request(app).post("/api/topics/missing/duplicate"));

    expect(res.status).toBe(404);
    expect(syncEntityUsagesMock).not.toHaveBeenCalled();
  });
});
