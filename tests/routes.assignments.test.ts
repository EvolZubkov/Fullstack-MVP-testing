/**
 * Tests for assignments routes:
 * - GET  /tests/:id/assignments
 * - POST /tests/:id/assignments
 * - POST /tests/:id/assignments/bulk
 * - DELETE /assignments/:id
 * - PATCH /assignment-tokens/:id/revoke
 * - POST /assignments/:id/resend
 * - GET  /learner/assigned-tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendEmailMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getAssignment: vi.fn(),
    getUserRoles: vi.fn(),
    getTestAssignments: vi.fn(),
    createTestAssignment: vi.fn(),
    deleteTestAssignment: vi.fn(),
    getAssignedTestsForUser: vi.fn(),
    getUser: vi.fn(),
    getGroup: vi.fn(),
    getGroupUsers: vi.fn(),
    // Token methods
    createAssignmentAccessToken: vi.fn(),
    getAssignmentAccessToken: vi.fn(),
    getAssignmentAccessTokensByAssignment: vi.fn(),
    revokeAssignmentAccessToken: vi.fn(),
    revokeAssignmentAccessTokensByAssignment: vi.fn(),
    revokeAssignmentAccessTokensByAssignmentAndUser: vi.fn(),
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({ sendAssignmentEmail: sendEmailMock }));

import assignmentsRouter from "../server/routes/assignments";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "author@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const learnerUser = {
  ...authorUser, id: "learner1", role: "learner",
  email: "learner@test.com", name: "Learner",
};
const learner2 = { ...learnerUser, id: "learner2", email: "learner2@test.com" };
// Privileged recipients (D-3 / PLAN_MAGIC_LINK_SCOPE.md Этап 3): must never
// receive a passwordless assignment link, direct or group.
const adminRecipient = {
  ...authorUser, id: "admin1", role: "administrator",
  email: "admin@test.com", name: "Admin Recipient",
};
const mixedRecipient = {
  ...authorUser, id: "mixed1", role: "author",
  email: "mixed@test.com", name: "Mixed Recipient",
};

/** Effective roles by user id, used by `storage.getUserRoles` in this suite. */
const rolesById: Record<string, string[]> = {
  author1: ["administrator"],
  admin1: ["administrator"],
  mixed1: ["author", "learner"],
};
/** Default: any id not listed above resolves as a pure learner (learner1, learner2, ...). */
function defaultGetUserRoles(id: string): Promise<string[]> {
  return Promise.resolve(rolesById[id] ?? ["learner"]);
}

const dbTest = { id: "test1", title: "Test One", description: "desc" };
const dbAssignment = {
  id: "asgn1", testId: "test1", userId: "learner1", groupId: null,
  dueDate: null, linkExpiresAt: null, assignedBy: "author1", assignedAt: new Date().toISOString(),
};
const dbGroup = { id: "grp1", name: "Group A", userCount: 2 };

const makeToken = (overrides: Partial<{
  id: string; assignmentId: string; userId: string; testId: string;
  tokenHash: string; expiresAt: Date; revokedAt: Date | null; createdAt: Date;
}> = {}) => ({
  id: "tok1",
  assignmentId: "asgn1",
  userId: "learner1",
  testId: "test1",
  tokenHash: "abc123",
  expiresAt: new Date(Date.now() + 86400_000),
  revokedAt: null,
  createdAt: new Date(),
  ...overrides,
});

// ─── App factory ──────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    const uid = req.headers["x-test-user"] as string | undefined;
    if (uid) req.session.userId = uid;
    next();
  });
  app.use("/api", assignmentsRouter);
  return app;
}

function asAuthor(req: request.Test) { return req.set("x-test-user", "author1"); }
function asLearner(req: request.Test) { return req.set("x-test-user", "learner1"); }

// ─── Default mock setup ───────────────────────────────────────────────────────
beforeEach(() => {
  vi.resetAllMocks();

  // Per-id roles: author1 is the acting administrator (requester); every other
  // id defaults to a pure learner unless overridden in `rolesById` above. This
  // matters because `mayReceiveAssignmentLink` resolves roles for the
  // RECIPIENT, not just the requester — a blanket ["administrator"] mock would
  // make every recipient look privileged and silently suppress token creation.
  storageMock.getUserRoles.mockImplementation(defaultGetUserRoles);
  storageMock.getTest.mockResolvedValue(dbTest);
  storageMock.getAssignment.mockResolvedValue(dbAssignment);

  storageMock.getUser.mockImplementation((id: string) => {
    if (id === "author1") return Promise.resolve(authorUser);
    if (id === "learner1") return Promise.resolve(learnerUser);
    if (id === "learner2") return Promise.resolve(learner2);
    if (id === "admin1") return Promise.resolve(adminRecipient);
    if (id === "mixed1") return Promise.resolve(mixedRecipient);
    return Promise.resolve(undefined);
  });

  // Default: no tokens
  storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([]);
  storageMock.createAssignmentAccessToken.mockImplementation((data: any) =>
    Promise.resolve({ id: "new-tok", createdAt: new Date(), revokedAt: null, ...data })
  );
  storageMock.revokeAssignmentAccessTokensByAssignment.mockResolvedValue(undefined);
  storageMock.revokeAssignmentAccessTokensByAssignmentAndUser.mockResolvedValue(undefined);
  storageMock.revokeAssignmentAccessToken.mockResolvedValue(undefined);

  sendEmailMock.mockResolvedValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/tests/:id/assignments", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/tests/test1/assignments");
    expect(res.status).toBe(401);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(404);
  });

  it("returns enriched assignments with user info (passwordHash stripped)", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([dbAssignment]);
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].user.email).toBe("learner@test.com");
    expect(res.body[0].user.passwordHash).toBeUndefined();
    expect(res.body[0].group).toBeNull();
  });

  it("returns enriched assignments with group info", async () => {
    const groupAssignment = { ...dbAssignment, userId: null, groupId: "grp1" };
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([groupAssignment]);
    storageMock.getGroup.mockResolvedValue(dbGroup);
    storageMock.getGroupUsers.mockResolvedValue([]); // enrichment fetches group members
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(200);
    expect(res.body[0].group.name).toBe("Group A");
    expect(res.body[0].user).toBeNull();
  });

  it("returns empty array when no assignments", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it("returns tokenStatus=active when there is a non-expired, non-revoked token", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([dbAssignment]);
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([
      makeToken({ revokedAt: null, expiresAt: new Date(Date.now() + 86400_000) }),
    ]);

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(200);
    expect(res.body[0].tokenStatus).toBe("active");
    expect(res.body[0].tokenId).toBe("tok1");
  });

  it("returns tokenStatus=expired when token is past expiry and not revoked", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([dbAssignment]);
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([
      makeToken({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) }),
    ]);

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.body[0].tokenStatus).toBe("expired");
    expect(res.body[0].tokenId).toBeNull();
  });

  it("returns tokenStatus=revoked when token has revokedAt set", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([dbAssignment]);
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([
      makeToken({ revokedAt: new Date() }),
    ]);

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.body[0].tokenStatus).toBe("revoked");
  });

  it("returns tokenStatus=none when no tokens exist", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([dbAssignment]);
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([]);

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.body[0].tokenStatus).toBe("none");
    expect(res.body[0].tokenId).toBeNull();
  });

  it("active token takes priority even when expired/revoked tokens also exist", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([dbAssignment]);
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([
      makeToken({ id: "tok-old", revokedAt: new Date(), expiresAt: new Date(Date.now() - 1000) }),
      makeToken({ id: "tok-active", revokedAt: null, expiresAt: new Date(Date.now() + 86400_000) }),
    ]);

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.body[0].tokenStatus).toBe("active");
    expect(res.body[0].tokenId).toBe("tok-active");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/tests/:id/assignments", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when neither userId nor groupId provided", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({}));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/userId or groupId/i);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1" }));
    expect(res.status).toBe(404);
  });

  it("returns 404 when user not found", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getUser.mockImplementation((id: string) => {
      if (id === "author1") return Promise.resolve(authorUser);
      return Promise.resolve(undefined);
    });
    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "ghost" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it("returns 404 when group not found", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getGroup.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ groupId: "ghost-group" }));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/group not found/i);
  });

  it("creates assignment for user and returns 201", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockResolvedValue(dbAssignment);

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1" }));
    expect(res.status).toBe(201);
    expect(res.body.id).toBe("asgn1");
    expect(storageMock.createTestAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ testId: "test1", userId: "learner1", groupId: null })
    );
  });

  it("creates assignment for group and returns 201", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getGroup.mockResolvedValue(dbGroup);
    storageMock.getGroupUsers.mockResolvedValue([]);
    const groupAsgn = { ...dbAssignment, userId: null, groupId: "grp1" };
    storageMock.createTestAssignment.mockResolvedValue(groupAsgn);

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ groupId: "grp1" }));
    expect(res.status).toBe(201);
    expect(res.body.groupId).toBe("grp1");
  });

  it("passes dueDate to storage as Date object", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockResolvedValue(dbAssignment);

    await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1", dueDate: "2026-12-31" }));

    const callArg = storageMock.createTestAssignment.mock.calls[0][0];
    expect(callArg.dueDate).toBeInstanceOf(Date);
  });

  it("passes linkExpiresAt to storage when provided", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockResolvedValue(dbAssignment);

    await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1", linkExpiresAt: "2026-06-30" }));

    const callArg = storageMock.createTestAssignment.mock.calls[0][0];
    expect(callArg.linkExpiresAt).toBeInstanceOf(Date);
  });

  it("linkExpiresAt defaults to dueDate when not provided", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockResolvedValue(dbAssignment);

    await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1", dueDate: "2026-08-15" }));

    // notifyUser fires async — token expiresAt should equal dueDate
    await new Promise(r => setTimeout(r, 50));
    if (storageMock.createAssignmentAccessToken.mock.calls.length > 0) {
      const tokenArg = storageMock.createAssignmentAccessToken.mock.calls[0][0];
      const dueDateObj = new Date("2026-08-15");
      expect(tokenArg.expiresAt.toDateString()).toBe(dueDateObj.toDateString());
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/tests/:id/assignments/bulk", () => {
  it("returns 400 when both arrays are empty", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments/bulk")
      .send({ userIds: [], groupIds: [] }));
    expect(res.status).toBe(400);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments/bulk")
      .send({ userIds: ["learner1"] }));
    expect(res.status).toBe(404);
  });

  it("creates assignments for multiple users", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockImplementation((data: any) =>
      Promise.resolve({ id: `asgn-${data.userId}`, ...data })
    );

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments/bulk")
      .send({ userIds: ["learner1", "learner2"] }));
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(storageMock.createTestAssignment).toHaveBeenCalledTimes(2);
  });

  it("creates assignments for multiple groups", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getGroupUsers.mockResolvedValue([]);
    storageMock.createTestAssignment.mockImplementation((data: any) =>
      Promise.resolve({ id: `asgn-${data.groupId}`, ...data })
    );

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments/bulk")
      .send({ groupIds: ["g1", "g2", "g3"] }));
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(3);
  });

  it("creates assignments for mixed users and groups", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getGroupUsers.mockResolvedValue([]);
    storageMock.createTestAssignment.mockImplementation((data: any) =>
      Promise.resolve({ id: "asgn", ...data })
    );

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments/bulk")
      .send({ userIds: ["learner1"], groupIds: ["g1"] }));
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("DELETE /api/assignments/:id", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).delete("/api/assignments/asgn1");
    expect(res.status).toBe(401);
  });

  it("returns 404 when assignment not found", async () => {
    storageMock.deleteTestAssignment.mockResolvedValue(false);
    const res = await asAuthor(request(makeApp()).delete("/api/assignments/asgn1"));
    expect(res.status).toBe(404);
  });

  it("revokes all tokens before deleting", async () => {
    storageMock.deleteTestAssignment.mockResolvedValue(true);
    await asAuthor(request(makeApp()).delete("/api/assignments/asgn1"));
    expect(storageMock.revokeAssignmentAccessTokensByAssignment).toHaveBeenCalledWith("asgn1");
  });

  it("returns success when deleted", async () => {
    storageMock.deleteTestAssignment.mockResolvedValue(true);
    const res = await asAuthor(request(makeApp()).delete("/api/assignments/asgn1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("PATCH /api/assignment-tokens/:id/revoke", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).patch("/api/assignment-tokens/tok1/revoke");
    expect(res.status).toBe(401);
  });

  it("revokes the specified token and returns success", async () => {
    const res = await asAuthor(request(makeApp()).patch("/api/assignment-tokens/tok1/revoke"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.revokeAssignmentAccessToken).toHaveBeenCalledWith("tok1");
  });

  it("returns 500 if storage throws", async () => {
    storageMock.revokeAssignmentAccessToken.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).patch("/api/assignment-tokens/tok1/revoke"));
    expect(res.status).toBe(500);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/assignments/:id/resend", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).post("/api/assignments/asgn1/resend");
    expect(res.status).toBe(401);
  });

  it("returns 404 when assignment has no tokens", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([]);
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no tokens/i);
  });

  it("returns 404 when test not found", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([makeToken()]);
    storageMock.getTest.mockResolvedValue(undefined);

    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/test not found/i);
  });

  it("returns 404 when user not found", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([makeToken()]);
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getUser.mockImplementation((id: string) => {
      if (id === "author1") return Promise.resolve(authorUser);
      return Promise.resolve(undefined); // learner1 not found
    });

    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it("revokes old tokens and creates a new one before resending", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([makeToken()]);
    storageMock.getTest.mockResolvedValue(dbTest);

    await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));

    expect(storageMock.revokeAssignmentAccessTokensByAssignment).toHaveBeenCalledWith("asgn1");
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ assignmentId: "asgn1", userId: "learner1", testId: "test1" })
    );
  });

  it("sends email to user with plain-text email (contains @) without decryption failure", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([makeToken()]);
    storageMock.getTest.mockResolvedValue(dbTest);
    // learnerUser has email "learner@test.com" (plain text with @)

    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "learner@test.com" })
    );
  });

  it("returns success even if token list contains only revoked tokens (picks userId from any token)", async () => {
    const revokedToken = makeToken({ revokedAt: new Date(Date.now() - 1000) });
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([revokedToken]);
    storageMock.getTest.mockResolvedValue(dbTest);

    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(200);
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalled();
  });

  it("returns success and sends email on repeated resends (3 resends scenario)", async () => {
    // Simulate accumulated tokens after 3 previous sends (all revoked except last)
    const tokens = [
      makeToken({ id: "tok1", revokedAt: new Date(Date.now() - 3000) }),
      makeToken({ id: "tok2", revokedAt: new Date(Date.now() - 2000) }),
      makeToken({ id: "tok3", revokedAt: null, expiresAt: new Date(Date.now() + 86400_000) }),
    ];
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue(tokens);
    storageMock.getTest.mockResolvedValue(dbTest);

    // 4th resend should still work
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(200);
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D-3 (PLAN_MAGIC_LINK_SCOPE.md, Этап 3): a passwordless assignment link must
// never be issued to a recipient holding any role other than `learner`.
describe("Assignment link withheld for privileged recipients (D-3)", () => {
  it("a pure-learner recipient still gets a token and a magic link in the letter", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockResolvedValue({ ...dbAssignment, userId: "learner1" });

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1" }));
    expect(res.status).toBe(201);

    await new Promise(r => setTimeout(r, 60));
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalled();
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.magicLink).toContain("/access/");
  });

  it("an administrator recipient gets no token and a letter without a magic link (direct assignment)", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockResolvedValue({ ...dbAssignment, userId: "admin1" });

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "admin1" }));
    expect(res.status).toBe(201);

    await new Promise(r => setTimeout(r, 60));
    expect(storageMock.createAssignmentAccessToken).not.toHaveBeenCalled();
    expect(storageMock.revokeAssignmentAccessTokensByAssignmentAndUser).not.toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.magicLink).toBeUndefined();
    expect(call.to).toBe("admin@test.com");
  });

  it("a recipient holding author+learner is still privileged and gets no token (mixed roles)", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.createTestAssignment.mockResolvedValue({ ...dbAssignment, userId: "mixed1" });

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "mixed1" }));
    expect(res.status).toBe(201);

    await new Promise(r => setTimeout(r, 60));
    expect(storageMock.createAssignmentAccessToken).not.toHaveBeenCalled();
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.magicLink).toBeUndefined();
  });

  it("resend withholds a new token for a privileged recipient (still revokes the old one)", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([
      makeToken({ userId: "admin1" }),
    ]);
    storageMock.getTest.mockResolvedValue(dbTest);

    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.revokeAssignmentAccessTokensByAssignment).toHaveBeenCalledWith("asgn1");
    expect(storageMock.createAssignmentAccessToken).not.toHaveBeenCalled();
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.to).toBe("admin@test.com");
    expect(call.magicLink).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("Token isolation for group assignments", () => {
  it("each group member gets their own token without revoking others (revokeByAssignmentAndUser)", async () => {
    // When notifyUser is called for 2 users in the same group,
    // it must call revokeByAssignmentAndUser (not revokeByAssignment)
    // so user1's token is not revoked when user2's notification is processed.

    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getGroup.mockResolvedValue(dbGroup);
    storageMock.getGroupUsers.mockResolvedValue([
      { id: "learner1" },
      { id: "learner2" },
    ]);
    storageMock.createTestAssignment.mockResolvedValue({
      ...dbAssignment, userId: null, groupId: "grp1",
    });

    await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ groupId: "grp1" }));

    // Allow async notifyUser calls to settle
    await new Promise(r => setTimeout(r, 100));

    // Must use per-user revoke, NOT the assignment-wide revoke
    expect(storageMock.revokeAssignmentAccessTokensByAssignmentAndUser).toHaveBeenCalledTimes(2);
    expect(storageMock.revokeAssignmentAccessTokensByAssignmentAndUser).toHaveBeenCalledWith("asgn1", "learner1");
    expect(storageMock.revokeAssignmentAccessTokensByAssignmentAndUser).toHaveBeenCalledWith("asgn1", "learner2");

    // The assignment-wide revoke should NOT be called from notifyUser
    expect(storageMock.revokeAssignmentAccessTokensByAssignment).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/learner/assigned-tests", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/learner/assigned-tests");
    expect(res.status).toBe(401);
  });

  it("returns assigned tests for learner", async () => {
    const tests = [{ id: "test1", title: "T1" }, { id: "test2", title: "T2" }];
    storageMock.getAssignedTestsForUser.mockResolvedValue(tests);

    const res = await asLearner(request(makeApp()).get("/api/learner/assigned-tests"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(storageMock.getAssignedTestsForUser).toHaveBeenCalledWith("learner1");
  });

  it("returns empty array when no assignments", async () => {
    storageMock.getAssignedTestsForUser.mockResolvedValue([]);
    const res = await asLearner(request(makeApp()).get("/api/learner/assigned-tests"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });
});
