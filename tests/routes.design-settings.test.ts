/**
 * @module tests/routes.design-settings
 * @description Integration tests for GET/PUT /api/tests/:id/design endpoints.
 *
 * Covers:
 * - GET: returns saved settings or default fallback
 * - PUT: successful save, validation errors (missing templateId, inactive template,
 *   unsupported apiVersion, extra params), reset to defaults
 * - Authorization: only author role can PUT
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────

const { storageMock, dbMock } = vi.hoisted(() => {
  const storageMock = {
    getTest: vi.fn(),
    updateTest: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
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
vi.mock("../server/scorm-exporter", () => ({ generateScormPackage: vi.fn() }));
vi.mock("../server/template-registry", () => ({
  isSupportedTemplateApiVersion: (v: string) => v === "1.0",
}));

import testsRouter from "../server/routes/tests";

// ─── App factory ──────────────────────────────────────────────────────────────

function makeApp(role: "author" | "learner" | null = "author") {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (role) req.session.userId = "user-1";
    next();
  });
  app.use("/api/tests", testsRouter);
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const baseTest = {
  id: "test-1",
  title: "Test",
  mode: "standard",
  designSettingsJson: {},
  overallPassRuleJson: { type: "percent", value: 70 },
  published: false,
  version: 1,
};

const authorUser = { id: "user-1", role: "author", status: "active" };
const learnerUser = { id: "user-1", role: "learner", status: "active" };

const corporateTemplate = {
  id: "corporate",
  name: "Корпоративный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  isActive: true,
  manifest: {
    params: [
      { key: "primaryColor", type: "color", label: "Основной цвет", default: "#0066cc" },
      { key: "progress.mode", type: "select", label: "Режим", default: "questions" },
    ],
    contentTemplates: [],
  },
};

// ─── GET /api/tests/:id/design ────────────────────────────────────────────────

describe("GET /api/tests/:id/design", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // PRD-15 FR-09: the GET resolves the user and the object-level read scope
    // (requireUserContext + requireTestScope) instead of the bare session check.
    storageMock.getUser.mockResolvedValue(authorUser);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).get("/api/tests/test-1/design");
    expect(res.status).toBe(401);
  });

  it("returns 404 when test does not exist", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/api/tests/missing/design");
    expect(res.status).toBe(404);
  });

  it("returns default fallback when designSettingsJson is empty", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: {} });
    const res = await request(makeApp()).get("/api/tests/test-1/design");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ templateId: "default" });
  });

  // A row that carries params but no `templateId` (transferred package, out-of-band
  // write) must resolve the same template every delivery path falls back to, or the
  // «Оформление» tab loads no manifest and reports the template declares nothing.
  it("fills in the default templateId when the saved settings carry none", async () => {
    storageMock.getTest.mockResolvedValue({
      ...baseTest,
      designSettingsJson: { params: { scaleRenderKind: "gradient_bar" } },
    });
    const res = await request(makeApp()).get("/api/tests/test-1/design");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      templateId: "default",
      params: { scaleRenderKind: "gradient_bar" },
    });
  });

  it("returns saved design settings", async () => {
    const settings = {
      templateId: "corporate",
      templateVersion: "1.0.0",
      templateApiVersion: "1.0",
      params: { primaryColor: "#ff0000" },
    };
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: settings });
    const res = await request(makeApp()).get("/api/tests/test-1/design");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(settings);
  });
});

// ─── PUT /api/tests/:id/design ────────────────────────────────────────────────

describe("PUT /api/tests/:id/design", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.updateTest.mockResolvedValue({ ...baseTest });

    const chain = dbMock._makeChain([corporateTemplate]);
    dbMock.select.mockReturnValue(chain);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(null)).put("/api/tests/test-1/design").send({});
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is learner", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["learner"]);
    storageMock.getUser.mockResolvedValue(learnerUser);
    const res = await request(makeApp("learner"))
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate" });
    expect(res.status).toBe(403);
  });

  it("returns 404 when test does not exist", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await request(makeApp())
      .put("/api/tests/missing/design")
      .send({ templateId: "corporate" });
    expect(res.status).toBe(404);
  });

  it("saves valid design settings and returns 200", async () => {
    const body = {
      templateId: "corporate",
      templateVersion: "1.0.0",
      templateApiVersion: "1.0",
      params: { primaryColor: "#0066cc", "progress.mode": "questions" },
    };
    const res = await request(makeApp()).put("/api/tests/test-1/design").send(body);
    expect(res.status).toBe(200);
    expect(res.body.templateId).toBe("corporate");
    expect(res.body.params).toEqual(body.params);
    expect(storageMock.updateTest).toHaveBeenCalledOnce();
  });

  it("fills in templateVersion and templateApiVersion from template when omitted", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate", params: {} });
    expect(res.status).toBe(200);
    expect(res.body.templateVersion).toBe("1.0.0");
    expect(res.body.templateApiVersion).toBe("1.0");
  });

  it("resets to defaults on empty body", async () => {
    const res = await request(makeApp()).put("/api/tests/test-1/design").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ templateId: "default" });
    expect(storageMock.updateTest).toHaveBeenCalledWith("test-1", { designSettingsJson: {} });
  });

  it("returns 422 when templateId is missing", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateApiVersion: "1.0", params: {} });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateId");
  });

  it("returns 422 for unsupported templateApiVersion", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate", templateApiVersion: "9.9", params: {} });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateApiVersion");
  });

  it("returns 422 when templateId does not exist (template not found)", async () => {
    const chain = dbMock._makeChain([]); // no template found
    dbMock.select.mockReturnValue(chain);
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "nonexistent", templateApiVersion: "1.0", params: {} });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("templateId");
  });

  it("returns 422 for extra params not in manifest", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({
        templateId: "corporate",
        templateApiVersion: "1.0",
        params: { primaryColor: "#fff", unknownKey: "value" },
      });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("params");
    expect(res.body.extraKeys).toContain("unknownKey");
  });

  it("accepts empty params object", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate", params: {} });
    expect(res.status).toBe(200);
  });
});

// ─── PRD-23: theme choice and per-theme colours ───────────────────────────────

/** Same params as `corporate`, plus a declared pair of palettes. */
const themedTemplate = {
  ...corporateTemplate,
  id: "certification",
  manifest: {
    ...corporateTemplate.manifest,
    themes: [
      { id: "light", label: "Светлая" },
      { id: "dark", label: "Тёмная" },
    ],
  },
};

describe("PUT /api/tests/:id/design — themes (PRD-23)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.updateTest.mockResolvedValue({ ...baseTest });
    dbMock.select.mockReturnValue(dbMock._makeChain([themedTemplate]));
  });

  it("stores the theme choice and the colours of each palette", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({
        templateId: "certification",
        params: { "progress.mode": "questions" },
        theme: "dark",
        paramsByTheme: { light: { primaryColor: "L" }, dark: { primaryColor: "D" } },
      });
    expect(res.status).toBe(200);
    expect(res.body.theme).toBe("dark");
    expect(res.body.paramsByTheme).toEqual({
      light: { primaryColor: "L" },
      dark: { primaryColor: "D" },
    });
  });

  it("defaults the choice to auto when the template has themes and the body has none", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "certification", params: {} });
    expect(res.status).toBe(200);
    expect(res.body.theme).toBe("auto");
  });

  it("refuses an unknown theme instead of dropping it", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "certification", params: {}, theme: "sepia" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("theme");
  });

  it("refuses a palette the template does not declare", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({
        templateId: "certification",
        params: {},
        paramsByTheme: { sepia: { primaryColor: "S" } },
      });
    expect(res.status).toBe(422);
    expect(res.body.unknownThemes).toEqual(["sepia"]);
  });

  it("refuses a non-colour param inside a palette — nothing would ever read it", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({
        templateId: "certification",
        params: {},
        paramsByTheme: { light: { "progress.mode": "pages" } },
      });
    expect(res.status).toBe(422);
    expect(res.body.extraKeys).toEqual(["progress.mode"]);
  });

  it("refuses per-theme colours for a template without themes", async () => {
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({
        templateId: "corporate",
        params: {},
        paramsByTheme: { light: { primaryColor: "L" } },
      });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("paramsByTheme");
  });

  it("refuses a pinned theme for a template without themes — only «Авто» applies", async () => {
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate", params: {}, theme: "dark" });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("theme");
  });

  it("keeps the pre-PRD-23 JSON shape for a template without themes", async () => {
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate", params: { primaryColor: "#fff" } });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("theme");
    expect(res.body).not.toHaveProperty("paramsByTheme");
  });
});

// ─── PRD-49: results labels and sub-block order ───────────────────────────────

describe("PUT /api/tests/:id/design — results labels and block order (PRD-49)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getTest.mockResolvedValue(baseTest);
    storageMock.getUser.mockResolvedValue(authorUser);
    storageMock.updateTest.mockResolvedValue({ ...baseTest });
    dbMock.select.mockReturnValue(dbMock._makeChain([corporateTemplate]));
  });

  it("stores the labels and the sub-block order", async () => {
    const labels = {
      "results.scales": { on: true, text: "Профиль" },
      "results.topics": { on: false },
    };
    const resultsBlockOrder = ["topics", "scales", "indicators", "summary"];
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate", params: {}, labels, resultsBlockOrder });
    expect(res.status).toBe(200);
    expect(res.body.labels).toEqual(labels);
    expect(res.body.resultsBlockOrder).toEqual(resultsBlockOrder);
    expect(storageMock.updateTest).toHaveBeenCalledWith(
      "test-1",
      expect.objectContaining({
        designSettingsJson: expect.objectContaining({ labels, resultsBlockOrder }),
      }),
    );

    // What the route saved is what a subsequent GET would hand back.
    storageMock.getTest.mockResolvedValue({ ...baseTest, designSettingsJson: res.body });
    const getRes = await request(makeApp()).get("/api/tests/test-1/design");
    expect(getRes.body.labels).toEqual(labels);
    expect(getRes.body.resultsBlockOrder).toEqual(resultsBlockOrder);
  });

  it("refuses a label stored as a bare string instead of a record", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({
        templateId: "corporate",
        params: {},
        labels: { "results.scales": "Профиль" },
      });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("labels");
    expect(res.body.badKeys).toEqual(["results.scales"]);
    expect(res.body.error).toContain("results.scales");
    expect(storageMock.updateTest).not.toHaveBeenCalled();
  });

  it("refuses a sub-block key the template does not know", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate", params: {}, resultsBlockOrder: ["legacy"] });
    expect(res.status).toBe(422);
    expect(res.body.field).toBe("resultsBlockOrder");
    expect(res.body.badKeys).toEqual(["legacy"]);
    expect(res.body.error).toContain("legacy");
    expect(storageMock.updateTest).not.toHaveBeenCalled();
  });

  it("keeps the pre-PRD-49 JSON shape when neither field is sent", async () => {
    const res = await request(makeApp())
      .put("/api/tests/test-1/design")
      .send({ templateId: "corporate", params: { primaryColor: "#fff" } });
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty("labels");
    expect(res.body).not.toHaveProperty("resultsBlockOrder");
    const saved = storageMock.updateTest.mock.calls[0][1].designSettingsJson;
    expect(saved).not.toHaveProperty("labels");
    expect(saved).not.toHaveProperty("resultsBlockOrder");
  });
});
