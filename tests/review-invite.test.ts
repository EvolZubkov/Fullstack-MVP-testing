/**
 * @module tests/review-invite
 *
 * PRD-52 FR-06/FR-07: приглашение рецензентов. Проверяется, что человек получает
 * ГРАНТ на рецензирование и персональную ссылку с назначением «рецензирование», а
 * не назначение на прохождение, — и что уже имеющийся edit-доступ при этом не
 * понижается: у владельца теста рецензирование и так есть, а понижение отняло бы
 * у него правку.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.hoisted(() => { process.env.DATABASE_URL = "postgresql://fake/test"; });

const { storageMock, emailMock } = vi.hoisted(() => ({
  storageMock: {
    getTest: vi.fn(),
    getUserByEmail: vi.fn(),
    createUser: vi.fn(),
    updateUser: vi.fn(),
    setUserRoles: vi.fn(),
    getTestGrantForUser: vi.fn(),
    upsertTestAccessGrant: vi.fn(),
    createAssignmentAccessToken: vi.fn(),
    createAssignment: vi.fn(),
  },
  emailMock: { sendReviewInviteEmail: vi.fn() },
}));

vi.mock("../server/email", () => emailMock);
vi.mock("../server/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { inviteReviewers } from "../server/services/review-invite";

const EXPIRES = new Date("2026-10-01T00:00:00.000Z");

function run(rows: { email: string; name?: string }[], over: Record<string, unknown> = {}) {
  return inviteReviewers({
    testId: "t1",
    rows,
    actorId: "author-1",
    linkExpiresAt: EXPIRES,
    storage: storageMock as never,
    ...over,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTest.mockResolvedValue({ id: "t1", title: "Сертификационный тест" });
  storageMock.getUserByEmail.mockResolvedValue(undefined);
  storageMock.createUser.mockImplementation(async (data: Record<string, unknown>) => ({
    id: "new-user", email: data.email, name: data.name ?? null,
  }));
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
  storageMock.upsertTestAccessGrant.mockResolvedValue({ id: "g1" });
  storageMock.createAssignmentAccessToken.mockResolvedValue({ id: "tok1" });
  emailMock.sendReviewInviteEmail.mockResolvedValue(true);
});

describe("inviteReviewers", () => {
  it("выдаёт грант review и ссылку с назначением «рецензирование»", async () => {
    const report = await run([{ email: "expert@x.test", name: "Ирина" }]);

    expect(storageMock.upsertTestAccessGrant).toHaveBeenCalledWith(
      expect.objectContaining({ testId: "t1", accessLevel: "review", grantedBy: "author-1" }),
    );
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ purpose: "review", assignmentId: null, testId: "t1" }),
    );
    expect(report.invited).toBe(1);
    expect(report.results[0].magicLink).toContain("/access/");
  });

  it("назначения на прохождение не создаёт: рецензент не участник", async () => {
    await run([{ email: "expert@x.test" }]);
    expect(storageMock.createAssignment).not.toHaveBeenCalled();
  });

  it("новому человеку заводит ВНЕШНЮЮ учётку без пароля и роль learner", async () => {
    await run([{ email: "new@x.test", name: "Новый" }]);
    expect(storageMock.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ email: "new@x.test", isExternal: true, passwordHash: null, status: "pending" }),
    );
    expect(storageMock.setUserRoles).toHaveBeenCalledWith("new-user", ["learner"], "author-1");
  });

  it("существующую учётку не переводит во внешние — обратного пути нет", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ id: "u9", email: "staff@x.test", name: "Сотрудник" });
    await run([{ email: "staff@x.test" }]);
    expect(storageMock.createUser).not.toHaveBeenCalled();
    expect(storageMock.updateUser).not.toHaveBeenCalled();
  });

  it("имя из списка заполняет пробел, но не переписывает существующее", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ id: "u9", email: "staff@x.test", name: null });
    storageMock.updateUser.mockResolvedValue({ id: "u9", email: "staff@x.test", name: "Из списка" });
    await run([{ email: "staff@x.test", name: "Из списка" }]);
    expect(storageMock.updateUser).toHaveBeenCalledWith("u9", { name: "Из списка" });
  });

  it("повторное приглашение не плодит грантов", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ id: "u9", email: "expert@x.test", name: "Ирина" });
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "review" });
    const report = await run([{ email: "expert@x.test" }]);
    expect(storageMock.upsertTestAccessGrant).not.toHaveBeenCalled();
    expect(report.alreadyHadAccess).toBe(1);
    expect(report.invited).toBe(0);
  });

  it("edit-доступ не понижается до рецензирования", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ id: "author-2", email: "co@x.test", name: "Соавтор" });
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "edit" });
    await run([{ email: "co@x.test" }]);
    expect(storageMock.upsertTestAccessGrant).not.toHaveBeenCalled();
  });

  it("ссылка всё равно выпускается: доступ уже есть, а войти по письму человек хочет", async () => {
    storageMock.getUserByEmail.mockResolvedValue({ id: "u9", email: "expert@x.test", name: "Ирина" });
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "review" });
    await run([{ email: "expert@x.test" }]);
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalledTimes(1);
  });

  it("без письма ссылка выпускается молча — пользователь платформы войдёт сам", async () => {
    await run([{ email: "staff@x.test" }], { sendEmail: false });
    expect(emailMock.sendReviewInviteEmail).not.toHaveBeenCalled();
    expect(storageMock.createAssignmentAccessToken).toHaveBeenCalledTimes(1);
  });

  it("сбой на одном адресе не отменяет остальных", async () => {
    storageMock.createUser
      .mockRejectedValueOnce(new Error("duplicate"))
      .mockImplementation(async (data: Record<string, unknown>) => ({ id: "u2", email: data.email, name: null }));

    const report = await run([{ email: "bad@x.test" }, { email: "good@x.test" }]);

    expect(report.failed).toEqual([{ email: "bad@x.test", reason: "duplicate" }]);
    expect(report.invited).toBe(1);
  });

  it("несуществующий тест — отказ до любых записей", async () => {
    storageMock.getTest.mockResolvedValue(undefined);
    await expect(run([{ email: "expert@x.test" }])).rejects.toThrow("Test not found");
    expect(storageMock.upsertTestAccessGrant).not.toHaveBeenCalled();
  });
});
