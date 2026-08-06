/**
 * @module tests/routes.logs
 * @description Integration tests for the recent-events router (GET /api/logs).
 * Covers the `logs.read` permission gate (401 unauthenticated / 403 for a role
 * that lacks the capability) and the query-param -> LogFilter mapping the handler
 * passes to getRecentLogs (defaults, explicit level/search/limit, non-numeric
 * limit). Storage drives the real requirePermission middleware (config is
 * initialized globally in tests/setup-config.ts); getRecentLogs is mocked so the
 * filter and the returned payload are asserted deterministically.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, getRecentLogsMock, loggerMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
  },
  getRecentLogsMock: vi.fn(),
  loggerMock: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({
  getRecentLogs: getRecentLogsMock,
  logger: loggerMock,
}));

import logsRouter from "../server/routes/logs";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const adminUser = { id: "u1", emailHash: "h1", status: "active" };

const sampleResult = {
  total: 2,
  shown: 2,
  entries: [
    { ts: "2026-07-04 10:00:00", level: "info", source: "app", message: "hello" },
    { ts: "2026-07-04 10:00:01", level: "error", source: "db", message: "boom" },
  ],
};

// ─── App factory ──────────────────────────────────────────────────────────────
function makeApp(authenticated = true, userId = "u1") {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (authenticated) req.session.userId = userId;
    next();
  });
  app.use("/api/logs", logsRouter);
  return app;
}

// ─── GET /api/logs ──────────────────────────────────────────────────────────────
describe("GET /api/logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(adminUser);
    storageMock.getUserRoles.mockResolvedValue(["administrator"]);
    getRecentLogsMock.mockReturnValue(sampleResult);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(false)).get("/api/logs");
    expect(res.status).toBe(401);
    expect(getRecentLogsMock).not.toHaveBeenCalled();
  });

  it("returns 403 when the role lacks logs.read", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);
    const res = await request(makeApp()).get("/api/logs");
    expect(res.status).toBe(403);
    expect(getRecentLogsMock).not.toHaveBeenCalled();
  });

  it("returns recent logs for an administrator with the default filter", async () => {
    const res = await request(makeApp()).get("/api/logs");
    expect(res.status).toBe(200);
    expect(res.body).toEqual(sampleResult);
    expect(getRecentLogsMock).toHaveBeenCalledWith({
      level: "all",
      search: undefined,
      limit: undefined,
    });
  });

  it("maps level/search/limit query params into the filter", async () => {
    const res = await request(makeApp()).get("/api/logs?level=error&search=db&limit=50");
    expect(res.status).toBe(200);
    expect(getRecentLogsMock).toHaveBeenCalledWith({
      level: "error",
      search: "db",
      limit: 50,
    });
  });

  it("ignores a non-numeric limit (falls back to undefined)", async () => {
    const res = await request(makeApp()).get("/api/logs?limit=abc");
    expect(res.status).toBe(200);
    expect(getRecentLogsMock).toHaveBeenCalledWith({
      level: "all",
      search: undefined,
      limit: undefined,
    });
  });
});

// ─── POST /api/logs/client ─────────────────────────────────────────────────────
// The write side exists so a failure only the BROWSER can see (a learner screen
// that renders nothing) still reaches «Логи». Any signed-in user may report —
// learners hold no `logs.*` capability and are exactly who hits those screens —
// so the guard is authentication plus a bounded, flattened, rate-limited payload.
describe("POST /api/logs/client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(adminUser);
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
  });

  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp(false)).post("/api/logs/client").send({ message: "boom" });
    expect(res.status).toBe(401);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  it("records a learner's report as an error entry attributed to the user", async () => {
    const res = await request(makeApp(true, "learner-1"))
      .post("/api/logs/client")
      .send({ scope: "take-test", message: "screen-template/start failed: HTTP 404" });
    expect(res.status).toBe(204);
    expect(loggerMock.error).toHaveBeenCalledWith(
      "[client:take-test] screen-template/start failed: HTTP 404 (user=learner-1)",
      "client",
    );
  });

  it("rejects a report with no message", async () => {
    const res = await request(makeApp(true, "learner-2")).post("/api/logs/client").send({ scope: "take-test" });
    expect(res.status).toBe(400);
    expect(loggerMock.error).not.toHaveBeenCalled();
  });

  // A line break in a report would otherwise forge extra entries downstream.
  it("flattens line breaks and truncates an oversized message", async () => {
    const res = await request(makeApp(true, "learner-3"))
      .post("/api/logs/client")
      .send({ scope: "a\nb", message: "x\ny" + "z".repeat(600) });
    expect(res.status).toBe(204);
    const [line] = loggerMock.error.mock.calls[0];
    expect(line).not.toContain("\n");
    expect(line).toContain("[client:a b]");
    // 500 chars of message + the fixed prefix/suffix around it.
    expect(line.length).toBeLessThan(560);
  });

  // The ring buffer is shared and finite: one browser must not be able to evict
  // every real event from it.
  it("stops accepting reports from one user past the per-minute budget", async () => {
    const app = makeApp(true, "flooder");
    for (let i = 0; i < 20; i += 1) {
      const ok = await request(app).post("/api/logs/client").send({ message: `r${i}` });
      expect(ok.status).toBe(204);
    }
    const blocked = await request(app).post("/api/logs/client").send({ message: "one too many" });
    expect(blocked.status).toBe(429);
    expect(loggerMock.error).toHaveBeenCalledTimes(20);
  });
});
