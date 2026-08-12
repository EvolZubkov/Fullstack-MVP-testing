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

  it("logs the caller's IP and User-Agent on a successful redemption", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord());
    const res = await request(makeApp())
      .get(`/access/${validToken}`)
      .set("user-agent", "TestClient/1.0");
    expect(res.status).toBe(302);
    expect(loggerMock.info).toHaveBeenCalledTimes(1);
    const [message] = loggerMock.info.mock.calls[0];
    expect(message).toContain("TestClient/1.0");
    expect(message).toMatch(/ip=\S+/);
  });

  it("truncates an over-long User-Agent before logging", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord());
    const longUa = "A".repeat(5000);
    const res = await request(makeApp())
      .get(`/access/${validToken}`)
      .set("user-agent", longUa);
    expect(res.status).toBe(302);
    const [message] = loggerMock.info.mock.calls[0];
    expect(message.length).toBeLessThan(longUa.length);
    expect(message).toContain("A".repeat(200));
    expect(message).not.toContain("A".repeat(201));
  });

  it("logs a warning with the IP when the token is not found", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(undefined);
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(404);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [message] = loggerMock.warn.mock.calls[0];
    expect(message).toMatch(/ip=\S+/);
    expect(message).toContain("not_found");
  });

  it("logs a warning with the IP when a revoked token is presented", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord({ revokedAt: new Date() }));
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(403);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [message] = loggerMock.warn.mock.calls[0];
    expect(message).toMatch(/ip=\S+/);
    expect(message).toContain("revoked");
  });

  it("logs a warning with the IP when an expired token is presented", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(
      makeRecord({ expiresAt: new Date(Date.now() - 1000) }),
    );
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(403);
    expect(loggerMock.warn).toHaveBeenCalledTimes(1);
    const [message] = loggerMock.warn.mock.calls[0];
    expect(message).toMatch(/ip=\S+/);
    expect(message).toContain("expired");
  });

  it("never logs the raw token on any path (success, not-found, revoked, expired, error)", async () => {
    const app = makeApp();

    storageMock.getAssignmentAccessToken.mockResolvedValueOnce(undefined);
    await request(app).get(`/access/${validToken}`);

    storageMock.getAssignmentAccessToken.mockResolvedValueOnce(makeRecord({ revokedAt: new Date() }));
    await request(app).get(`/access/${validToken}`);

    storageMock.getAssignmentAccessToken.mockResolvedValueOnce(
      makeRecord({ expiresAt: new Date(Date.now() - 1000) }),
    );
    await request(app).get(`/access/${validToken}`);

    storageMock.getAssignmentAccessToken.mockResolvedValueOnce(makeRecord());
    await request(app).get(`/access/${validToken}`);

    storageMock.getAssignmentAccessToken.mockRejectedValueOnce(new Error("db down"));
    await request(app).get(`/access/${validToken}`);

    const allCalls = [
      ...loggerMock.info.mock.calls,
      ...loggerMock.warn.mock.calls,
      ...loggerMock.error.mock.calls,
    ];
    expect(allCalls.length).toBeGreaterThan(0);
    for (const call of allCalls) {
      for (const arg of call) {
        if (typeof arg === "string") {
          expect(arg).not.toContain(validToken);
        }
      }
    }
  });

  it("returns 500 when storage throws", async () => {
    storageMock.getAssignmentAccessToken.mockRejectedValue(new Error("db down"));
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.status).toBe(500);
    expect(res.text).toContain("Произошла ошибка");
    expect(loggerMock.error).toHaveBeenCalledTimes(1);
  });

  it("marks the session as scoped to the assignment and the test", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord());
    const app = makeApp();
    // A probe route reports what the magic link put into the session.
    app.get("/probe", (req, res) => res.json({ magic: (req.session as unknown as { magic?: unknown }).magic }));

    const agent = request.agent(app);
    await agent.get(`/access/${validToken}`);
    const probe = await agent.get("/probe");
    expect(probe.body.magic).toEqual({ assignmentId: "asgn1", testId: "test1" });
  });

  it("sends the hygiene headers so the raw token cannot leak", async () => {
    storageMock.getAssignmentAccessToken.mockResolvedValue(makeRecord());
    const res = await request(makeApp()).get(`/access/${validToken}`);
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["cache-control"]).toContain("no-store");
  });
});
