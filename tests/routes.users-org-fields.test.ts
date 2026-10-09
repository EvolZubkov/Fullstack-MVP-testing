/**
 * @module tests/routes.users-org-fields
 * @description Org-structure fields and linking keys through the users API
 * (org-structure plan, task 1; PRD-54 BR-54-28, BR-54-30, BR-54-31).
 *
 * The fields are optional and edited both ways, so the contract has three
 * states per field: absent from the body (leave as is), empty (clear), a value
 * (normalised and stored). The LMS learner id links telemetry to a person and
 * must be unique, like the external key: a second owner would make the link a
 * lottery, so the API refuses it with the name of the current owner.
 *
 * Harness mirrors routes.users.coverage.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserByExternalKey: vi.fn(),
    getUserByLmsLearnerId: vi.fn(),
    getOrgValues: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    getUserGroups: vi.fn(),
    setUserGroups: vi.fn(),
    getUserRoles: vi.fn(),
    setUserRoles: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({ sendInviteEmail: vi.fn(), sendPasswordResetEmail: vi.fn() }));
vi.mock("../server/superadmin", () => ({ isSuperadminEmailHash: () => false, superadminEmails: () => [] }));

import usersRouter from "../server/routes/users";

const base = {
  status: "active", mustChangePassword: false, gdprConsent: true, isExternal: false,
  createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const admin = { ...base, id: "admin1", email: "admin@test.com", name: "Admin" };
const target = { ...base, id: "target1", email: "target@test.com", name: "Target" };
const other = { ...base, id: "other1", email: "other@test.com", name: "Петров Игорь" };

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

beforeEach(() => {
  vi.resetAllMocks();
  storageMock.getUser.mockImplementation((id: string) =>
    Promise.resolve(({ admin1: admin, target1: target, other1: other } as Record<string, unknown>)[id]));
  storageMock.getUserRoles.mockImplementation((id: string) =>
    Promise.resolve(id === "admin1" ? ["administrator"] : ["learner"]));
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getUserByEmail.mockResolvedValue(undefined);
  storageMock.getUserByExternalKey.mockResolvedValue(undefined);
  storageMock.getUserByLmsLearnerId.mockResolvedValue(undefined);
  storageMock.createUser.mockImplementation((u: object) => Promise.resolve({ ...target, ...u, id: "new1" }));
  storageMock.updateUser.mockImplementation((_id: string, patch: object) => Promise.resolve({ ...target, ...patch }));
});

describe("POST /api/users — org fields and linking keys", () => {
  const create = (body: object) =>
    asAdmin(request(makeApp()).post("/api/users"))
      .send({ email: "new@test.com", password: "longenough1", roles: ["learner"], ...body });

  it("stores the four fields and the external key, normalised", async () => {
    const res = await create({
      organization: "  АО  «Ромашка» ", unit: "Отдел продаж", position: "Менеджер",
      lmsLearnerId: " petrov_i ", externalKey: " TAB-1 ",
    });
    expect(res.status).toBe(201);
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({
      organization: "АО «Ромашка»", unit: "Отдел продаж", position: "Менеджер",
      lmsLearnerId: "petrov_i", externalKey: "TAB-1",
    }));
  });

  it("stores empty fields as null", async () => {
    await create({ unit: "  ", lmsLearnerId: "" });
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({ unit: null, lmsLearnerId: null }));
  });

  it("accepts the org fields for an external participant too", async () => {
    const res = await asAdmin(request(makeApp()).post("/api/users"))
      .send({ email: "ext@test.com", isExternal: true, organization: "ООО «Партнёр»" });
    expect(res.status).toBe(201);
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({ organization: "ООО «Партнёр»" }));
  });

  it("refuses an LMS learner id that another person holds, naming them", async () => {
    storageMock.getUserByLmsLearnerId.mockResolvedValue(other);
    const res = await create({ lmsLearnerId: "petrov_i" });
    expect(res.status).toBe(409);
    expect(res.body.field).toBe("lmsLearnerId");
    expect(res.body.error).toContain("Петров Игорь");
    expect(storageMock.createUser).not.toHaveBeenCalled();
  });

  it("refuses an external key that another person holds", async () => {
    storageMock.getUserByExternalKey.mockResolvedValue(other);
    const res = await create({ externalKey: "TAB-1" });
    expect(res.status).toBe(409);
    expect(res.body.field).toBe("externalKey");
  });
});

describe("PUT /api/users/:id — org fields and linking keys", () => {
  const update = (body: object) => asAdmin(request(makeApp()).put("/api/users/target1")).send(body);

  it("writes only the fields present in the body", async () => {
    const res = await update({ name: "Target", unit: " Логистика ", position: "" });
    expect(res.status).toBe(200);
    const patch = storageMock.updateUser.mock.calls[0][1];
    expect(patch).toMatchObject({ unit: "Логистика", position: null });
    expect(patch).not.toHaveProperty("organization");
    expect(patch).not.toHaveProperty("lmsLearnerId");
  });

  it("lets a person keep their own LMS learner id", async () => {
    storageMock.getUserByLmsLearnerId.mockResolvedValue(target);
    const res = await update({ lmsLearnerId: "target_t" });
    expect(res.status).toBe(200);
    expect(storageMock.updateUser.mock.calls[0][1]).toMatchObject({ lmsLearnerId: "target_t" });
  });

  it("refuses an LMS learner id held by someone else", async () => {
    storageMock.getUserByLmsLearnerId.mockResolvedValue(other);
    const res = await update({ lmsLearnerId: "petrov_i" });
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ field: "lmsLearnerId" });
    expect(res.body.error).toContain("Петров Игорь");
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });
});

describe("GET /api/users/org-values", () => {
  it("returns the dictionary of values per field", async () => {
    const values = {
      organization: [], unit: [{ value: "Отдел продаж", users: 14, attempts: 212 }], position: [],
    };
    storageMock.getOrgValues.mockResolvedValue(values);
    const res = await asAdmin(request(makeApp()).get("/api/users/org-values"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual(values);
    // Must not be swallowed by GET /:id.
    expect(storageMock.getUser).not.toHaveBeenCalledWith("org-values");
  });
});
