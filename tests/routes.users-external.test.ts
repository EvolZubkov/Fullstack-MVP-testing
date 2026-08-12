/**
 * @module tests/routes.users-external
 * @description PRD-28 (FR-01/FR-05/FR-06): creating an external participant one
 * at a time, and the ONE-WAY conversion into an ordinary account.
 *
 * Three properties are pinned here. Creation must store no password at all and
 * must fix the role set to `learner`, so the flag cannot be used to smuggle in a
 * passwordless account with wider rights. `POST /:id/promote` must clear the flag
 * and hand the account the very letter the ordinary invite path sends — an
 * account that just became ordinary has no password yet. And the reverse move is
 * unreachable by construction: `PUT /:id` never reads `isExternal`, so no request
 * body can turn an employee into an external participant (that would be a block
 * dressed up as a kind change; blocking has its own endpoint).
 *
 * Harness mirrors tests/routes.users-invite.test.ts: hoisted storage mock, mocked
 * e-mail seam, supertest over an express app with a session shim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendInviteMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    promoteExternalUser: vi.fn(),
    getUserGroups: vi.fn(),
    setUserGroups: vi.fn(),
    getUserRoles: vi.fn(),
    setUserRoles: vi.fn(),
    createPasswordResetToken: vi.fn(),
    getRecentTokensCount: vi.fn(),
  },
  sendInviteMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({
  sendInviteEmail: sendInviteMock,
  sendPasswordResetEmail: vi.fn(),
}));

import usersRouter from "../server/routes/users";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const base = {
  name: "Кто-то", status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", isExternal: false,
  createdAt: new Date(), lastLoginAt: null, expiresAt: null, gdprConsentAt: null, createdBy: null,
};
/** The acting operator: `users.create`/`users.manage` come from the mocked role set. */
const adminUser = { ...base, id: "admin1", email: "admin@test.com" };

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = req.headers["x-test-user"] ?? "admin1";
    next();
  });
  app.use("/api/users", usersRouter);
  return app;
}

let app: express.Express;

beforeEach(() => {
  vi.clearAllMocks();
  app = makeApp();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue(adminUser);
  storageMock.getUserGroups.mockResolvedValue([]);
  storageMock.getUserByEmail.mockResolvedValue(null);
  storageMock.updateUser.mockResolvedValue(adminUser);
  storageMock.promoteExternalUser.mockResolvedValue(adminUser);
  storageMock.createPasswordResetToken.mockResolvedValue({});
  storageMock.getRecentTokensCount.mockResolvedValue(0);
  sendInviteMock.mockResolvedValue(true);
});

describe("заведение внешнего участника и перевод в штатные", () => {
  it("создаёт внешнего без пароля и только с ролью learner", async () => {
    storageMock.getUserByEmail.mockResolvedValue(null);
    storageMock.createUser.mockResolvedValue({ id: "u9", email: "e@x.ru", isExternal: true });

    const res = await request(app).post("/api/users").send({ email: "e@x.ru", name: "Внешний", isExternal: true });

    expect(res.status).toBe(201);
    expect(storageMock.createUser).toHaveBeenCalledWith(expect.objectContaining({ passwordHash: null, isExternal: true }));
    expect(storageMock.setUserRoles).toHaveBeenCalledWith("u9", ["learner"], expect.anything());
  });

  it("перевод в штатные снимает признак и шлёт приглашение", async () => {
    storageMock.getUser.mockResolvedValue({ id: "u9", email: "e@x.ru", isExternal: true, status: "pending" });

    const res = await request(app).post("/api/users/u9/promote").send({});

    expect(res.status).toBe(200);
    expect(storageMock.promoteExternalUser).toHaveBeenCalledWith("u9");
    expect(storageMock.createPasswordResetToken).toHaveBeenCalled();
  });

  it("обратный перевод недоступен: признак нельзя выставить существующей штатной учётке", async () => {
    storageMock.getUser.mockResolvedValue({ id: "u1", isExternal: false });

    const res = await request(app).put("/api/users/u1").send({ isExternal: true });

    expect(res.status).toBe(200);
    expect(storageMock.updateUser).toHaveBeenCalledWith("u1", expect.not.objectContaining({ isExternal: true }));
  });

  it("перевод штатной учётки отклоняется и ничего не меняет", async () => {
    storageMock.getUser.mockResolvedValue({ ...base, id: "u1", email: "staff@x.ru" });

    const res = await request(app).post("/api/users/u1/promote").send({});

    expect(res.status).toBe(400);
    expect(storageMock.promoteExternalUser).not.toHaveBeenCalled();
    expect(storageMock.createPasswordResetToken).not.toHaveBeenCalled();
    expect(sendInviteMock).not.toHaveBeenCalled();
  });
});
