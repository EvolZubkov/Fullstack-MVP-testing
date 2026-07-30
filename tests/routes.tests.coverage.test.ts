/**
 * @module tests/routes.tests.coverage
 * @description Branch-coverage tests for server/routes/tests.ts. Complements the
 *   happy-path suite in tests/routes.tests.test.ts by exercising the ERROR,
 *   PERMISSION and VALIDATION branches: 400/403/404/409/422 short-circuits and
 *   the 500 catch blocks. Harness (storage/service/db/module mocks + the
 *   session-injecting middleware) is copied from tests/routes.tests.test.ts and
 *   extended with the access/owner/scope storage methods those branches touch.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const {
  storageMock,
  serviceMock,
  generateScormMock,
  buildExportMock,
  apiVersionMock,
  screenTplMock,
  contentTemplatesMock,
  tplDirMock,
  dbState,
} = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getTests: vi.fn(),
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
    getAdaptiveLevels: vi.fn().mockResolvedValue([]),
    getResultVariables: vi.fn().mockResolvedValue([]),
    getScales: vi.fn().mockResolvedValue([]),
    getQuestionMeasurements: vi.fn().mockResolvedValue([]),
    getTestQuestionScoring: vi.fn().mockResolvedValue([]),
    getAdaptiveLevelLinks: vi.fn().mockResolvedValue([]),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    setTestOwner: vi.fn().mockResolvedValue(undefined),
    // PRD-13 object-scope helpers.
    getTestAccessGrants: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
    isTestAssignedToUser: vi.fn().mockResolvedValue(false),
    upsertTestAccessGrant: vi.fn(),
    removeTestAccessGrant: vi.fn(),
    // PRD-15 block C topic-access helper (used by firstInvisibleTopic).
    getActiveTopicGrantsForGrantees: vi.fn().mockResolvedValue([]),
    // snapshot build on publish (PRD-15 block B).
    getContentPages: vi.fn().mockResolvedValue([]),
    getContentPageBindings: vi.fn().mockResolvedValue([]),
    getTopicCourses: vi.fn().mockResolvedValue([]),
    getTopicEvents: vi.fn().mockResolvedValue([]),
    getQuestionsByIds: vi.fn().mockResolvedValue([]),
    getLatestSnapshot: vi.fn().mockResolvedValue(undefined),
    createTestSnapshot: vi.fn().mockResolvedValue({ id: "snap-1", version: 1 }),
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
    getReferencedSnapshotIds: vi.fn().mockResolvedValue([]),
    deleteSnapshotById: vi.fn().mockResolvedValue(undefined),
    annulInProgressAttempts: vi.fn().mockResolvedValue(0),
    getTopic: vi.fn().mockResolvedValue({ id: "t1", name: "Тема" }),
    // PRD-15 block D: per-(test, question) scoring overrides.
    getQuestion: vi.fn(),
    upsertTestQuestionScoring: vi.fn(),
    deleteTestQuestionScoring: vi.fn(),
    // SCORM telemetry.
    createScormPackage: vi.fn().mockResolvedValue(undefined),
  },
  serviceMock: {
    create: vi.fn(),
    save: vi.fn(),
    reconcileExisting: vi.fn(async () => ({ deleted: 0, created: 0 })),
  },
  generateScormMock: vi.fn(),
  buildExportMock: vi.fn(),
  apiVersionMock: vi.fn().mockReturnValue(true),
  screenTplMock: vi.fn(),
  contentTemplatesMock: vi.fn(() => [] as Array<Record<string, unknown>>),
  tplDirMock: vi.fn(async () => "template/dir"),
  dbState: { templates: [] as Array<Record<string, unknown>> },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
// Configurable Drizzle chain: `db.select().from(t).where(cond)` resolves to
// dbState.templates (the design route reads the active template row this way).
vi.mock("../server/db", () => ({
  db: { select: () => ({ from: () => ({ where: () => Promise.resolve(dbState.templates) }) }) },
}));
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage: generateScormMock }));
// Keep the real ScormBuildError class (route's instanceof) but stub the assembler.
vi.mock("../server/scorm/build-export-data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/scorm/build-export-data")>();
  return { ...actual, buildScormExportData: buildExportMock };
});
vi.mock("../server/template-registry", () => ({ isSupportedTemplateApiVersion: apiVersionMock }));
vi.mock("../server/services/template-render", () => ({
  readScreenTemplate: screenTplMock,
  // PRD-22: the start screen resolves its illustration against the VARIANT's
  // declaration, so the route reads the manifest's contentTemplates too.
  readManifestContentTemplates: () => contentTemplatesMock(),
  readVariantLayouts: () => ({}),
}));
vi.mock("../server/services/template-dir", () => ({
  resolveTemplateDir: tplDirMock,
  resolveSystemScreenDir: tplDirMock,
}));
// Mock the TestSettingsService singleton at the route boundary; keep the real
// error classes so instanceof checks in the route still work.
vi.mock("../server/services/test-settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/test-settings")>();
  return { ...actual, testSettingsService: serviceMock };
});

import testsRouter from "../server/routes/tests";
import { ScormBuildError } from "../server/scorm/build-export-data";
import { FlowPolicyValidationError } from "../server/services/flow-policy-validator";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const adminUser = {
  id: "admin1", email: "admin@test.com", name: "Admin", role: "administrator",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const authorUser = { ...adminUser, id: "author1", email: "author@test.com", name: "Author", role: "author" };
const genericUser = { ...adminUser, id: "someone", email: "u@test.com", name: "User" };

const dbTest = {
  id: "test1", title: "My Test", mode: "standard", version: 3,
  status: "draft", published: false, ownerId: null,
  overallPassRuleJson: { type: "percent", value: 70 },
  description: null, feedback: null, feedbackJson: null, flowPolicyJson: null,
  webhookUrl: null, showDifficultyLevel: true, startPageContent: null,
  showCorrectAnswers: false, timeLimitMinutes: null, maxAttempts: null,
  telemetryEnabled: false, folderId: null, designSettingsJson: {},
  createdAt: new Date(), updatedAt: new Date(),
};
const dbSection = { id: "sec1", testId: "test1", topicId: "t1", drawCount: 5, drawAll: false, topicPassRuleJson: null, required: true, timeLimitMinutes: null, feedbackJson: null, drawBlueprintJson: null, formSetJson: null };

// ─── App helpers ──────────────────────────────────────────────────────────────
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
function asAdmin(req: request.Test) { return req.set("x-test-user", "admin1"); }
function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }

/** Reset all mocks and re-arm the common defaults each branch relies on. */
function resetDefaults() {
  vi.clearAllMocks();
  storageMock.getUser.mockImplementation(async (id: string) =>
    id === "admin1" ? adminUser : id === "author1" ? authorUser : genericUser);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUsers.mockResolvedValue([]);
  storageMock.getTopics.mockResolvedValue([{ id: "t1", name: "JS", code: null }]);
  storageMock.getTestSections.mockResolvedValue([]);
  storageMock.getQuestionsByTopic.mockResolvedValue([]);
  storageMock.getAdaptiveTopicSettingsByTest.mockResolvedValue([]);
  storageMock.getAdaptiveLevelsByTest.mockResolvedValue([]);
  storageMock.getTestQuestionScoring.mockResolvedValue([]);
  storageMock.getResultVariables.mockResolvedValue([]);
  storageMock.getScales.mockResolvedValue([]);
  storageMock.getQuestionMeasurements.mockResolvedValue([]);
  storageMock.getLatestSnapshot.mockResolvedValue(undefined);
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
  storageMock.isTestAssignedToUser.mockResolvedValue(false);
  storageMock.getActiveTopicGrantsForGrantees.mockResolvedValue([]);
  storageMock.getTestAccessGrants.mockResolvedValue([]);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  apiVersionMock.mockReturnValue(true);
  serviceMock.reconcileExisting.mockResolvedValue({ deleted: 0, created: 0 });
}

// ─── GET / — list scope + 500 ─────────────────────────────────────────────────
describe("GET /api/tests — scope filter and error branch", () => {
  let app: express.Express;
  beforeEach(() => { resetDefaults(); app = makeApp(); });

  it("non-admin author sees only owned/granted tests (scope.all=false)", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTestIdsByOwner.mockResolvedValue(["test1"]);
    storageMock.getTests.mockResolvedValue([
      { ...dbTest, id: "test1", ownerId: "author1" },
      { ...dbTest, id: "test2" },
    ]);
    const res = await asAuthor(request(app).get("/api/tests"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("test1");
  });

  it("500 when storage.getTests throws", async () => {
    storageMock.getTests.mockRejectedValue(new Error("db down"));
    const res = await asAdmin(request(app).get("/api/tests"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch tests");
  });
});

// ─── GET /:id/screen-template/:screen ─────────────────────────────────────────
describe("GET /api/tests/:id/screen-template/:screen", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("400 for an unknown screen name", async () => {
    const res = await asAdmin(request(app).get("/api/tests/test1/screen-template/nope"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unknown screen");
  });

  it("404 when the template payload cannot be read", async () => {
    screenTplMock.mockReturnValue(null);
    const res = await asAdmin(request(app).get("/api/tests/test1/screen-template/start"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Template not found");
  });

  it("200 returns the resolved template payload", async () => {
    screenTplMock.mockReturnValue({ layout: "<div></div>", css: "", theme: {} });
    const res = await asAdmin(request(app).get("/api/tests/test1/screen-template/question"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("layout");
  });

  // PRD-22: the start illustration is a PROPERTY of the start page; the test-wide
  // branding param stays the fallback. The web host resolves it here so its start
  // screen shows the same picture the SCORM package does.
  it("the start page's own illustration overrides the branding param", async () => {
    storageMock.getTest.mockResolvedValue({
      ...dbTest,
      designSettingsJson: { templateId: "default", params: { startImageUrl: { url: "/uploads/media/brand.png" } } },
    });
    storageMock.getContentPages.mockResolvedValue([
      { id: "p1", kind: "start", templateKey: "start.image-right", settingsJson: { image: "/uploads/media/page.png" } },
    ]);
    contentTemplatesMock.mockReturnValue([
      { key: "start.image-right", settings: [{ key: "image", type: "image" }] },
    ]);
    screenTplMock.mockReturnValue({
      layout: "<div></div>", css: "", theme: {},
      design: { logoUrl: "/uploads/media/logo.png", startImageUrl: "/uploads/media/brand.png" },
    });
    const res = await asAdmin(request(app).get("/api/tests/test1/screen-template/start"));
    expect(res.status).toBe(200);
    expect(res.body.design.startImageUrl).toBe("/uploads/media/page.png");
    // Other branding survives the override.
    expect(res.body.design.logoUrl).toBe("/uploads/media/logo.png");
  });

  it("keeps the branding illustration when the start page carries none", async () => {
    storageMock.getTest.mockResolvedValue({
      ...dbTest,
      designSettingsJson: { templateId: "default", params: { startImageUrl: { url: "/uploads/media/brand.png" } } },
    });
    storageMock.getContentPages.mockResolvedValue([
      { id: "p1", kind: "start", templateKey: "start.image-right", settingsJson: {} },
    ]);
    contentTemplatesMock.mockReturnValue([
      { key: "start.image-right", settings: [{ key: "image", type: "image" }] },
    ]);
    screenTplMock.mockReturnValue({ layout: "<div></div>", css: "", theme: {}, design: { startImageUrl: "/uploads/media/brand.png" } });
    const res = await asAdmin(request(app).get("/api/tests/test1/screen-template/start"));
    expect(res.body.design.startImageUrl).toBe("/uploads/media/brand.png");
  });

  it("a start variant without the illustration property shows none", async () => {
    // The branding param used to paint every start variant, so «Старт: стандартный»
    // looked exactly like «изображение справа» and switching them changed nothing.
    storageMock.getTest.mockResolvedValue({
      ...dbTest,
      designSettingsJson: { templateId: "default", params: { startImageUrl: { url: "/uploads/media/brand.png" } } },
    });
    storageMock.getContentPages.mockResolvedValue([
      { id: "p1", kind: "start", templateKey: "start.standard", settingsJson: {} },
    ]);
    contentTemplatesMock.mockReturnValue([{ key: "start.standard", settings: [] }]);
    screenTplMock.mockReturnValue({ layout: "<div></div>", css: "", theme: {}, design: { startImageUrl: "/uploads/media/brand.png" } });
    const res = await asAdmin(request(app).get("/api/tests/test1/screen-template/start"));
    expect(res.body.design.startImageUrl).toBeUndefined();
  });

  it("500 when reading the template throws", async () => {
    screenTplMock.mockImplementation(() => { throw new Error("fs error"); });
    const res = await asAdmin(request(app).get("/api/tests/test1/screen-template/start"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch screen template");
  });
});

// ─── GET /migration-health — 500 ──────────────────────────────────────────────
describe("GET /api/tests/migration-health — error branch", () => {
  let app: express.Express;
  beforeEach(() => { resetDefaults(); app = makeApp(); });

  it("500 when getMigrationHealth throws", async () => {
    storageMock.getMigrationHealth.mockRejectedValue(new Error("boom"));
    const res = await asAdmin(request(app).get("/api/tests/migration-health"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get migration health");
  });
});

// ─── GET /:id — reconcile + 500 ───────────────────────────────────────────────
describe("GET /api/tests/:id — reconcile and error branches", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("200 and logs when reconcile creates/deletes system rows", async () => {
    serviceMock.reconcileExisting.mockResolvedValue({ deleted: 0, created: 2 });
    const res = await asAdmin(request(app).get("/api/tests/test1"));
    expect(res.status).toBe(200);
    expect(serviceMock.reconcileExisting).toHaveBeenCalledWith("test1");
  });

  it("200 even when reconcile itself throws (best-effort heal)", async () => {
    serviceMock.reconcileExisting.mockRejectedValue(new Error("reconcile boom"));
    const res = await asAdmin(request(app).get("/api/tests/test1"));
    expect(res.status).toBe(200);
  });

  it("500 when loading the full test throws", async () => {
    storageMock.getTestSections.mockRejectedValue(new Error("load boom"));
    const res = await asAdmin(request(app).get("/api/tests/test1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch test");
  });
});

// ─── GET /:id/available-eligibility-plugins ───────────────────────────────────
describe("GET /api/tests/:id/available-eligibility-plugins", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("200 returns a plugins array", async () => {
    const res = await asAdmin(request(app).get("/api/tests/test1/available-eligibility-plugins"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.plugins)).toBe(true);
  });
});

// ─── POST / — sections/topic/flow/error branches ──────────────────────────────
describe("POST /api/tests — error and permission branches", () => {
  let app: express.Express;
  beforeEach(() => { resetDefaults(); app = makeApp(); });

  it("400 when a standard test has no sections", async () => {
    const res = await asAdmin(request(app).post("/api/tests").send({
      title: "No Sections", mode: "standard",
    }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Sections are required for standard tests");
  });

  it("403 topic_forbidden when a referenced topic is invisible to the author", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTopic.mockResolvedValue({ id: "t1", name: "Private", ownerId: "other", visibility: "private" });
    const res = await asAuthor(request(app).post("/api/tests").send({
      title: "T", mode: "standard", sections: [{ topicId: "t1", drawCount: 3 }],
    }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("topic_forbidden");
    expect(res.body.topicId).toBe("t1");
  });

  it("422 flow_policy_invalid when the service rejects the flow policy", async () => {
    serviceMock.create.mockRejectedValue(new FlowPolicyValidationError([
      { field: "flowMode", code: "invalid", message: "bad" } as never,
    ]));
    const res = await asAdmin(request(app).post("/api/tests").send({
      title: "T", mode: "standard", sections: [{ topicId: "t1", drawCount: 3 }],
    }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("flow_policy_invalid");
  });

  it("500 when the create service throws a generic error", async () => {
    serviceMock.create.mockRejectedValue(new Error("insert failed"));
    const res = await asAdmin(request(app).post("/api/tests").send({
      title: "T", mode: "standard", sections: [{ topicId: "t1", drawCount: 3 }],
    }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to create test");
  });
});

// ─── GET /:id/adaptive-settings ───────────────────────────────────────────────
describe("GET /api/tests/:id/adaptive-settings", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("200 returns adaptive settings", async () => {
    const res = await asAdmin(request(app).get("/api/tests/test1/adaptive-settings"));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it("500 when loading adaptive settings throws", async () => {
    storageMock.getAdaptiveTopicSettingsByTest.mockRejectedValue(new Error("boom"));
    const res = await asAdmin(request(app).get("/api/tests/test1/adaptive-settings"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get adaptive settings");
  });
});

// ─── GET /:id/design ──────────────────────────────────────────────────────────
describe("GET /api/tests/:id/design", () => {
  let app: express.Express;
  beforeEach(() => { resetDefaults(); app = makeApp(); });

  it("200 default templateId when design settings are empty", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, designSettingsJson: {} });
    const res = await asAdmin(request(app).get("/api/tests/test1/design"));
    expect(res.status).toBe(200);
    expect(res.body.templateId).toBe("default");
  });

  it("200 returns stored design settings when present", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, designSettingsJson: { templateId: "rtk", params: {} } });
    const res = await asAdmin(request(app).get("/api/tests/test1/design"));
    expect(res.status).toBe(200);
    expect(res.body.templateId).toBe("rtk");
  });
});

// ─── PUT /:id/design ──────────────────────────────────────────────────────────
describe("PUT /api/tests/:id/design", () => {
  let app: express.Express;
  const templateRow = {
    id: "tpl1", version: "1.0.0", templateApiVersion: "1.0", isActive: true,
    manifest: { params: [{ key: "color" }] },
  };
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.updateTest.mockResolvedValue(dbTest);
    dbState.templates = [templateRow];
    app = makeApp();
  });

  it("200 resets to defaults on an empty body", async () => {
    const res = await asAdmin(request(app).put("/api/tests/test1/design").send({}));
    expect(res.status).toBe(200);
    expect(res.body.templateId).toBe("default");
    expect(storageMock.updateTest).toHaveBeenCalledWith("test1", { designSettingsJson: {} });
  });

  it("422 when templateId is missing", async () => {
    const res = await asAdmin(request(app).put("/api/tests/test1/design").send({ params: {} }));
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateId");
  });

  it("422 for an unsupported templateApiVersion", async () => {
    apiVersionMock.mockReturnValue(false);
    const res = await asAdmin(request(app).put("/api/tests/test1/design").send({
      templateId: "tpl1", templateApiVersion: "9.9",
    }));
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateApiVersion");
  });

  it("422 when the template is not found or inactive", async () => {
    dbState.templates = [];
    const res = await asAdmin(request(app).put("/api/tests/test1/design").send({ templateId: "ghost" }));
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateId");
  });

  it("422 for unknown params not declared in the manifest", async () => {
    const res = await asAdmin(request(app).put("/api/tests/test1/design").send({
      templateId: "tpl1", params: { unknownKey: 1 },
    }));
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("params");
    expect(res.body.extraKeys).toContain("unknownKey");
  });

  it("200 persists a valid design settings payload", async () => {
    const res = await asAdmin(request(app).put("/api/tests/test1/design").send({
      templateId: "tpl1", params: { color: "red" },
    }));
    expect(res.status).toBe(200);
    expect(res.body.templateId).toBe("tpl1");
    expect(storageMock.updateTest).toHaveBeenCalled();
  });

  it("500 when persisting design settings throws", async () => {
    storageMock.updateTest.mockRejectedValue(new Error("write boom"));
    const res = await asAdmin(request(app).put("/api/tests/test1/design").send({
      templateId: "tpl1", params: { color: "red" },
    }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update design settings");
  });
});

// ─── PUT /:id — topic/flow/error branches ─────────────────────────────────────
describe("PUT /api/tests/:id — error and permission branches", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("403 topic_forbidden when a newly added topic is invisible to the author", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    // Author owns the test (passes requireTestScope edit) but adds an invisible topic.
    storageMock.getTest.mockResolvedValue({ ...dbTest, ownerId: "author1" });
    storageMock.getTestSections.mockResolvedValue([]); // nothing exempt yet
    storageMock.getTopic.mockResolvedValue({ id: "t9", name: "Private", ownerId: "other", visibility: "private" });
    const res = await asAuthor(request(app).put("/api/tests/test1").send({
      title: "T", mode: "standard", sections: [{ topicId: "t9", drawCount: 2 }],
    }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("topic_forbidden");
    expect(res.body.topicId).toBe("t9");
  });

  it("422 flow_policy_invalid when the save service rejects the flow policy", async () => {
    serviceMock.save.mockRejectedValue(new FlowPolicyValidationError([
      { field: "flowMode", code: "invalid", message: "bad" } as never,
    ]));
    const res = await asAdmin(request(app).put("/api/tests/test1").send({ title: "T" }));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("flow_policy_invalid");
  });

  it("500 when the save service throws a generic error", async () => {
    serviceMock.save.mockRejectedValue(new Error("save boom"));
    const res = await asAdmin(request(app).put("/api/tests/test1").send({ title: "T" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update test");
  });
});

// ─── PATCH /:id/status — infeasible + 500 ─────────────────────────────────────
describe("PATCH /api/tests/:id/status — infeasible and error branches", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("409 publish_infeasible when the draw cannot be satisfied", async () => {
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getQuestionsByTopic.mockResolvedValue([{ id: "q1", topicId: "t1", tags: [], difficulty: 50 }]);
    const res = await asAdmin(request(app).patch("/api/tests/test1/status").send({ status: "published" }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("publish_infeasible");
    expect(storageMock.patchTestStatus).not.toHaveBeenCalled();
  });

  it("500 when patchTestStatus throws", async () => {
    storageMock.patchTestStatus.mockRejectedValue(new Error("patch boom"));
    const res = await asAdmin(request(app).patch("/api/tests/test1/status").send({ status: "archived" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update test status");
  });
});

// ─── POST /:id/republish-force — 500 ──────────────────────────────────────────
describe("POST /api/tests/:id/republish-force — error branch", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "published" });
    app = makeApp();
  });

  it("500 when annulling in-progress attempts throws", async () => {
    storageMock.annulInProgressAttempts.mockRejectedValue(new Error("annul boom"));
    const res = await asAdmin(request(app).post("/api/tests/test1/republish-force"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to force republish");
  });
});

// ─── POST /:id/restore — 500 ──────────────────────────────────────────────────
describe("POST /api/tests/:id/restore — error branch", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue({ ...dbTest, status: "archived" });
    app = makeApp();
  });

  it("500 when patchTestStatus throws", async () => {
    storageMock.patchTestStatus.mockRejectedValue(new Error("restore boom"));
    const res = await asAdmin(request(app).post("/api/tests/test1/restore"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to restore test");
  });
});

// ─── DELETE /:id — 500 ────────────────────────────────────────────────────────
describe("DELETE /api/tests/:id — error branch", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("500 when deleteTest throws", async () => {
    storageMock.deleteTest.mockRejectedValue(new Error("delete boom"));
    const res = await asAdmin(request(app).delete("/api/tests/test1").send({ confirmTitle: "My Test" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete test");
  });
});

// ─── GET /:id/export/scorm ────────────────────────────────────────────────────
describe("GET /api/tests/:id/export/scorm", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    buildExportMock.mockResolvedValue({ test: { id: "test1", title: "My Test", mode: "standard" } });
    generateScormMock.mockResolvedValue(Buffer.from("PKzip-bytes"));
    app = makeApp();
  });

  it("404 when the build reports the test is missing", async () => {
    buildExportMock.mockRejectedValue(new ScormBuildError("Test not found", 404));
    const res = await asAdmin(request(app).get("/api/tests/test1/export/scorm"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Test not found");
  });

  it("422 with field when the design templateApiVersion is unsupported", async () => {
    buildExportMock.mockRejectedValue(new ScormBuildError("bad api", 422, "templateApiVersion"));
    const res = await asAdmin(request(app).get("/api/tests/test1/export/scorm"));
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("bad api");
    expect(res.body.field).toBe("templateApiVersion");
  });

  it("500 when the build throws a generic error", async () => {
    buildExportMock.mockRejectedValue(new Error("bake boom"));
    const res = await asAdmin(request(app).get("/api/tests/test1/export/scorm"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to export SCORM package");
  });

  it("200 streams the zip without telemetry", async () => {
    const res = await asAdmin(request(app).get("/api/tests/test1/export/scorm"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(storageMock.createScormPackage).not.toHaveBeenCalled();
  });

  it("200 creates a scorm_package record when telemetry=true", async () => {
    const res = await asAdmin(request(app).get("/api/tests/test1/export/scorm?telemetry=true"));
    expect(res.status).toBe(200);
    expect(storageMock.createScormPackage).toHaveBeenCalledTimes(1);
    const [payload] = generateScormMock.mock.calls[0] as [{ telemetry: { enabled: boolean } | null }];
    expect(payload.telemetry?.enabled).toBe(true);
  });
});

// ─── GET /:id/question-scoring ────────────────────────────────────────────────
describe("GET /api/tests/:id/question-scoring", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("200 returns the override rows", async () => {
    storageMock.getTestQuestionScoring.mockResolvedValue([{ id: "ov1", testId: "test1", questionId: "q1" }]);
    const res = await asAdmin(request(app).get("/api/tests/test1/question-scoring"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("500 when reading the rows throws", async () => {
    storageMock.getTestQuestionScoring.mockRejectedValue(new Error("boom"));
    const res = await asAdmin(request(app).get("/api/tests/test1/question-scoring"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to fetch question scoring");
  });
});

// ─── PUT/DELETE /:id/question-scoring/:questionId — 500 ───────────────────────
describe("PUT/DELETE /api/tests/:id/question-scoring/:questionId — error branches", () => {
  let app: express.Express;
  const dbQuestion = { id: "q1", topicId: "t1", type: "single", contentHash: "h1" };
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestSections.mockResolvedValue([dbSection]);
    storageMock.getQuestion.mockResolvedValue(dbQuestion);
    app = makeApp();
  });

  it("PUT 500 when the upsert throws", async () => {
    storageMock.upsertTestQuestionScoring.mockRejectedValue(new Error("upsert boom"));
    const res = await asAdmin(request(app).put("/api/tests/test1/question-scoring/q1").send({ points: 5 }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to save question scoring");
  });

  it("DELETE 500 when the delete throws", async () => {
    storageMock.deleteTestQuestionScoring.mockRejectedValue(new Error("delete boom"));
    const res = await asAdmin(request(app).delete("/api/tests/test1/question-scoring/q1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete question scoring");
  });
});

// ─── GET /:id/access ──────────────────────────────────────────────────────────
describe("GET /api/tests/:id/access", () => {
  let app: express.Express;
  beforeEach(() => { resetDefaults(); app = makeApp(); });

  it("404 when the test does not exist", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAdmin(request(app).get("/api/tests/ghost/access"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Test not found");
  });

  it("403 when a non-owner author asks for access", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTest.mockResolvedValue({ ...dbTest, ownerId: "someone-else" });
    const res = await asAuthor(request(app).get("/api/tests/test1/access"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("200 returns owner and grants for an admin", async () => {
    storageMock.getTest.mockResolvedValue({ ...dbTest, ownerId: "author1" });
    storageMock.getTestAccessGrants.mockResolvedValue([{ userId: "u2", accessLevel: "edit" }]);
    const res = await asAdmin(request(app).get("/api/tests/test1/access"));
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe("author1");
    expect(res.body.grants).toHaveLength(1);
  });

  it("500 when loading grants throws", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAccessGrants.mockRejectedValue(new Error("boom"));
    const res = await asAdmin(request(app).get("/api/tests/test1/access"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get test access");
  });
});

// ─── POST /:id/access ─────────────────────────────────────────────────────────
describe("POST /api/tests/:id/access", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.upsertTestAccessGrant.mockResolvedValue({ id: "g1", testId: "test1", userId: "u2", accessLevel: "edit" });
    app = makeApp();
  });

  it("404 when the test does not exist", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAdmin(request(app).post("/api/tests/ghost/access").send({ userId: "u2", accessLevel: "edit" }));
    expect(res.status).toBe(404);
  });

  it("403 when a non-owner author grants access", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTest.mockResolvedValue({ ...dbTest, ownerId: "someone-else" });
    const res = await asAuthor(request(app).post("/api/tests/test1/access").send({ userId: "u2", accessLevel: "edit" }));
    expect(res.status).toBe(403);
  });

  it("400 when userId is missing", async () => {
    const res = await asAdmin(request(app).post("/api/tests/test1/access").send({ accessLevel: "edit" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("userId required");
  });

  it("400 when accessLevel is invalid", async () => {
    const res = await asAdmin(request(app).post("/api/tests/test1/access").send({ userId: "u2", accessLevel: "owner" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("accessLevel must be 'edit' or 'assign'");
  });

  it("404 when the grantee user does not exist", async () => {
    storageMock.getUser.mockImplementation(async (id: string) => (id === "admin1" ? adminUser : undefined));
    const res = await asAdmin(request(app).post("/api/tests/test1/access").send({ userId: "ghost", accessLevel: "edit" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("201 grants access to an existing user", async () => {
    const res = await asAdmin(request(app).post("/api/tests/test1/access").send({ userId: "u2", accessLevel: "assign" }));
    expect(res.status).toBe(201);
    expect(storageMock.upsertTestAccessGrant).toHaveBeenCalled();
  });

  it("500 when the upsert throws", async () => {
    storageMock.upsertTestAccessGrant.mockRejectedValue(new Error("boom"));
    const res = await asAdmin(request(app).post("/api/tests/test1/access").send({ userId: "u2", accessLevel: "edit" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to grant test access");
  });
});

// ─── DELETE /:id/access/:userId ───────────────────────────────────────────────
describe("DELETE /api/tests/:id/access/:userId", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.removeTestAccessGrant.mockResolvedValue(true);
    app = makeApp();
  });

  it("404 when the test does not exist", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAdmin(request(app).delete("/api/tests/ghost/access/u2"));
    expect(res.status).toBe(404);
  });

  it("403 when a non-owner author revokes access", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    storageMock.getTest.mockResolvedValue({ ...dbTest, ownerId: "someone-else" });
    const res = await asAuthor(request(app).delete("/api/tests/test1/access/u2"));
    expect(res.status).toBe(403);
  });

  it("404 when the grant is absent", async () => {
    storageMock.removeTestAccessGrant.mockResolvedValue(false);
    const res = await asAdmin(request(app).delete("/api/tests/test1/access/u2"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Grant not found");
  });

  it("204 on a successful revoke", async () => {
    const res = await asAdmin(request(app).delete("/api/tests/test1/access/u2"));
    expect(res.status).toBe(204);
    expect(storageMock.removeTestAccessGrant).toHaveBeenCalledWith("test1", "u2");
  });

  it("500 when the revoke throws", async () => {
    storageMock.removeTestAccessGrant.mockRejectedValue(new Error("boom"));
    const res = await asAdmin(request(app).delete("/api/tests/test1/access/u2"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to revoke test access");
  });
});

// ─── PATCH /:id/owner ─────────────────────────────────────────────────────────
describe("PATCH /api/tests/:id/owner", () => {
  let app: express.Express;
  beforeEach(() => {
    resetDefaults();
    storageMock.getTest.mockResolvedValue(dbTest);
    app = makeApp();
  });

  it("403 when the actor lacks tests.owner.change (author)", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    const res = await asAuthor(request(app).patch("/api/tests/test1/owner").send({ ownerId: "u2" }));
    expect(res.status).toBe(403);
  });

  it("404 when the test does not exist", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAdmin(request(app).patch("/api/tests/ghost/owner").send({ ownerId: "u2" }));
    expect(res.status).toBe(404);
  });

  it("400 when ownerId is neither a string nor null", async () => {
    const res = await asAdmin(request(app).patch("/api/tests/test1/owner").send({ ownerId: 42 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("ownerId must be a string or null");
  });

  it("404 when the new owner user does not exist", async () => {
    storageMock.getUser.mockImplementation(async (id: string) => (id === "admin1" ? adminUser : undefined));
    const res = await asAdmin(request(app).patch("/api/tests/test1/owner").send({ ownerId: "ghost" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Owner user not found");
  });

  it("200 clears the owner when ownerId is null", async () => {
    const res = await asAdmin(request(app).patch("/api/tests/test1/owner").send({ ownerId: null }));
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBeNull();
    expect(storageMock.setTestOwner).toHaveBeenCalledWith("test1", null);
  });

  it("200 assigns a new existing owner", async () => {
    const res = await asAdmin(request(app).patch("/api/tests/test1/owner").send({ ownerId: "u2" }));
    expect(res.status).toBe(200);
    expect(res.body.ownerId).toBe("u2");
  });

  it("500 when setting the owner throws", async () => {
    storageMock.setTestOwner.mockRejectedValue(new Error("boom"));
    const res = await asAdmin(request(app).patch("/api/tests/test1/owner").send({ ownerId: null }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to change test owner");
  });
});
