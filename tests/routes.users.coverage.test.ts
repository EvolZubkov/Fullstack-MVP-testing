/**
 * Branch-coverage tests for server/routes/users.ts.
 *
 * Focus: the error/edge branches that the happy-path suites
 * (routes.users-bulk.test.ts, routes.questions-users-assignments.test.ts) leave
 * uncovered — role/ceiling 403s, 404 misses, validation 400s, the superadmin
 * guard, per-handler 500 catch blocks, the fully-uncovered PUT /:id/roles
 * handler, and a few bulk-preview/import edge branches.
 *
 * Harness mirrors the reference suites: hoisted storage mock, mocked email and
 * superadmin resolution (so the config-derived superadmin flag is deterministic
 * without initConfig), supertest + an x-test-user session shim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";
import ExcelJS from "exceljs";
import { addAoaSheet, workbookToBuffer } from "../server/utils/excel";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendEmailMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUsers: vi.fn(),
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    updateUserPassword: vi.fn(),
    getUserGroups: vi.fn(),
    setUserGroups: vi.fn(),
    getUserRoles: vi.fn(),
    setUserRoles: vi.fn(),
    getGroups: vi.fn(),
    createGroup: vi.fn(),
    addUserToGroup: vi.fn(),
    createPasswordResetToken: vi.fn(),
    deactivateUser: vi.fn(),
    activateUser: vi.fn(),
    deleteAttemptsByUserAndTest: vi.fn(),
    getAttemptsByUser: vi.fn(),
    getTests: vi.fn(),
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({
  sendInviteEmail: sendEmailMock,
  sendPasswordResetEmail: sendEmailMock,
}));
// Superadmin resolution is derived from config; mock the seam so the flag is
// deterministic (emailHash "superadmin-hash" = superadmin) without initConfig.
vi.mock("../server/superadmin", () => ({
  isSuperadminEmailHash: (h: string | null | undefined) => h === "superadmin-hash",
  superadminEmails: () => [],
}));
// Email encrypt/hash lives behind the mocked storage layer, so users.ts never
// reaches this module in these tests; the mock is included per the harness
// convention (and to keep the module graph inert if it were ever pulled in).
vi.mock("../server/utils/crypto", () => ({
  hashEmail: (e: string) => `hash:${e}`,
  encryptEmail: async (e: string) => `enc:${e}`,
  decryptEmail: async (e: string) => e,
  verifyEmailHash: () => true,
  hashPassword: async (p: string) => `scrypt:${p}`,
  verifyPassword: async () => true,
  isLegacyBcryptHash: () => false,
  dummyVerifyPassword: async () => {},
}));

import usersRouter from "../server/routes/users";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const base = {
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
// author1 is the admin-capable actor (its stored role set is ["administrator"],
// per the reference-suite convention) — the naming is historical.
const authorUser = { ...base, id: "author1", email: "author@test.com", name: "Author", role: "administrator" };
const managerUser = { ...base, id: "manager1", email: "manager@test.com", name: "Manager", role: "manager" };
const learnerUser = { ...base, id: "learner1", email: "learner@test.com", name: "Learner", role: "learner" };
const targetUser = { ...base, id: "target1", email: "target@test.com", name: "Target", role: "learner" };
const superUser = { ...base, id: "super1", email: "root@test.com", name: "Root", role: "learner", emailHash: "superadmin-hash" };

const dbTest = { id: "test1", title: "Test 1", mode: "standard", maxAttempts: 3, createdAt: new Date() };
const groupA = { id: "grp1", name: "Группа А", description: null, createdAt: new Date(), createdBy: null };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/users", usersRouter);
  return app;
}

function as(req: request.Test, uid: string) { return req.set("x-test-user", uid); }
const asAuthor = (req: request.Test) => as(req, "author1");
const asManager = (req: request.Test) => as(req, "manager1");
const asLearner = (req: request.Test) => as(req, "learner1");

async function makeXlsx(rows: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Users", rows);
  return workbookToBuffer(wb);
}

beforeEach(() => {
  // resetAllMocks (not clearAllMocks): several tests below poison mutation-method
  // implementations with mockRejectedValue to exercise 500 catch blocks; a full
  // reset stops those from leaking into later tests (e.g. bulk-import).
  vi.resetAllMocks();
  // Keyed by id so actor (middleware) and target (handler) resolve independently
  // regardless of call order; unknown ids miss (404 paths).
  storageMock.getUser.mockImplementation((id: string) => {
    switch (id) {
      case "author1": return Promise.resolve(authorUser);
      case "manager1": return Promise.resolve(managerUser);
      case "learner1": return Promise.resolve(learnerUser);
      case "target1": return Promise.resolve(targetUser);
      case "super1": return Promise.resolve(superUser);
      default: return Promise.resolve(undefined);
    }
  });
  storageMock.getUserRoles.mockImplementation((id: string) => {
    switch (id) {
      case "manager1": return Promise.resolve(["manager"]);
      case "learner1": return Promise.resolve(["learner"]);
      case "target1": return Promise.resolve(["learner"]);
      default: return Promise.resolve(["administrator"]);
    }
  });
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getGroups.mockResolvedValue([]);
  storageMock.createPasswordResetToken.mockResolvedValue({});
  sendEmailMock.mockResolvedValue(true);
});

// ─────────────────────────────────────────────────────────────────────────────
// GET / (list) — 500 catch
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/users — error branches", () => {
  it("returns 500 when storage.getUsers throws", async () => {
    storageMock.getUsers.mockRejectedValue(new Error("db down"));
    const res = await asAuthor(request(makeApp()).get("/api/users"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get users");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id — 500 catch
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/users/:id — error branches", () => {
  it("returns 500 when getUserGroups throws for an existing user", async () => {
    storageMock.getUserGroups.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).get("/api/users/target1"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get user");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST / (create) — role/ceiling/validation/500 branches
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users — create branches", () => {
  it("returns 400 when password missing but email present", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users").send({ email: "x@test.com" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 400 for an invalid role in roles[]", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users")
      .send({ email: "x@test.com", password: "pass123", roles: ["superhacker"] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Invalid role in request");
  });

  it("returns 403 when actor exceeds the assignment ceiling (manager -> author)", async () => {
    const res = await asManager(request(makeApp()).post("/api/users")
      .send({ email: "x@test.com", password: "pass123", role: "author" }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
    expect(res.body.reason).toBeTruthy();
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  it("creates a user from a valid roles[] set (array path)", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.createUser.mockResolvedValue({ ...targetUser, id: "u1" });
    const res = await asAuthor(request(makeApp()).post("/api/users")
      .send({ email: "new@test.com", password: "pass123", roles: ["author", "learner"] }));
    expect(res.status).toBe(201);
    expect(res.body.roles).toEqual(["author", "learner"]);
    expect(storageMock.setUserRoles).toHaveBeenCalledWith("u1", ["author", "learner"], "author1");
  });

  it("returns 500 when createUser throws", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.createUser.mockRejectedValue(new Error("insert failed"));
    const res = await asAuthor(request(makeApp()).post("/api/users")
      .send({ email: "new@test.com", password: "pass123" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to create user");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:id (update) — email-change no-conflict, groupIds, 500
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/users/:id — update branches", () => {
  it("updates email + groups when new email is free (no conflict)", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.updateUser.mockResolvedValue({ ...targetUser, email: "fresh@test.com" });
    storageMock.setUserGroups.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp()).put("/api/users/target1")
      .send({ email: "fresh@test.com", name: "Renamed", groupIds: ["grp1"] }));
    expect(res.status).toBe(200);
    expect(storageMock.getUserByEmail).toHaveBeenCalledWith("fresh@test.com");
    expect(storageMock.setUserGroups).toHaveBeenCalledWith("target1", ["grp1"]);
  });

  it("returns 500 when updateUser throws", async () => {
    storageMock.updateUser.mockRejectedValue(new Error("update failed"));
    const res = await asAuthor(request(makeApp()).put("/api/users/target1").send({ name: "X" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update user");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:id/roles — whole handler was uncovered
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/users/:id/roles", () => {
  it("returns 404 when target user is missing", async () => {
    const res = await asAuthor(request(makeApp()).put("/api/users/ghost/roles").send({ roles: ["learner"] }));
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("returns 400 when roles is not an array", async () => {
    const res = await asAuthor(request(makeApp()).put("/api/users/target1/roles").send({ roles: "author" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/array/i);
  });

  it("returns 403 when admin tries to assign the administrator role (above ceiling)", async () => {
    const res = await asAuthor(request(makeApp()).put("/api/users/target1/roles").send({ roles: ["administrator"] }));
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("Forbidden");
    expect(res.body.reason).toMatch(/administrator/);
    expect(storageMock.setUserRoles).not.toHaveBeenCalled();
  });

  it("returns 403 when a non-superadmin edits a superadmin account", async () => {
    const res = await asAuthor(request(makeApp()).put("/api/users/super1/roles").send({ roles: ["learner"] }));
    expect(res.status).toBe(403);
    expect(res.body.reason).toMatch(/superadmin/);
  });

  it("assigns a valid role set (200)", async () => {
    storageMock.setUserRoles.mockResolvedValue(undefined);
    const res = await asAuthor(request(makeApp()).put("/api/users/target1/roles").send({ roles: ["author"] }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: "target1", roles: ["author"] });
    expect(storageMock.setUserRoles).toHaveBeenCalledWith("target1", ["author"], "author1");
  });

  it("returns 500 when setUserRoles throws", async () => {
    storageMock.setUserRoles.mockRejectedValue(new Error("write failed"));
    const res = await asAuthor(request(makeApp()).put("/api/users/target1/roles").send({ roles: ["author"] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to set user roles");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/reset-password — short password, 404, 500
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users/:id/reset-password — branches", () => {
  it("returns 400 when password is shorter than 6 chars", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/target1/reset-password").send({ newPassword: "123" }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 6/i);
  });

  it("returns 404 when target user is missing", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/ghost/reset-password").send({ newPassword: "longenough" }));
    expect(res.status).toBe(404);
  });

  it("returns 500 when updateUserPassword throws", async () => {
    storageMock.updateUserPassword.mockRejectedValue(new Error("no write"));
    const res = await asAuthor(request(makeApp()).post("/api/users/target1/reset-password").send({ newPassword: "longenough" }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to reset password");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/deactivate — 404, superadmin guard, 500
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users/:id/deactivate — branches", () => {
  it("returns 404 when target user is missing", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/ghost/deactivate"));
    expect(res.status).toBe(404);
  });

  it("returns 400 when target is a superadmin", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/super1/deactivate"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/superadmin/i);
    expect(storageMock.deactivateUser).not.toHaveBeenCalled();
  });

  it("returns 500 when deactivateUser throws", async () => {
    storageMock.deactivateUser.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).post("/api/users/target1/deactivate"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to deactivate user");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/activate — 404, 500
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users/:id/activate — branches", () => {
  it("returns 404 when target user is missing", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/ghost/activate"));
    expect(res.status).toBe(404);
  });

  it("returns 500 when activateUser throws", async () => {
    storageMock.activateUser.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).post("/api/users/target1/activate"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to activate user");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/reset-attempts — 404, 500
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users/:id/reset-attempts — branches", () => {
  it("returns 404 when target user is missing", async () => {
    const res = await asAuthor(request(makeApp()).post("/api/users/ghost/reset-attempts").send({}));
    expect(res.status).toBe(404);
  });

  it("returns 500 when getAttemptsByUser throws (no testId path)", async () => {
    storageMock.getAttemptsByUser.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).post("/api/users/target1/reset-attempts").send({}));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to reset attempts");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id/attempts-summary — 404, inner branches, 500
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/users/:id/attempts-summary — branches", () => {
  it("returns 404 when target user is missing", async () => {
    const res = await asAuthor(request(makeApp()).get("/api/users/ghost/attempts-summary"));
    expect(res.status).toBe(404);
  });

  it("computes bestScore/lastAttemptAt across completed and in-progress attempts", async () => {
    storageMock.getAttemptsByUser.mockResolvedValue([
      { testId: "test1", finishedAt: new Date("2024-01-02"), resultJson: { percent: 80 } },
      { testId: "test1", finishedAt: new Date("2024-01-01"), resultJson: { percent: 50 } },
      { testId: "test1", finishedAt: new Date("2024-01-03"), resultJson: {} }, // percent undefined -> || 0
      { testId: "test1", finishedAt: null, resultJson: null },                  // in progress
    ]);
    storageMock.getTests.mockResolvedValue([dbTest]);
    const res = await asAuthor(request(makeApp()).get("/api/users/target1/attempts-summary"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].totalAttempts).toBe(4);
    expect(res.body[0].completedAttempts).toBe(3);
    expect(res.body[0].bestScore).toBe(80);
    expect(new Date(res.body[0].lastAttemptAt).toISOString()).toBe(new Date("2024-01-03").toISOString());
  });

  it("leaves bestScore null when completed attempts carry no result payload", async () => {
    storageMock.getAttemptsByUser.mockResolvedValue([
      { testId: "test1", finishedAt: new Date("2024-01-05"), resultJson: null },
    ]);
    storageMock.getTests.mockResolvedValue([dbTest]);
    const res = await asAuthor(request(makeApp()).get("/api/users/target1/attempts-summary"));
    expect(res.status).toBe(200);
    expect(res.body[0].bestScore).toBeNull();
    expect(res.body[0].completedAttempts).toBe(1);
  });

  it("returns 500 when getAttemptsByUser throws", async () => {
    storageMock.getAttemptsByUser.mockRejectedValue(new Error("boom"));
    storageMock.getTests.mockResolvedValue([dbTest]);
    const res = await asAuthor(request(makeApp()).get("/api/users/target1/attempts-summary"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get attempts summary");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id/groups — 404, 500
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/users/:id/groups — branches", () => {
  it("returns 404 when target user is missing", async () => {
    const res = await asAuthor(request(makeApp()).get("/api/users/ghost/groups"));
    expect(res.status).toBe(404);
  });

  it("returns 500 when getUserGroups throws", async () => {
    storageMock.getUserGroups.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).get("/api/users/target1/groups"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get user groups");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /:id/groups — 404, 500
// ─────────────────────────────────────────────────────────────────────────────
describe("PUT /api/users/:id/groups — branches", () => {
  it("returns 404 when target user is missing", async () => {
    const res = await asAuthor(request(makeApp()).put("/api/users/ghost/groups").send({ groupIds: [] }));
    expect(res.status).toBe(404);
  });

  it("returns 500 when setUserGroups throws", async () => {
    storageMock.setUserGroups.mockRejectedValue(new Error("boom"));
    const res = await asAuthor(request(makeApp()).put("/api/users/target1/groups").send({ groupIds: ["grp1"] }));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to update user groups");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-preview — role=author branch, >500 rows, parse-failure 500
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users/bulk-preview — edge branches", () => {
  it("maps role=author to a valid author preview and reads the Email header variant", async () => {
    storageMock.getGroups.mockResolvedValue([groupA]);
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    const buf = await makeXlsx([
      ["Email", "name", "role", "group"],
      ["author-row@test.com", "A", "author", "Группа А"],
    ]);
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(200);
    expect(res.body[0].role).toBe("author");
    expect(res.body[0].groupFound).toBe(true);
  });

  it("returns 400 when more than 500 rows are uploaded", async () => {
    const rows = [["email", "name"]];
    for (let i = 0; i < 501; i++) rows.push([`u${i}@test.com`, `U${i}`]);
    const buf = await makeXlsx(rows);
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-preview").attach("file", buf, "users.xlsx"));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/500/);
  });

  it("returns 500 when the uploaded file cannot be parsed", async () => {
    const res = await asAuthor(request(makeApp())
      .post("/api/users/bulk-preview")
      .attach("file", Buffer.from("this is not a spreadsheet"), "users.xlsx"));
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to parse file");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /bulk-import — role-ceiling per-row error, existing-group-by-name
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/users/bulk-import — edge branches", () => {
  const newRow = {
    idx: 0, email: "bulk@test.com", name: "Bulk", role: "learner",
    groupName: null, groupId: null, groupFound: false, status: "new", existingId: null,
  };

  it("records a per-row error when the row role exceeds the actor ceiling", async () => {
    // Manager may create only learners; an author row is rejected per-row.
    const res = await asManager(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [{ ...newRow, role: "author" }],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(0);
    expect(res.body.errors).toHaveLength(1);
    expect(res.body.errors[0]).toContain("bulk@test.com");
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  it("resolves a group by name from the DB when groupId is absent", async () => {
    storageMock.createUser.mockResolvedValue({ ...targetUser, id: "u1" });
    storageMock.addUserToGroup.mockResolvedValue({});
    storageMock.getGroups.mockResolvedValue([groupA]); // matched by name, no auto-create
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [{ ...newRow, groupId: null, groupName: "Группа А" }],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(storageMock.createGroup).not.toHaveBeenCalled();
    expect(storageMock.addUserToGroup).toHaveBeenCalledWith("u1", "grp1");
  });

  it("still creates the user when group assignment fails (swallowed)", async () => {
    storageMock.createUser.mockResolvedValue({ ...targetUser, id: "u1" });
    storageMock.getGroups.mockResolvedValue([groupA]);
    storageMock.addUserToGroup.mockRejectedValue(new Error("group link failed"));
    const res = await asAuthor(request(makeApp()).post("/api/users/bulk-import").send({
      rows: [{ ...newRow, groupId: "grp1", groupName: "Группа А", groupFound: true }],
      sendInvites: false,
    }));
    expect(res.status).toBe(200);
    // The addUserToGroup rejection is caught inline and logged, not surfaced.
    expect(res.body.created).toBe(1);
    expect(res.body.errors).toHaveLength(0);
  });
});
