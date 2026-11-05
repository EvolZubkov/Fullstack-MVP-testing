/**
 * @module tests/public-link-routes
 * @description Public test link, stage 1: the author API (`server/routes/public-link.ts`)
 * and the anonymous play (`server/routes/public-play.ts`). Verifies the edit gate, the
 * 409 for an unpublished test, token issue/rotation/disable, the host page and package
 * file serving, the no-index headers and the 404 for unknown, disabled or unpublished links.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock, publishedSnapshotOfMock, getPublicPackageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getTest: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTestGrantForUser: vi.fn(),
    getTestPublicLink: vi.fn(),
    getTestPublicLinkByToken: vi.fn(),
    upsertTestPublicLink: vi.fn(),
    deleteTestPublicLink: vi.fn(),
  },
  publishedSnapshotOfMock: vi.fn(),
  getPublicPackageMock: vi.fn(),
}));

vi.mock("../server/db", () => ({ db: {} }));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../server/services/test-snapshot", () => ({ publishedSnapshotOf: publishedSnapshotOfMock }));
vi.mock("../server/scorm/debug-player/public-package-cache", () => ({
  getPublicPackage: getPublicPackageMock,
  LIVE_PACKAGE_TTL_MS: 10 * 60 * 1000,
}));

import publicLinkRouter from "../server/routes/public-link";
import publicPlayRouter from "../server/routes/public-play";

const TOKEN = "a".repeat(64);

function makeApp(authed = true) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (authed) req.session.userId = "user-1";
    next();
  });
  app.use("/p", publicPlayRouter);
  app.use("/api/tests", publicLinkRouter);
  return app;
}

const user = { id: "user-1", emailHash: "h", role: "author", status: "active" };
const baseTest = {
  id: "test-1", title: "Test", mode: "standard", ownerId: "user-1",
  status: "published", updatedAt: new Date("2026-10-12T10:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(user);
  storageMock.getTest.mockResolvedValue(baseTest);
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTestPublicLink.mockResolvedValue(undefined);
  storageMock.upsertTestPublicLink.mockResolvedValue({});
  storageMock.deleteTestPublicLink.mockResolvedValue(undefined);
  publishedSnapshotOfMock.mockResolvedValue({ id: "snap-1" });
});

describe("author API /api/tests/:id/public-link", () => {
  it("reports no link for a published test", async () => {
    const res = await request(makeApp()).get("/api/tests/test-1/public-link");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ url: null, published: true });
  });

  it("refuses to issue a link for a draft with 409", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, status: "draft" });
    const res = await request(makeApp()).post("/api/tests/test-1/public-link");
    expect(res.status).toBe(409);
    expect(storageMock.upsertTestPublicLink).not.toHaveBeenCalled();
  });

  it("issues a link for a test published before snapshots (no snapshot)", async () => {
    publishedSnapshotOfMock.mockResolvedValue(null);
    const res = await request(makeApp()).post("/api/tests/test-1/public-link");
    expect(res.status).toBe(200);
    expect(storageMock.upsertTestPublicLink).toHaveBeenCalled();
  });

  it("issues a link with a 64-hex token for a published test", async () => {
    const res = await request(makeApp()).post("/api/tests/test-1/public-link");
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/p\/[0-9a-f]{64}$/);
    expect(res.body.published).toBe(true);
    expect(storageMock.upsertTestPublicLink).toHaveBeenCalledWith("test-1", expect.stringMatching(/^[0-9a-f]{64}$/), "user-1");
  });

  it("disables the link on DELETE", async () => {
    const res = await request(makeApp()).delete("/api/tests/test-1/public-link");
    expect(res.status).toBe(200);
    expect(res.body.url).toBeNull();
    expect(storageMock.deleteTestPublicLink).toHaveBeenCalledWith("test-1");
  });

  it("returns 403 without tests.edit", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await request(makeApp()).post("/api/tests/test-1/public-link");
    expect(res.status).toBe(403);
    expect(storageMock.upsertTestPublicLink).not.toHaveBeenCalled();
  });
});

describe("anonymous play /p/:token", () => {
  const pkg = {
    files: new Map<string, Buffer>([["index.html", Buffer.from("<html>sco</html>")]]),
    launch: "index.html",
  };

  beforeEach(() => {
    storageMock.getTestPublicLinkByToken.mockResolvedValue({ testId: "test-1", token: TOKEN });
    getPublicPackageMock.mockResolvedValue(pkg);
  });

  it("answers an unknown token with 404 and an HTML page", async () => {
    storageMock.getTestPublicLinkByToken.mockResolvedValue(undefined);
    const res = await request(makeApp(false)).get(`/p/${"b".repeat(64)}`);
    expect(res.status).toBe(404);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("serves the host page without a session, with no-index headers", async () => {
    const res = await request(makeApp(false)).get(`/p/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.text).toContain(`/p/${TOKEN}/shim.js`);
    expect(res.text).toContain(`/p/${TOKEN}/play/index.html`);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["x-robots-tag"]).toContain("noindex");
  });

  it("serves package files and 404s on a missing one", async () => {
    const ok = await request(makeApp(false)).get(`/p/${TOKEN}/play/index.html`);
    expect(ok.status).toBe(200);
    expect(ok.text).toBe("<html>sco</html>");
    const missing = await request(makeApp(false)).get(`/p/${TOKEN}/play/missing.js`);
    expect(missing.status).toBe(404);
  });

  it("answers 404 when the test is no longer published", async () => {
    storageMock.getTest.mockResolvedValue({ ...baseTest, status: "draft" });
    const res = await request(makeApp(false)).get(`/p/${TOKEN}`);
    expect(res.status).toBe(404);
    expect(getPublicPackageMock).not.toHaveBeenCalled();
  });

  it("keys the package by snapshot when one exists, with no TTL", async () => {
    await request(makeApp(false)).get(`/p/${TOKEN}`);
    expect(getPublicPackageMock).toHaveBeenCalledWith("test-1", "snap:snap-1");
  });

  it("serves a published test without a snapshot from live content with a TTL", async () => {
    publishedSnapshotOfMock.mockResolvedValue(null);
    const res = await request(makeApp(false)).get(`/p/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(getPublicPackageMock).toHaveBeenCalledWith(
      "test-1",
      `live:${baseTest.updatedAt.getTime()}`,
      { ttlMs: 10 * 60 * 1000 },
    );
  });

  it("rejects a malformed token without a DB lookup", async () => {
    const res = await request(makeApp(false)).get("/p/not-a-token");
    expect(res.status).toBe(404);
    expect(storageMock.getTestPublicLinkByToken).not.toHaveBeenCalled();
  });
});
