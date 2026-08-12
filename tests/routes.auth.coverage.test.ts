/**
 * @module tests/routes.auth.coverage
 * @description Branch-coverage tests for the /api/auth router that complement
 * {@link module:tests/routes.auth}. They target the branches the happy-path
 * suite leaves out: the login rate limiter and catch block, the `me` /
 * check-email / forgot-password / verify-reset-token / reset-password / change-
 * password error and edge branches, the forgot-password dev-link branch, the
 * authenticated logout branch, and the whole complete-first-login route.
 *
 * The harness mirrors routes.auth.test.ts: storage and the email module are
 * mocked; the real crypto/logger/audit are used (token hashing is deterministic).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, emailMock } = vi.hoisted(() => {
  const storageMock = {
    validatePassword: vi.fn(),
    updateUserLastLogin: vi.fn(),
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getUserByEmail: vi.fn(),
    updateUserPassword: vi.fn(),
    updateUser: vi.fn(),
    getRecentTokensCount: vi.fn(),
    createPasswordResetToken: vi.fn(),
    getPasswordResetToken: vi.fn(),
    markTokenAsUsed: vi.fn(),
  };
  const emailMock = { sendPasswordResetEmail: vi.fn() };
  return { storageMock, emailMock };
});

vi.mock("../server/storage", () => ({ storage: storageMock }));
vi.mock("../server/email", () => emailMock);

import authRouter from "../server/routes/auth";

// ─── App factory ──────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/auth", authRouter);
  return app;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const baseUser = {
  id: "u1",
  email: "kate@test.com",
  name: "Kate",
  role: "author",
  status: "active",
  mustChangePassword: false,
  gdprConsent: true,
  passwordHash: "hashed",
  emailHash: "hash",
  createdAt: new Date(),
  lastLoginAt: null,
  createdBy: null,
};

const activeToken = {
  id: "tok1",
  userId: "u1",
  tokenHash: "abc",
  expiresAt: new Date(Date.now() + 30 * 60 * 1000),
  usedAt: null,
  requestIp: "127.0.0.1",
  createdAt: new Date(),
};

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN — rate limit + catch + both 400 operands
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/login (coverage)", () => {
  let app: express.Express;
  beforeEach(() => { vi.clearAllMocks(); app = makeApp(); });

  it("returns 400 when password missing (email present)", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "x@x.com" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when email missing (password present)", async () => {
    const res = await request(app).post("/api/auth/login").send({ password: "pw" });
    expect(res.status).toBe(400);
  });

  it("returns 500 when a downstream storage call throws", async () => {
    storageMock.validatePassword.mockResolvedValue(baseUser);
    storageMock.updateUserLastLogin.mockRejectedValue(new Error("db down"));
    const res = await request(app).post("/api/auth/login").send({ email: "kate@test.com", password: "correct" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Login failed");
  });

  // MUST be the last /login test in the file — it permanently trips the
  // in-memory rate limiter for this IP within the 15-min window.
  it("returns 429 after too many attempts from the same IP", async () => {
    storageMock.validatePassword.mockResolvedValue(null);
    let last = 0;
    for (let i = 0; i < 15; i++) {
      last = (await request(app).post("/api/auth/login").send({ email: "x@x.com", password: "wrong" })).status;
    }
    expect(last).toBe(429);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT — authenticated branch (userId present)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/logout (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("looks up the user when a session exists and still succeeds", async () => {
    storageMock.getUser.mockResolvedValue(baseUser);
    const res = await request(makeApp()).post("/api/auth/logout").set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.getUser).toHaveBeenCalledWith("u1");
  });

  it("swallows a getUser failure during logout", async () => {
    storageMock.getUser.mockRejectedValue(new Error("db"));
    const res = await request(makeApp()).post("/api/auth/logout").set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /me — catch branch
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/auth/me (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 500 when getUser throws", async () => {
    storageMock.getUser.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).get("/api/auth/me").set("x-test-user", "u1");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to get user");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHECK EMAIL — catch branch
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/check-email (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 500 when getUserByEmail throws", async () => {
    storageMock.getUserByEmail.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).post("/api/auth/check-email").send({ email: "kate@test.com" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to check email");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD — dev-link branch + catch
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/forgot-password (coverage)", () => {
  const prevEnv = process.env.NODE_ENV;
  beforeEach(() => { vi.clearAllMocks(); });
  afterEach(() => { process.env.NODE_ENV = prevEnv; });

  it("includes devLink when NODE_ENV=development and email was not sent", async () => {
    process.env.NODE_ENV = "development";
    storageMock.getUserByEmail.mockResolvedValue(baseUser);
    storageMock.getRecentTokensCount.mockResolvedValue(0);
    storageMock.createPasswordResetToken.mockResolvedValue({});
    emailMock.sendPasswordResetEmail.mockResolvedValue(false);
    const res = await request(makeApp()).post("/api/auth/forgot-password").send({ email: "kate@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.devLink).toContain("/reset-password?token=");
  });

  it("returns 500 when getUserByEmail throws", async () => {
    storageMock.getUserByEmail.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).post("/api/auth/forgot-password").send({ email: "kate@test.com" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to process request");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY RESET TOKEN — non-string token, null emailHint, catch
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/auth/verify-reset-token (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when token is not a string (array query)", async () => {
    const res = await request(makeApp()).get("/api/auth/verify-reset-token?token=a&token=b");
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Token required");
  });

  it("returns emailHint null when the token's user is gone", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(activeToken);
    storageMock.getUser.mockResolvedValue(undefined);
    const res = await request(makeApp()).get("/api/auth/verify-reset-token?token=good");
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.emailHint).toBeNull();
  });

  it("returns 500 when the token lookup throws", async () => {
    storageMock.getPasswordResetToken.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).get("/api/auth/verify-reset-token?token=good");
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to verify token");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD — used token, expired token, missing user, catch
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/reset-password (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when the token was already used", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue({ ...activeToken, usedAt: new Date() });
    const res = await request(makeApp()).post("/api/auth/reset-password").send({ token: "used", newPassword: "newpass123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been used/);
  });

  it("returns 400 when the token has expired", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue({ ...activeToken, expiresAt: new Date(Date.now() - 1000) });
    const res = await request(makeApp()).post("/api/auth/reset-password").send({ token: "old", newPassword: "newpass123" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/);
  });

  it("succeeds without activating when the user is missing after reset", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(activeToken);
    storageMock.updateUserPassword.mockResolvedValue(undefined);
    storageMock.markTokenAsUsed.mockResolvedValue(undefined);
    storageMock.getUser.mockResolvedValue(undefined); // user gone -> `user &&` false
    const res = await request(makeApp()).post("/api/auth/reset-password").send({ token: "good", newPassword: "newpass123" });
    expect(res.status).toBe(200);
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });

  it("returns 500 when updating the password throws", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(activeToken);
    storageMock.updateUserPassword.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).post("/api/auth/reset-password").send({ token: "good", newPassword: "newpass123" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to reset password");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE PASSWORD — short password, missing user, catch
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/change-password (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 400 when the new password is too short", async () => {
    const res = await request(makeApp()).post("/api/auth/change-password")
      .set("x-test-user", "u1")
      .send({ currentPassword: "old", newPassword: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters/);
  });

  it("returns 404 when the session user is not found", async () => {
    storageMock.getUser.mockResolvedValue(undefined);
    const res = await request(makeApp()).post("/api/auth/change-password")
      .set("x-test-user", "ghost")
      .send({ currentPassword: "old", newPassword: "newpass123" });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("returns 500 when getUser throws", async () => {
    storageMock.getUser.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).post("/api/auth/change-password")
      .set("x-test-user", "u1")
      .send({ currentPassword: "old", newPassword: "newpass123" });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to change password");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// COMPLETE FIRST LOGIN — whole route (uncovered by the base suite)
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/complete-first-login (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).post("/api/auth/complete-first-login").send({ gdprConsent: true });
    expect(res.status).toBe(401);
  });

  it("returns 404 when the user is not found", async () => {
    storageMock.getUser.mockResolvedValue(undefined);
    const res = await request(makeApp()).post("/api/auth/complete-first-login")
      .set("x-test-user", "ghost").send({ gdprConsent: true });
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("User not found");
  });

  it("returns 400 when first login is already completed", async () => {
    storageMock.getUser.mockResolvedValue({ ...baseUser, mustChangePassword: false, gdprConsent: true });
    const res = await request(makeApp()).post("/api/auth/complete-first-login")
      .set("x-test-user", "u1").send({ gdprConsent: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("First login already completed");
  });

  it("returns 400 when the new password is too short", async () => {
    storageMock.getUser.mockResolvedValue({ ...baseUser, mustChangePassword: true, gdprConsent: false });
    const res = await request(makeApp()).post("/api/auth/complete-first-login")
      .set("x-test-user", "u1").send({ newPassword: "abc", gdprConsent: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters/);
  });

  it("completes with password + gdpr consent and activates a pending user", async () => {
    const pending = { ...baseUser, mustChangePassword: true, gdprConsent: false, status: "pending" };
    const activated = { ...pending, mustChangePassword: false, gdprConsent: true, status: "active" };
    storageMock.getUser.mockResolvedValueOnce(pending).mockResolvedValueOnce(activated);
    storageMock.updateUserPassword.mockResolvedValue(undefined);
    storageMock.updateUser.mockResolvedValue(undefined);
    const res = await request(makeApp()).post("/api/auth/complete-first-login")
      .set("x-test-user", "u1").send({ newPassword: "goodpass1", gdprConsent: true });
    expect(res.status).toBe(200);
    expect(res.body.user.status).toBe("active");
    expect(storageMock.updateUserPassword).toHaveBeenCalledWith("u1", "goodpass1");
    expect(storageMock.updateUser).toHaveBeenCalledWith("u1", expect.objectContaining({
      mustChangePassword: false, gdprConsent: true, gdprConsentAt: expect.any(Date), status: "active",
    }));
  });

  it("completes without a password and without gdpr consent (active user)", async () => {
    const user = { ...baseUser, mustChangePassword: true, gdprConsent: false, status: "active" };
    storageMock.getUser.mockResolvedValueOnce(user).mockResolvedValueOnce({ ...user, mustChangePassword: false });
    storageMock.updateUser.mockResolvedValue(undefined);
    const res = await request(makeApp()).post("/api/auth/complete-first-login")
      .set("x-test-user", "u1").send({});
    expect(res.status).toBe(200);
    expect(storageMock.updateUserPassword).not.toHaveBeenCalled();
    const patch = storageMock.updateUser.mock.calls[0][1];
    expect(patch).toEqual({ mustChangePassword: false }); // no gdpr fields, no status change
  });

  it("returns 500 when getUser throws", async () => {
    storageMock.getUser.mockRejectedValue(new Error("boom"));
    const res = await request(makeApp()).post("/api/auth/complete-first-login")
      .set("x-test-user", "u1").send({ gdprConsent: true });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe("Failed to complete first login");
  });
});
