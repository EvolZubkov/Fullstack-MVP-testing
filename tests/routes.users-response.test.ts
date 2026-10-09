/**
 * @module tests/routes.users-response
 * @description What the users API gives away and what bulk import keeps
 * (org-structure plan, task 0).
 *
 * Two defects found while mapping the users screens:
 *  - every answer of `/api/users` carried the whole `users` row, password hash
 *    and email hash included, to any holder of `users.read`;
 *  - bulk import showed the external key of a NEW row in the preview and then
 *    created the account without it.
 *
 * Harness mirrors routes.users.coverage.test.ts: hoisted storage mock, mocked
 * email and superadmin seams, supertest with an x-test-user session shim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock, sendEmailMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUsers: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByExternalKey: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    getUserGroups: vi.fn(),
    setUserGroups: vi.fn(),
    getUserRoles: vi.fn(),
    setUserRoles: vi.fn(),
    getGroups: vi.fn(),
    createGroup: vi.fn(),
    addUserToGroup: vi.fn(),
    createPasswordResetToken: vi.fn(),
  },
  sendEmailMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({
  sendInviteEmail: sendEmailMock,
  sendPasswordResetEmail: sendEmailMock,
}));
vi.mock("../server/superadmin", () => ({
  isSuperadminEmailHash: () => false,
  superadminEmails: () => [],
}));

import usersRouter from "../server/routes/users";

const secretFields = { passwordHash: "scrypt:secret", emailHash: "hash:secret" };
const base = {
  status: "active", mustChangePassword: false, gdprConsent: true,
  createdAt: new Date(), lastLoginAt: null, createdBy: null, isExternal: false,
  externalKey: null, ...secretFields,
};
const admin = { ...base, id: "admin1", email: "admin@test.com", name: "Admin" };
const target = { ...base, id: "target1", email: "target@test.com", name: "Target" };

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

const asAdmin = (req: request.Test) => req.set("x-test-user", "admin1");

/** No answer of the users API may carry the stored secrets of an account. */
function expectNoSecrets(body: Record<string, unknown>) {
  expect(body).not.toHaveProperty("passwordHash");
  expect(body).not.toHaveProperty("emailHash");
}

beforeEach(() => {
  vi.resetAllMocks();
  storageMock.getUser.mockImplementation((id: string) =>
    Promise.resolve(id === "admin1" ? admin : id === "target1" ? target : undefined));
  storageMock.getUserRoles.mockImplementation((id: string) =>
    Promise.resolve(id === "admin1" ? ["administrator"] : ["learner"]));
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getGroups.mockResolvedValue([]);
  storageMock.createPasswordResetToken.mockResolvedValue({});
  sendEmailMock.mockResolvedValue(true);
});

describe("users API answers carry no stored secrets", () => {
  it("GET /api/users", async () => {
    storageMock.getUsers.mockResolvedValue([admin, target]);
    const res = await asAdmin(request(makeApp()).get("/api/users"));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    for (const row of res.body) expectNoSecrets(row);
    // The strip must not take the fields the list actually renders with it.
    expect(res.body[1]).toMatchObject({ id: "target1", email: "target@test.com", roles: ["learner"] });
  });

  it("GET /api/users/:id", async () => {
    const res = await asAdmin(request(makeApp()).get("/api/users/target1"));
    expect(res.status).toBe(200);
    expectNoSecrets(res.body);
    expect(res.body).toMatchObject({ id: "target1", name: "Target" });
  });

  it("POST /api/users", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    storageMock.createUser.mockResolvedValue({ ...target, id: "new1", email: "new@test.com" });
    const res = await asAdmin(request(makeApp()).post("/api/users"))
      .send({ email: "new@test.com", password: "longenough1", roles: ["learner"] });
    expect(res.status).toBe(201);
    expectNoSecrets(res.body);
    expect(res.body).toMatchObject({ id: "new1", roles: ["learner"] });
  });

  it("PUT /api/users/:id", async () => {
    storageMock.updateUser.mockResolvedValue({ ...target, name: "Renamed" });
    const res = await asAdmin(request(makeApp()).put("/api/users/target1")).send({ name: "Renamed" });
    expect(res.status).toBe(200);
    expectNoSecrets(res.body);
    expect(res.body).toMatchObject({ id: "target1", name: "Renamed" });
  });
});

describe("POST /api/users/bulk-import — external key of a new row", () => {
  it("creates the account with the key the preview showed", async () => {
    storageMock.createUser.mockResolvedValue({ ...target, id: "new1", email: "new@test.com" });
    const res = await asAdmin(request(makeApp()).post("/api/users/bulk-import")).send({
      sendInvites: false,
      rows: [{ email: "new@test.com", name: "New", role: "learner", status: "new", externalKey: "  TAB-77  " }],
    });
    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({ externalKey: "TAB-77" }));
  });

  it("creates the account without a key when the cell is empty", async () => {
    storageMock.createUser.mockResolvedValue({ ...target, id: "new1", email: "new@test.com" });
    await asAdmin(request(makeApp()).post("/api/users/bulk-import")).send({
      sendInvites: false,
      rows: [{ email: "new@test.com", status: "new", externalKey: "" }],
    });
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({ externalKey: null }));
  });
});
