/**
 * @module tests/email.assignment.test
 * @description Where the assignment letter's call-to-action points (PRD-28
 * раздел 6). A privileged recipient gets no one-time `/access/<token>` link
 * (rule D-3), but the letter must still lead to the TEST itself
 * (`/learner/test/<id>`): the person signs in with their own password and lands
 * on the test rather than in the general cabinet. The withheld letter still
 * says nothing about why the quick link is absent — letters get forwarded.
 *
 * The broader branch coverage of {@link module:server/email} lives in
 * `tests/email.test.ts`; this file is only about the destination address.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  sendMail: vi.fn(),
  verify: vi.fn(),
}));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({ sendMail: m.sendMail, verify: m.verify }),
  },
}));
vi.mock("../server/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// eslint-disable-next-line import/first -- import after vi.mock
import { config } from "../server/config";
// eslint-disable-next-line import/first
import { sendAssignmentEmail } from "../server/email";

beforeEach(() => {
  vi.clearAllMocks();
  config.email = {
    host: "smtp.x.test",
    port: 587,
    secure: false,
    from: "noreply@x.test",
    auth: { user: "smtp-user@x.test", pass: "secret" },
  } as never;
  config.server = { ...config.server, appName: "TestApp" } as never;
  m.sendMail.mockResolvedValue({ messageId: "1" });
});

describe("sendAssignmentEmail: адрес письма", () => {
  it("письмо без разовой ссылки ведёт на адрес теста", async () => {
    await sendAssignmentEmail({ to: "a@x.ru", testTitle: "Тест", testId: "t1" });

    const call = m.sendMail.mock.calls[0][0];
    expect(call.html).toContain("/learner/test/t1");
    expect(call.html).not.toContain("/access/");
    expect(call.text).toContain("/learner/test/t1");
    expect(call.text).not.toContain("/access/");
  });

  it("письмо без разовой ссылки не объясняет её отсутствия", async () => {
    await sendAssignmentEmail({ to: "a@x.ru", testTitle: "Тест", testId: "t1" });

    const call = m.sendMail.mock.calls[0][0];
    expect(call.html).not.toMatch(/роль|прав/i);
    expect(call.text).not.toMatch(/роль|прав/i);
  });

  it("письмо с разовой ссылкой по-прежнему ведёт на неё", async () => {
    await sendAssignmentEmail({
      to: "a@x.ru",
      testTitle: "Тест",
      testId: "t1",
      magicLink: "https://app.test/access/abc",
    });

    const call = m.sendMail.mock.calls[0][0];
    expect(call.html).toContain("/access/abc");
    expect(call.html).not.toContain("/learner/test/t1");
    expect(call.text).toContain("/access/abc");
    expect(call.text).not.toContain("/learner/test/t1");
  });
});
