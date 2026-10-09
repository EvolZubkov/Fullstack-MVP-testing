/**
 * @module tests/review-scope-middleware
 *
 * PRD-52 FR-02. The reviewer routes are gated by object scope alone: the holder of
 * a `review` grant on THIS test, or anyone who may already edit it. There is no
 * capability check on purpose — an external expert arrives by a magic link holding
 * `learner`, and a role gate would shut out the very audience the screen exists for.
 * Covers all four branches: no permission context (401), unknown test (404), no
 * scope (403), and the allowed path.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";
import { ROLES } from "@shared/access";

vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock, accessMock } = vi.hoisted(() => ({
  storageMock: { getTest: vi.fn() },
  accessMock: { canReviewTest: vi.fn() },
}));
vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/services/test-access", () => accessMock);

import { requireReviewScope } from "../server/middleware/review-scope";

const TEST = { id: "t1", ownerId: "owner-1" };

/** A request already carrying what `requirePermission` would have attached. */
function mockReq(overrides: Record<string, unknown> = {}): Request {
  return {
    params: { id: "t1" },
    effectiveRoles: [ROLES.LEARNER],
    currentUser: { id: "expert-1" },
    ...overrides,
  } as unknown as Request;
}

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { res.statusCode = code; return res; },
    json(payload: unknown) { res.body = payload; return res; },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue(TEST);
  accessMock.canReviewTest.mockResolvedValue(true);
});

describe("requireReviewScope", () => {
  it("passes through when the review scope allows it", async () => {
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireReviewScope()(mockReq(), res, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(0);
    expect(accessMock.canReviewTest).toHaveBeenCalledWith([ROLES.LEARNER], "expert-1", TEST);
  });

  it("answers 401 when the permission middleware did not run before it", async () => {
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireReviewScope()(mockReq({ effectiveRoles: undefined, currentUser: undefined }), res, next);
    expect(res.statusCode).toBe(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown test", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireReviewScope()(mockReq(), res, next);
    expect(res.statusCode).toBe(404);
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 403 when the user holds no review scope on this test", async () => {
    accessMock.canReviewTest.mockResolvedValue(false);
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireReviewScope()(mockReq(), res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("answers 500 when the lookup itself fails, never falling through", async () => {
    storageMock.getTest.mockRejectedValue(new Error("db down"));
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireReviewScope()(mockReq(), res, next);
    expect(res.statusCode).toBe(500);
    expect(next).not.toHaveBeenCalled();
  });

  it("reads the test id from the named route parameter", async () => {
    const res = mockRes();
    const next = vi.fn() as unknown as NextFunction;
    await requireReviewScope("testId")(mockReq({ params: { testId: "t9" } }), res, next);
    expect(storageMock.getTest).toHaveBeenCalledWith("t9");
    expect(next).toHaveBeenCalledTimes(1);
  });
});
