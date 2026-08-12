/**
 * @module tests/routes.template-assets
 * @description PRD-22 FR-37: serving a template's own files to the web host.
 *
 * Author content may point at `images/diagram.png`; inside a SCORM package those
 * files sit next to the page, but on the web there was nowhere to point — static
 * hosting covers only `/uploads` and `/docs`, and built-in templates live outside
 * both. These tests pin the route's contract: it resolves inside the template
 * directory, refuses to escape it, and does not become a second way to fetch the
 * manifest or layouts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import path from "node:path";
import session from "express-session";

const { resolveTemplateDirMock, fsPromisesMock, sendFileCalls } = vi.hoisted(() => ({
  resolveTemplateDirMock: vi.fn(),
  fsPromisesMock: { access: vi.fn(), readFile: vi.fn() },
  sendFileCalls: [] as string[],
}));

vi.mock("../server/services/template-dir", () => ({
  resolveTemplateDir: resolveTemplateDirMock,
}));
vi.mock("node:fs/promises", () => ({ default: fsPromisesMock, ...fsPromisesMock }));
vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/storage", () => ({
  storage: {
    getUser: vi.fn().mockResolvedValue({ id: "u1", role: "author", status: "active" }),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
  },
}));
vi.mock("../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import templatesRouter from "../server/routes/templates";

const TEMPLATE_DIR = path.resolve("/srv/templates/cert");

function makeApp(signedIn = true) {
  const app = express();
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, res: any, next: any) => {
    // Any signed-in user may read template files (learner mid-test, admin in preview).
    if (signedIn) req.session.userId = "u1";
    // `sendFile` needs a real file; the route is what is under test, so it is
    // stubbed to report the resolved path instead.
    res.sendFile = (p: string) => {
      sendFileCalls.push(p);
      res.status(200).end("file");
    };
    next();
  });
  app.use("/api/templates", templatesRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  sendFileCalls.length = 0;
  resolveTemplateDirMock.mockResolvedValue(TEMPLATE_DIR);
  fsPromisesMock.access.mockResolvedValue(undefined);
});

describe("GET /api/templates/:id/assets/*", () => {
  it("serves a file from the template directory", async () => {
    const res = await request(makeApp()).get("/api/templates/cert/assets/images/logo.png");

    expect(res.status).toBe(200);
    expect(sendFileCalls[0]).toBe(path.join(TEMPLATE_DIR, "images", "logo.png"));
    // Draft templates serve their files too: an administrator previews a template
    // BEFORE activating it, and an active-only rule would show that preview with
    // broken images — the very defect this route exists to fix.
    expect(resolveTemplateDirMock).toHaveBeenCalledWith("cert");
  });

  it("serves nested paths", async () => {
    await request(makeApp()).get("/api/templates/cert/assets/styles/fonts/a.woff2");
    expect(sendFileCalls[0]).toBe(path.join(TEMPLATE_DIR, "styles", "fonts", "a.woff2"));
  });

  it("refuses to escape the template directory", async () => {
    // A plain `../` never reaches the route — the client normalises it away. The
    // vector that does arrive is percent-encoded, and it must be rejected.
    const res = await request(makeApp()).get("/api/templates/cert/assets/%2e%2e%2f%2e%2e%2fetc%2fpasswd");

    expect(res.status).toBe(400);
    expect(sendFileCalls).toEqual([]);
  });

  it("does not serve the manifest, layouts or demo data", async () => {
    for (const p of ["manifest.json", "layouts/content.html", "demo/course.json"]) {
      const res = await request(makeApp()).get(`/api/templates/cert/assets/${p}`);
      expect(res.status).toBe(404);
    }
    expect(sendFileCalls).toEqual([]);
  });

  it("returns 404 when the file is absent", async () => {
    fsPromisesMock.access.mockRejectedValue(new Error("ENOENT"));

    const res = await request(makeApp()).get("/api/templates/cert/assets/images/missing.png");

    expect(res.status).toBe(404);
    expect(sendFileCalls).toEqual([]);
  });

  it("returns 404 when the template itself cannot be resolved", async () => {
    resolveTemplateDirMock.mockRejectedValue(new Error("no such template"));

    const res = await request(makeApp()).get("/api/templates/nope/assets/images/logo.png");

    expect(res.status).toBe(404);
  });
});

describe("GET /api/templates/:id/assets/* — access", () => {
  it("requires a signed-in user", async () => {
    const res = await request(makeApp(false)).get("/api/templates/cert/assets/images/logo.png");

    expect(res.status).toBe(401);
    expect(sendFileCalls).toEqual([]);
  });
});
