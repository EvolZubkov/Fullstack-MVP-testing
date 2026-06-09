/**
 * @module tests/routes.templates
 * @description Integration tests for GET /api/templates and GET /api/templates/:id.
 * Also covers syncBuiltinTemplates startup sync and isSupportedTemplateApiVersion validation.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────

const { dbMock, fsMock } = vi.hoisted(() => {
  const chainResult: any[] = [];
  const chain: any = {
    select: vi.fn(),
    from: vi.fn(),
    where: vi.fn(),
    insert: vi.fn(),
    values: vi.fn(),
    onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
    then: (resolve: any) => resolve(chainResult),
  };
  chain.select.mockReturnValue(chain);
  chain.from.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);
  chain.insert.mockReturnValue(chain);
  chain.values.mockReturnValue(chain);

  const dbMock = { ...chain, _chainResult: chainResult };

  const fsMock = {
    existsSync: vi.fn().mockReturnValue(true),
    readFileSync: vi.fn(),
  };

  return { dbMock, fsMock };
});

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("node:fs", () => ({ default: fsMock }));
// templates.ts reads template data from `db`; storage is used only by the
// permission middleware, so a light mock returning an author is enough.
vi.mock("../server/storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "author1", role: "author", status: "active", emailHash: "x" }),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
  },
}));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─── App factory ──────────────────────────────────────────────────────────────

import templatesRouter from "../server/routes/templates";
import { isSupportedTemplateApiVersion, syncBuiltinTemplates } from "../server/template-registry";

function makeApp(userId?: string) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  if (userId) {
    app.use((req: any, _res: any, next: any) => {
      req.session.userId = userId;
      next();
    });
  }
  app.use("/api/templates", templatesRouter);
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const templateDefault = {
  id: "default",
  name: "Стандартный",
  version: "1.0.0",
  templateApiVersion: "1.0",
  description: "Базовый одноколоночный плеер.",
  isBuiltin: true,
  isActive: true,
  manifest: { id: "default", contentTemplates: [{ key: "intro.hero", label: "Введение", placeholders: [] }] },
  previewPath: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};

const templateCorporate = { ...templateDefault, id: "corporate", name: "Корпоративный" };
const templateMinimal   = { ...templateDefault, id: "minimal",   name: "Минималистичный" };

// ─── GET /api/templates ────────────────────────────────────────────────────────

describe("GET /api/templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock._chainResult.splice(0, Infinity, templateDefault, templateCorporate, templateMinimal);
    dbMock.select.mockReturnValue(dbMock);
    dbMock.from.mockReturnValue(dbMock);
    dbMock.where.mockReturnValue(dbMock);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp()).get("/api/templates");
    expect(res.status).toBe(401);
  });

  it("returns list of active templates", async () => {
    const res = await request(makeApp("user-1")).get("/api/templates");
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body.map((t: any) => t.id)).toEqual(["default", "corporate", "minimal"]);
  });

  it("each template has id, name, version, templateApiVersion, manifest", async () => {
    const res = await request(makeApp("user-1")).get("/api/templates");
    for (const t of res.body) {
      expect(t).toHaveProperty("id");
      expect(t).toHaveProperty("name");
      expect(t).toHaveProperty("version");
      expect(t).toHaveProperty("templateApiVersion");
      expect(t).toHaveProperty("manifest");
    }
  });
});

// ─── GET /api/templates/:id ───────────────────────────────────────────────────

describe("GET /api/templates/:id", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.select.mockReturnValue(dbMock);
    dbMock.from.mockReturnValue(dbMock);
    dbMock.where.mockReturnValue(dbMock);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp()).get("/api/templates/default");
    expect(res.status).toBe(401);
  });

  it("returns the template with its manifest", async () => {
    dbMock._chainResult.splice(0, Infinity, templateDefault);
    const res = await request(makeApp("user-1")).get("/api/templates/default");
    expect(res.status).toBe(200);
    expect(res.body.id).toBe("default");
    expect(res.body.manifest).toHaveProperty("contentTemplates");
  });

  it("returns 404 for a non-existent template", async () => {
    dbMock._chainResult.splice(0, Infinity);
    const res = await request(makeApp("user-1")).get("/api/templates/nonexistent");
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty("error");
  });

  it("manifest.contentTemplates contains key, label, placeholders", async () => {
    dbMock._chainResult.splice(0, Infinity, templateDefault);
    const res = await request(makeApp("user-1")).get("/api/templates/default");
    const ct = res.body.manifest.contentTemplates[0];
    expect(ct).toHaveProperty("key");
    expect(ct).toHaveProperty("label");
    expect(ct).toHaveProperty("placeholders");
  });
});

// ─── isSupportedTemplateApiVersion ───────────────────────────────────────────

describe("isSupportedTemplateApiVersion", () => {
  it('accepts "1.0"', () => {
    expect(isSupportedTemplateApiVersion("1.0")).toBe(true);
  });

  it('rejects "2.0"', () => {
    expect(isSupportedTemplateApiVersion("2.0")).toBe(false);
  });

  it("rejects empty string", () => {
    expect(isSupportedTemplateApiVersion("")).toBe(false);
  });

  it("rejects unknown version", () => {
    expect(isSupportedTemplateApiVersion("1.1")).toBe(false);
  });
});

// ─── syncBuiltinTemplates ─────────────────────────────────────────────────────

describe("syncBuiltinTemplates", () => {
  const validManifest = {
    id: "default",
    name: "Стандартный",
    version: "1.0.0",
    templateApiVersion: "1.0",
    description: "Test",
    // Default template must declare all system variant kinds — see
    // defaultTemplateManifestSchema (PRD-7 G48 / 2026-05-28; +start Phase 1).
    contentTemplates: [
      { key: "start.standard", label: "Старт", kind: "start", pageKind: "start", placeholders: [] },
      { key: "results.standard", label: "Итоги теста", kind: "results", pageKind: "results", placeholders: [] },
      { key: "question.standard", label: "Стандартный вопрос", kind: "questions", isDefault: true, placeholders: [] },
      { key: "intro.simple", label: "Введение", kind: "intro", pageKind: "content.intro", placeholders: [] },
      { key: "summary.simple", label: "Итоги", kind: "summary", pageKind: "content.summary", placeholders: [] },
      { key: "router.menu", label: "Меню", kind: "router", pageKind: "content.router", placeholders: [] },
    ],
    params: [],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.insert.mockReturnValue(dbMock);
    dbMock.values.mockReturnValue(dbMock);
    dbMock.onConflictDoUpdate.mockResolvedValue(undefined);
  });

  // PRD-3: only `default` ships on disk; `corporate`/`minimal` dead refs removed.
  it("upserts the single built-in template when its manifest is valid", async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(validManifest));

    await syncBuiltinTemplates();

    expect(dbMock.insert).toHaveBeenCalledTimes(1);
    expect(dbMock.onConflictDoUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips the template when its manifest file is missing", async () => {
    fsMock.existsSync.mockReturnValue(false);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(validManifest));

    await syncBuiltinTemplates();

    expect(dbMock.insert).toHaveBeenCalledTimes(0);
  });

  it("skips the template with an unsupported templateApiVersion", async () => {
    const badManifest = { ...validManifest, templateApiVersion: "9.9" };
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue(JSON.stringify(badManifest));

    await syncBuiltinTemplates();

    expect(dbMock.insert).toHaveBeenCalledTimes(0);
  });

  it("skips the template when its manifest JSON is malformed", async () => {
    fsMock.existsSync.mockReturnValue(true);
    fsMock.readFileSync.mockReturnValue("not-json");

    await syncBuiltinTemplates();

    expect(dbMock.insert).toHaveBeenCalledTimes(0);
  });
});
