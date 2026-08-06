/**
 * @module tests/routes.content-pages
 * @description Integration tests for content pages API:
 * GET/POST/PUT/DELETE /api/tests/:id/content-pages and
 * PUT /api/tests/:id/content-pages/reorder.
 *
 * Covers:
 * - Authorization (401/403)
 * - CRUD lifecycle
 * - topicId membership validation (422)
 * - templateKey validation against current design template (422)
 * - HTML/richText sanitization
 * - Reorder endpoint
 * - templateKeyMissing flag in GET
 * - Template change does not affect stored content pages
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
const learnerUser = { id: "user-1", role: "learner", status: "active" };

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
        pageKind: "intro",
        placeholders: [
          { key: "title", type: "text", label: "Заголовок", required: true },
          { key: "body", type: "richText", label: "Текст", required: false },
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
  templateKey: "intro.hero",
  sortOrder: 0,
  valuesJson: { values: { title: "Hello" } },
  autoAdvance: false,
  autoAdvanceDelayMs: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

// ─── GET /api/tests/:id/content-pages ────────────────────────────────────────

describe("GET /api/tests/:id/content-pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPages.mockResolvedValue([basePage]);
    dbMock.select.mockReturnValue(dbMock._makeChain([]));
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).get("/api/tests/test-1/content-pages");
    expect(res.status).toBe(401);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/api/tests/missing/content-pages");
    expect(res.status).toBe(404);
  });

  it("returns list of pages", async () => {
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].id).toBe("page-1");
  });

  it("adds templateKeyMissing=false when templateKey is valid in current template", async () => {
    const testWithTemplate = { ...baseTest, designSettingsJson: { templateId: "corporate" } };
    storageMock.getTest.mockResolvedValue(testWithTemplate);
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));

    const res = await request(makeApp()).get("/api/tests/test-1/content-pages");
    expect(res.status).toBe(200);
    expect(res.body[0].templateKeyMissing).toBe(false);
  });

  it("adds templateKeyMissing=true when templateKey is absent from current template", async () => {
    const testWithTemplate = { ...baseTest, designSettingsJson: { templateId: "corporate" } };
    storageMock.getTest.mockResolvedValue(testWithTemplate);
    const pageWithUnknownKey = { ...basePage, templateKey: "obsolete.key" };
    storageMock.getContentPages.mockResolvedValue([pageWithUnknownKey]);
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));

    const res = await request(makeApp()).get("/api/tests/test-1/content-pages");
    expect(res.status).toBe(200);
    expect(res.body[0].templateKeyMissing).toBe(true);
  });

  it("templateKeyMissing is false when design uses default template", async () => {
    // designSettingsJson is empty → default template → no manifest lookup
    const res = await request(makeApp()).get("/api/tests/test-1/content-pages");
    expect(res.status).toBe(200);
    expect(res.body[0].templateKeyMissing).toBe(false);
  });
});

// ─── POST /api/tests/:id/content-pages ───────────────────────────────────────

describe("POST /api/tests/:id/content-pages", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getTestSections.mockResolvedValue([section1]);
    storageMock.createContentPage.mockResolvedValue(basePage);
    dbMock.select.mockReturnValue(dbMock._makeChain([]));
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).post("/api/tests/test-1/content-pages").send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is learner", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    storageMock.getUser.mockResolvedValue(learnerUser);
    const res = await request(makeApp("learner"))
      .post("/api/tests/test-1/content-pages")
      .send({ topicId: "topic-1", position: "before_topic", type: "intro" });
    expect(res.status).toBe(403);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp())
      .post("/api/tests/missing/content-pages")
      .send({ topicId: "topic-1", position: "before_topic", type: "intro" });
    expect(res.status).toBe(404);
  });

  it("returns 422 when topicId is missing", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ position: "before_topic", type: "intro" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("topicId");
  });

  it("returns 422 when position is invalid", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ topicId: "topic-1", position: "middle", type: "intro" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("position");
  });

  it("returns 422 when type is invalid", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ topicId: "topic-1", position: "before_topic", type: "quiz" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("type");
  });

  it("returns 422 when topicId does not belong to test", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ topicId: "topic-999", position: "before_topic", type: "intro" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("topicId");
  });

  it("returns 422 when templateKey not found in current design template", async () => {
    const testWithTemplate = { ...baseTest, designSettingsJson: { templateId: "corporate" } };
    storageMock.getTest.mockResolvedValue(testWithTemplate);
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));

    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ topicId: "topic-1", position: "before_topic", type: "intro", mode: "template", templateKey: "unknown.key" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateKey");
  });

  it("creates a page successfully", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ topicId: "topic-1", position: "before_topic", type: "intro" });
    expect(res.status).toBe(201);
    expect(storageMock.createContentPage).toHaveBeenCalledOnce();
  });

  it("creates a test-scope page (position before, no topicId)", async () => {
    storageMock.createContentPage.mockResolvedValue({ ...basePage, topicId: null, position: "before", type: "info", kind: "info" });
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ position: "before", type: "info" });
    expect(res.status).toBe(201);
    expect(storageMock.createContentPage).toHaveBeenCalledOnce();
    const callArgs = storageMock.createContentPage.mock.calls[0][0];
    expect(callArgs.topicId).toBeNull();
    expect(callArgs.position).toBe("before");
    expect(callArgs.kind).toBe("info");
    // Test-scope pages skip topic-membership validation entirely.
    expect(storageMock.getTestSections).not.toHaveBeenCalled();
  });

  it("creates a test-scope page in the after-test zone (position after, no topicId)", async () => {
    storageMock.createContentPage.mockResolvedValue({ ...basePage, topicId: null, position: "after", type: "info", kind: "info" });
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({ position: "after", type: "info" });
    expect(res.status).toBe(201);
    const callArgs = storageMock.createContentPage.mock.calls[0][0];
    expect(callArgs.topicId).toBeNull();
    expect(callArgs.position).toBe("after");
    expect(storageMock.getTestSections).not.toHaveBeenCalled();
  });

  it("sanitizes script tags in richText values", async () => {
    const testWithTemplate = { ...baseTest, designSettingsJson: { templateId: "corporate" } };
    storageMock.getTest.mockResolvedValue(testWithTemplate);
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));

    await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        topicId: "topic-1",
        position: "before_topic",
        type: "intro",
        mode: "template",
        templateKey: "intro.hero",
        valuesJson: {
          values: {
            title: "Hello",
            body: '<p>Text</p><script>alert("xss")</script>',
          },
        },
      });

    const callArgs = storageMock.createContentPage.mock.calls[0][0];
    expect(callArgs.valuesJson.values.body).not.toContain("<script>");
    expect(callArgs.valuesJson.values.body).toContain("<p>Text</p>");
  });

  it("sanitizes on* event handlers in richText values", async () => {
    const testWithTemplate = { ...baseTest, designSettingsJson: { templateId: "corporate" } };
    storageMock.getTest.mockResolvedValue(testWithTemplate);
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));

    await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        topicId: "topic-1",
        position: "before_topic",
        type: "intro",
        mode: "template",
        templateKey: "intro.hero",
        valuesJson: { values: { title: "t", body: '<img src="x" onerror="alert(1)">' } },
      });

    const callArgs = storageMock.createContentPage.mock.calls[0][0];
    expect(callArgs.valuesJson.values.body).not.toContain("onerror");
  });

  // A `<style>` block is not unsafe, so it is kept — but its rules must not
  // escape the page block. In the package the markup lands in the real document,
  // where a pasted `body { … }` rule restyles the whole player.
  it("confines CSS of a template placeholder to its own region", async () => {
    const testWithTemplate = { ...baseTest, designSettingsJson: { templateId: "corporate" } };
    storageMock.getTest.mockResolvedValue(testWithTemplate);
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));

    await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        topicId: "topic-1",
        position: "before_topic",
        type: "intro",
        mode: "template",
        templateKey: "intro.hero",
        valuesJson: { values: { title: "t", body: "<style>body { display: flex; }</style>" } },
      });

    const callArgs = storageMock.createContentPage.mock.calls[0][0];
    expect(callArgs.valuesJson.values.body).toContain('[data-placeholder="body"] { display: flex; }');
  });

  it("confines CSS of an html-mode page to the page container", async () => {
    await request(makeApp())
      .post("/api/tests/test-1/content-pages")
      .send({
        topicId: "topic-1",
        position: "before_topic",
        type: "html",
        mode: "html",
        valuesJson: { values: { __html: "<style>body { display: flex; }</style>" } },
      });

    const callArgs = storageMock.createContentPage.mock.calls[0][0];
    expect(callArgs.valuesJson.values.__html).toContain(".content-page--html { display: flex; }");
  });
});

// ─── PUT /api/tests/:id/content-pages/reorder ────────────────────────────────

describe("PUT /api/tests/:id/content-pages/reorder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.reorderContentPages.mockResolvedValue(undefined);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).put("/api/tests/test-1/content-pages/reorder").send([]);
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is learner", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    storageMock.getUser.mockResolvedValue(learnerUser);
    const res = await request(makeApp("learner"))
      .put("/api/tests/test-1/content-pages/reorder")
      .send([{ id: "page-1", sortOrder: 0 }]);
    expect(res.status).toBe(403);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp())
      .put("/api/tests/missing/content-pages/reorder")
      .send([{ id: "page-1", sortOrder: 0 }]);
    expect(res.status).toBe(404);
  });

  it("reorders successfully", async () => {
    const updates = [{ id: "page-1", sortOrder: 2 }, { id: "page-2", sortOrder: 0 }];
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/reorder")
      .send(updates);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(storageMock.reorderContentPages).toHaveBeenCalledWith(updates);
  });
});

// ─── PUT /api/tests/:id/content-pages/:pageId ────────────────────────────────

describe("PUT /api/tests/:id/content-pages/:pageId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPage.mockResolvedValue(basePage);
    storageMock.getTestSections.mockResolvedValue([section1]);
    storageMock.updateContentPage.mockResolvedValue({ ...basePage, sortOrder: 1 });
    dbMock.select.mockReturnValue(dbMock._makeChain([]));
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).put("/api/tests/test-1/content-pages/page-1").send({});
    expect(res.status).toBe(401);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).put("/api/tests/missing/content-pages/page-1").send({});
    expect(res.status).toBe(404);
  });

  it("returns 404 when page not found", async () => {
    storageMock.getContentPage.mockResolvedValue(undefined);
    const res = await request(makeApp()).put("/api/tests/test-1/content-pages/missing").send({});
    expect(res.status).toBe(404);
  });

  it("returns 404 when page belongs to another test", async () => {
    storageMock.getContentPage.mockResolvedValue({ ...basePage, testId: "other-test" });
    const res = await request(makeApp()).put("/api/tests/test-1/content-pages/page-1").send({});
    expect(res.status).toBe(404);
  });

  it("returns 422 when topicId does not belong to test", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ topicId: "topic-999" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("topicId");
  });

  it("allows topicId=null to move a page to a test-scope zone (cross-zone DnD)", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ position: "before", topicId: null });
    expect(res.status).toBe(200);
    expect(storageMock.updateContentPage).toHaveBeenCalledWith(
      "page-1",
      expect.objectContaining({ topicId: null, position: "before" }),
    );
  });

  it("updates successfully", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/content-pages/page-1")
      .send({ sortOrder: 1 });
    expect(res.status).toBe(200);
    expect(storageMock.updateContentPage).toHaveBeenCalledOnce();
  });
});

// ─── DELETE /api/tests/:id/content-pages/:pageId ─────────────────────────────

describe("DELETE /api/tests/:id/content-pages/:pageId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPage.mockResolvedValue(basePage);
    storageMock.deleteContentPage.mockResolvedValue(true);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).delete("/api/tests/test-1/content-pages/page-1");
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is learner", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    storageMock.getUser.mockResolvedValue(learnerUser);
    const res = await request(makeApp("learner")).delete("/api/tests/test-1/content-pages/page-1");
    expect(res.status).toBe(403);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).delete("/api/tests/missing/content-pages/page-1");
    expect(res.status).toBe(404);
  });

  it("returns 404 when page not found", async () => {
    storageMock.getContentPage.mockResolvedValue(undefined);
    const res = await request(makeApp()).delete("/api/tests/test-1/content-pages/missing");
    expect(res.status).toBe(404);
  });

  it("deletes successfully", async () => {
    const res = await request(makeApp()).delete("/api/tests/test-1/content-pages/page-1");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(storageMock.deleteContentPage).toHaveBeenCalledWith("page-1");
  });
});

// ─── Template change does not affect content pages ───────────────────────────

describe("template change does not affect stored content pages", () => {
  it("GET returns pages unchanged after design template changes, with templateKeyMissing flag", async () => {
    vi.clearAllMocks();

    // Test switched from corporate to minimal; page still has intro.hero key
    const testWithMinimal = { ...baseTest, designSettingsJson: { templateId: "minimal" } };
    storageMock.getTest.mockResolvedValue(testWithMinimal);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPages.mockResolvedValue([{ ...basePage, templateKey: "intro.hero" }]);

    // minimal template has no intro.hero in its contentTemplates
    const minimalTemplate = {
      ...corporateTemplate,
      id: "minimal",
      manifest: {
        params: [],
        contentTemplates: [{ key: "intro.simple", label: "Просто", pageKind: "intro", placeholders: [] }],
      },
    };
    dbMock.select.mockReturnValue(dbMock._makeChain([minimalTemplate]));

    const res = await request(makeApp()).get("/api/tests/test-1/content-pages");
    expect(res.status).toBe(200);
    // Page still returned, just flagged
    expect(res.body).toHaveLength(1);
    expect(res.body[0].templateKey).toBe("intro.hero");
    expect(res.body[0].templateKeyMissing).toBe(true);
  });
});

// ─── POST /api/tests/:id/content-pages/:pageId/replace-variant ───────────────
//
// PRD-7 FR-46 / PRD-1 §4.3.3: switching a content page to another variant
// of the same `kind`. Values for placeholders that exist in both variants
// must survive; placeholders only present in the old variant are dropped.
describe("POST /api/tests/:id/content-pages/:pageId/replace-variant", () => {
  const multiVariantTemplate = {
    id: "default",
    name: "Default",
    version: "1.0.0",
    templateApiVersion: "1.0",
    isActive: true,
    manifest: {
      params: [],
      contentTemplates: [
        {
          key: "intro.hero",
          label: "Hero",
          kind: "intro",
          placeholders: [
            { key: "title", type: "text", label: "Заголовок", required: true },
            { key: "subtitle", type: "text", label: "Подзаголовок", required: false },
            { key: "heroImage", type: "image", label: "Изображение", required: false },
          ],
        },
        {
          key: "intro.simple",
          label: "Simple",
          kind: "intro",
          placeholders: [
            { key: "title", type: "text", label: "Заголовок", required: true },
            { key: "body", type: "richText", label: "Текст", required: false },
          ],
        },
        {
          key: "info.text",
          label: "Info",
          kind: "info",
          placeholders: [{ key: "title", type: "text", label: "Заголовок", required: true }],
        },
      ],
    },
  };

  const introPage = {
    id: "page-1",
    testId: "test-1",
    topicId: null,
    position: "before",
    mode: "template",
    type: "intro",
    kind: "intro",
    templateKey: "intro.hero",
    sortOrder: 0,
    valuesJson: {
      values: { title: "Hello", subtitle: "World", heroImage: "img.png" },
      placeholderStyles: { subtitle: { fontSize: 18 } },
    },
    autoAdvance: false,
    autoAdvanceDelayMs: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: { templateId: "default" } });
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.getContentPage.mockResolvedValue(introPage);
    storageMock.updateContentPage.mockImplementation(async (_id: string, patch: unknown) => ({
      ...introPage,
      ...(patch as object),
    }));
    dbMock.select.mockReturnValue(dbMock._makeChain([multiVariantTemplate]));
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null))
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.simple" });
    expect(res.status).toBe(401);
  });

  it("returns 403 for non-author role", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    storageMock.getUser.mockResolvedValue(learnerUser);
    const res = await request(makeApp("learner"))
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.simple" });
    expect(res.status).toBe(403);
  });

  it("rejects missing newTemplateKey with 422", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({});
    expect(res.status).toBe(422);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp())
      .post("/api/tests/missing/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.simple" });
    expect(res.status).toBe(404);
  });

  it("returns 404 when content page not found", async () => {
    storageMock.getContentPage.mockResolvedValue(undefined);
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/missing/replace-variant")
      .send({ newTemplateKey: "intro.simple" });
    expect(res.status).toBe(404);
  });

  it("returns 404 when newTemplateKey is not in the test's template", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.nonexistent" });
    expect(res.status).toBe(404);
  });

  it("returns 422 on variant kind mismatch (intro → info)", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "info.text" });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/kind mismatch/);
    expect(res.body.currentKind).toBe("intro");
    expect(res.body.newKind).toBe("info");
  });

  it("returns 422 when newTemplateKey equals current templateKey", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.hero" });
    expect(res.status).toBe(422);
  });

  it("happy path: preserves shared placeholder (title), removes others, marks added", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.simple" });

    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    expect(res.body.diff.preserved).toEqual(["title"]);
    expect(res.body.diff.removed.sort()).toEqual(["heroImage", "subtitle"]);
    expect(res.body.diff.added).toEqual(["body"]);

    // updateContentPage must have been called with templateKey + filtered values
    expect(storageMock.updateContentPage).toHaveBeenCalledOnce();
    const patch = (storageMock.updateContentPage.mock.calls[0] as unknown[])[1] as {
      templateKey: string;
      valuesJson: { values: Record<string, unknown>; placeholderStyles?: Record<string, unknown> };
    };
    expect(patch.templateKey).toBe("intro.simple");
    expect(patch.valuesJson.values.title).toBe("Hello");
    expect(patch.valuesJson.values).not.toHaveProperty("subtitle");
    expect(patch.valuesJson.values).not.toHaveProperty("heroImage");
    // Styles for dropped keys also gone
    expect(patch.valuesJson.placeholderStyles).not.toHaveProperty("subtitle");
  });

  // ── Draft template override (?templateId=) — switch template before save ──────
  // The editor sends the in-progress «Оформление» template so the variant change
  // validates against the CHOSEN template, not the saved design.
  it("validates against the DRAFT template via ?templateId= so a switch works before save", async () => {
    // Saved design = default (no intro.334-bizo); the active DRAFT = my-template, which has it.
    const myTemplate = {
      id: "my-template",
      isActive: true,
      manifest: {
        params: [],
        contentTemplates: [
          { key: "intro.e-migr-0", label: "Введение", kind: "intro", placeholders: [{ key: "title", type: "text", label: "T" }] },
          { key: "intro.334-bizo", label: "Введение 2", kind: "intro", placeholders: [{ key: "title", type: "text", label: "T" }] },
        ],
      },
    };
    // First db.select (the override active-template query) resolves to my-template.
    dbMock.select.mockReturnValueOnce(dbMock._makeChain([myTemplate]));
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant?templateId=my-template")
      .send({ newTemplateKey: "intro.334-bizo" });
    expect(res.status).toBe(200);
    expect(res.body.applied).toBe(true);
    const patch = (storageMock.updateContentPage.mock.calls[0] as unknown[])[1] as { templateKey: string };
    expect(patch.templateKey).toBe("intro.334-bizo");
  });

  it("without ?templateId, a variant only in the draft template is rejected (validated against saved)", async () => {
    // Saved default (multiVariantTemplate) lacks intro.334-bizo → 404.
    const res = await request(makeApp())
      .post("/api/tests/test-1/content-pages/page-1/replace-variant")
      .send({ newTemplateKey: "intro.334-bizo" });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found in current template/);
  });
});
