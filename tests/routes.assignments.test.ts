/**
 * Tests for assignments routes:
 * - GET  /tests/:id/assignments
 * - POST /tests/:id/assignments
 * - POST /tests/:id/assignments/bulk
 * - DELETE /assignments/:id
 * - GET  /learner/assigned-tests
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getTestAssignments: vi.fn(),
    createTestAssignment: vi.fn(),
    deleteTestAssignment: vi.fn(),
    getAssignedTestsForUser: vi.fn(),
    getUser: vi.fn(),
    getGroup: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

import assignmentsRouter from "../server/routes/assignments";

// ─── App factory ──────────────────────────────────────────────────────────────
const authorUser = {
  id: "author1", email: "a@test.com", name: "Author", role: "author",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const learnerUser = { ...authorUser, id: "learner1", role: "learner", email: "l@test.com" };

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

const dbTest = { id: "test1", title: "T1" };
const dbAssignment = {
  id: "asgn1", testId: "test1", userId: "learner1", groupId: null,
  dueDate: null, assignedBy: "author1",
};
const dbGroup = { id: "grp1", name: "Group A" };

beforeEach(() => {
  vi.resetAllMocks();
  storageMock.getUser.mockImplementation((id: string) => {
    if (id === "author1") return Promise.resolve(authorUser);
    if (id === "learner1") return Promise.resolve(learnerUser);
    return Promise.resolve(undefined);
  });
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

  it("returns enriched assignments with user info", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([dbAssignment]);
    storageMock.getUser.mockImplementation((id: string) => {
      if (id === "author1") return Promise.resolve(authorUser);
      if (id === "learner1") return Promise.resolve({ ...learnerUser, passwordHash: "secret" });
      return Promise.resolve(undefined);
    });

    const res = await asAuthor(request(makeApp()).get("/api/tests/test1/assignments"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].user.email).toBe("l@test.com");
    // passwordHash должен быть удалён
    expect(res.body[0].user.passwordHash).toBeUndefined();
    expect(res.body[0].group).toBeNull();
  });

  it("returns enriched assignments with group info", async () => {
    const groupAssignment = { ...dbAssignment, userId: null, groupId: "grp1" };
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getTestAssignments.mockResolvedValue([groupAssignment]);
    storageMock.getGroup.mockResolvedValue(dbGroup);

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
    expect(res.body.error).toMatch(/test not found/i);
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
    storageMock.getUser.mockImplementation((id: string) => {
      if (id === "author1") return Promise.resolve(authorUser);
      if (id === "learner1") return Promise.resolve(learnerUser);
    });
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
    const groupAsgn = { ...dbAssignment, userId: null, groupId: "grp1" };
    storageMock.createTestAssignment.mockResolvedValue(groupAsgn);

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ groupId: "grp1" }));
    expect(res.status).toBe(201);
    expect(res.body.groupId).toBe("grp1");
  });

  it("passes dueDate to storage", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
    storageMock.getUser.mockImplementation((id: string) => {
      if (id === "author1") return Promise.resolve(authorUser);
      if (id === "learner1") return Promise.resolve(learnerUser);
    });
    storageMock.createTestAssignment.mockResolvedValue(dbAssignment);

    await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments")
      .send({ userId: "learner1", dueDate: "2026-12-31" }));

    const callArg = storageMock.createTestAssignment.mock.calls[0][0];
    expect(callArg.dueDate).toBeInstanceOf(Date);
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
      .send({ userIds: ["u1", "u2"] }));
    expect(res.status).toBe(201);
    expect(res.body).toHaveLength(2);
    expect(storageMock.createTestAssignment).toHaveBeenCalledTimes(2);
  });

  it("creates assignments for multiple groups", async () => {
    storageMock.getTest.mockResolvedValue(dbTest);
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
    storageMock.createTestAssignment.mockImplementation((data: any) =>
      Promise.resolve({ id: "asgn", ...data })
    );

    const res = await asAuthor(request(makeApp())
      .post("/api/tests/test1/assignments/bulk")
      .send({ userIds: ["u1"], groupIds: ["g1"] }));
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

  it("returns success when deleted", async () => {
    storageMock.deleteTestAssignment.mockResolvedValue(true);
    const res = await asAuthor(request(makeApp()).delete("/api/assignments/asgn1"));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
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
