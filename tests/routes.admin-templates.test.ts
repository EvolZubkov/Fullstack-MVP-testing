/**
 * @module tests/routes.admin-templates
 * @description Integration tests for the PRD-3 admin template lifecycle API:
 * the author-role gate, upload structural-validation gate (real ZIP + real
 * validator), and the lifecycle guards (activate gate, delete/built-in guard,
 * deactivate cascade). DB and the file store are mocked; ZIP parsing and
 * validation run for real.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import JSZip from "jszip";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { dbMock, storageMock } = vi.hoisted(() => {
  const state: { selectResult: any[]; returningResult: any[] } = { selectResult: [], returningResult: [] };
  const chain: any = { __state: state };
  for (const m of ["select", "from", "where", "insert", "values", "update", "set", "delete", "onConflictDoUpdate"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.returning = vi.fn(() => Promise.resolve(state.returningResult));
  chain.then = (resolve: any) => resolve(state.selectResult);
  chain.transaction = vi.fn(async (cb: any) => cb(chain));
  return { dbMock: chain, storageMock: { getUser: vi.fn() } };
});

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../server/services/template-package", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/template-package")>();
  return { ...actual, writeTemplateFiles: vi.fn().mockResolvedValue("/fake/uploads/templates/acme") };
});

import adminTemplatesRouter from "../server/routes/admin-templates";

// ─── App factory ──────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    const u = req.headers["x-test-user"];
    if (u) req.session.userId = u;
    next();
  });
  app.use("/api/admin/templates", adminTemplatesRouter);
  return app;
}
const asAuthor = (r: request.Test) => r.set("x-test-user", "author1");
const asLearner = (r: request.Test) => r.set("x-test-user", "learner1");

// ─── ZIP fixtures ──────────────────────────────────────────────────────────────
const validManifest = {
  id: "acme",
  name: "ACME",
  version: "1.0.0",
  templateApiVersion: "1.0",
  layouts: { shell: "shell.html", question: "layouts/question.html", content: "layouts/content.html", results: "layouts/results.html" },
  assets: { preview: "preview.svg", styles: ["styles/base.css"], scripts: [] },
  preview: { demoData: "demo/course.json", routes: ["start"] },
  params: [],
  capabilities: { questionTypes: ["single"] },
  contentTemplates: [{ key: "q.std", label: "Стандартный вопрос", kind: "questions", placeholders: [] }],
};
async function validZip(): Promise<Buffer> {
  const z = new JSZip();
  z.file("manifest.json", JSON.stringify(validManifest));
  z.file("shell.html", '<main data-slot="page"></main>');
  z.file("layouts/question.html", '<div data-slot="question-text"></div><div data-slot="question-interaction"></div>');
  z.file("layouts/content.html", '<div data-slot="page-content"></div>');
  z.file("layouts/results.html", "<div></div>");
  z.file("styles/base.css", "body{}");
  z.file("preview.svg", "<svg/>");
  z.file("demo/course.json", "{}");
  return z.generateAsync({ type: "nodebuffer" });
}
async function noManifestZip(): Promise<Buffer> {
  const z = new JSZip();
  z.file("shell.html", "<main></main>");
  return z.generateAsync({ type: "nodebuffer" });
}

// ─── Tests ──────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  dbMock.__state.selectResult = [];
  dbMock.__state.returningResult = [];
  storageMock.getUser.mockResolvedValue({ id: "author1", role: "author" });
});

describe("auth gate", () => {
  it("401 when unauthenticated", async () => {
    const res = await request(makeApp()).get("/api/admin/templates");
    expect(res.status).toBe(401);
  });

  it("403 for a learner", async () => {
    storageMock.getUser.mockResolvedValue({ id: "learner1", role: "learner" });
    const res = await asLearner(request(makeApp()).get("/api/admin/templates"));
    expect(res.status).toBe(403);
  });

  it("200 list for an author", async () => {
    dbMock.__state.selectResult = [{ id: "default", status: "active" }, { id: "acme", status: "draft" }];
    const res = await asAuthor(request(makeApp()).get("/api/admin/templates"));
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => t.id)).toEqual(["default", "acme"]);
  });
});

describe("POST / (upload)", () => {
  it("400 when no file is attached", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/admin/templates"));
    expect(res.status).toBe(400);
  });

  it("422 with report when the ZIP has no manifest.json", async () => {
    const buf = await noManifestZip();
    const res = await asAuthor(request(makeApp()).post("/api/admin/templates").attach("file", buf, "t.zip"));
    expect(res.status).toBe(422);
    expect(res.body.report.blocking.map((i: any) => i.code)).toContain("MANIFEST_MISSING");
  });

  it("201 draft when a valid ZIP is uploaded", async () => {
    dbMock.__state.selectResult = []; // existing ids
    dbMock.__state.returningResult = [{ id: "acme", status: "draft", sourceType: "uploaded" }];
    const buf = await validZip();
    const res = await asAuthor(request(makeApp()).post("/api/admin/templates").attach("file", buf, "t.zip"));
    expect(res.status).toBe(201);
    expect(res.body.template.id).toBe("acme");
    expect(res.body.template.status).toBe("draft");
    expect(res.body.report.ok).toBe(true);
  });
});

describe("lifecycle guards", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAuthor(request(makeApp()).get("/api/admin/templates/nope"));
    expect(res.status).toBe(404);
  });

  it("activate is blocked when structural validation failed", async () => {
    dbMock.__state.selectResult = [
      { id: "acme", isBuiltin: false, status: "draft", validationJson: { ok: false, blocking: [{ code: "FILE_MISSING" }] } },
    ];
    const res = await asAuthor(request(makeApp()).put("/api/admin/templates/acme/activate"));
    expect(res.status).toBe(409);
  });

  it("activate is blocked when validation passed but smoke-test has not", async () => {
    dbMock.__state.selectResult = [
      { id: "acme", isBuiltin: false, status: "draft", validationJson: { ok: true }, smokeTestJson: null },
    ];
    const res = await asAuthor(request(makeApp()).put("/api/admin/templates/acme/activate"));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("работоспособности");
  });

  it("activate succeeds when both validation and smoke-test pass", async () => {
    dbMock.__state.selectResult = [
      { id: "acme", isBuiltin: false, status: "draft", validationJson: { ok: true }, smokeTestJson: { ok: true, routes: [] } },
    ];
    dbMock.__state.returningResult = [{ id: "acme", status: "active", isActive: true }];
    const res = await asAuthor(request(makeApp()).put("/api/admin/templates/acme/activate"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  it("delete is refused for a built-in template", async () => {
    dbMock.__state.selectResult = [{ id: "default", isBuiltin: true, sourceType: "builtin", isActive: true, status: "active" }];
    const res = await asAuthor(request(makeApp()).delete("/api/admin/templates/default"));
    expect(res.status).toBe(409);
  });

  it("deactivate switches dependent tests and returns the count", async () => {
    // loadTemplate + the in-transaction dependents query both read selectResult;
    // a single uploaded, active row drives loadTemplate and counts as 1 dependent.
    dbMock.__state.selectResult = [
      { id: "acme", isBuiltin: false, sourceType: "uploaded", isActive: true, status: "active" },
    ];
    const res = await asAuthor(request(makeApp()).put("/api/admin/templates/acme/deactivate"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("inactive");
    expect(typeof res.body.switchedTests).toBe("number");
    expect(dbMock.transaction).toHaveBeenCalled();
  });

  it("smoke-test intake rejects a malformed report (400)", async () => {
    dbMock.__state.selectResult = [{ id: "acme" }];
    const res = await asAuthor(request(makeApp()).post("/api/admin/templates/acme/smoke-test").send({ nope: true }));
    expect(res.status).toBe(400);
  });

  it("smoke-test intake persists a valid report", async () => {
    dbMock.__state.selectResult = [{ id: "acme" }];
    dbMock.__state.returningResult = [{ id: "acme", smokeTestJson: { ok: true, routes: [] } }];
    const res = await asAuthor(
      request(makeApp())
        .post("/api/admin/templates/acme/smoke-test")
        .send({ ok: true, total: 1, passed: 1, warned: 0, failed: 0, routes: [{ route: "start", status: "pass", errors: [], warnings: [] }] }),
    );
    expect(res.status).toBe(200);
    expect(res.body.report.ok).toBe(true);
  });
});
