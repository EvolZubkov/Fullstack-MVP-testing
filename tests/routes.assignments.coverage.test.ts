/**
 * Branch-coverage tests for the assignments router (error / edge paths).
 *
 * Complements the happy-path suite in `routes.assignments.test.ts`: this file
 * targets the previously uncovered branches — 500 catch handlers, the
 * encrypted-email decrypt paths, permission/scope failures, and the four group
 * routes not exercised by the base suite (group-users, resend-group,
 * resend-user, revoke-user).
 *
 * Notes on the harness:
 * - `requirePermission`/`requireTestScope`/`requireAssignmentScope` all resolve
 *   roles through `storage.getUserRoles`; the default mock returns
 *   `["administrator"]`, which bypasses object-level scope. Tests that assert a
 *   403 override the roles.
 * - The scope middleware loads the assignment/test BEFORE the route body, so a
 *   route-body 404 for a scoped endpoint is only reachable by returning a valid
 *   entity to the middleware and `undefined` to the handler via
 *   `mockResolvedValueOnce` sequencing.
 * - The real `decryptEmail` swallows errors and returns "", so the "cannot
 *   decrypt" 400 branch is only reachable with a crypto mock that throws.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendEmailMock, decryptEmailMock, hashEmailMock } = vi.hoisted(() => ({
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
    getTestGrantForUser: vi.fn(),
    // Token methods
    createAssignmentAccessToken: vi.fn(),
    getAssignmentAccessToken: vi.fn(),
    getAssignmentAccessTokensByAssignment: vi.fn(),
    revokeAssignmentAccessToken: vi.fn(),
    revokeAssignmentAccessTokensByAssignment: vi.fn(),
    revokeAssignmentAccessTokensByAssignmentAndUser: vi.fn(),
  },
  sendEmailMock: vi.fn(),
  decryptEmailMock: vi.fn(),
  hashEmailMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({ sendAssignmentEmail: sendEmailMock }));
// `../utils/crypto` is reached via dynamic import inside the router; mock it so
// the decrypt branches are controllable. `hashEmail` is also used transitively
// by the superadmin resolver, so keep it deterministic and non-matching.
vi.mock("../server/utils/crypto", () => ({
  decryptEmail: decryptEmailMock,
  hashEmail: hashEmailMock,
  encryptEmail: vi.fn(),
  hashPassword: vi.fn(),
  verifyPassword: vi.fn(),
  hashPasswordSync: vi.fn(),
}));

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
// A user whose stored email is encrypted (no "@") — forces the decrypt branch.
const encUser = { ...learnerUser, id: "enc1", email: "ENCRYPTEDBLOB", name: "Enc User" };
// A user with no email at all — forces the empty-email branch.
const noEmailUser = { ...learnerUser, id: "noemail1", email: null as unknown as string, name: "No Email" };
// Privileged recipients (D-3 / PLAN_MAGIC_LINK_SCOPE.md Этап 3): must never
// receive a passwordless assignment link, direct, group, or resend.
const adminRecipient = {
  ...authorUser, id: "admin1", role: "administrator",
  email: "admin@test.com", name: "Admin Recipient",
};
const mixedRecipient = {
  ...authorUser, id: "mixed1", role: "author",
  email: "mixed@test.com", name: "Mixed Recipient",
};

const dbTest = { id: "test1", title: "Test One", description: "desc" };
const dbAssignment = {
  id: "asgn1", testId: "test1", userId: "learner1", groupId: null,
  dueDate: null, linkExpiresAt: null, assignedBy: "author1", assignedAt: new Date().toISOString(),
};
const groupAssignment = {
  id: "gasgn1", testId: "test1", userId: null, groupId: "grp1",
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
const settle = () => new Promise((r) => setTimeout(r, 60));

// ─── Default mock setup ───────────────────────────────────────────────────────
beforeEach(() => {
  vi.resetAllMocks();

  // Per-id roles: author1 is the acting administrator (requester); every other
  // id defaults to a pure learner. `mayReceiveAssignmentLink` (D-3) resolves
  // roles for the RECIPIENT, so a blanket ["administrator"] mock would make
  // every recipient look privileged and silently suppress token creation —
  // see `tests/routes.assignments.test.ts` for the dedicated D-3 coverage.
  storageMock.getUserRoles.mockImplementation((id: string) => {
    if (id === "author1") return Promise.resolve(["administrator"]);
    if (id === "admin1") return Promise.resolve(["administrator"]);
    if (id === "mixed1") return Promise.resolve(["author", "learner"]);
    return Promise.resolve(["learner"]);
  });
  storageMock.getTest.mockResolvedValue(dbTest);
  storageMock.getAssignment.mockResolvedValue(dbAssignment);
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);

  storageMock.getUser.mockImplementation((id: string) => {
    if (id === "author1") return Promise.resolve(authorUser);
    if (id === "learner1") return Promise.resolve(learnerUser);
    if (id === "learner2") return Promise.resolve(learner2);
    if (id === "enc1") return Promise.resolve(encUser);
    if (id === "noemail1") return Promise.resolve(noEmailUser);
    if (id === "admin1") return Promise.resolve(adminRecipient);
    if (id === "mixed1") return Promise.resolve(mixedRecipient);
    return Promise.resolve(undefined);
  });

  storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([]);
  storageMock.createAssignmentAccessToken.mockImplementation((data: any) =>
    Promise.resolve({ id: "new-tok", createdAt: new Date(), revokedAt: null, ...data })
  );
  storageMock.revokeAssignmentAccessTokensByAssignment.mockResolvedValue(undefined);
  storageMock.revokeAssignmentAccessTokensByAssignmentAndUser.mockResolvedValue(undefined);
  storageMock.revokeAssignmentAccessToken.mockResolvedValue(undefined);
  storageMock.deleteTestAssignment.mockResolvedValue(true);
  storageMock.createTestAssignment.mockResolvedValue(dbAssignment);
  storageMock.getGroupUsers.mockResolvedValue([]);
  storageMock.getGroup.mockResolvedValue(dbGroup);
  storageMock.getTestAssignments.mockResolvedValue([]);
  storageMock.getAssignedTestsForUser.mockResolvedValue([]);

  sendEmailMock.mockResolvedValue(true);
  decryptEmailMock.mockResolvedValue("decrypted@test.com");
  hashEmailMock.mockImplementation((e: string) => "hash:" + e);
});

// ─── Permission / scope failures (403) ────────────────────────────────────────
describe("permission and scope gates", () => {
  it("GET /tests/:id/assignments → 403 when role lacks assignments.manage", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asLearner(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/forbidden/i);
  });

  it("POST /tests/:id/assignments → 403 when role lacks assignments.manage", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asLearner(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1" }));
    expect(res.status).toBe(403);
  });

  it("GET /tests/:id/assignments → 403 when manager has no grant on the test", async () => {
    storageMock.getUserRoles.mockResolvedValue(["manager"]);
    storageMock.getTestGrantForUser.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(403);
  });

  it("DELETE /assignments/:id → 403 when manager has no grant on the parent test", async () => {
    storageMock.getUserRoles.mockResolvedValue(["manager"]);
    storageMock.getTestGrantForUser.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp()).delete("/api/assignments/asgn1"));
    expect(res.status).toBe(403);
  });

  it("PATCH /assignment-tokens/:id/revoke → 403 when role lacks assignments.manage", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asLearner(request(makeApp()).patch("/api/assignment-tokens/tok1/revoke"));
    expect(res.status).toBe(403);
  });
});

// ─── GET /tests/:id/assignments — 500 ─────────────────────────────────────────
describe("GET /api/tests/:id/assignments (errors)", () => {
  it("returns 500 when storage throws while listing", async () => {
    storageMock.getTestAssignments.mockRejectedValue(new Error("DB down"));
    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch/i);
  });
});

// ─── POST /tests/:id/assignments — 500 + notifyUser branches ──────────────────
describe("POST /api/tests/:id/assignments (errors + notify)", () => {
  it("returns 500 when createTestAssignment throws", async () => {
    storageMock.createTestAssignment.mockRejectedValue(new Error("insert failed"));
    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to create/i);
  });

  it("notifyUser decrypts an encrypted email and sends to the decrypted address", async () => {
    storageMock.createTestAssignment.mockResolvedValue({ ...dbAssignment, id: "asgn-enc", userId: "enc1" });
    decryptEmailMock.mockResolvedValue("real@corp.com");

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "enc1" }));
    expect(res.status).toBe(201);

    await settle();
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "real@corp.com" }));
  });

  it("notifyUser aborts (no token, no email) when the email cannot be decrypted", async () => {
    storageMock.createTestAssignment.mockResolvedValue({ ...dbAssignment, id: "asgn-enc", userId: "enc1" });
    decryptEmailMock.mockRejectedValue(new Error("bad key"));

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "enc1" }));
    expect(res.status).toBe(201);

    await settle();
    expect(storageMock.createAssignmentAccessToken).not.toHaveBeenCalled();
    expect(storageMock.revokeAssignmentAccessTokensByAssignmentAndUser).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it("notifyUser aborts when the decrypted email is empty", async () => {
    storageMock.createTestAssignment.mockResolvedValue({ ...dbAssignment, id: "asgn-enc", userId: "enc1" });
    decryptEmailMock.mockResolvedValue("");

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "enc1" }));
    expect(res.status).toBe(201);

    await settle();
    expect(storageMock.createAssignmentAccessToken).not.toHaveBeenCalled();
    expect(sendEmailMock).not.toHaveBeenCalled();
  });
});

// ─── POST /tests/:id/assignments/bulk — 500 + group loop ──────────────────────
describe("POST /api/tests/:id/assignments/bulk (errors + group members)", () => {
  it("returns 500 when a bulk insert throws", async () => {
    storageMock.createTestAssignment.mockRejectedValue(new Error("insert failed"));
    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments/bulk")
      .send({ userIds: ["learner1", "learner2"] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to create/i);
  });

  it("notifies each member when bulk-assigning a group with members", async () => {
    storageMock.createTestAssignment.mockResolvedValue({ ...groupAssignment, id: "gasgn-bulk" });
    storageMock.getGroupUsers.mockResolvedValue([{ id: "learner1" }, { id: "learner2" }]);

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments/bulk")
      .send({ groupIds: ["grp1"] }));
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(1);

    await settle();
    // One token generated per group member.
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalledTimes(2);
  });
});

// ─── DELETE /assignments/:id — 500 ────────────────────────────────────────────
describe("DELETE /api/assignments/:id (errors)", () => {
  it("returns 500 when revoking tokens throws", async () => {
    storageMock.revokeAssignmentAccessTokensByAssignment.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).delete("/api/assignments/asgn1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to delete/i);
  });
});

// ─── POST /assignments/:id/resend — decrypt + edge + 500 ──────────────────────
describe("POST /api/assignments/:id/resend (decrypt + errors)", () => {
  it("returns 500 when token lookup throws", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to resend/i);
  });

  it("decrypts an encrypted email and returns success", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([makeToken({ userId: "enc1" })]);
    decryptEmailMock.mockResolvedValue("real@corp.com");

    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "real@corp.com" }));
  });

  it("returns 400 when the encrypted email cannot be decrypted", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([makeToken({ userId: "enc1" })]);
    decryptEmailMock.mockRejectedValue(new Error("bad key"));

    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot decrypt/i);
  });

  it("sends with an empty recipient when the user has no email", async () => {
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([makeToken({ userId: "noemail1" })]);

    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend"));
    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "" }));
    expect(decryptEmailMock).not.toHaveBeenCalled();
  });
});

// ─── GET /assignments/:id/group-users ─────────────────────────────────────────
describe("GET /api/assignments/:id/group-users", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).get("/api/assignments/gasgn1/group-users");
    expect(res.status).toBe(401);
  });

  it("returns 400 when the assignment is not a group assignment", async () => {
    // Default getAssignment (dbAssignment) has groupId=null and passes scope.
    const res = await asAuthor(request(makeApp()).get("/api/assignments/asgn1/group-users"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a group/i);
  });

  it("returns 404 (route body) when the assignment vanishes after the scope check", async () => {
    // Middleware sees the assignment; the handler's re-fetch returns undefined.
    storageMock.getAssignment
      .mockResolvedValueOnce(groupAssignment)
      .mockResolvedValueOnce(undefined);
    const res = await asAuthor(request(makeApp()).get("/api/assignments/gasgn1/group-users"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/assignment not found/i);
  });

  it("returns members with per-user token status and decrypted emails", async () => {
    storageMock.getAssignment.mockResolvedValue(groupAssignment);
    storageMock.getGroupUsers.mockResolvedValue([
      { id: "learner1", email: "l1@test.com", name: "L1", status: "active" },
      { id: "learner2", email: "ENCBLOB2", name: "L2", status: "active" },
      { id: "learner3", email: "l3@test.com", name: "L3", status: "active" },
    ]);
    storageMock.getAssignmentAccessTokensByAssignment.mockResolvedValue([
      makeToken({ id: "t-active", userId: "learner1", revokedAt: null, expiresAt: new Date(Date.now() + 86400_000) }),
      makeToken({ id: "t-revoked", userId: "learner2", revokedAt: new Date() }),
    ]);
    decryptEmailMock.mockResolvedValue("decrypted2@test.com");

    const res = await asAuthor(request(makeApp()).get("/api/assignments/gasgn1/group-users"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(3);
    expect(res.body[0].tokenStatus).toBe("active");
    expect(res.body[1].tokenStatus).toBe("revoked");
    expect(res.body[1].email).toBe("decrypted2@test.com");
    expect(res.body[2].tokenStatus).toBe("none");
  });

  it("keeps the raw email when decryption throws (swallowed)", async () => {
    storageMock.getAssignment.mockResolvedValue(groupAssignment);
    storageMock.getGroupUsers.mockResolvedValue([
      { id: "learner2", email: "ENCBLOB2", name: "L2", status: "active" },
    ]);
    decryptEmailMock.mockRejectedValue(new Error("bad key"));

    const res = await asAuthor(request(makeApp()).get("/api/assignments/gasgn1/group-users"));
    expect(res.status).toBe(200);
    expect(res.body[0].email).toBe("ENCBLOB2");
  });

  it("returns 500 when fetching members throws", async () => {
    storageMock.getAssignment.mockResolvedValue(groupAssignment);
    storageMock.getGroupUsers.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).get("/api/assignments/gasgn1/group-users"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to get group/i);
  });
});

// ─── POST /assignments/:id/resend-group ───────────────────────────────────────
describe("POST /api/assignments/:id/resend-group", () => {
  it("returns 400 when the assignment is not a group assignment", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-group"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a group/i);
  });

  it("returns 404 (route body) when the assignment vanishes after the scope check", async () => {
    storageMock.getAssignment
      .mockResolvedValueOnce(groupAssignment)
      .mockResolvedValueOnce(undefined);
    const res = await asAuthor(request(makeApp()).post("/api/assignments/gasgn1/resend-group"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/assignment not found/i);
  });

  it("returns 404 when the test vanishes after the scope check", async () => {
    storageMock.getAssignment.mockResolvedValue(groupAssignment);
    storageMock.getTest
      .mockResolvedValueOnce(dbTest) // middleware
      .mockResolvedValueOnce(undefined); // handler
    const res = await asAuthor(request(makeApp()).post("/api/assignments/gasgn1/resend-group"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/test not found/i);
  });

  it("resends to plaintext members and skips those whose email cannot be decrypted", async () => {
    storageMock.getAssignment.mockResolvedValue(groupAssignment);
    storageMock.getGroupUsers.mockResolvedValue([
      { id: "learner1", email: "l1@test.com", name: "L1", status: "active" }, // sent
      { id: "learner2", email: "ENCBLOB2", name: "L2", status: "active" },   // decrypt throws → skipped
    ]);
    decryptEmailMock.mockRejectedValue(new Error("bad key"));

    const res = await asAuthor(request(makeApp()).post("/api/assignments/gasgn1/resend-group"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sent: 1 });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "l1@test.com" }));
  });

  it("returns 500 when revoking existing tokens throws", async () => {
    storageMock.getAssignment.mockResolvedValue(groupAssignment);
    storageMock.getGroupUsers.mockResolvedValue([{ id: "learner1", email: "l1@test.com", name: "L1", status: "active" }]);
    storageMock.revokeAssignmentAccessTokensByAssignment.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).post("/api/assignments/gasgn1/resend-group"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to resend group/i);
  });

  // D-3 (PLAN_MAGIC_LINK_SCOPE.md, Этап 3): a privileged group member must not
  // receive a new passwordless link when the group is resent.
  it("withholds the token and link for a privileged group member (administrator)", async () => {
    storageMock.getAssignment.mockResolvedValue(groupAssignment);
    storageMock.getGroupUsers.mockResolvedValue([
      { id: "learner1", email: "l1@test.com", name: "L1", status: "active", emailHash: "x" },
      { id: "admin1", email: "admin@test.com", name: "Admin Recipient", status: "active", emailHash: "x" },
    ]);

    const res = await asAuthor(request(makeApp()).post("/api/assignments/gasgn1/resend-group"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sent: 2 });
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalledTimes(1); // only learner1
    const adminCall = sendEmailMock.mock.calls.find((c: any[]) => c[0].to === "admin@test.com")?.[0];
    expect(adminCall).toBeDefined();
    expect(adminCall.magicLink).toBeUndefined();
  });
});

// ─── POST /assignments/:id/resend-user/:userId ────────────────────────────────
describe("POST /api/assignments/:id/resend-user/:userId", () => {
  it("returns 404 (route body) when the assignment vanishes after the scope check", async () => {
    storageMock.getAssignment
      .mockResolvedValueOnce(dbAssignment)
      .mockResolvedValueOnce(undefined);
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-user/learner2"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/assignment not found/i);
  });

  it("returns 404 when the test vanishes after the scope check", async () => {
    storageMock.getTest
      .mockResolvedValueOnce(dbTest) // middleware
      .mockResolvedValueOnce(undefined); // handler
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-user/learner2"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/test not found/i);
  });

  it("returns 404 when the target user does not exist", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-user/ghost"));
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/user not found/i);
  });

  it("resends to a plaintext-email user and returns success", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-user/learner2"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.revokeAssignmentAccessTokensByAssignmentAndUser).toHaveBeenCalledWith("asgn1", "learner2");
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "learner2@test.com" }));
  });

  it("decrypts an encrypted-email user and returns success", async () => {
    decryptEmailMock.mockResolvedValue("real@corp.com");
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-user/enc1"));
    expect(res.status).toBe(200);
    expect(sendEmailMock).toHaveBeenCalledWith(expect.objectContaining({ to: "real@corp.com" }));
  });

  it("returns 400 when the encrypted email cannot be decrypted", async () => {
    decryptEmailMock.mockRejectedValue(new Error("bad key"));
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-user/enc1"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/cannot decrypt/i);
  });

  it("returns 500 when token generation throws", async () => {
    storageMock.createAssignmentAccessToken.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-user/learner2"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to resend/i);
  });

  // D-3 (PLAN_MAGIC_LINK_SCOPE.md, Этап 3): a privileged recipient must not
  // receive a new passwordless link when resent individually.
  it("withholds the token and link for a privileged recipient (author+learner)", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/assignments/asgn1/resend-user/mixed1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.createAssignmentAccessToken).not.toHaveBeenCalled();
    expect(sendEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({ to: "mixed@test.com" }),
    );
    const call = sendEmailMock.mock.calls[0][0];
    expect(call.magicLink).toBeUndefined();
  });
});

// ─── PATCH /assignments/:id/revoke-user/:userId ───────────────────────────────
describe("PATCH /api/assignments/:id/revoke-user/:userId", () => {
  it("revokes the user's tokens and returns success", async () => {
    const res = await asAuthor(request(makeApp()).patch("/api/assignments/asgn1/revoke-user/learner2"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.revokeAssignmentAccessTokensByAssignmentAndUser).toHaveBeenCalledWith("asgn1", "learner2");
  });

  it("returns 500 when revoke throws", async () => {
    storageMock.revokeAssignmentAccessTokensByAssignmentAndUser.mockRejectedValue(new Error("DB error"));
    const res = await asAuthor(request(makeApp()).patch("/api/assignments/asgn1/revoke-user/learner2"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to revoke/i);
  });
});

// ─── GET /learner/assigned-tests — 500 ────────────────────────────────────────
describe("GET /api/learner/assigned-tests (errors)", () => {
  it("returns 500 when storage throws", async () => {
    storageMock.getAssignedTestsForUser.mockRejectedValue(new Error("DB error"));
    const res = await asLearner(request(makeApp()).get("/api/learner/assigned-tests"));
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch/i);
  });
});
