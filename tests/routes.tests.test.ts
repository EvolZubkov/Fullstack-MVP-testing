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
const { storageMock, serviceMock } = vi.hoisted(() => ({
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
    getUsers: vi.fn().mockResolvedValue([]),
    getQuestionsByTopic: vi.fn(),
    getAdaptiveTopicSettingsByTest: vi.fn(),
    getAdaptiveLevelsByTest: vi.fn(),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    // PRD-15 block D: per-test scoring overrides (none by default).
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelLinks: vi.fn(),
    deleteAdaptiveLevelLinksByTest: vi.fn(),
    deleteAdaptiveLevelsByTest: vi.fn(),
    deleteAdaptiveTopicSettingsByTest: vi.fn(),
    createAdaptiveTopicSettings: vi.fn(),
    createAdaptiveLevel: vi.fn(),
    createAdaptiveLevelLink: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    setTestOwner: vi.fn().mockResolvedValue(undefined),
    getTestAccessGrants: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    // snapshot build on publish (PRD-15 block B)
    getContentPages: vi.fn().mockResolvedValue([]),
    getTopicCourses: vi.fn().mockResolvedValue([]),
    getTopicEvents: vi.fn().mockResolvedValue([]),
    getLatestSnapshot: vi.fn().mockResolvedValue(undefined),
    createTestSnapshot: vi.fn().mockResolvedValue({ id: "snap-1", version: 1 }),
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
    getReferencedSnapshotIds: vi.fn().mockResolvedValue([]),
    deleteSnapshotById: vi.fn().mockResolvedValue(undefined),
    annulInProgressAttempts: vi.fn().mockResolvedValue(0),
    getTopic: vi.fn().mockResolvedValue({ id: "tp1", name: "Тема" }),
    // PRD-15 block D: per-(test, question) scoring overrides.
    getQuestion: vi.fn(),
    upsertTestQuestionScoring: vi.fn(),
    deleteTestQuestionScoring: vi.fn(),
  },
  serviceMock: {
    create: vi.fn(),
    save: vi.fn(),
    // GET /api/tests/:id calls reconcileExisting() as a best-effort healing
    // pass (PRD-7 G48). A no-op is fine in route tests; failures are caught
    // and logged.
    reconcileExisting: vi.fn(async () => ({ deleted: 0, created: 0 })),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage: vi.fn() }));
vi.mock("../server/template-registry", () => ({ isSupportedTemplateApiVersion: vi.fn().mockReturnValue(true) }));
// Mock the TestSettingsService singleton at the route boundary. Keep the
// real error classes so the route's instanceof checks still work end-to-end.
vi.mock("../server/services/test-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/test-settings")>();
  return { ...actual, testSettingsService: serviceMock };
});

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
    // PRD-15 FR-06 (E-12): publishing runs the draw-feasibility check over the
    // test's sections; no sections = nothing to verify.
    storageMock.getTestSections.mockResolvedValue([]);
    // PRD-15 block B: publishing also freezes a snapshot (empty test here).
    storageMock.getTopics.mockResolvedValue([]);
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

// ─── POST /:id/republish-force (PRD-15 FR-14) ─────────────────────────────────
describe("POST /api/tests/:id/republish-force", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getTopics.mockResolvedValue([]);
    app = makeApp();
  });

  it("200 — annuls in-progress attempts and creates a new snapshot", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "published" });
    storageMock.annulInProgressAttempts.mockResolvedValue(3);
    const res = await asAuthor(request(app).post("/api/tests/test1/republish-force"));
    expect(res.status).toBe(200);
    expect(res.body.annulledAttempts).toBe(3);
    expect(storageMock.annulInProgressAttempts).toHaveBeenCalledWith("test1");
    expect(storageMock.createTestSnapshot).toHaveBeenCalled();
  });

  it("400 — when the test is not published", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "draft" });
    const res = await asAuthor(request(app).post("/api/tests/test1/republish-force"));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("not_published");
    expect(storageMock.annulInProgressAttempts).not.toHaveBeenCalled();
  });

  it("409 — when the draw is infeasible, does not annul or snapshot", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "published", mode: "standard" });
    storageMock.getTestSections.mockResolvedValue([
      { id: "s1", testId: "test1", topicId: "tp1", drawCount: 5, drawAll: false, drawBlueprintJson: null },
    ]);
    storageMock.getQuestionsByTopic.mockResolvedValue([{ id: "q1", topicId: "tp1", tags: [], difficulty: 50 }]);
    storageMock.getTopic.mockResolvedValue({ id: "tp1", name: "Тема" });
    const res = await asAuthor(request(app).post("/api/tests/test1/republish-force"));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("publish_infeasible");
    expect(storageMock.annulInProgressAttempts).not.toHaveBeenCalled();
    expect(storageMock.createTestSnapshot).not.toHaveBeenCalled();
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
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    app = makeApp();
  });

  it("POST / — creates test with legacy published field (no status in body)", async () => {
    serviceMock.create.mockResolvedValue(dbTest);
    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "Legacy Test",
      sections: [{ topicId: "t1", drawCount: 3 }],
      overallPassRuleJson: { type: "percent", value: 70 },
      published: true,
    }));
    expect(res.status).toBe(201);
    expect(serviceMock.create).toHaveBeenCalled();
  });

  it("PUT /:id — updates test without status field (legacy client)", async () => {
    serviceMock.save.mockResolvedValue(dbTest);
    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "Updated",
      overallPassRuleJson: { type: "percent", value: 70 },
    }));
    expect(res.status).toBe(200);
    expect(serviceMock.save).toHaveBeenCalled();
  });

  it("PUT /:id — returns 404 when service throws status=404", async () => {
    serviceMock.save.mockRejectedValue(Object.assign(new Error("Test not found"), { status: 404 }));
    const res = await asAuthor(request(app).put("/api/tests/x").send({ title: "X" }));
    expect(res.status).toBe(404);
  });

  it("PUT /:id — returns 409 on VersionConflictError", async () => {
    const { VersionConflictError } = await import("../server/services/test-settings");
    serviceMock.save.mockRejectedValue(new VersionConflictError(7, 3));
    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "X",
      expectedVersion: 3,
    }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("version_conflict");
    expect(res.body.currentVersion).toBe(7);
    expect(res.body.expectedVersion).toBe(3);
  });

  it("PUT /:id — returns 422 on RequiredFieldsMissingError with structured fields", async () => {
    const { RequiredFieldsMissingError } = await import("../server/services/required-fields-validator");
    serviceMock.save.mockRejectedValue(new RequiredFieldsMissingError([
      { pageId: "p-intro", templateKey: "intro.hero", missingFields: ["title"] },
      { pageId: "p-summary", templateKey: "summary.text", missingFields: ["result"] },
    ]));
    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "X",
      status: "published",
    }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("required_fields_missing");
    expect(res.body.fields).toEqual([
      { pageId: "p-intro", templateKey: "intro.hero", fieldName: "title" },
      { pageId: "p-summary", templateKey: "summary.text", fieldName: "result" },
    ]);
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

  it("201 — passes PRD-7 fields (feedbackJson, telemetryEnabled, status) to service", async () => {
    serviceMock.create.mockResolvedValue(dbTest);
    await asAuthor(request(app).post("/api/tests").send({
      title: "PRD-7 Test",
      sections: [{ topicId: "t1", drawCount: 3 }],
      status: "published",
      telemetryEnabled: true,
      feedbackJson: { format: "plain", text: "Well done", links: [], assets: [] },
    }));
    const [payload] = serviceMock.create.mock.calls[0] as [{ test: Record<string, unknown> }];
    expect(payload.test.status).toBe("published");
    expect(payload.test.telemetryEnabled).toBe(true);
    expect(payload.test.feedbackJson).toMatchObject({ format: "plain", text: "Well done" });
  });
});

// ─── PUT /:id validation (PRD-7 §5.4) ────────────────────────────────────────
describe("PUT /api/tests/:id — Zod validation", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTest.mockResolvedValue(dbTest);
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
    // drawCount is z.number().int().min(0): 0 is valid ("draw all"); a non-integer
    // is the invalid case the schema's .int() rejects.
    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "T",
      sections: [{ topicId: "t1", drawCount: 1.5 }],
    }));
    expect(res.status).toBe(400);
    expect(res.body.fields.length).toBeGreaterThan(0);
  });

  it("200 — passes PRD-7 status/feedbackJson to service.save", async () => {
    serviceMock.save.mockResolvedValue(dbTest);
    await asAuthor(request(app).put("/api/tests/test1").send({
      title: "Updated",
      status: "archived",
      feedbackJson: { format: "html", text: "<p>done</p>", links: [], assets: [] },
    }));
    const [testId, payload] = serviceMock.save.mock.calls[0] as [string, { test: Record<string, unknown> }];
    expect(testId).toBe("test1");
    expect(payload.test.status).toBe("archived");
    expect(payload.test.feedbackJson).toMatchObject({ format: "html" });
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

// ─── Adaptive mode forwarding (PRD-7 §6.3) ────────────────────────────────────
// The route delegates adaptive persistence to the service: `adaptiveSettings`
// flows to the service only for `mode === "adaptive"`, and for adaptive PUT the
// `sections` field is dropped (sections live with standard mode only).
describe("POST/PUT /api/tests — adaptive mode forwarding", () => {
  let app: express.Express;

  const adaptiveSettings = [{
    topicId: "t1",
    failureFeedback: "Study more",
    levels: [{
      levelIndex: 0, levelName: "Basic",
      minDifficulty: 0, maxDifficulty: 50, questionsCount: 5, passThreshold: 70,
    }],
  }];

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getTestSections.mockResolvedValue([]);
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
    storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
    storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
    app = makeApp();
  });

  it("POST adaptive — forwards adaptiveSettings to service.create and sets mode=adaptive", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, mode: "adaptive" });
    serviceMock.create.mockResolvedValue({ ...dbTest, mode: "adaptive" });

    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "Adaptive Test",
      mode: "adaptive",
      adaptiveSettings,
    }));

    expect(res.status).toBe(201);
    const [payload] = serviceMock.create.mock.calls[0] as [{ test: { mode?: string }; adaptiveSettings?: unknown }];
    expect(payload.test.mode).toBe("adaptive");
    expect(payload.adaptiveSettings).toEqual(adaptiveSettings);
  });

  it("POST standard — does NOT forward adaptiveSettings to service.create", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    serviceMock.create.mockResolvedValue(dbTest);

    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "Standard Test",
      mode: "standard",
      sections: [{ topicId: "t1", drawCount: 3 }],
      adaptiveSettings, // present in body but must be ignored for standard mode
    }));

    expect(res.status).toBe(201);
    const [payload] = serviceMock.create.mock.calls[0] as [{ adaptiveSettings?: unknown }];
    expect(payload.adaptiveSettings).toBeUndefined();
  });

  it("PUT adaptive — forwards adaptiveSettings and drops sections (§6.3)", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, mode: "adaptive" });
    serviceMock.save.mockResolvedValue({ ...dbTest, mode: "adaptive" });

    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "Adaptive Updated",
      mode: "adaptive",
      sections: [{ topicId: "t1", drawCount: 3 }], // should be ignored for adaptive
      adaptiveSettings,
    }));

    expect(res.status).toBe(200);
    const [testId, payload] = serviceMock.save.mock.calls[0] as [string, { sections?: unknown; adaptiveSettings?: unknown }];
    expect(testId).toBe("test1");
    expect(payload.adaptiveSettings).toEqual(adaptiveSettings);
    expect(payload.sections).toBeUndefined();
  });
});

// ─── Legacy read-path: a pre-PRD-7 test opens through the new single-test GET ──
describe("GET /api/tests/:id — legacy test opens", () => {
  let app: express.Express;

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS" }]);
    storageMock.getQuestionsByTopic.mockResolvedValue([]);
    app = makeApp();
  });

  it("200 — legacy published test (published=true) loads with sections", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "published", published: true });
    storageMock.getTestSections.mockResolvedValue([dbSection]);

    const res = await asAuthor(request(app).get("/api/tests/test1"));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("published");
    expect(Array.isArray(res.body.sections)).toBe(true);
    expect(res.body.sections[0].topicName).toBe("JS");
  });
});

// ─── PRD-15 block D: per-(test, question) scoring overrides (FR-30/FR-35) ────
describe("PUT/DELETE /api/tests/:id/question-scoring/:questionId", () => {
  let app: express.Express;
  const dbQuestion = {
    id: "q1", topicId: "t1", type: "single", prompt: "Q?",
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    points: 1, difficulty: 50, scoringJson: null, contentHash: "h-current",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getQuestion.mockResolvedValue(dbQuestion);
    storageMock.upsertTestQuestionScoring.mockImplementation(
      async (testId: string, questionId: string, values: Record<string, unknown>) =>
        ({ id: "ov1", testId, questionId, ...values }),
    );
    storageMock.deleteTestQuestionScoring.mockResolvedValue(true);
    storageMock.updateTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("PUT — upserts pinned to the question's current contentHash and bumps the version", async () => {
    const res = await asAuthor(request(app)
      .put("/api/tests/test1/question-scoring/q1")
      .send({ points: 5, difficulty: 90 }));
    expect(res.status).toBe(200);
    expect(storageMock.upsertTestQuestionScoring).toHaveBeenCalledWith("test1", "q1", {
      points: 5,
      scoringJson: null,
      difficulty: 90,
      pinnedContentHash: "h-current",
    });
    // FR-12: the edit must surface as «Опубликован, есть изменения».
    expect(storageMock.updateTest).toHaveBeenCalledWith("test1", {});
  });

  it("PUT — accepts a graded config and a zero price", async () => {
    const scoring = { kind: "weighted", weights: [1, 0] };
    const res = await asAuthor(request(app)
      .put("/api/tests/test1/question-scoring/q1")
      .send({ points: 0, scoringJson: scoring }));
    expect(res.status).toBe(200);
    expect(storageMock.upsertTestQuestionScoring).toHaveBeenCalledWith("test1", "q1",
      expect.objectContaining({ points: 0, scoringJson: scoring }));
  });

  it("PUT — an all-empty body clears the override instead of storing a no-op row", async () => {
    const res = await asAuthor(request(app)
      .put("/api/tests/test1/question-scoring/q1")
      .send({}));
    expect(res.status).toBe(200);
    expect(res.body.cleared).toBe(true);
    expect(storageMock.deleteTestQuestionScoring).toHaveBeenCalledWith("test1", "q1");
    expect(storageMock.upsertTestQuestionScoring).not.toHaveBeenCalled();
  });

  it("PUT — 422 when the question is outside the test's topics", async () => {
    storageMock.getQuestion.mockResolvedValue({ ...dbQuestion, topicId: "other-topic" });
    const res = await asAuthor(request(app)
      .put("/api/tests/test1/question-scoring/q1")
      .send({ points: 5 }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("question_not_in_test");
  });

  it("PUT — 404 for a missing question; 400 for an invalid graded config", async () => {
    storageMock.getQuestion.mockResolvedValue(undefined);
    const missing = await asAuthor(request(app)
      .put("/api/tests/test1/question-scoring/q1")
      .send({ points: 5 }));
    expect(missing.status).toBe(404);

    storageMock.getQuestion.mockResolvedValue(dbQuestion);
    const invalid = await asAuthor(request(app)
      .put("/api/tests/test1/question-scoring/q1")
      .send({ scoringJson: { kind: "weighted" } })); // weights missing
    expect(invalid.status).toBe(400);
  });

  it("DELETE — resets the override and bumps the version; 404 when absent", async () => {
    const ok = await asAuthor(request(app).delete("/api/tests/test1/question-scoring/q1"));
    expect(ok.status).toBe(200);
    expect(storageMock.deleteTestQuestionScoring).toHaveBeenCalledWith("test1", "q1");
    expect(storageMock.updateTest).toHaveBeenCalledWith("test1", {});

    storageMock.deleteTestQuestionScoring.mockResolvedValue(false);
    const gone = await asAuthor(request(app).delete("/api/tests/test1/question-scoring/q1"));
    expect(gone.status).toBe(404);
  });
});
