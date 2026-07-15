/**
 * @module tests/email.test
 * @description Unit coverage for {@link module:server/email}. nodemailer is
 * mocked (a fake transport whose `sendMail`/`verify` resolve or reject on
 * demand) and the SMTP settings are toggled on the real `config` singleton, so
 * every branch is exercised without a network: SMTP-not-configured (link logged,
 * returns false), a successful send (returns true) and a send failure (caught,
 * link logged, returns false).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  sendMail: vi.fn(),
  verify: vi.fn(),
  createTransport: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: (...args: unknown[]) => {
      m.createTransport(...args);
      return { sendMail: m.sendMail, verify: m.verify };
    },
  },
}));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// eslint-disable-next-line import/first -- import after vi.mock
import { config } from "../server/config";
// eslint-disable-next-line import/first
import {
  sendPasswordResetEmail,
  sendAssignmentEmail,
  sendInviteEmail,
  verifySmtpConnection,
} from "../server/email";

/** Put the config singleton into a fully-configured SMTP state. */
function configureSmtp(from = "noreply@x.test") {
  config.email = {
    host: "smtp.x.test",
    port: 587,
    secure: false,
    from,
    auth: { user: "smtp-user@x.test", pass: "secret" },
  } as never;
  config.server = { ...config.server, appName: "TestApp" } as never;
}

/** Wipe SMTP host/credentials so getTransporter() returns null. */
function disableSmtp() {
  config.email = {
    host: "",
    port: 587,
    secure: false,
    from: "",
    auth: { user: "", pass: "" },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  configureSmtp();
  m.sendMail.mockResolvedValue({ messageId: "1" });
  m.verify.mockResolvedValue(true);
});

describe("sendPasswordResetEmail", () => {
  it("returns false and logs the link when SMTP is not configured", async () => {
    disableSmtp();
    expect(await sendPasswordResetEmail("u@x.test", "https://reset")).toBe(false);
    expect(m.sendMail).not.toHaveBeenCalled();
  });

  it("sends and returns true (with a personalised greeting)", async () => {
    const ok = await sendPasswordResetEmail("u@x.test", "https://reset", "Иван");
    expect(ok).toBe(true);
    const call = m.sendMail.mock.calls[0][0];
    expect(call.to).toBe("u@x.test");
    expect(call.subject).toContain("TestApp");
    expect(call.html).toContain("Иван");
    expect(call.from).toContain("noreply@x.test");
  });

  it("returns false when the transport throws", async () => {
    m.sendMail.mockRejectedValueOnce(new Error("smtp down"));
    expect(await sendPasswordResetEmail("u@x.test", "https://reset")).toBe(false);
  });

  it("falls back to the SMTP user as the from address when 'from' is empty", async () => {
    configureSmtp("");
    await sendPasswordResetEmail("u@x.test", "https://reset");
    expect(m.sendMail.mock.calls[0][0].from).toContain("smtp-user@x.test");
  });
});

describe("sendAssignmentEmail", () => {
  const base = { to: "u@x.test", testTitle: "Quiz", magicLink: "https://go" };

  it("returns false and logs when SMTP is not configured", async () => {
    disableSmtp();
    expect(await sendAssignmentEmail(base)).toBe(false);
    expect(m.sendMail).not.toHaveBeenCalled();
  });

  it("sends with a formatted due date and description", async () => {
    const ok = await sendAssignmentEmail({
      ...base,
      userName: "Пётр",
      testDescription: "desc",
      dueDate: new Date("2026-08-01T00:00:00Z"),
    });
    expect(ok).toBe(true);
    const html = m.sendMail.mock.calls[0][0].html as string;
    expect(html).toContain("desc");
    expect(html).toContain("2026");
  });

  it("sends without an optional due date/description", async () => {
    expect(await sendAssignmentEmail({ ...base, dueDate: null, testDescription: null })).toBe(true);
  });

  it("returns false when the transport throws", async () => {
    m.sendMail.mockRejectedValueOnce(new Error("boom"));
    expect(await sendAssignmentEmail(base)).toBe(false);
  });
});

describe("sendInviteEmail", () => {
  const base = { to: "u@x.test", inviteLink: "https://invite" };

  it("returns false and logs when SMTP is not configured", async () => {
    disableSmtp();
    expect(await sendInviteEmail(base)).toBe(false);
  });

  it("sends with an inviter name", async () => {
    const ok = await sendInviteEmail({ ...base, userName: "Анна", inviterName: "Admin" });
    expect(ok).toBe(true);
    expect(m.sendMail.mock.calls[0][0].html).toContain("Admin");
  });

  it("sends without an inviter name (impersonal copy)", async () => {
    expect(await sendInviteEmail(base)).toBe(true);
  });

  it("returns false when the transport throws", async () => {
    m.sendMail.mockRejectedValueOnce(new Error("nope"));
    expect(await sendInviteEmail(base)).toBe(false);
  });
});

describe("verifySmtpConnection", () => {
  it("returns false when SMTP is not configured", async () => {
    disableSmtp();
    expect(await verifySmtpConnection()).toBe(false);
  });

  it("returns true when the transport verifies", async () => {
    expect(await verifySmtpConnection()).toBe(true);
    expect(m.verify).toHaveBeenCalled();
  });

  it("returns false when verify throws", async () => {
    m.verify.mockRejectedValueOnce(new Error("auth failed"));
    expect(await verifySmtpConnection()).toBe(false);
  });
});
