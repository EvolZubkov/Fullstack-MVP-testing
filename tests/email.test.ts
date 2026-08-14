/**
 * @module tests/email.test
 * @description Unit coverage for {@link module:server/email}. nodemailer is
 * mocked (a fake transport whose `sendMail`/`verify` resolve or reject on
 * demand) and the SMTP settings are toggled on the real `config` singleton, so
 * every branch is exercised without a network: SMTP-not-configured (link logged,
 * returns false), a successful send (returns true) and a send failure (caught,
 * link logged, returns false).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
import { logger } from "../server/logger";
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
  const base = { to: "u@x.test", testId: "t1", testTitle: "Quiz", magicLink: "https://go" };

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

  // D-3 (PLAN_MAGIC_LINK_SCOPE.md, Этап 3): withheld for privileged recipients —
  // `magicLink` is omitted and the letter falls back to a plain link that needs
  // an ordinary sign-in. Since PRD-28 раздел 6 that fallback addresses the test
  // itself (`/learner/test/<id>`), not the general login page.
  describe("without a magicLink (withheld for a privileged recipient)", () => {
    const withheld = { to: "u@x.test", testId: "t1", testTitle: "Quiz" };

    it("renders a sign-in call-to-action instead of a magic link", async () => {
      const ok = await sendAssignmentEmail(withheld);
      expect(ok).toBe(true);
      const call = m.sendMail.mock.calls[0][0];
      expect(call.html).toContain("/learner/test/t1");
      expect(call.html).toContain("Войти и пройти тест");
      expect(call.html).toContain("После входа откроется страница теста.");
      expect(call.text).toContain("/learner/test/t1");
      expect(call.text).toContain("После входа откроется страница теста.");
    });

    it("mentions no token, access link or the reason it is absent", async () => {
      const ok = await sendAssignmentEmail(withheld);
      expect(ok).toBe(true);
      const call = m.sendMail.mock.calls[0][0];
      expect(call.html).not.toContain("/access/");
      expect(call.text).not.toContain("/access/");
      // No hint at roles/permissions anywhere in the letter (product decision
      // 2026-07-30: forwarded e-mails must not disclose the protection).
      expect(call.html).not.toMatch(/роль|прав/i);
      expect(call.text).not.toMatch(/роль|прав/i);
    });

    it("logs the fallback URL (and no token) when SMTP is not configured", async () => {
      disableSmtp();
      expect(await sendAssignmentEmail(withheld)).toBe(false);
      const loggedLoginLine = (logger.info as any).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((line: string) => line.startsWith("Login required: "));
      expect(loggedLoginLine).toContain("/learner/test/t1");
      const loggedLinkLine = (logger.info as any).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((line: string) => line.startsWith("Link: "));
      expect(loggedLinkLine).toBeUndefined();
    });

    it("logs the fallback URL (and no token) when the transport throws", async () => {
      m.sendMail.mockRejectedValueOnce(new Error("boom"));
      expect(await sendAssignmentEmail(withheld)).toBe(false);
      const loggedLoginLine = (logger.info as any).mock.calls
        .map((c: unknown[]) => String(c[0]))
        .find((line: string) => line.startsWith("Login required: "));
      expect(loggedLoginLine).toContain("/learner/test/t1");
    });
  });

  it("with a magicLink, the call-to-action is unchanged (byte-identical CTA block)", async () => {
    // Guards against regressions in the branch that must stay untouched: the
    // exact copy an already-passing recipient has always seen.
    await sendAssignmentEmail(base);
    const call = m.sendMail.mock.calls[0][0];
    expect(call.html).toContain(
      "Для прохождения теста нажмите на кнопку ниже — вход произойдёт автоматически, пароль не требуется:",
    );
    expect(call.html).toContain(`<a href="${base.magicLink}" class="button"`);
    expect(call.html).toContain("Пройти тест");
    expect(call.html).toContain("Ссылка персональная — не передавайте её другим людям.");
    expect(call.text).toContain("Для прохождения перейдите по ссылке (пароль не требуется):");
    expect(call.text).toContain("Ссылка персональная — не передавайте её другим.");
  });
});

// PRD-28 FR-20: a letter that did not go out still leaves a WORKING key behind
// (недоставка не отменяет выпуск ссылки), so the fallback logging is the one
// place where a bulk run against a broken transport could drop hundreds of live
// passwordless links into a file, each next to its recipient's address.
describe("недоставленное письмо с разовой ссылкой не пишет её в журнал", () => {
  const savedEnv = process.env.NODE_ENV;
  const withLink = {
    to: "u@x.test",
    testId: "t1",
    testTitle: "Quiz",
    magicLink: "https://app.test/access/deadbeefdeadbeef",
  };

  /** Every line the logger was handed, joined for substring checks. */
  function loggedLines(): string {
    const calls = [logger.info, logger.warn, logger.error, logger.debug]
      .flatMap((fn) => (fn as any).mock.calls as unknown[][]);
    return calls.map((c) => String(c[0])).join("\n");
  }

  afterEach(() => {
    process.env.NODE_ENV = savedEnv;
  });

  it("в рабочем окружении: SMTP выключен — ни токена, ни /access/", async () => {
    process.env.NODE_ENV = "production";
    disableSmtp();

    expect(await sendAssignmentEmail(withLink)).toBe(false);

    const lines = loggedLines();
    expect(lines).not.toContain("/access/");
    expect(lines).not.toContain("deadbeefdeadbeef");
    // What is left is what makes the failure actionable, and nothing more.
    expect(lines).toContain("To: u@x.test");
    expect(lines).toContain("Test: Quiz");
  });

  it("в рабочем окружении: транспорт упал — ни токена, ни /access/", async () => {
    process.env.NODE_ENV = "production";
    m.sendMail.mockRejectedValueOnce(new Error("smtp down"));

    expect(await sendAssignmentEmail(withLink)).toBe(false);

    const lines = loggedLines();
    expect(lines).not.toContain("/access/");
    expect(lines).not.toContain("deadbeefdeadbeef");
    expect(lines).toContain("To: u@x.test");
  });

  it("в окружении разработки строка со ссылкой остаётся", async () => {
    // With SMTP off in development, the log is the only way to get the link by
    // hand — removing it there would take the local scenario away entirely.
    process.env.NODE_ENV = "development";
    disableSmtp();

    expect(await sendAssignmentEmail(withLink)).toBe(false);

    expect(loggedLines()).toContain(`Link: ${withLink.magicLink}`);
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

// Regression (2026-07-31): the button label came out accent-on-accent — the
// colour lived only in the `<style>` block and mail clients overrode the anchor
// with their own link colour. Every call-to-action must carry the contrasting
// colour inline (and `!important`, which outranks the client's stylesheet).
describe("call-to-action button contrast", () => {
  const cases: Array<[string, () => Promise<unknown>]> = [
    ["password reset", () => sendPasswordResetEmail("u@x.test", "https://reset")],
    ["assignment (magic link)", () => sendAssignmentEmail({ to: "u@x.test", testId: "t1", testTitle: "Q", magicLink: "https://go" })],
    ["assignment (sign-in fallback)", () => sendAssignmentEmail({ to: "u@x.test", testId: "t1", testTitle: "Q" })],
    ["invite", () => sendInviteEmail({ to: "u@x.test", inviteLink: "https://invite" })],
  ];

  it.each(cases)("%s: the button carries an inline !important colour", async (_name, send) => {
    await send();
    const html = m.sendMail.mock.calls[0][0].html as string;
    const anchor = html.match(/<a[^>]*class="button"[^>]*>.*?<\/a>/s)?.[0];
    expect(anchor).toBeDefined();
    // Both the anchor and its inner span state the colour explicitly.
    expect(anchor!.match(/color:\s*#FFFFFF\s*!important/gi)?.length).toBeGreaterThanOrEqual(2);
    // ...and it is NOT the accent the button sits on.
    expect(anchor).not.toMatch(/color:\s*#7700FF/i);
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
