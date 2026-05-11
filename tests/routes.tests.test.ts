/**
 * @module tests/routes.tests
 * @description Tests for new PRD-7 endpoints in server/routes/tests.ts:
 *   - PATCH /api/tests/:id/status  (§5.2 — status change, no version bump)
 *   - DELETE /api/tests/:id        (§5.2 — confirmTitle required)
 *   - POST /api/tests/:id/restore  (§5.2 — archived -> draft)
 *   - GET /api/tests?status=archived  (filter, §5.1)
 *
 * Backward-compat scenarios for existing POST / PUT are also exercised.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getTests: vi.fn(),
    createTest: vi.fn(),
    updateTest: vi.fn(),
    deleteTest: vi.fn(),
    patchTestStatus: vi.fn(),
    getMigrationHealth: vi.fn(),
    getTestSections: vi.fn(),
    getTopics: vi.fn(),
    getQuestionsByTopic: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(),
    getAdaptiveLevelsByTest: vi.fn(),
    getAdaptiveLevelLinks: vi.fn(),
    deleteAdaptiveLevelLinksByTest: vi.fn(),
    deleteAdaptiveLevelsByTest: vi.fn(),
    deleteAdaptiveTopicSettingsByTest: vi.fn(),
    createAdaptiveTopicSettings: vi.fn(),
    createAdaptiveLevel: vi.fn(),
    createAdaptiveLevelLink: vi.fn(),
    getUser: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage: vi.fn() }));
vi.mock("../server/template-registry", () => ({ isSupportedTemplateApiVersion: vi.fn().mockReturnValue(true) }));

import testsRouter from "../server/routes/tests";

// ─── App helpers ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
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
  app.use("/api/tests", testsRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const dbTest = {
  id: "test1", title: "My Test", mode: "standard", version: 3,
  status: "draft", published: false,
  overallPassRuleJson: { type: "percent", value: 70 },
  description: null, feedback: null, feedbackJson: null, flowPolicyJson: null,
  webhookUrl: null, showDifficultyLevel: true, startPageContent: null,
  showCorrectAnswers: false, timeLimitMinutes: null, maxAttempts: null,
  telemetryEnabled: false, folderId: null, designSettingsJson: {},
  createdAt: new Date(), updatedAt: new Date(),
};

const dbSection = { id: "sec1", testId: "test1", topicId: "t1", drawCount: 5, topicPassRuleJson: null, required: true, timeLimitMinutes: null, feedbackJson: null };

// ─── GET / with status filter ────────────────────────────────────────────────
describe("GET /api/tests — status filter", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    app = makeApp();
  });

  it("default — excludes archived tests", async () => {
    storageMock.getTests.mockResolvedValue([
      { ...dbTest, status: "draft" },
      { ...dbTest, id: "t2", status: "archived" },
    ]);
    const res = await asAuthor(request(app).get("/api/tests"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("draft");
  });

  it("?status=archived — returns only archived tests", async () => {
    storageMock.getTests.mockResolvedValue([
      { ...dbTest, status: "draft" },
      { ...dbTest, id: "t2", status: "archived", title: "Old Test" },
    ]);
    const res = await asAuthor(request(app).get("/api/tests?status=archived"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].status).toBe("archived");
  });

  it("includes both draft and published in default response", async () => {
    storageMock.getTests.mockResolvedValue([
      { ...dbTest, status: "draft" },
      { ...dbTest, id: "t2", status: "published" },
    ]);
    const res = await asAuthor(request(app).get("/api/tests"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ─── PATCH /:id/status ───────────────────────────────────────────────────────
describe("PATCH /api/tests/:id/status", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp();
  });

  it("200 — updates status and returns id/status/version", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.patchTestStatus.mockResolvedValue({ id: "test1", status: "published", version: 3 });
    const res = await asAuthor(request(app).patch("/api/tests/test1/status").send({ status: "published" }));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(res.body.id).toBe("test1");
    expect(storageMock.patchTestStatus).toHaveBeenCalledWith("test1", "published");
  });

  it("200 — skips version check when expectedVersion absent", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.patchTestStatus.mockResolvedValue({ id: "test1", status: "archived", version: 3 });
    const res = await asAuthor(request(app).patch("/api/tests/test1/status").send({ status: "archived" }));
    expect(res.status).toBe(200);
  });

  it("409 — version conflict when expectedVersion mismatches", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, version: 5 });
    const res = await asAuthor(
      request(app).patch("/api/tests/test1/status").send({ status: "published", expectedVersion: 3 }),
    );
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("version_conflict");
    expect(res.body.currentVersion).toBe(5);
    expect(res.body.expectedVersion).toBe(3);
    expect(storageMock.patchTestStatus).not.toHaveBeenCalled();
  });

  it("200 — succeeds when expectedVersion matches", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, version: 3 });
    storageMock.patchTestStatus.mockResolvedValue({ id: "test1", status: "draft", version: 3 });
    const res = await asAuthor(
      request(app).patch("/api/tests/test1/status").send({ status: "draft", expectedVersion: 3 }),
    );
    expect(res.status).toBe(200);
  });

  it("400 — invalid status value", async () => {
    const res = await asAuthor(request(app).patch("/api/tests/test1/status").send({ status: "active" }));
    expect(res.status).toBe(400);
    expect(res.body.field).toBe("status");
  });

  it("404 — test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).patch("/api/tests/x/status").send({ status: "draft" }));
    expect(res.status).toBe(404);
  });

  it("401 — unauthenticated request", async () => {
    const res = await request(app).patch("/api/tests/test1/status").send({ status: "draft" });
    expect(res.status).toBe(401);
  });
});

// ─── POST /:id/restore ────────────────────────────────────────────────────────
describe("POST /api/tests/:id/restore", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp();
  });

  it("204 — restores archived test to draft", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "archived" });
    storageMock.patchTestStatus.mockResolvedValue({ id: "test1", status: "draft", version: 3 });
    const res = await asAuthor(request(app).post("/api/tests/test1/restore"));
    expect(res.status).toBe(204);
    expect(storageMock.patchTestStatus).toHaveBeenCalledWith("test1", "draft");
  });

  it("400 — test is not archived", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "draft" });
    const res = await asAuthor(request(app).post("/api/tests/test1/restore"));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_archived");
  });

  it("404 — test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).post("/api/tests/x/restore"));
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /:id with confirmTitle ───────────────────────────────────────────
describe("DELETE /api/tests/:id — confirmTitle", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.deleteAdaptiveLevelLinksByTest.mockResolvedValue(undefined);
    storageMock.deleteAdaptiveLevelsByTest.mockResolvedValue(undefined);
    storageMock.deleteAdaptiveTopicSettingsByTest.mockResolvedValue(undefined);
    storageMock.deleteTest.mockResolvedValue(true);
    app = makeApp();
  });

  it("204 — deletes when confirmTitle matches exactly", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(
      request(app).delete("/api/tests/test1").send({ confirmTitle: "My Test" }),
    );
    expect(res.status).toBe(204);
    expect(storageMock.deleteTest).toHaveBeenCalledWith("test1");
  });

  it("400 — title_mismatch when confirmTitle differs", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(
      request(app).delete("/api/tests/test1").send({ confirmTitle: "wrong title" }),
    );
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("title_mismatch");
    expect(storageMock.deleteTest).not.toHaveBeenCalled();
  });

  it("400 — title_mismatch is case-sensitive", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(
      request(app).delete("/api/tests/test1").send({ confirmTitle: "my test" }),
    );
    expect(res.status).toBe(400);
  });

  it("400 — missing confirmTitle", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(request(app).delete("/api/tests/test1").send({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("title_mismatch");
  });

  it("404 — test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(
      request(app).delete("/api/tests/x").send({ confirmTitle: "anything" }),
    );
    expect(res.status).toBe(404);
  });
});

// ─── Backward compat: POST / and PUT /:id unchanged ──────────────────────────
describe("Backward compat — POST / and PUT /:id", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    app = makeApp();
  });

  it("POST / — creates test with legacy published field (no status in body)", async () => {
    storageMock.createTest.mockResolvedValue(dbTest);
    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "Legacy Test",
      sections: [{ topicId: "t1", drawCount: 3 }],
      overallPassRuleJson: { type: "percent", value: 70 },
      published: true,
    }));
    expect(res.status).toBe(201);
    expect(storageMock.createTest).toHaveBeenCalled();
  });

  it("PUT /:id — updates test without status field (legacy client)", async () => {
    storageMock.updateTest.mockResolvedValue(dbTest);
    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "Updated",
      overallPassRuleJson: { type: "percent", value: 70 },
    }));
    expect(res.status).toBe(200);
    expect(storageMock.updateTest).toHaveBeenCalled();
  });

  it("PUT /:id — returns 404 when not found", async () => {
    storageMock.updateTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(app).put("/api/tests/x").send({ title: "X" }));
    expect(res.status).toBe(404);
  });
});

// ─── POST / validation (PRD-7 §5.4) ──────────────────────────────────────────
describe("POST /api/tests — Zod validation", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    app = makeApp();
  });

  it("400 — missing title returns structured fields error", async () => {
    const res = await asAuthor(request(app).post("/api/tests").send({
      sections: [{ topicId: "t1", drawCount: 3 }],
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(Array.isArray(res.body.fields)).toBe(true);
    expect(res.body.fields.some((f: { field: string }) => f.field === "title")).toBe(true);
  });

  it("400 — invalid status enum returns structured error", async () => {
    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "T",
      sections: [{ topicId: "t1", drawCount: 3 }],
      status: "invalid_status",
    }));
    expect(res.status).toBe(400);
    expect(res.body.fields.some((f: { field: string }) => f.field === "status")).toBe(true);
  });

  it("400 — invalid webhookUrl returns structured error", async () => {
    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "T",
      sections: [{ topicId: "t1", drawCount: 3 }],
      webhookUrl: "not-a-url",
    }));
    expect(res.status).toBe(400);
    expect(res.body.fields.some((f: { field: string }) => f.field === "webhookUrl")).toBe(true);
  });

  it("201 — passes PRD-7 fields (feedbackJson, telemetryEnabled, status) to storage", async () => {
    storageMock.createTest.mockResolvedValue(dbTest);
    await asAuthor(request(app).post("/api/tests").send({
      title: "PRD-7 Test",
      sections: [{ topicId: "t1", drawCount: 3 }],
      status: "published",
      telemetryEnabled: true,
      feedbackJson: { format: "plain", text: "Well done", links: [], assets: [] },
    }));
    const [callArgs] = storageMock.createTest.mock.calls[0] as [Record<string, unknown>, unknown[]];
    expect(callArgs.status).toBe("published");
    expect(callArgs.telemetryEnabled).toBe(true);
    expect(callArgs.feedbackJson).toMatchObject({ format: "plain", text: "Well done" });
  });
});

// ─── PUT /:id validation (PRD-7 §5.4) ────────────────────────────────────────
describe("PUT /api/tests/:id — Zod validation", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    app = makeApp();
  });

  it("400 — invalid mode enum returns structured error", async () => {
    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "T",
      mode: "unknown_mode",
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
    expect(res.body.fields.some((f: { field: string }) => f.field === "mode")).toBe(true);
  });

  it("400 — invalid section drawCount (non-integer) returns structured error", async () => {
    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "T",
      sections: [{ topicId: "t1", drawCount: 0 }],
    }));
    expect(res.status).toBe(400);
    expect(res.body.fields.length).toBeGreaterThan(0);
  });

  it("200 — passes PRD-7 status/feedbackJson to updateTest", async () => {
    storageMock.updateTest.mockResolvedValue(dbTest);
    await asAuthor(request(app).put("/api/tests/test1").send({
      title: "Updated",
      status: "archived",
      feedbackJson: { format: "html", text: "<p>done</p>", links: [], assets: [] },
    }));
    const [, callPatch] = storageMock.updateTest.mock.calls[0] as [string, Record<string, unknown>];
    expect(callPatch.status).toBe("archived");
    expect(callPatch.feedbackJson).toMatchObject({ format: "html" });
  });
});

// ─── GET /migration-health ────────────────────────────────────────────────────
describe("GET /api/tests/migration-health", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    app = makeApp();
  });

  it("200 — returns legacyStartPageCount", async () => {
    storageMock.getMigrationHealth.mockResolvedValue({ legacyStartPageCount: 0 });
    const res = await asAuthor(request(app).get("/api/tests/migration-health"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("legacyStartPageCount");
  });

  it("401 — unauthenticated", async () => {
    const res = await request(app).get("/api/tests/migration-health");
    expect(res.status).toBe(401);
  });
});
