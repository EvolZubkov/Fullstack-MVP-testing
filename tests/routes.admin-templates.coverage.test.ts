/**
 * @module tests/routes.admin-templates.coverage
 * @description Branch-coverage companion to `routes.admin-templates.test.ts`.
 * The sibling suite exercises the happy paths and the headline lifecycle guards;
 * this one drives the remaining error/edge branches of every route in
 * `server/routes/admin-templates.ts`: the 404 «not found» arms, the 409 lifecycle
 * refusals (active/used/default/no-source/built-in), the 400/422 upload gates
 * (missing file, Zip-Slip, unreadable ZIP, failed re-validation), the 200 success
 * arms of get/update/export/validate/preview-image/smoke-bundle, and every
 * route's 500 catch block. DB and the file store are mocked; ZIP parsing and
 * structural validation run for real where it is cheap to do so.
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import JSZip from "jszip";
import os from "node:os";
import nodePath from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { dbMock, storageMock, pkgState } = vi.hoisted(() => {
  const state: { selectResult: any[]; returningResult: any[]; selectQueue: any[] | null } = {
    selectResult: [],
    returningResult: [],
    selectQueue: null,
  };
  const chain: any = { __state: state };
  for (const m of ["select", "from", "where", "insert", "values", "update", "set", "delete", "onConflictDoUpdate"]) {
    chain[m] = vi.fn(() => chain);
  }
  chain.returning = vi.fn(() => Promise.resolve(state.returningResult));
  // Await resolution: a queued sequence (for routes that read twice, e.g. delete
  // = loadTemplate + usageCount) takes precedence, else the flat selectResult.
  chain.then = (resolve: any) => {
    if (Array.isArray(state.selectQueue)) {
      const next = state.selectQueue.length ? state.selectQueue.shift() : [];
      return resolve(next);
    }
    return resolve(state.selectResult);
  };
  chain.transaction = vi.fn(async (cb: any) => cb(chain));
  return {
    dbMock: chain,
    storageMock: { getUser: vi.fn(), getUserRoles: vi.fn().mockResolvedValue(["administrator"]) },
    pkgState: { dirEntries: new Map<string, Buffer>() },
  };
});

vi.mock("../server/db", () => ({ db: dbMock }));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("../server/services/template-package", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/template-package")>();
  return {
    ...actual,
    // Spy over the real reader so per-test overrides (Zip-Slip / unreadable) are
    // possible while every non-overridden call still parses a real ZIP buffer.
    readZipEntries: vi.fn(actual.readZipEntries),
    writeTemplateFiles: vi.fn().mockResolvedValue("/fake/uploads/templates/acme"),
    readDirEntries: vi.fn(async () => pkgState.dirEntries),
    buildTemplateExportZip: vi.fn().mockResolvedValue(Buffer.from("PK-zip-bytes")),
  };
});

import { readZipEntries, readDirEntries, buildTemplateExportZip, ZipSlipError } from "../server/services/template-package";
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
/** Authorized caller — the default `getUserRoles` mock returns `administrator`. */
const asAdmin = (r: request.Test) => r.set("x-test-user", "admin1");

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
/** The same fully-valid package as {@link validZip}, but as an entry map (for the
 *  dir-backed re-validate route whose `readDirEntries` is mocked). */
function validEntries(): Map<string, Buffer> {
  return new Map<string, Buffer>([
    ["manifest.json", Buffer.from(JSON.stringify(validManifest))],
    ["shell.html", Buffer.from('<main data-slot="page"></main>')],
    ["layouts/question.html", Buffer.from('<div data-slot="question-text"></div><div data-slot="question-interaction"></div>')],
    ["layouts/content.html", Buffer.from('<div data-slot="page-content"></div>')],
    ["layouts/results.html", Buffer.from("<div></div>")],
    ["styles/base.css", Buffer.from("body{}")],
    ["preview.svg", Buffer.from("<svg/>")],
    ["demo/course.json", Buffer.from("{}")],
  ]);
}

/** Makes the next DB read throw, to reach a route's 500 catch block. */
function breakNextSelect() {
  dbMock.select.mockImplementationOnce(() => {
    throw new Error("db down");
  });
}

// ─── Real temp package for preview-image streaming ───────────────────────────────
let previewDir = "";
beforeAll(() => {
  previewDir = nodePath.join(os.tmpdir(), `tb-admin-tpl-cov-${process.pid}`);
  mkdirSync(previewDir, { recursive: true });
  writeFileSync(nodePath.join(previewDir, "preview.svg"), "<svg><rect/></svg>");
  writeFileSync(nodePath.join(previewDir, "preview.bin"), Buffer.from([1, 2, 3, 4]));
});
afterAll(() => {
  rmSync(previewDir, { recursive: true, force: true });
});

// ─── Tests ──────────────────────────────────────────────────────────────────────
beforeEach(() => {
  vi.clearAllMocks();
  dbMock.__state.selectResult = [];
  dbMock.__state.returningResult = [];
  dbMock.__state.selectQueue = null;
  pkgState.dirEntries = new Map<string, Buffer>();
  storageMock.getUser.mockResolvedValue({ id: "admin1", role: "administrator" });
});

describe("role gate (requirePermission)", () => {
  it("403 for an author role (no adminTemplates.manage)", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["author"]);
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates"));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
  });

  it("403 for a manager role", async () => {
    storageMock.getUserRoles.mockResolvedValueOnce(["manager"]);
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates"));
    expect(res.status).toBe(403);
  });
});

describe("GET / (list)", () => {
  it("500 when the DB read throws", async () => {
    breakNextSelect();
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to list templates");
  });
});

describe("GET /:id (details)", () => {
  it("200 with usage count for a known template", async () => {
    dbMock.__state.selectResult = [{ id: "acme", status: "draft" }];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme"));
    expect(res.status).toBe(200);
    expect(res.body.template.id).toBe("acme");
    expect(typeof res.body.usageCount).toBe("number");
  });

  it("500 when loadTemplate throws", async () => {
    breakNextSelect();
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get template");
  });
});

describe("POST / (upload) error arms", () => {
  it("422 when the ZIP carries a Zip-Slip path", async () => {
    vi.mocked(readZipEntries).mockRejectedValueOnce(new ZipSlipError("../evil.txt"));
    const res = await asAdmin(
      request(makeApp()).post("/api/admin/templates").attach("file", Buffer.from("x"), "t.zip"),
    );
    expect(res.status).toBe(422);
    expect(res.body.entry).toBe("../evil.txt");
  });

  it("422 when the ZIP is unreadable", async () => {
    vi.mocked(readZipEntries).mockRejectedValueOnce(new Error("corrupt central dir"));
    const res = await asAdmin(
      request(makeApp()).post("/api/admin/templates").attach("file", Buffer.from("x"), "t.zip"),
    );
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Не удалось прочитать ZIP-архив");
  });

  it("500 when a downstream DB read throws", async () => {
    breakNextSelect(); // the existing-ids probe after the ZIP is read
    const buf = await validZip();
    const res = await asAdmin(request(makeApp()).post("/api/admin/templates").attach("file", buf, "t.zip"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to upload template");
  });
});

describe("PUT /:id/activate", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/nope/activate"));
    expect(res.status).toBe(404);
  });

  it("200 for a built-in without validation/smoke gate", async () => {
    dbMock.__state.selectResult = [
      { id: "default", isBuiltin: true, status: "draft", validationJson: null, smokeTestJson: null },
    ];
    dbMock.__state.returningResult = [{ id: "default", status: "active", isActive: true }];
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/default/activate"));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("active");
  });

  it("500 on DB failure", async () => {
    breakNextSelect();
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/acme/activate"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to activate template");
  });
});

describe("PUT /:id/deactivate", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/nope/deactivate"));
    expect(res.status).toBe(404);
  });

  it("409 refuses to deactivate the default template", async () => {
    dbMock.__state.selectResult = [{ id: "default", isBuiltin: false, status: "active" }];
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/default/deactivate"));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("по умолчанию");
  });

  it("500 on DB failure", async () => {
    breakNextSelect();
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/acme/deactivate"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to deactivate template");
  });
});

describe("DELETE /:id", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(request(makeApp()).delete("/api/admin/templates/nope"));
    expect(res.status).toBe(404);
  });

  it("409 when the template is still active", async () => {
    dbMock.__state.selectResult = [
      { id: "acme", isBuiltin: false, sourceType: "uploaded", isActive: true, status: "active" },
    ];
    const res = await asAdmin(request(makeApp()).delete("/api/admin/templates/acme"));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("деактивируйте");
  });

  it("409 when the template is used by tests", async () => {
    // loadTemplate and usageCount both read selectResult -> one row => used = 1.
    dbMock.__state.selectResult = [
      { id: "acme", isBuiltin: false, sourceType: "uploaded", isActive: false, status: "draft" },
    ];
    const res = await asAdmin(request(makeApp()).delete("/api/admin/templates/acme"));
    expect(res.status).toBe(409);
    expect(res.body.usageCount).toBe(1);
  });

  it("200 deletes an unused uploaded template (with a file source)", async () => {
    dbMock.__state.selectQueue = [
      [{ id: "acme", isBuiltin: false, sourceType: "uploaded", isActive: false, status: "draft", sourcePath: "/fake/acme" }],
      [], // usageCount = 0
    ];
    const res = await asAdmin(request(makeApp()).delete("/api/admin/templates/acme"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "acme", deleted: true });
  });

  it("200 deletes an unused uploaded template without a file source", async () => {
    dbMock.__state.selectQueue = [
      [{ id: "acme", isBuiltin: false, sourceType: "uploaded", isActive: false, status: "draft", sourcePath: null }],
      [],
    ];
    const res = await asAdmin(request(makeApp()).delete("/api/admin/templates/acme"));
    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(true);
  });

  it("500 on DB failure", async () => {
    breakNextSelect();
    const res = await asAdmin(request(makeApp()).delete("/api/admin/templates/acme"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete template");
  });
});

describe("PUT /:id/update", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/nope/update"));
    expect(res.status).toBe(404);
  });

  it("409 refuses to update a built-in via upload", async () => {
    dbMock.__state.selectResult = [{ id: "default", isBuiltin: true, sourceType: "builtin" }];
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/default/update"));
    expect(res.status).toBe(409);
    expect(res.body.error).toContain("Встроенный");
  });

  it("400 when no file is attached", async () => {
    dbMock.__state.selectResult = [{ id: "acme", isBuiltin: false, sourceType: "uploaded" }];
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/acme/update"));
    expect(res.status).toBe(400);
  });

  it("422 on a Zip-Slip path", async () => {
    dbMock.__state.selectResult = [{ id: "acme", isBuiltin: false, sourceType: "uploaded" }];
    vi.mocked(readZipEntries).mockRejectedValueOnce(new ZipSlipError("../boom"));
    const res = await asAdmin(
      request(makeApp()).put("/api/admin/templates/acme/update").attach("file", Buffer.from("x"), "t.zip"),
    );
    expect(res.status).toBe(422);
    expect(res.body.entry).toBe("../boom");
  });

  it("422 on an unreadable ZIP", async () => {
    dbMock.__state.selectResult = [{ id: "acme", isBuiltin: false, sourceType: "uploaded" }];
    vi.mocked(readZipEntries).mockRejectedValueOnce(new Error("bad zip"));
    const res = await asAdmin(
      request(makeApp()).put("/api/admin/templates/acme/update").attach("file", Buffer.from("x"), "t.zip"),
    );
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Не удалось прочитать ZIP-архив");
  });

  it("422 flags the template invalid when the new package fails validation", async () => {
    dbMock.__state.selectResult = [{ id: "acme", isBuiltin: false, sourceType: "uploaded" }];
    dbMock.__state.returningResult = [{ id: "acme", status: "invalid", isActive: false }];
    const buf = await noManifestZip();
    const res = await asAdmin(
      request(makeApp()).put("/api/admin/templates/acme/update").attach("file", buf, "t.zip"),
    );
    expect(res.status).toBe(422);
    expect(res.body.error).toBe("Обновление не прошло валидацию");
    expect(res.body.template.status).toBe("invalid");
    expect(res.body.report.ok).toBe(false);
  });

  it("200 replaces files and refreshes on a valid re-upload", async () => {
    dbMock.__state.selectResult = [{ id: "acme", isBuiltin: false, sourceType: "uploaded" }];
    dbMock.__state.returningResult = [{ id: "acme", version: "1.0.0", status: "draft" }];
    const buf = await validZip();
    const res = await asAdmin(
      request(makeApp()).put("/api/admin/templates/acme/update").attach("file", buf, "t.zip"),
    );
    expect(res.status).toBe(200);
    expect(res.body.template.id).toBe("acme");
    expect(res.body.report.ok).toBe(true);
  });

  it("500 on DB failure", async () => {
    breakNextSelect();
    const res = await asAdmin(request(makeApp()).put("/api/admin/templates/acme/update"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update template");
  });
});

describe("GET /:id/export", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/nope/export"));
    expect(res.status).toBe(404);
  });

  it("409 when the template has no file source", async () => {
    dbMock.__state.selectResult = [{ id: "acme", version: "1.0.0", sourcePath: null }];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/export"));
    expect(res.status).toBe(409);
  });

  it("200 streams a zip attachment", async () => {
    dbMock.__state.selectResult = [{ id: "acme", version: "1.0.0", sourcePath: "/fake/acme" }];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/export"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/zip");
    expect(res.headers["content-disposition"]).toContain("acme-1.0.0.zip");
  });

  it("500 when packing fails", async () => {
    dbMock.__state.selectResult = [{ id: "acme", version: "1.0.0", sourcePath: "/fake/acme" }];
    vi.mocked(buildTemplateExportZip).mockRejectedValueOnce(new Error("pack failed"));
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/export"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to export template");
  });
});

describe("POST /:id/validate", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(request(makeApp()).post("/api/admin/templates/nope/validate"));
    expect(res.status).toBe(404);
  });

  it("409 when the template has no file source", async () => {
    dbMock.__state.selectResult = [{ id: "acme", sourcePath: null }];
    const res = await asAdmin(request(makeApp()).post("/api/admin/templates/acme/validate"));
    expect(res.status).toBe(409);
  });

  it("200 keeps the status when re-validation passes", async () => {
    dbMock.__state.selectResult = [{ id: "acme", sourcePath: "/fake/acme", status: "draft", isActive: false }];
    dbMock.__state.returningResult = [{ id: "acme", status: "draft", isActive: false }];
    pkgState.dirEntries = validEntries();
    const res = await asAdmin(request(makeApp()).post("/api/admin/templates/acme/validate"));
    expect(res.status).toBe(200);
    expect(res.body.report.ok).toBe(true);
    expect(res.body.template.status).toBe("draft");
  });

  it("200 flags the template invalid when re-validation fails", async () => {
    dbMock.__state.selectResult = [{ id: "acme", sourcePath: "/fake/acme", status: "active", isActive: true }];
    dbMock.__state.returningResult = [{ id: "acme", status: "invalid", isActive: false }];
    pkgState.dirEntries = new Map<string, Buffer>([["shell.html", Buffer.from("<main></main>")]]);
    const res = await asAdmin(request(makeApp()).post("/api/admin/templates/acme/validate"));
    expect(res.status).toBe(200);
    expect(res.body.report.ok).toBe(false);
    expect(res.body.template.status).toBe("invalid");
  });

  it("500 on DB failure", async () => {
    breakNextSelect();
    const res = await asAdmin(request(makeApp()).post("/api/admin/templates/acme/validate"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to validate template");
  });
});

describe("GET /:id/preview-image", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/nope/preview-image"));
    expect(res.status).toBe(404);
  });

  it("400 rejects a preview path that escapes the root", async () => {
    dbMock.__state.selectResult = [
      { id: "acme", sourcePath: "/fake/acme", manifest: { assets: { preview: "../evil.svg" } } },
    ];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/preview-image"));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Unsafe preview path");
  });

  it("404 when the preview file is missing on disk", async () => {
    dbMock.__state.selectResult = [
      { id: "acme", sourcePath: "/fake/acme", manifest: { assets: { preview: "preview.svg" } } },
    ];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/preview-image"));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("Preview asset not found");
  });

  it("200 streams an SVG with the svg mime type", async () => {
    dbMock.__state.selectResult = [
      { id: "acme", sourcePath: previewDir, manifest: { assets: { preview: "preview.svg" } } },
    ];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/preview-image"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("image/svg+xml");
  });

  it("200 streams an unknown extension as octet-stream", async () => {
    dbMock.__state.selectResult = [
      { id: "acme", sourcePath: previewDir, manifest: { assets: { preview: "preview.bin" } } },
    ];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/preview-image"));
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/octet-stream");
  });

  it("500 on DB failure", async () => {
    breakNextSelect();
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/preview-image"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to read preview image");
  });
});

describe("GET /:id/smoke-bundle", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/nope/smoke-bundle"));
    expect(res.status).toBe(404);
  });

  it("200 with null demo when absent and no template.js", async () => {
    dbMock.__state.selectResult = [
      {
        id: "acme",
        sourcePath: "/fake/acme",
        manifest: {
          layouts: { shell: "shell.html", question: "layouts/question.html" },
          assets: { styles: ["styles/base.css"] }, // no scripts -> templateJs undefined
          preview: {}, // no demoData -> demo stays null
        },
      },
    ];
    pkgState.dirEntries = new Map<string, Buffer>([
      ["layouts/question.html", Buffer.from('<div data-slot="question-text"></div>')],
      ["styles/base.css", Buffer.from("body{color:blue}")],
    ]);
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/smoke-bundle"));
    expect(res.status).toBe(200);
    expect(res.body.demo).toBeNull();
    expect(res.body.templateJs).toBeUndefined();
    expect(res.body.layouts.shell).toBeUndefined();
    expect(res.body.layouts.question).toContain("question-text");
  });

  it("500 when reading the package directory fails", async () => {
    dbMock.__state.selectResult = [{ id: "acme", sourcePath: "/fake/acme", manifest: {} }];
    vi.mocked(readDirEntries).mockRejectedValueOnce(new Error("io error"));
    const res = await asAdmin(request(makeApp()).get("/api/admin/templates/acme/smoke-bundle"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to build smoke bundle");
  });
});

describe("POST /:id/smoke-test", () => {
  it("404 for an unknown template", async () => {
    dbMock.__state.selectResult = [];
    const res = await asAdmin(
      request(makeApp())
        .post("/api/admin/templates/nope/smoke-test")
        .send({ ok: true, routes: [] }),
    );
    expect(res.status).toBe(404);
  });

  it("500 on DB failure", async () => {
    breakNextSelect();
    const res = await asAdmin(
      request(makeApp())
        .post("/api/admin/templates/acme/smoke-test")
        .send({ ok: true, routes: [] }),
    );
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to record smoke test");
  });
});
