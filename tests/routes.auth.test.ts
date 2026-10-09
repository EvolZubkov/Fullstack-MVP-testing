/**
 * Tests for /api/auth routes
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
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
import { magicScopeGuard } from "../server/middleware/magic-scope";

// ─── App factory ──────────────────────────────────────────────────────────────
function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));

  // Inject userId into session for authenticated routes
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    // A magic-link session is seeded once and then lives in the session store, so
    // a later request without the header still sees it — that is what lets the
    // login test assert that the mark was actually REMOVED.
    if (req.headers["x-test-magic"] && !req.session.magic) {
      req.session.magic = JSON.parse(req.headers["x-test-magic"]);
    }
    next();
  });

  app.get("/probe-session", (req: any, res: any) => res.json({ magic: req.session.magic ?? null }));
  // The scope guard sits in front of the routers in production (server/routes.ts),
  // so it must sit in front of them here too: without it these tests exercise the
  // handlers through a door the real request never gets to open, and a rule table
  // that locks a magic-link session out of `/api/auth/login` still looks green.
  app.use(magicScopeGuard);
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
// LOGIN
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/login", () => {
  let app: express.Express;
  beforeEach(() => { vi.clearAllMocks(); app = makeApp(); });

  it("returns 400 when email or password missing", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "x@x.com" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it("returns 401 on invalid credentials", async () => {
    storageMock.validatePassword.mockResolvedValue(null);
    const res = await request(app).post("/api/auth/login").send({ email: "x@x.com", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("returns 403 when account is inactive", async () => {
    storageMock.validatePassword.mockResolvedValue({ ...baseUser, status: "inactive" });
    const res = await request(app).post("/api/auth/login").send({ email: "x@x.com", password: "pw" });
    expect(res.status).toBe(403);
  });

  it("returns user data on successful login", async () => {
    storageMock.validatePassword.mockResolvedValue(baseUser);
    storageMock.updateUserLastLogin.mockResolvedValue(undefined);
    const res = await request(app).post("/api/auth/login").send({ email: "kate@test.com", password: "correct" });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("kate@test.com");
    expect(res.body.user.roles).toEqual(["administrator"]);
    expect(storageMock.updateUserLastLogin).toHaveBeenCalledWith("u1");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// LOGOUT
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/logout", () => {
  it("returns success", async () => {
    const app = makeApp();
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /me
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/auth/me", () => {
  let app: express.Express;
  beforeEach(() => { vi.clearAllMocks(); app = makeApp(); });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
  });

  it("returns user when authenticated", async () => {
    storageMock.getUser.mockResolvedValue(baseUser);
    const res = await request(app).get("/api/auth/me").set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe("u1");
  });

  it("returns 401 when user not found in DB", async () => {
    storageMock.getUser.mockResolvedValue(undefined);
    const res = await request(app).get("/api/auth/me").set("x-test-user", "ghost");
    expect(res.status).toBe(401);
  });

  it("returns 403 when user is inactive", async () => {
    storageMock.getUser.mockResolvedValue({ ...baseUser, status: "inactive" });
    const res = await request(app).get("/api/auth/me").set("x-test-user", "u1");
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ACCOUNT ENUMERATION — the removed check-email probe
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/check-email (removed)", () => {
  let app: express.Express;
  beforeEach(() => { vi.clearAllMocks(); app = makeApp(); });

  it("is gone: the router no longer answers whether an address exists", async () => {
    storageMock.getUserByEmail.mockResolvedValue(baseUser);
    const res = await request(app).post("/api/auth/check-email").send({ email: "kate@test.com" });
    expect(res.status).toBe(404);
    expect(res.body.exists).toBeUndefined();
    expect(storageMock.getUserByEmail).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FORGOT PASSWORD
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/forgot-password", () => {
  let app: express.Express;
  beforeEach(() => { vi.clearAllMocks(); app = makeApp(); });

  it("returns 400 when no email", async () => {
    const res = await request(app).post("/api/auth/forgot-password").send({});
    expect(res.status).toBe(400);
  });

  it("returns success even when user not found (security)", async () => {
    storageMock.getUserByEmail.mockResolvedValue(undefined);
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "ghost@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("returns 429 when too many recent tokens", async () => {
    storageMock.getUserByEmail.mockResolvedValue(baseUser);
    storageMock.getRecentTokensCount.mockResolvedValue(3);
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "kate@test.com" });
    expect(res.status).toBe(429);
  });

  it("creates token and sends email on success", async () => {
    storageMock.getUserByEmail.mockResolvedValue(baseUser);
    storageMock.getRecentTokensCount.mockResolvedValue(0);
    storageMock.createPasswordResetToken.mockResolvedValue({});
    emailMock.sendPasswordResetEmail.mockResolvedValue(true);
    const res = await request(app).post("/api/auth/forgot-password").send({ email: "kate@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.createPasswordResetToken).toHaveBeenCalled();
  });

  it("answers a known and an unknown address byte for byte the same", async () => {
    // Now that check-email is gone this is the only public door left, so the two
    // replies must be indistinguishable — a masked-address hint present for one
    // of them would restore the enumeration oracle on its own.
    storageMock.getUserByEmail.mockResolvedValue(baseUser);
    storageMock.getRecentTokensCount.mockResolvedValue(0);
    storageMock.createPasswordResetToken.mockResolvedValue({});
    emailMock.sendPasswordResetEmail.mockResolvedValue(true);
    const known = await request(app).post("/api/auth/forgot-password").send({ email: "kate@test.com" });

    storageMock.getUserByEmail.mockResolvedValue(undefined);
    const unknown = await request(app).post("/api/auth/forgot-password").send({ email: "nobody@test.com" });

    expect(known.status).toBe(unknown.status);
    expect(known.body).toEqual(unknown.body);
    expect(known.body.hint).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// VERIFY RESET TOKEN
// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/auth/verify-reset-token", () => {
  let app: express.Express;
  beforeEach(() => { vi.clearAllMocks(); app = makeApp(); });

  it("returns 400 when no token", async () => {
    const res = await request(app).get("/api/auth/verify-reset-token");
    expect(res.status).toBe(400);
  });

  it("returns 400 when token not found", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(undefined);
    const res = await request(app).get("/api/auth/verify-reset-token?token=bad");
    expect(res.status).toBe(400);
  });

  it("returns 400 when token already used", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue({ ...activeToken, usedAt: new Date() });
    const res = await request(app).get("/api/auth/verify-reset-token?token=used");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already been used/);
  });

  it("returns 400 when token expired", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue({
      ...activeToken,
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app).get("/api/auth/verify-reset-token?token=expired");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/expired/);
  });

  it("returns valid: true with emailHint for good token", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(activeToken);
    storageMock.getUser.mockResolvedValue(baseUser);
    const res = await request(app).get("/api/auth/verify-reset-token?token=good");
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.emailHint).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RESET PASSWORD
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/reset-password", () => {
  let app: express.Express;
  beforeEach(() => { vi.clearAllMocks(); app = makeApp(); });

  it("returns 400 when missing fields", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "x" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when password too short", async () => {
    const res = await request(app).post("/api/auth/reset-password").send({ token: "x", newPassword: "abc" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/6 characters/);
  });

  it("returns 400 when token invalid", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(undefined);
    const res = await request(app).post("/api/auth/reset-password").send({ token: "bad", newPassword: "newpass123" });
    expect(res.status).toBe(400);
  });

  it("resets password and marks token used on success", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(activeToken);
    storageMock.updateUserPassword.mockResolvedValue(undefined);
    storageMock.markTokenAsUsed.mockResolvedValue(undefined);
    storageMock.getUser.mockResolvedValue(baseUser);
    const res = await request(app).post("/api/auth/reset-password").send({ token: "good", newPassword: "newpass123" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.updateUserPassword).toHaveBeenCalledWith("u1", "newpass123");
    expect(storageMock.markTokenAsUsed).toHaveBeenCalledWith("tok1");
  });

  it("activates pending user after reset", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(activeToken);
    storageMock.updateUserPassword.mockResolvedValue(undefined);
    storageMock.markTokenAsUsed.mockResolvedValue(undefined);
    storageMock.getUser.mockResolvedValue({ ...baseUser, status: "pending" });
    storageMock.updateUser.mockResolvedValue(undefined);
    const res = await request(app).post("/api/auth/reset-password").send({ token: "good", newPassword: "newpass123" });
    expect(res.status).toBe(200);
    expect(storageMock.updateUser).toHaveBeenCalledWith("u1", { status: "active" });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CHANGE PASSWORD
// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/change-password", () => {
  let app: express.Express;
  beforeEach(() => { vi.clearAllMocks(); app = makeApp(); });

  it("returns 401 when not authenticated", async () => {
    const res = await request(app).post("/api/auth/change-password")
      .send({ currentPassword: "old", newPassword: "new123" });
    expect(res.status).toBe(401);
  });

  it("returns 400 when missing fields", async () => {
    const res = await request(app).post("/api/auth/change-password")
      .set("x-test-user", "u1")
      .send({ currentPassword: "old" });
    expect(res.status).toBe(400);
  });

  it("returns 401 when current password wrong", async () => {
    storageMock.getUser.mockResolvedValue(baseUser);
    storageMock.validatePassword.mockResolvedValue(null);
    const res = await request(app).post("/api/auth/change-password")
      .set("x-test-user", "u1")
      .send({ currentPassword: "wrong", newPassword: "newpass123" });
    expect(res.status).toBe(401);
  });

  it("changes password successfully", async () => {
    storageMock.getUser.mockResolvedValue(baseUser);
    storageMock.validatePassword.mockResolvedValue(baseUser);
    storageMock.updateUserPassword.mockResolvedValue(undefined);
    const res = await request(app).post("/api/auth/change-password")
      .set("x-test-user", "u1")
      .send({ currentPassword: "correct", newPassword: "newpass123" });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(storageMock.updateUserPassword).toHaveBeenCalledWith("u1", "newpass123");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// magic-link scope
// ─────────────────────────────────────────────────────────────────────────────
describe("magic-link scope on the session", () => {
  const magicHeader = JSON.stringify({ assignmentId: "a1", testId: "t1" });

  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.getUser.mockResolvedValue(baseUser);
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
  });

  it("a password login clears the magic scope of the session", async () => {
    storageMock.validatePassword.mockResolvedValue(baseUser);
    storageMock.updateUserLastLogin.mockResolvedValue(undefined);
    const agent = request.agent(makeApp());

    const seeded = await agent.get("/probe-session").set("x-test-magic", magicHeader);
    expect(seeded.body.magic).toEqual({ assignmentId: "a1", testId: "t1" });

    const login = await agent.post("/api/auth/login").send({ email: "kate@test.com", password: "secret" });
    expect(login.status).toBe(200);

    const after = await agent.get("/probe-session");
    expect(after.body.magic).toBeNull();
  });

  it("GET /me reports the magic scope of a restricted session", async () => {
    const res = await request(makeApp())
      .get("/api/auth/me")
      .set("x-test-user", "u1")
      .set("x-test-magic", magicHeader);
    expect(res.status).toBe(200);
    expect(res.body.user.magicScope).toEqual({ testId: "t1" });
  });

  it("GET /me reports a null magic scope for a normal session", async () => {
    const res = await request(makeApp()).get("/api/auth/me").set("x-test-user", "u1");
    expect(res.status).toBe(200);
    expect(res.body.user.magicScope).toBeNull();
  });

  // Regression for the trap a magic link used to close on a browser: the scope
  // guard refused `/api/auth/login`, so the ONE action that clears the mark could
  // not be performed. Everything outside the test answered 403, the client sent
  // the person to the login form, and the form answered 403 as well — a loop with
  // no exit but deleting the cookie. The way OUT of a link must stay reachable
  // from inside it.
  it("lets a restricted session log in with a password (no lock-out loop)", async () => {
    storageMock.validatePassword.mockResolvedValue(baseUser);
    storageMock.updateUserLastLogin.mockResolvedValue(undefined);
    const agent = request.agent(makeApp());
    await agent.get("/probe-session").set("x-test-magic", magicHeader);

    const login = await agent.post("/api/auth/login").send({ email: "kate@test.com", password: "secret" });
    expect(login.status).toBe(200);
    expect(login.body.error).toBeUndefined();
  });

  it("lets a restricted session ask for a password-recovery letter", async () => {
    storageMock.getUserByEmail.mockResolvedValue(baseUser);
    storageMock.getRecentTokensCount.mockResolvedValue(0);
    storageMock.createPasswordResetToken.mockResolvedValue({ id: "tok1" });
    emailMock.sendPasswordResetEmail.mockResolvedValue(true);
    const agent = request.agent(makeApp());
    await agent.get("/probe-session").set("x-test-magic", magicHeader);

    const res = await agent.post("/api/auth/forgot-password").send({ email: "kate@test.com" });
    expect(res.status).toBe(200);
    expect(res.body.code).not.toBe("MAGIC_SCOPE");
  });

  it("lets a restricted session verify and redeem a recovery token", async () => {
    storageMock.getPasswordResetToken.mockResolvedValue(activeToken);
    storageMock.updateUserPassword.mockResolvedValue(undefined);
    storageMock.markTokenAsUsed.mockResolvedValue(undefined);
    const agent = request.agent(makeApp());
    await agent.get("/probe-session").set("x-test-magic", magicHeader);

    const verify = await agent.get("/api/auth/verify-reset-token?token=abc");
    expect(verify.status).toBe(200);

    const reset = await agent.post("/api/auth/reset-password").send({ token: "abc", newPassword: "newpass123" });
    expect(reset.status).toBe(200);
    expect(reset.body.success).toBe(true);
  });

  // The opposite side of the same rule: `change-password` is an action INSIDE the
  // application, not a way out of the link, and it stays denied (tests/magic-scope-rules).
  it("still denies changing the password from inside a link", async () => {
    const agent = request.agent(makeApp());
    await agent.get("/probe-session").set("x-test-magic", magicHeader);

    const res = await agent.post("/api/auth/change-password")
      .set("x-test-user", "u1")
      .send({ currentPassword: "correct", newPassword: "newpass123" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("MAGIC_SCOPE");
  });
});
