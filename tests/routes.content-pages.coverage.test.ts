/**
 * @module tests/routes.content-pages.coverage
 * @description Branch-coverage tests for the content-pages router that
 * complement the happy-path suite in `routes.content-pages.test.ts`. These
 * exercise the error / boundary branches only:
 *
 * - GET/POST/PUT/DELETE catch blocks -> 500
 * - POST `type: "html"` -> `kind: "info"` derivation
 * - POST/PUT `normalizeValuesForTemplate` resultField throws -> 422 (path / renderer)
 * - POST resultField normalization (fontSize style, rendererOptions object/default, continue)
 * - PUT reorder non-array body -> 422
 * - PUT templateKey not found in template -> 422
 * - PUT free-form (non-template) sanitize branch + diagnostics
 * - PUT full-field update (every `if (X !== undefined)` true branch)
 * - replace-variant unresolvable template -> 422
 * - preview-page route (404 variants, success, 500)
 * - getTestContentTemplates draft-override-not-found fallback
 *
 * The mock harness mirrors `routes.content-pages.test.ts` verbatim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────

const { storageMock, dbMock } = vi.hoisted(() => {
  const storageMock = {
    getTest: vi.fn(),
    getTestSections: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getContentPages: vi.fn(),
    getContentPage: vi.fn(),
    createContentPage: vi.fn(),
    updateContentPage: vi.fn(),
    deleteContentPage: vi.fn(),
    reorderContentPages: vi.fn(),
  };

  const makeChain = (result: unknown) => {
    const chain: any = {
      select: vi.fn(),
      from: vi.fn(),
      where: vi.fn(),
      then: (resolve: any) => resolve(result),
    };
    chain.select.mockReturnValue(chain);
    chain.from.mockReturnValue(chain);
    chain.where.mockReturnValue(chain);
    return chain;
  };

  const dbMock = { _makeChain: makeChain, select: vi.fn() };
  return { storageMock, dbMock };
});

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import contentPagesRouter from "../server/routes/content-pages";

// ─── App factory ──────────────────────────────────────────────────────────────

function makeApp(role: "author" | "learner" | null = "author") {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (role) req.session.userId = "user-1";
    next();
  });
  app.use("/api/tests", contentPagesRouter);
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseTest = {
  id: "test-1",
  title: "Test",
  mode: "standard",
  designSettingsJson: {},
};

const authorUser = { id: "user-1", role: "author", status: "active" };

const section1 = { id: "sec-1", testId: "test-1", topicId: "topic-1", questionsCount: 5 };

const corporateTemplate = {
  id: "corporate",
  name: "Корпоративный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  isActive: true,
  manifest: {
    params: [],
    contentTemplates: [
      {
        key: "intro.hero",
        label: "Введение",
        kind: "intro",
        placeholders: [
          { key: "title", type: "text", label: "Заголовок", required: true },
          { key: "body", type: "richText", label: "Текст", required: false },
        ],
      },
    ],
  },
};

// Template exposing a resultField with allowedPaths/allowedRenderers, used to
// drive the 422 throws inside normalizeValuesForTemplate.
const resultStrictTemplate = {
  id: "corporate",
  name: "Итоги",
  version: "1.0.0",
  templateApiVersion: "1.0",
  isActive: true,
  manifest: {
    params: [],
    contentTemplates: [
      {
        key: "summary.result",
        label: "Итоги",
        kind: "summary",
        placeholders: [
          { key: "title", type: "text", label: "Заголовок" },
          {
            key: "rf",
            type: "resultField",
            allowedPaths: ["score.percent"],
            allowedRenderers: ["number"],
            defaultPath: "score.percent",
            defaultRenderer: "number",
          },
        ],
      },
    ],
  },
};

// Template covering all normalizeValuesForTemplate branches at once: textFit
// fontSize, resultField with rendererOptions (object), resultField without
// rendererOptions (default {}), resultField with non-object value (continue).
const resultRichTemplate = {
  id: "corporate",
  name: "Итоги+",
  version: "1.0.0",
  templateApiVersion: "1.0",
  isActive: true,
  manifest: {
    params: [],
    contentTemplates: [
      {
        key: "summary.result",
        label: "Итоги",
        kind: "summary",
        placeholders: [
          { key: "title", type: "text", label: "T", textFit: { allowAuthorFontSize: true } },
          {
            key: "rf1",
            type: "resultField",
            allowedPaths: ["score.percent"],
            allowedRenderers: ["number"],
            defaultPath: "score.percent",
            defaultRenderer: "number",
          },
          { key: "rf2", type: "resultField" },
          { key: "rf3", type: "resultField" },
        ],
      },
    ],
  },
};

const basePage = {
  id: "page-1",
  testId: "test-1",
  topicId: "topic-1",
  position: "before_topic",
  mode: "template",
  type: "intro",
  kind: "intro",
  templateKey: "intro.hero",
  sortOrder: 0,
  valuesJson: { values: { title: "Hello" } },
  autoAdvance: false,
  autoAdvanceDelayMs: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ─── GET /api/tests/:id/content-pages (error + fallback branches) ────────────

describe("GET /api/tests/:id/content-pages (branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPages.mockResolvedValue([basePage]);
    dbMock.select.mockReturnValue(dbMock._makeChain([]));
  });

  it("returns 500 when getContentPages throws", async () => {
    storageMock.getContentPages.mockRejectedValue(new Error("db down"));
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get content pages");
  });

  it("falls back to saved template when the ?templateId draft override is not found", async () => {
    // savedId=default, override=other -> readTemplates(other, active) returns []
    // -> draftTpl undefined -> falls through to saved (also empty) -> null.
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages?templateId=other");
    expect(res.status).toBe(200);
    // validKeys === null (no resolvable template) -> flag stays false.
    expect(res.body[0].templateKeyMissing).toBe(false);
  });
});

// ─── POST /api/tests/:id/content-pages (error + boundary branches) ───────────

describe("POST /api/tests/:id/content-pages (branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTestSections.mockResolvedValue([section1]);
    storageMock.createContentPage.mockImplementation(async (p: any) => ({ ...basePage, ...p }));
    dbMock.select.mockReturnValue(dbMock._makeChain([]));
  });

  it("derives kind='info' for a type='html' page", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ topicId: "topic-1", position: "before_topic", type: "html" });
    expect(res.status).toBe(201);
    const callArgs = storageMock.createContentPage.mock.calls[0][0];
    expect(callArgs.type).toBe("html");
    expect(callArgs.kind).toBe("info");
  });

  it("returns 500 when createContentPage throws", async () => {
    storageMock.createContentPage.mockRejectedValue(new Error("insert failed"));
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ topicId: "topic-1", position: "before_topic", type: "intro" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to create content page");
  });

  it("returns 422 when a resultField path is not allowed", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "corporate" } });
    dbMock.select.mockReturnValue(dbMock._makeChain([resultStrictTemplate]));

    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        position: "before",
        type: "summary",
        mode: "template",
        templateKey: "summary.result",
        valuesJson: { values: { rf: { path: "not.allowed" } } },
      });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("valuesJson.values.rf.path");
  });

  it("returns 422 when a resultField renderer is not allowed", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "corporate" } });
    dbMock.select.mockReturnValue(dbMock._makeChain([resultStrictTemplate]));

    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        position: "before",
        type: "summary",
        mode: "template",
        templateKey: "summary.result",
        valuesJson: { values: { rf: { path: "score.percent", renderer: "evil" } } },
      });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("valuesJson.values.rf.renderer");
  });

  it("normalizes resultField values, fontSize style, and rendererOptions defaults", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "corporate" } });
    dbMock.select.mockReturnValue(dbMock._makeChain([resultRichTemplate]));

    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        position: "before",
        type: "summary",
        mode: "template",
        templateKey: "summary.result",
        valuesJson: {
          values: {
            title: "T",
            rf1: { path: "score.percent", renderer: "number", rendererOptions: { decimals: 2 } },
            rf2: { path: "score.percent" },
            rf3: "not-an-object",
          },
          placeholderStyles: { title: { fontSize: 20 } },
        },
      });
    expect(res.status).toBe(201);
    const callArgs = storageMock.createContentPage.mock.calls[0][0];
    // textFit fontSize preserved
    expect(callArgs.valuesJson.placeholderStyles.title.fontSize).toBe(20);
    // rendererOptions object branch preserved
    expect(callArgs.valuesJson.values.rf1.rendererOptions).toEqual({ decimals: 2 });
    // rendererOptions absent -> defaulted to {}
    expect(callArgs.valuesJson.values.rf2.rendererOptions).toEqual({});
    // non-object resultField value left untouched (continue branch)
    expect(callArgs.valuesJson.values.rf3).toBe("not-an-object");
  });
});

// ─── PUT /api/tests/:id/content-pages/reorder (branches) ─────────────────────

describe("PUT /api/tests/:id/content-pages/reorder (branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.reorderContentPages.mockResolvedValue(undefined);
  });

  it("returns 422 when body is not an array", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/reorder")
      .send({ not: "an-array" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("body");
  });

  it("returns 500 when reorderContentPages throws", async () => {
    storageMock.reorderContentPages.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/reorder")
      .send([{ id: "page-1", sortOrder: 0 }]);
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to reorder content pages");
  });
});

// ─── PUT /api/tests/:id/content-pages/:pageId (branches) ─────────────────────

describe("PUT /api/tests/:id/content-pages/:pageId (branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPage.mockResolvedValue(basePage);
    storageMock.getTestSections.mockResolvedValue([section1]);
    storageMock.updateContentPage.mockImplementation(async (_id: string, patch: any) => ({ ...basePage, ...patch }));
    dbMock.select.mockReturnValue(dbMock._makeChain([]));
  });

  it("returns 422 when templateKey is not found in the current template", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "corporate" } });
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));

    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ mode: "template", templateKey: "ghost.key", valuesJson: { values: { title: "x" } } });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateKey");
  });

  it("returns 422 when a resultField path is not allowed (template branch throw)", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "corporate" } });
    dbMock.select.mockReturnValue(dbMock._makeChain([resultStrictTemplate]));

    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ mode: "template", templateKey: "summary.result", valuesJson: { values: { rf: { path: "nope" } } } });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("valuesJson.values.rf.path");
  });

  it("sanitizes free-form values (non-template mode) and returns diagnostics", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ mode: "standard", valuesJson: { values: { note: "<p>ok</p><script>alert(1)</script>" } } });
    expect(res.status).toBe(200);
    // The sanitizer stripped a <script>, so the per-field diagnostics report it.
    expect(res.body.sanitizeDiagnostics.note).toBeDefined();
    const patch = storageMock.updateContentPage.mock.calls[0][1];
    expect(patch.valuesJson.values.note).not.toContain("<script>");
  });

  it("applies every provided field on update", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "corporate" } });
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));

    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({
        position: "before_topic",
        mode: "template",
        type: "info",
        templateKey: "intro.hero",
        sortOrder: 3,
        autoAdvance: true,
        autoAdvanceDelayMs: 2000,
        valuesJson: { values: { title: "Hi" } },
      });
    expect(res.status).toBe(200);
    const patch = storageMock.updateContentPage.mock.calls[0][1];
    expect(patch.position).toBe("before_topic");
    expect(patch.mode).toBe("template");
    expect(patch.type).toBe("info");
    expect(patch.templateKey).toBe("intro.hero");
    expect(patch.sortOrder).toBe(3);
    expect(patch.autoAdvance).toBe(true);
    expect(patch.autoAdvanceDelayMs).toBe(2000);
    expect(patch.valuesJson).toBeDefined();
    // topicId was not sent -> not part of the patch
    expect(patch).not.toHaveProperty("topicId");
  });

  it("returns 500 when updateContentPage throws", async () => {
    storageMock.updateContentPage.mockRejectedValue(new Error("update failed"));
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ sortOrder: 5 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update content page");
  });
});

// ─── POST replace-variant (branches) ─────────────────────────────────────────

describe("POST /api/tests/:id/content-pages/:pageId/replace-variant (branches)", () => {
  const introPage = { ...basePage, topicId: null, position: "before", kind: "intro", templateKey: "intro.hero" };
  const multiVariantTemplate = {
    id: "default",
    isActive: true,
    manifest: {
      params: [],
      contentTemplates: [
        { key: "intro.hero", kind: "intro", placeholders: [{ key: "title", type: "text" }] },
        { key: "intro.simple", kind: "intro", placeholders: [{ key: "title", type: "text" }] },
      ],
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPage.mockResolvedValue(introPage);
    storageMock.updateContentPage.mockResolvedValue(introPage);
  });

  it("returns 422 when the test has no resolvable template", async () => {
    // designSettingsJson points at a template id the db does not return.
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "ghost" } });
    dbMock.select.mockReturnValue(dbMock._makeChain([]));

    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.simple" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/no resolvable template/);
  });

  it("returns 500 when updateContentPage throws", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "default" } });
    dbMock.select.mockReturnValue(dbMock._makeChain([multiVariantTemplate]));
    storageMock.updateContentPage.mockRejectedValue(new Error("write failed"));

    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.simple" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to replace variant");
  });
});

// ─── DELETE /api/tests/:id/content-pages/:pageId (branches) ──────────────────

describe("DELETE /api/tests/:id/content-pages/:pageId (branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPage.mockResolvedValue(basePage);
  });

  it("returns 500 when deleteContentPage throws", async () => {
    storageMock.deleteContentPage.mockRejectedValue(new Error("delete failed"));
    const res = await request(makeApp()).delete("/api/tests/test-1/content-pages/page-1");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete content page");
  });
});

// ─── GET preview-page (branches) ─────────────────────────────────────────────

describe("GET /api/tests/:id/content-pages/:pageId/preview-page (branches)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPage.mockResolvedValue({ ...basePage, topicId: null });
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).get("/api/tests/test-1/content-pages/page-1/preview-page");
    expect(res.status).toBe(401);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/api/tests/missing/content-pages/page-1/preview-page");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Test not found");
  });

  it("returns 404 when page not found", async () => {
    storageMock.getContentPage.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages/missing/preview-page");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Content page not found");
  });

  it("returns 404 when page belongs to another test", async () => {
    storageMock.getContentPage.mockResolvedValue({ ...basePage, testId: "other-test" });
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages/page-1/preview-page");
    expect(res.status).toBe(404);
    expect(res.text).toContain("Content page not found");
  });

  it("returns 404 for a non-builtin template id", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "custom-zzz" } });
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages/page-1/preview-page");
    expect(res.status).toBe(404);
    expect(res.text).toContain("preview.html not found");
  });

  it("returns 404 for a builtin template whose preview.html is absent", async () => {
    // "corporate" is whitelisted but ships no preview.html -> fs.access fails.
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "corporate" } });
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages/page-1/preview-page");
    expect(res.status).toBe(404);
    expect(res.text).toContain("preview.html not found");
  });

  it("serves the injected preview.html for the default template", async () => {
    // Empty designSettingsJson -> templateId defaults to "default", which has preview.html.
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages/page-1/preview-page");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.text).toContain("prd7-page-preview-override");
  });

  it("returns 500 when getContentPage throws", async () => {
    storageMock.getContentPage.mockRejectedValue(new Error("db down"));
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages/page-1/preview-page");
    expect(res.status).toBe(500);
    expect(res.text).toContain("page-preview failed");
  });
});
