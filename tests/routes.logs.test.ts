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
const { storageMock, getRecentLogsMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn(),
  },
  getRecentLogsMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/logger", () => ({
  getRecentLogs: getRecentLogsMock,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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
function makeApp(authenticated = true) {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (authenticated) req.session.userId = "u1";
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
