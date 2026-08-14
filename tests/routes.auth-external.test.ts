/**
 * @module tests/routes.auth-external
 * @description PRD-28 (FR-03/FR-04): both password-recovery doors are closed for
 * an external participant. Such an account has no password at all — the only way
 * in is the assignment link — so `POST /api/auth/forgot-password` must not mint a
 * reset token for it, and `POST /api/users/:id/invite` must refuse to send a
 * letter whose whole payload is a password-setup link.
 *
 * Each refusal is paired with its antipode on an ORDINARY account, so a failure
 * tells apart "the external branch closed the door" from "the door is closed for
 * everyone" (a regression that would break recovery outright).
 *
 * Harness mirrors tests/routes.users-invite.test.ts: hoisted storage mock, mocked
 * e-mail seam, supertest over an express app with a session shim.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendInviteMock, sendResetMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserByEmail: vi.fn(),
    getUserRoles: vi.fn(),
    getRecentTokensCount: vi.fn(),
    createPasswordResetToken: vi.fn(),
    getUserGroups: vi.fn(),
  },
  sendInviteMock: vi.fn(),
  sendResetMock: vi.fn(),
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => ({
  sendInviteEmail: sendInviteMock,
  sendPasswordResetEmail: sendResetMock,
}));

import authRouter from "../server/routes/auth";
import usersRouter from "../server/routes/users";

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const base = {
  name: "Кто-то", status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", isExternal: false,
  createdAt: new Date(), lastLoginAt: null, expiresAt: null, gdprConsentAt: null, createdBy: null,
};
/** The acting operator: `users.manage` comes from the mocked role set. */
const adminUser = { ...base, id: "admin1", email: "admin@test.com" };
/** The account under test: external, hence passwordless, and still `pending`. */
const externalUser = {
  ...base, id: "u1", email: "ext@example.com", isExternal: true, passwordHash: null, status: "pending",
};
/** Its antipode: an ordinary account on the same paths. */
const staffUser = { ...base, id: "u2", email: "staff@example.com" };

/**
 * Dispatch `getUser` by id. The users API reads the operator from the session
 * as well as the account named in the path; a blanket `mockResolvedValue` makes
 * the two the same row, and then a refusal aimed at the target could just as
 * well have come from the operator.
 */
function getUserById(...accounts: { id: string }[]) {
  return (id: string) => Promise.resolve(accounts.find((a) => a.id === id) ?? adminUser);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  // Every request acts as the operator unless a test says otherwise; the users
  // API is capability-gated and these cases are about the handler, not the gate.
  app.use((req: any, _res: any, next: any) => {
    req.session.userId = req.headers["x-test-user"] ?? "admin1";
    next();
  });
  app.use("/api/auth", authRouter);
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
  storageMock.getRecentTokensCount.mockResolvedValue(0);
  storageMock.createPasswordResetToken.mockResolvedValue({});
  sendInviteMock.mockResolvedValue(true);
  sendResetMock.mockResolvedValue(true);
});

describe("внешний участник и пути восстановления", () => {
  it("forgot-password не выпускает токен и отвечает нейтрально", async () => {
    storageMock.getUserByEmail.mockResolvedValue(externalUser);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "ext@example.com" });

    expect(res.status).toBe(200);
    expect(res.body.message).toBe("If this email exists, a reset link has been sent");
    // The masked-address hint would confirm the account exists; the refusal must
    // be indistinguishable from the unknown-address answer.
    expect(res.body.hint).toBeUndefined();
    expect(storageMock.createPasswordResetToken).not.toHaveBeenCalled();
    expect(sendResetMock).not.toHaveBeenCalled();
  });

  it("forgot-password штатной учётки по-прежнему выпускает токен", async () => {
    storageMock.getUserByEmail.mockResolvedValue(staffUser);

    const res = await request(app).post("/api/auth/forgot-password").send({ email: "staff@example.com" });

    expect(res.status).toBe(200);
    expect(storageMock.createPasswordResetToken).toHaveBeenCalled();
    expect(sendResetMock).toHaveBeenCalled();
  });

  it("приглашение задать пароль внешней учётке отклоняется", async () => {
    storageMock.getUser.mockImplementation(getUserById(externalUser));

    const res = await request(app).post("/api/users/u1/invite").send({});

    expect(res.status).toBe(400);
    expect(storageMock.createPasswordResetToken).not.toHaveBeenCalled();
    expect(sendInviteMock).not.toHaveBeenCalled();
  });

  it("приглашение штатной учётке в статусе pending уходит как раньше", async () => {
    storageMock.getUser.mockImplementation(getUserById({ ...staffUser, status: "pending" }));

    const res = await request(app).post("/api/users/u2/invite").send({});

    expect(res.status).toBe(200);
    expect(storageMock.createPasswordResetToken).toHaveBeenCalled();
    expect(sendInviteMock).toHaveBeenCalled();
  });
});
