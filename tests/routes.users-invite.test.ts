/**
 * Tests for POST /api/users/:id/invite — re-sending the invitation e-mail
 * (password-setup link) to an account that has never signed in.
 *
 * The endpoint exists because the invite letter used to be reachable ONLY from
 * the bulk-import flow, and only for rows that created a NEW account: an
 * account left in `pending` (created one at a time, or imported with the
 * checkbox off, or whose letter was lost) had no supported way to receive it
 * again.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import express from "express";
import session from "express-session";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
const { storageMock, sendInviteMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUsers: vi.fn(),
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    getUserGroups: vi.fn(),
    setUserGroups: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
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
const adminUser = {
  id: "admin1", email: "admin@test.com", name: "Админ", role: "administrator",
  status: "active", mustChangePassword: false, gdprConsent: true,
  passwordHash: "x", emailHash: "x", createdAt: new Date(), lastLoginAt: null, createdBy: null,
};
const learnerUser = { ...adminUser, id: "learner1", role: "learner", email: "learner@test.com" };
const pendingUser = {
  ...adminUser, id: "pending1", email: "pending@test.com", name: "Новичок",
  status: "pending", mustChangePassword: true, gdprConsent: false,
};
const activeUser = { ...adminUser, id: "active1", email: "active@test.com", status: "active" };
const inactiveUser = { ...adminUser, id: "inactive1", email: "inactive@test.com", status: "inactive" };

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

function asAdmin(req: request.Test) { return req.set("x-test-user", "admin1"); }
function asLearner(req: request.Test) { return req.set("x-test-user", "learner1"); }

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockImplementation((id: string) => {
    const all = [adminUser, learnerUser, pendingUser, activeUser, inactiveUser];
    return Promise.resolve(all.find((u) => u.id === id));
  });
  storageMock.createPasswordResetToken.mockResolvedValue({});
  storageMock.getRecentTokensCount.mockResolvedValue(0);
  sendInviteMock.mockResolvedValue(true);
});

describe("POST /api/users/:id/invite", () => {
  it("returns 401 when not authenticated", async () => {
    const res = await request(makeApp()).post("/api/users/pending1/invite");
    expect(res.status).toBe(401);
    expect(sendInviteMock).not.toHaveBeenCalled();
  });

  it("returns 403 for a learner", async () => {
    storageMock.getUserRoles.mockResolvedValue(["learner"]);
    const res = await asLearner(request(makeApp()).post("/api/users/pending1/invite"));
    expect(res.status).toBe(403);
    expect(sendInviteMock).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown user", async () => {
    const res = await asAdmin(request(makeApp()).post("/api/users/nope/invite"));
    expect(res.status).toBe(404);
    // Asserted so this cannot pass by the route simply not existing.
    expect(storageMock.getUser).toHaveBeenCalledWith("nope");
    expect(sendInviteMock).not.toHaveBeenCalled();
  });

  it("sends the invite letter with a password-setup link", async () => {
    const res = await asAdmin(request(makeApp()).post("/api/users/pending1/invite"));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sent: true });
    expect(sendInviteMock).toHaveBeenCalledOnce();
    expect(sendInviteMock).toHaveBeenCalledWith(expect.objectContaining({
      to: "pending@test.com",
      userName: "Новичок",
      inviteLink: expect.stringContaining("/reset-password?token="),
    }));
  });

  it("mints a reset token valid for 7 days", async () => {
    await asAdmin(request(makeApp()).post("/api/users/pending1/invite"));

    expect(storageMock.createPasswordResetToken).toHaveBeenCalledOnce();
    const [userId, tokenHash, , ttlMs] = storageMock.createPasswordResetToken.mock.calls[0];
    expect(userId).toBe("pending1");
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 of the raw token, never the token itself
    expect(ttlMs).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("never puts the raw token in the stored hash", async () => {
    const res = await asAdmin(request(makeApp()).post("/api/users/pending1/invite"));
    expect(res.status).toBe(200);

    const rawToken = sendInviteMock.mock.calls[0][0].inviteLink.split("token=")[1];
    const [, tokenHash] = storageMock.createPasswordResetToken.mock.calls[0];
    expect(rawToken).toHaveLength(64);
    expect(tokenHash).not.toBe(rawToken);
  });

  it("names the sender so the recipient knows who invited them", async () => {
    await asAdmin(request(makeApp()).post("/api/users/pending1/invite"));
    expect(sendInviteMock).toHaveBeenCalledWith(expect.objectContaining({ inviterName: "Админ" }));
  });

  it("omits both names when neither account has one", async () => {
    // A nameless account must not produce «Здравствуйте, null!» in the letter.
    storageMock.getUser.mockImplementation((id: string) =>
      Promise.resolve(
        id === "pending1" ? { ...pendingUser, name: null }
          : id === "admin1" ? { ...adminUser, name: null }
            : undefined,
      ),
    );

    await asAdmin(request(makeApp()).post("/api/users/pending1/invite"));

    const arg = sendInviteMock.mock.calls[0][0];
    expect(arg.userName).toBeUndefined();
    expect(arg.inviterName).toBeUndefined();
  });

  it("reports sent=false when the letter could not be delivered", async () => {
    sendInviteMock.mockResolvedValue(false); // e.g. SMTP not configured — link goes to the log
    const res = await asAdmin(request(makeApp()).post("/api/users/pending1/invite"));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, sent: false });
  });

  it("refuses to invite an account that already signed in", async () => {
    const res = await asAdmin(request(makeApp()).post("/api/users/active1/invite"));
    expect(res.status).toBe(400);
    expect(storageMock.createPasswordResetToken).not.toHaveBeenCalled();
    expect(sendInviteMock).not.toHaveBeenCalled();
  });

  it("refuses to invite a blocked account", async () => {
    const res = await asAdmin(request(makeApp()).post("/api/users/inactive1/invite"));
    expect(res.status).toBe(400);
    expect(sendInviteMock).not.toHaveBeenCalled();
  });

  it("returns 429 after three invites within an hour", async () => {
    storageMock.getRecentTokensCount.mockResolvedValue(3);
    const res = await asAdmin(request(makeApp()).post("/api/users/pending1/invite"));
    expect(res.status).toBe(429);
    expect(storageMock.getRecentTokensCount).toHaveBeenCalledWith("pending1", 1);
    expect(sendInviteMock).not.toHaveBeenCalled();
  });

  it("returns 500 when the mailer throws", async () => {
    sendInviteMock.mockRejectedValue(new Error("smtp down"));
    const res = await asAdmin(request(makeApp()).post("/api/users/pending1/invite"));
    expect(res.status).toBe(500);
  });
});
