/**
 * @module tests/routes.access
 * @description Integration tests for the magic-link access router
 * (GET /access/:token). Covers the token-length gate (400), the
 * not-found (404), revoked (403) and expired (403) token states, the
 * successful session-establishing redirect (302), and the storage-error
 * catch (500). Storage and the logger are mocked; the router is exercised
 * end-to-end through supertest so the rendered error pages and the redirect
 * target are asserted directly.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, loggerMock } = vi.hoisted(() => ({
  storageMock: {
    getAssignmentAccessToken: vi.fn(),
  },
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({ logger: loggerMock }));

import accessRouter from "../server/routes/access";

// ─── App factory ──────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use("/access", accessRouter);
  return app;
}

// A token of at least 32 chars passes the length gate; its sha256 hash is what
// storage.getAssignmentAccessToken is (mock-)queried with, so the value is opaque.
const validToken = "a".repeat(40);

/** Build a token record with sensible non-revoked, non-expired defaults. */
function makeRecord(overrides: Partial<{
  id: string; assignmentId: string; userId: string; testId: string;
  tokenHash: string; expiresAt: Date; revokedAt: Date | null; createdAt: Date;
}> = {}) {
  return {
    id: "tok1",
    assignmentId: "asgn1",
    userId: "learner1",
    testId: "test1",
    tokenHash: "hash",
    expiresAt: new Date(Date.now() + 86_400_000),
    revokedAt: null,
    createdAt: new Date(),
    ...overrides,
  };
}

// ─── GET /access/:token ─────────────────────────────────────────────────────────
describe("GET /access/:token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 400 for a token shorter than 32 chars", async () => {
    const res = await request(makeApp()).get("/access/short");
    expect(res.status).toBe(400);
    expect(res.text).toContain("Недействительная ссылка");
    expect(storageMock.getAssignmentAccessToken).not.toHaveBeenCalled();
  });

  it("returns 404 when the token record is not found", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(undefined);
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(404);
    expect(res.text).toContain("Ссылка не найдена");
    expect(storageMock.getAssignmentAccessToken).toHaveBeenCalledTimes(1);
  });

  it("returns 403 when the token was revoked", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord({ revokedAt: new Date() }));
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(403);
    expect(res.text).toContain("отозвана");
  });

  it("returns 403 when the token is expired", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(
      makeRecord({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(403);
    expect(res.text).toContain("истёк");
  });

  it("establishes the session and redirects to the test on success", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord());
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("/learner/test/test1");
    // The session was mutated and saved, so a session cookie is issued.
    expect(res.headers["set-cookie"]).toBeDefined();
    expect(loggerMock.info).toHaveBeenCalledTimes(1);
  });

  it("returns 500 when storage throws", async () => {
    storageMock.getAssignmentAccessToken.mockRejectedValue(new Error("db down"));
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(500);
    expect(res.text).toContain("Произошла ошибка");
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });
});
