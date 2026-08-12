/**
 * @module tests/routes.docs
 * @description Tests for the consolidated documentation download endpoint
 * (`GET /api/docs/:doc`) that backs the «Материалы» block on the home page.
 *
 * The contract worth protecting is the PER-DOCUMENT permission: the endpoint is
 * one route, but each guide carries its own capability, so an author reaches the
 * authoring guide and is refused the template specification. Everything else
 * (unknown id, missing artifact) must fail loudly rather than serve a wrong file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

vi.hoisted(() => {
  process.env.DATABASE_URL = "postgresql://fake/test";
});

const { storageMock, docsMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
  },
  // Only the two filesystem-touching functions are faked: whether the built PDF
  // is on disk, and streaming its bytes. The registry and its capabilities stay
  // real, because those are what the tests are about.
  docsMock: { resolveDocPath: vi.fn(), sendDocDownload: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../server/services/doc-downloads", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/services/doc-downloads")>();
  return { ...actual, resolveDocPath: docsMock.resolveDocPath, sendDocDownload: docsMock.sendDocDownload };
});

import docsRouter from "../server/routes/docs";
import { DOC_DOWNLOADS } from "../server/services/doc-downloads";

const user = { id: "user-1", status: "active" };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = "user-1";
    next();
  });
  app.use("/api/docs", docsRouter);
  return app;
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(user);
  storageMock.getUserRoles.mockResolvedValue(["author"]);
  // The artifact is on disk; streaming it is stubbed down to the headers the
  // real sender would set, so the assertions stay about the route's decisions.
  docsMock.resolveDocPath.mockReturnValue("/built/test-authoring-guide.pdf");
  docsMock.sendDocDownload.mockImplementation(async (res: any) => {
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''doc.pdf");
    res.send(Buffer.from("%PDF-1.4 stub"));
  });
});

describe("GET /api/docs/:doc", () => {
  it("serves a document the reader's rights cover", async () => {
    const res = await request(makeApp()).get("/api/docs/test-authoring");

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toContain("attachment");
  });

  it("refuses a document outside the reader's rights", async () => {
    // The author role does not hold adminTemplates.manage.
    const res = await request(makeApp()).get("/api/docs/template-spec");

    expect(res.status).toBe(403);
    expect(docsMock.sendDocDownload).not.toHaveBeenCalled();
  });

  it("lets an administrator through to the same document", async () => {
    storageMock.getUserRoles.mockResolvedValue(["administrator"]);

    const res = await request(makeApp()).get("/api/docs/template-spec");

    expect(res.status).toBe(200);
  });

  it("gives a learner nothing", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);

    const res = await request(makeApp()).get("/api/docs/test-authoring");

    expect(res.status).toBe(403);
  });

  it("answers 404 for an id that is not in the registry", async () => {
    const res = await request(makeApp()).get("/api/docs/no-such-guide");

    expect(res.status).toBe(404);
  });

  it("explains how to rebuild when the artifact is missing", async () => {
    docsMock.resolveDocPath.mockReturnValue(null);

    const res = await request(makeApp()).get("/api/docs/test-authoring");

    expect(res.status).toBe(404);
    expect(res.body.error).toContain("npm run docs:pdf");
  });

  it("requires an authenticated session", async () => {
    const app = express();
    app.use(express.json());
    app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
    app.use("/api/docs", docsRouter);

    const res = await request(app).get("/api/docs/test-authoring");

    expect(res.status).toBe(401);
  });
});

describe("the document registry", () => {
  it("keeps ids unique — the URL segment must address exactly one file", () => {
    const ids = DOC_DOWNLOADS.map((doc) => doc.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it("points every entry at a PDF built by `npm run docs:pdf`", () => {
    expect(DOC_DOWNLOADS.every((doc) => doc.file.endsWith(".pdf"))).toBe(true);
    expect(DOC_DOWNLOADS.every((doc) => doc.filename.endsWith(".pdf"))).toBe(true);
  });

  // The path lookup is exercised against the real filesystem: it is the one
  // piece the route mocks away, and a wrong answer here is exactly the
  // «Документ не собран» users would see.
  it("resolves a built artifact and reports null for an absent one", async () => {
    const actual = await vi.importActual<typeof import("../server/services/doc-downloads")>(
      "../server/services/doc-downloads",
    );

    expect(actual.resolveDocPath("definitely-not-built.pdf")).toBeNull();
    // Every registry entry must be present in the repo — the PDFs are committed
    // so a container ships them without Chrome.
    for (const doc of DOC_DOWNLOADS) {
      expect(actual.resolveDocPath(doc.file), `${doc.file} отсутствует в docs/dist`).not.toBeNull();
    }
  });
});
