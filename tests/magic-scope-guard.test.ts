/**
 * @module tests/magic-scope-guard
 * @description Tests for the magic-link scope guard: an unrestricted session passes
 * through untouched, a restricted one reaches only the allow-listed API paths, and
 * object binding rejects another test's id or an attempt that belongs elsewhere.
 * Non-API paths are outside the guard's remit entirely.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";

const { storageMock } = vi.hoisted(() => ({
  storageMock: { getAttempt: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));

import { magicScopeGuard } from "../server/middleware/magic-scope";

/** Mini app: a fake session is injected, then the guard, then a catch-all echo. */
function makeApp(magic: { assignmentId: string; testId: string } | null, userId = "u1") {
  const app = express();
  app.use((req, _res, next) => {
    (req as unknown as { session: Record<string, unknown> }).session = magic
      ? { userId, magic }
      : { userId };
    next();
  });
  app.use(magicScopeGuard);
  app.use((req, res) => res.json({ reached: req.path }));
  return app;
}

describe("magicScopeGuard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lets a normal session through", async () => {
    const res = await request(makeApp(null)).get("/api/home");
    expect(res.status).toBe(200);
  });

  it("ignores everything outside /api", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/uploads/media/x.png");
    expect(res.status).toBe(200);
  });

  it("denies an API path absent from the table", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/learner/attempts");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MAGIC_SCOPE");
  });

  it("allows an unbound API path", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/auth/me");
    expect(res.status).toBe(200);
  });

  it("allows the scope's own test", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/tests/t1/resume");
    expect(res.status).toBe(200);
  });

  it("denies another test's id", async () => {
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/tests/t2/resume");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MAGIC_SCOPE");
  });

  it("allows an attempt of this test owned by this user", async () => {
    storageMock.getAttempt.mockResolvedValue({ id: "at1", userId: "u1", testId: "t1" });
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/at1/result");
    expect(res.status).toBe(200);
  });

  it("denies an attempt of another test", async () => {
    storageMock.getAttempt.mockResolvedValue({ id: "at2", userId: "u1", testId: "t9" });
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/at2/result");
    expect(res.status).toBe(403);
  });

  it("denies an attempt owned by someone else", async () => {
    storageMock.getAttempt.mockResolvedValue({ id: "at3", userId: "other", testId: "t1" });
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/at3/result");
    expect(res.status).toBe(403);
  });

  it("denies a missing attempt", async () => {
    storageMock.getAttempt.mockResolvedValue(undefined);
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/nope/result");
    expect(res.status).toBe(403);
  });

  it("answers 500 when the attempt lookup throws", async () => {
    storageMock.getAttempt.mockRejectedValue(new Error("db down"));
    const res = await request(makeApp({ assignmentId: "a1", testId: "t1" })).get("/api/attempts/at1/result");
    expect(res.status).toBe(500);
  });
});
