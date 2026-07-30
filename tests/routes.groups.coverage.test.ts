/**
 * @module tests/routes.groups.coverage
 * @description Branch-coverage tests for the /api/groups router that complement
 * the group cases in {@link module:tests/routes.topics-folders-groups}. They
 * target the branches the happy-path suite leaves out: every route's catch/500
 * block, the role gate (401/403), the empty-array-falls-through-to-userId path,
 * and — the largest gap — the fire-and-forget `notifyNewGroupMember` helper
 * (no assignments, missing user, decrypt success/failure, per-assignment
 * skip/expiry variants and the outer catch).
 *
 * The harness extends the reference harness with mocks for the email module and
 * the crypto module so the notification helper can be exercised end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, emailMock, cryptoMock } = vi.hoisted(() => ({
  storageMock: {
    getGroups: vi.fn(), getGroup: vi.fn(), createGroup: vi.fn(),
    updateGroup: vi.fn(), deleteGroup: vi.fn(),
    getGroupUsers: vi.fn(), addUserToGroup: vi.fn(), removeUserFromGroup: vi.fn(),
    // notifyNewGroupMember dependencies
    getGroupAssignments: vi.fn(), getUser: vi.fn(), getTest: vi.fn(),
    createAssignmentAccessToken: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
  },
  emailMock: { sendAssignmentEmail: vi.fn() },
  cryptoMock: { decryptEmail: vi.fn() },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => emailMock);
// Preserve the real hashEmail/verifyEmailHash (used by the superadmin/access
// resolution in requirePermission); only override decryptEmail.
vi.mock("../server/utils/crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../server/utils/crypto")>();
  return { ...actual, decryptEmail: cryptoMock.decryptEmail };
});

import groupsRouter from "../server/routes/groups";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const learnerUser = { ...authorUser, id: "learner1", role: "learner" };
const group = { id: "g1", name: "Group A", description: null, createdAt: new Date(), createdBy: null };
const groupUser = { id: "u2", email: "user@test.com", name: "User" };
// A privileged new member (D-3 / PLAN_MAGIC_LINK_SCOPE.md Этап 3): adding this
// user to a group with an active assignment must not mint a passwordless link.
const adminGroupUser = { id: "admin1", email: "admin@test.com", name: "Admin" };

/** Effective roles by user id, used by `storage.getUserRoles` in this suite. */
const rolesById: Record<string, string[]> = {
  author1: ["administrator"],
  admin1: ["administrator"],
};
/** Default: any id not listed above resolves as a pure learner (u2, ...). */
function defaultGetUserRoles(id: string): Promise<string[]> {
  return Promise.resolve(rolesById[id] ?? ["learner"]);
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/groups", groupsRouter);
  return app;
}
const asAuthor = (req: request.Test) => req.set("x-test-user", "author1");
const tick = () => new Promise((r) => setTimeout(r, 60));

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue(authorUser);
  // Per-id roles: author1 is the acting administrator (requester); every other
  // id defaults to a pure learner. `mayReceiveAssignmentLink` (D-3) resolves
  // roles for the RECIPIENT (the new group member), so a blanket
  // ["administrator"] mock would make every new member look privileged and
  // silently suppress token creation.
  storageMock.getUserRoles.mockImplementation(defaultGetUserRoles);
});

// ─────────────────────────────────────────────────────────────────────────────
// ROLE GATE (requirePermission — 401/403)
// ─────────────────────────────────────────────────────────────────────────────
describe("groups role gate", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await request(makeApp()).get("/api/groups");
    expect(res.status).toBe(401);
  });

  it("returns 403 when the user lacks groups.manage", async () => {
    storageMock.getUser.mockResolvedValue(learnerUser);
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await request(makeApp()).get("/api/groups").set("x-test-user", "learner1");
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CATCH / 500 branches
// ─────────────────────────────────────────────────────────────────────────────
describe("groups catch/500 branches", () => {
  it("GET / — 500 when getGroups throws", async () => {
    storageMock.getGroups.mockRejectedValue(new Error("db"));
    const res = await asAuthor(request(makeApp()).get("/api/groups"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get groups");
  });

  it("GET /:id — 500 when getGroup throws", async () => {
    storageMock.getGroup.mockRejectedValue(new Error("db"));
    const res = await asAuthor(request(makeApp()).get("/api/groups/g1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get group");
  });

  it("POST / — 500 when createGroup throws", async () => {
    storageMock.createGroup.mockRejectedValue(new Error("db"));
    const res = await asAuthor(request(makeApp()).post("/api/groups").send({ name: "X" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to create group");
  });

  it("PUT /:id — 500 when updateGroup throws", async () => {
    storageMock.updateGroup.mockRejectedValue(new Error("db"));
    const res = await asAuthor(request(makeApp()).put("/api/groups/g1").send({ name: "X" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update group");
  });

  it("DELETE /:id — 500 when deleteGroup throws", async () => {
    storageMock.deleteGroup.mockRejectedValue(new Error("db"));
    const res = await asAuthor(request(makeApp()).delete("/api/groups/g1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to delete group");
  });

  it("POST /:id/users — 500 when getGroup throws", async () => {
    storageMock.getGroup.mockRejectedValue(new Error("db"));
    const res = await asAuthor(request(makeApp()).post("/api/groups/g1/users").send({ userId: "u2" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to add users to group");
  });

  it("DELETE /:id/users/:userId — 500 when removeUserFromGroup throws", async () => {
    storageMock.removeUserFromGroup.mockRejectedValue(new Error("db"));
    const res = await asAuthor(request(makeApp()).delete("/api/groups/g1/users/u2"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to remove user from group");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/users — empty userIds array falls through to userId
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/groups/:id/users (coverage)", () => {
  it("uses userId when userIds is an empty array", async () => {
    storageMock.getGroup.mockResolvedValue(group);
    storageMock.getGroupUsers.mockResolvedValueOnce([]).mockResolvedValueOnce([groupUser]);
    storageMock.addUserToGroup.mockResolvedValue({});
    storageMock.getGroupAssignments.mockResolvedValue([]); // notify: no-op
    const res = await asAuthor(request(makeApp()).post("/api/groups/g1/users").send({ userIds: [], userId: "u2" }));
    expect(res.status).toBe(200);
    expect(storageMock.addUserToGroup).toHaveBeenCalledWith("u2", "g1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// notifyNewGroupMember (fire-and-forget helper)
// ─────────────────────────────────────────────────────────────────────────────
describe("notifyNewGroupMember (coverage)", () => {
  const test = { id: "test-1", title: "T", description: "d" };

  // Common route wiring: group exists, u2 is a new member -> notify fires.
  function wireNewMember() {
    storageMock.getGroup.mockResolvedValue(group);
    storageMock.getGroupUsers.mockResolvedValueOnce([]).mockResolvedValueOnce([groupUser]);
    storageMock.addUserToGroup.mockResolvedValue({});
  }

  it("sends assignment emails across assignments (skip, decrypt, all expiry variants)", async () => {
    wireNewMember();
    storageMock.getGroupAssignments.mockResolvedValue([
      { id: "a0", testId: "gone", dueDate: null, linkExpiresAt: null },      // test missing -> continue
      { id: "a1", testId: "test-1", dueDate: null, linkExpiresAt: new Date(Date.now() + 1e7) }, // linkExpiresAt
      { id: "a2", testId: "test-1", dueDate: new Date(Date.now() + 2e7), linkExpiresAt: null }, // dueDate
      { id: "a3", testId: "test-1", dueDate: null, linkExpiresAt: null },    // default +30d
    ]);
    // The member's stored email is an encrypted blob (no "@") -> decrypt branch.
    // Scoped by id (not a blanket mockResolvedValue): the actor lookup inside
    // requirePermission also goes through storage.getUser, and must keep
    // resolving to author1's own record so its role check still passes.
    storageMock.getUser.mockImplementation(async (id: string) =>
      id === "author1" ? authorUser : { ...groupUser, email: "encrypted-blob", name: "User" },
    );
    storageMock.getTest.mockImplementation(async (id: string) => (id === "test-1" ? test : undefined));
    storageMock.createAssignmentAccessToken.mockResolvedValue({});
    cryptoMock.decryptEmail.mockResolvedValue("user@test.com");
    emailMock.sendAssignmentEmail.mockResolvedValue(undefined);

    const res = await asAuthor(request(makeApp()).post("/api/groups/g1/users").send({ userId: "u2" }));
    expect(res.status).toBe(200);
    await tick();
    expect(cryptoMock.decryptEmail).toHaveBeenCalledWith("encrypted-blob");
    expect(emailMock.sendAssignmentEmail).toHaveBeenCalledTimes(3); // a1, a2, a3
  });

  it("is a no-op when the group has no assignments", async () => {
    wireNewMember();
    storageMock.getGroupAssignments.mockResolvedValue([]);
    const res = await asAuthor(request(makeApp()).post("/api/groups/g1/users").send({ userId: "u2" }));
    expect(res.status).toBe(200);
    await tick();
    expect(emailMock.sendAssignmentEmail).not.toHaveBeenCalled();
  });

  it("aborts when the added user cannot be loaded", async () => {
    wireNewMember();
    storageMock.getGroupAssignments.mockResolvedValue([{ id: "a1", testId: "test-1", dueDate: null, linkExpiresAt: null }]);
    storageMock.getUser.mockImplementation(async (id: string) => (id === "author1" ? authorUser : null));
    const res = await asAuthor(request(makeApp()).post("/api/groups/g1/users").send({ userId: "u2" }));
    expect(res.status).toBe(200);
    await tick();
    expect(emailMock.sendAssignmentEmail).not.toHaveBeenCalled();
  });

  it("swallows a decrypt failure and stops", async () => {
    wireNewMember();
    storageMock.getGroupAssignments.mockResolvedValue([{ id: "a1", testId: "test-1", dueDate: null, linkExpiresAt: null }]);
    // Scoped by id — see the comment in the previous test for why a blanket
    // mockResolvedValue would break the actor's own permission check.
    storageMock.getUser.mockImplementation(async (id: string) =>
      id === "author1" ? authorUser : { ...groupUser, email: "encrypted-blob" },
    );
    cryptoMock.decryptEmail.mockRejectedValue(new Error("bad key"));
    const res = await asAuthor(request(makeApp()).post("/api/groups/g1/users").send({ userId: "u2" }));
    expect(res.status).toBe(200);
    await tick();
    expect(emailMock.sendAssignmentEmail).not.toHaveBeenCalled();
  });

  it("swallows an outer storage failure (getGroupAssignments throws)", async () => {
    wireNewMember();
    storageMock.getGroupAssignments.mockRejectedValue(new Error("db"));
    const res = await asAuthor(request(makeApp()).post("/api/groups/g1/users").send({ userId: "u2" }));
    expect(res.status).toBe(200);
    await tick();
    expect(emailMock.sendAssignmentEmail).not.toHaveBeenCalled();
  });

  // D-3 (PLAN_MAGIC_LINK_SCOPE.md, Этап 3): the vulnerability this stage
  // closes — adding a privileged user to a group with an active assignment
  // must not hand them a passwordless entry link.
  it("withholds the token and link when the new member is privileged (administrator)", async () => {
    storageMock.getGroup.mockResolvedValue(group);
    storageMock.getGroupUsers.mockResolvedValueOnce([]).mockResolvedValueOnce([adminGroupUser]);
    storageMock.addUserToGroup.mockResolvedValue({});
    storageMock.getGroupAssignments.mockResolvedValue([
      { id: "a1", testId: "test-1", dueDate: null, linkExpiresAt: null },
    ]);
    storageMock.getUser.mockImplementation(async (id: string) =>
      id === "admin1" ? { ...adminGroupUser, emailHash: "x" } : authorUser,
    );
    storageMock.getTest.mockResolvedValue(test);
    emailMock.sendAssignmentEmail.mockResolvedValue(undefined);

    const res = await asAuthor(request(makeApp()).post("/api/groups/g1/users").send({ userId: "admin1" }));
    expect(res.status).toBe(200);
    await tick();

    expect(storageMock.createAssignmentAccessToken).not.toHaveBeenCalled();
    expect(emailMock.sendAssignmentEmail).toHaveBeenCalledTimes(1);
    const call = emailMock.sendAssignmentEmail.mock.calls[0][0];
    expect(call.to).toBe("admin@test.com");
    expect(call.magicLink).toBeUndefined();
  });
});
