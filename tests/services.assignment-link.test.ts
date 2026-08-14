/**
 * @module tests/services.assignment-link.test
 * @description Unit coverage for {@link module:server/services/assignment-link}.
 * The storage layer, the e-mail transport and the D-3 role gate
 * (`mayReceiveAssignmentLink`) are mocked, so both branches — link minted and
 * link withheld — are exercised without a database or a network.
 *
 * The focus is the value the helper hands BACK to its caller (PRD-28 задача 6):
 * a bulk run needs the freshly minted link (the raw token is never stored, so
 * the moment of issue is the only moment it exists) and the per-address
 * delivery outcome. The raw token must reach the caller and NOTHING else — in
 * particular it must never appear in the log.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  mayReceive: vi.fn(),
  sendAssignmentEmail: vi.fn(),
  revokeTokens: vi.fn(),
  createToken: vi.fn(),
}));

vi.mock("../server/logger", () => ({
  logger: { info: m.info, warn: m.warn, error: m.error, debug: m.debug },
}));
vi.mock("../server/services/access", () => ({
  mayReceiveAssignmentLink: m.mayReceive,
}));
vi.mock("../server/email", () => ({ sendAssignmentEmail: m.sendAssignmentEmail }));
vi.mock("../server/storage", () => ({
  storage: {
    revokeAssignmentAccessTokensByAssignmentAndUser: m.revokeTokens,
    createAssignmentAccessToken: m.createToken,
  },
}));

// eslint-disable-next-line import/first -- import after vi.mock
import { deliverAssignmentLink } from "../server/services/assignment-link";

/** The plan's canonical call: a plain learner receiving a fresh assignment. */
const base = {
  user: { id: "u1", name: "Ученик", emailHash: "h" },
  email: "u1@example.com",
  assignmentId: "a1",
  testId: "t1",
  testTitle: "Тест",
  expiresAt: new Date("2026-09-01T00:00:00Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  m.mayReceive.mockResolvedValue(true);
  m.sendAssignmentEmail.mockResolvedValue(true);
  m.revokeTokens.mockResolvedValue(undefined);
  m.createToken.mockResolvedValue(undefined);
});

describe("deliverAssignmentLink", () => {
  it("возвращает выпущенную ссылку вызывающему", async () => {
    const result = await deliverAssignmentLink(base);

    expect(result.issued).toBe(true);
    expect(result.magicLink).toMatch(/\/access\/[0-9a-f]{64}$/);
    expect(result.delivered).toBe(true);
  });

  it("для привилегированного получателя ссылки нет", async () => {
    m.mayReceive.mockResolvedValue(false);

    const result = await deliverAssignmentLink(base);

    expect(result.issued).toBe(false);
    expect(result.magicLink).toBeUndefined();
    expect(result.delivered).toBe(true);
    expect(m.createToken).not.toHaveBeenCalled();
  });

  it("неудача транспорта гасит delivered, но не выпуск ссылки", async () => {
    m.sendAssignmentEmail.mockResolvedValue(false);

    const result = await deliverAssignmentLink(base);

    expect(result.delivered).toBe(false);
    expect(result.issued).toBe(true);
    expect(result.magicLink).toMatch(/\/access\/[0-9a-f]{64}$/);
  });

  it("исход отправки виден и для отозванного получателя", async () => {
    m.mayReceive.mockResolvedValue(false);
    m.sendAssignmentEmail.mockResolvedValue(false);

    const result = await deliverAssignmentLink(base);

    expect(result).toEqual({ issued: false, delivered: false });
  });

  it("сырой токен не попадает в журнал", async () => {
    const result = await deliverAssignmentLink(base);
    const rawToken = result.magicLink!.split("/access/")[1];

    expect(rawToken).toHaveLength(64);
    const logged = [m.info, m.warn, m.error, m.debug]
      .flatMap((fn) => fn.mock.calls.flat())
      .filter((arg): arg is string => typeof arg === "string");
    expect(logged.length).toBeGreaterThan(0);
    for (const line of logged) {
      expect(line).not.toContain(rawToken);
      expect(line).not.toContain("/access/");
    }
  });

  it("в базе оседает только хеш токена, а не сам токен", async () => {
    const result = await deliverAssignmentLink(base);
    const rawToken = result.magicLink!.split("/access/")[1];

    const stored = m.createToken.mock.calls[0][0] as { tokenHash: string };
    expect(stored.tokenHash).toHaveLength(64);
    expect(stored.tokenHash).not.toBe(rawToken);
  });
});
