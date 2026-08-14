/**
 * @module tests/services.participants-invite
 * @description PRD-28 (FR-10..FR-18): the bulk-participant pipeline — workbook
 * to rows, rows to statuses, statuses to a run and a report.
 *
 * The three stages are pinned separately because they fail differently: parsing
 * is about what the operator's file says, classification about what the system
 * already knows, and the run about what must and must not happen to accounts.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

// ─── Hoist mocks ──────────────────────────────────────────────────────────────
// The delivery seam is mocked whole: whether a privileged recipient gets a link
// is `deliverAssignmentLink`'s decision and is pinned in its own suite. Here the
// run is judged on what it asks for, and on the report it builds from the answer.
const { deliverMock } = vi.hoisted(() => ({ deliverMock: vi.fn() }));
vi.mock("../server/services/assignment-link", () => ({
  deliverAssignmentLink: deliverMock,
  resolveAssignmentTokenExpiry: (linkExpiresAt: Date | null, dueDate: Date | null) =>
    linkExpiresAt ?? dueDate ?? new Date("2026-09-01T00:00:00.000Z"),
}));

import { addAoaSheet, workbookToBuffer } from "../server/utils/excel";
import {
  classifyParticipants,
  ParticipantsInviteError,
  parseParticipantsWorkbook,
  runParticipantsInvite,
  type ParticipantPreviewRow,
  type ParticipantRow,
  type ParticipantStatus,
} from "../server/services/participants-invite";
import type { IStorage } from "../server/storage";

/** Build an xlsx buffer from an array-of-arrays, first row being the header. */
async function workbookWith(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Участники", rows);
  return workbookToBuffer(wb);
}

/** Only the handful of `IStorage` methods the pipeline touches, all mocked. */
function makeStorage(overrides: Partial<Record<string, unknown>> = {}) {
  const mock = {
    getTest: vi.fn().mockResolvedValue({ id: "t1", title: "Тест", description: null }),
    getTestAssignments: vi.fn().mockResolvedValue([]),
    getGroupUsers: vi.fn().mockResolvedValue([]),
    getUserByEmail: vi.fn().mockResolvedValue(undefined),
    getUserRoles: vi.fn().mockResolvedValue(["learner"]),
    createUser: vi.fn((u: Record<string, unknown>) =>
      Promise.resolve({ ...u, id: `u-${u.email}`, name: u.name ?? null })),
    setUserRoles: vi.fn().mockResolvedValue(undefined),
    updateUser: vi.fn((id: string, data: Record<string, unknown>) => Promise.resolve({ id, ...data })),
    getGroups: vi.fn().mockResolvedValue([]),
    createGroup: vi.fn((g: Record<string, unknown>) => Promise.resolve({ ...g, id: "g-new" })),
    addUserToGroup: vi.fn().mockResolvedValue(undefined),
    createTestAssignment: vi.fn((a: Record<string, unknown>) => Promise.resolve({ ...a, id: "as-1" })),
    revokeAssignmentAccessTokensByAssignmentAndUser: vi.fn().mockResolvedValue(undefined),
    createPasswordResetToken: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
  return mock as unknown as IStorage & Record<string, ReturnType<typeof vi.fn>>;
}

/** A preview row as the operator would have confirmed it. */
function previewRow(
  index: number,
  email: string,
  status: ParticipantStatus,
  extra: Partial<ParticipantPreviewRow> = {},
): ParticipantPreviewRow {
  return { index, email, name: null, status, userId: null, ...extra };
}

/** Everything `runParticipantsInvite` needs beyond the rows and the storage. */
const runDefaults = {
  testId: "t1",
  actorId: "op1",
  dueDate: null,
  linkExpiresAt: null,
  groupName: null,
};

/** Turn addresses into parsed rows, the way {@link parseParticipantsWorkbook} would. */
function rowsOf(...emails: string[]): ParticipantRow[] {
  return emails.map((email, index) => ({ index, email, name: null }));
}

describe("разбор книги участников", () => {
  it("читает email и name, игнорирует прочие колонки", async () => {
    const buf = await workbookWith([
      ["email", "name", "role", "group"],
      ["a@x.ru", "Анна", "administrator", "Отдел"],
    ]);

    const rows = await parseParticipantsWorkbook(buf, { maxRows: 500 });

    // `role` and `group` are read by nobody: the role of a participant is always
    // `learner`, and the group comes from the form, one for the whole run.
    expect(rows).toEqual([{ index: 0, email: "a@x.ru", name: "Анна" }]);
  });

  it("схлопывает повтор адреса", async () => {
    const buf = await workbookWith([["email", "name"], ["a@x.ru", "Анна"], ["A@X.ru", "Анна вторая"]]);

    const rows = await parseParticipantsWorkbook(buf, { maxRows: 500 });

    // One address is one participant, whatever the case it is written in.
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Анна");
  });

  it("отклоняет книгу сверх потолка", async () => {
    const buf = await workbookWith([["email", "name"], ["a@x.ru", "А"], ["b@x.ru", "Б"]]);

    await expect(parseParticipantsWorkbook(buf, { maxRows: 1 })).rejects.toThrow(/Maximum 1 rows/);
  });

  it("отказы разбора несут вид, а не только текст", async () => {
    // The route picks a status code by `kind`; a reworded message must not be
    // able to change what the operator's browser gets back.
    const empty = await workbookWith([["email", "name"]]);
    await expect(parseParticipantsWorkbook(empty, { maxRows: 500 }))
      .rejects.toMatchObject({ name: "ParticipantsInviteError", kind: "empty_file" });

    const tooMany = await workbookWith([["email", "name"], ["a@x.ru", "А"], ["b@x.ru", "Б"]]);
    await expect(parseParticipantsWorkbook(tooMany, { maxRows: 1 }))
      .rejects.toMatchObject({ kind: "too_many_rows", detail: { maxRows: 1 } });
  });
});

describe("классификация строк", () => {
  it("раздаёт статусы по состоянию системы", async () => {
    const accounts: Record<string, Record<string, unknown>> = {
      "ext@x.ru": { id: "u-ext", isExternal: true, status: "active" },
      "learner@x.ru": { id: "u-learner", isExternal: false, status: "active" },
      "boss@x.ru": { id: "u-boss", isExternal: false, status: "active" },
      "off@x.ru": { id: "u-off", isExternal: false, status: "inactive" },
      "done@x.ru": { id: "u-done", isExternal: false, status: "active" },
    };
    const storage = makeStorage({
      getUserByEmail: vi.fn((email: string) => Promise.resolve(accounts[email])),
      getUserRoles: vi.fn((id: string) =>
        Promise.resolve(id === "u-boss" ? ["manager", "learner"] : ["learner"]),
      ),
      getTestAssignments: vi.fn().mockResolvedValue([{ id: "a1", userId: "u-done", groupId: null }]),
    });

    const preview = await classifyParticipants(
      rowsOf("new@x.ru", "ext@x.ru", "learner@x.ru", "boss@x.ru", "off@x.ru", "done@x.ru", "нет"),
      { testId: "t1", storage },
    );

    expect(preview.map((p) => p.status)).toEqual([
      "new",        // адреса нет
      "external",   // внешний участник
      "learner",    // штатный учащийся
      "privileged", // роль с правами: письмо без разовой ссылки
      "error",      // деактивирован
      "assigned",   // тест уже назначен
      "error",      // адрес без «собаки»
    ]);
    expect(preview[4].error).toBe("Учётная запись деактивирована");
    expect(preview[6].error).toBe("Некорректный адрес");
    // The row keeps its sheet position, so the operator's ticks survive the trip.
    expect(preview.map((p) => p.index)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("членство в назначенной группе тоже считается назначением", async () => {
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({ id: "u-member", isExternal: false, status: "active" }),
      getTestAssignments: vi.fn().mockResolvedValue([{ id: "a1", userId: null, groupId: "g1" }]),
      getGroupUsers: vi.fn().mockResolvedValue([{ id: "u-member" }]),
    });

    const preview = await classifyParticipants(rowsOf("member@x.ru"), { testId: "t1", storage });

    // Missing this would hand the person a SECOND link to a test they already
    // have, and revoke nothing of the first assignment.
    expect(preview[0].status).toBe("assigned");
  });
});

describe("прогон", () => {
  beforeEach(() => {
    deliverMock.mockReset();
    deliverMock.mockResolvedValue({
      issued: true,
      magicLink: "https://host/access/abc",
      delivered: true,
    });
  });

  it("создаёт внешних без пароля, назначает и собирает отчёт", async () => {
    const storage = makeStorage();

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new", { name: "Анна" })],
      storage,
    });

    expect(storage.createUser).toHaveBeenCalledWith(expect.objectContaining({
      email: "a@x.ru", passwordHash: null, isExternal: true, status: "pending", createdBy: "op1",
    }));
    expect(storage.setUserRoles).toHaveBeenCalledWith("u-a@x.ru", ["learner"], "op1");
    // FR-15: this scenario mints no password-setup token at all.
    expect(storage.createPasswordResetToken).not.toHaveBeenCalled();
    expect(report).toMatchObject({ created: 1, reused: 0, assigned: 1, groupId: null });
    expect(report.results[0]).toMatchObject({ email: "a@x.ru", delivered: true });
    expect(report.results[0].magicLink).toMatch(/\/access\//);
  });

  it("создаёт группу и одно назначение на неё", async () => {
    const storage = makeStorage();

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new"), previewRow(1, "b@x.ru", "new")],
      groupName: "Набор апреля",
      storage,
    });

    expect(storage.createGroup).toHaveBeenCalledWith(expect.objectContaining({ name: "Набор апреля" }));
    expect(storage.addUserToGroup).toHaveBeenCalledTimes(2);
    // One assignment on the group, not one per person.
    expect(storage.createTestAssignment).toHaveBeenCalledTimes(1);
    expect(storage.createTestAssignment).toHaveBeenCalledWith(
      expect.objectContaining({ groupId: "g-new", userId: null }),
    );
    expect(report.groupId).toBe("g-new");
    expect(report.results).toHaveLength(2);
  });

  it("занятое имя группы отклоняется до любых изменений", async () => {
    const storage = makeStorage({
      getGroups: vi.fn().mockResolvedValue([{ id: "g1", name: "Набор апреля" }]),
    });

    // The service speaks English and carries the name in `detail`; the Russian
    // sentence the operator reads is composed by the route.
    await expect(runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new")],
      groupName: "набор апреля",
      storage,
    })).rejects.toMatchObject({
      kind: "group_name_taken",
      detail: { groupName: "набор апреля" },
    });

    // Refused BEFORE anything was written: the operator renames and retries on a
    // system that never saw the first attempt.
    expect(storage.createUser).not.toHaveBeenCalled();
    expect(storage.createGroup).not.toHaveBeenCalled();
    expect(storage.createTestAssignment).not.toHaveBeenCalled();
  });

  it("исчезнувший тест — типизированный отказ", async () => {
    const storage = makeStorage({ getTest: vi.fn().mockResolvedValue(undefined) });

    await expect(runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new")],
      storage,
    })).rejects.toBeInstanceOf(ParticipantsInviteError);
  });

  it("сбой на строке не прерывает прогон", async () => {
    const storage = makeStorage();
    storage.createUser
      .mockRejectedValueOnce(new Error("boom"))
      .mockImplementationOnce((u: Record<string, unknown>) => Promise.resolve({ ...u, id: "u-b" }));

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new"), previewRow(1, "b@x.ru", "new")],
      storage,
    });

    expect(report.created).toBe(1);
    // Nothing was written for the failed row, and the report says exactly that.
    expect(report.failed).toEqual([
      { email: "a@x.ru", reason: "boom", accountCreated: false, assignmentCreated: false },
    ]);
    expect(report.results).toHaveLength(1);
  });

  it("сбой после создания учётки виден в отчёте как осадок", async () => {
    const storage = makeStorage();
    // The account is already in the database when the role set fails to write.
    storage.setUserRoles.mockRejectedValueOnce(new Error("roles down"));

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new")],
      storage,
    });

    expect(storage.createUser).toHaveBeenCalledTimes(1);
    // Without the flags the operator could not tell this from "nothing happened".
    expect(report.failed).toEqual([
      { email: "a@x.ru", reason: "roles down", accountCreated: true, assignmentCreated: false },
    ]);
    // Counted nowhere: the summary tallies rows that went all the way through.
    expect(report).toMatchObject({ created: 0, reused: 0, assigned: 0 });
  });

  it("при полном провале списка пустая группа не остаётся", async () => {
    const storage = makeStorage();
    storage.createUser.mockRejectedValue(new Error("boom"));

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new")],
      groupName: "Поток 12",
      storage,
    });

    // The name stays free, so the operator's retry with the same one is not
    // refused because of their own failed attempt.
    expect(storage.createGroup).not.toHaveBeenCalled();
    expect(report.groupId).toBeNull();
    expect(report.failed).toHaveLength(1);
  });

  it("строки со статусом error пропускаются, а не падают", async () => {
    const storage = makeStorage();

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "нет", "error"), previewRow(1, "b@x.ru", "new")],
      storage,
    });

    // The row was not selectable in the preview and nothing is attempted for it;
    // it is not a failure of this run either — its reason is already on screen.
    expect(storage.createUser).toHaveBeenCalledTimes(1);
    expect(report.results.map((r) => r.email)).toEqual(["b@x.ru"]);
    expect(report.failed).toEqual([]);
    expect(report).toMatchObject({ created: 1, assigned: 1 });
  });

  it("недоставленное письмо не отменяет выпуск ссылки", async () => {
    deliverMock.mockResolvedValue({
      issued: true,
      magicLink: "https://host/access/abc",
      delivered: false,
    });
    const storage = makeStorage();

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new")],
      storage,
    });

    // Раздел 6: the link stays valid and goes into the operator's export; the
    // row is a success with `delivered: false`, not a failure.
    expect(report.results[0]).toMatchObject({
      delivered: false, magicLink: "https://host/access/abc",
    });
    expect(report.failed).toEqual([]);
    expect(report).toMatchObject({ created: 1, assigned: 1 });
  });

  it("отчёт несёт срок действия выпущенных ссылок", async () => {
    const storage = makeStorage();

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "a@x.ru", "new")],
      storage,
    });

    // Один срок на весь прогон, и он приходит с сервера: книгу со ссылками
    // собирает клиент, а взять дату ему негде — оператор её не задавал, и
    // умолчание (+30 дней) проставляет цепочка выпуска токена.
    expect(report.linksExpireAt).toBe("2026-09-01T00:00:00.000Z");
    expect(deliverMock).toHaveBeenCalledWith(expect.objectContaining({
      expiresAt: new Date("2026-09-01T00:00:00.000Z"),
    }));
  });

  it("явный срок оператора уходит в отчёт тем же значением", async () => {
    const storage = makeStorage();

    const report = await runParticipantsInvite({
      ...runDefaults,
      linkExpiresAt: new Date("2026-10-05T00:00:00.000Z"),
      rows: [previewRow(0, "a@x.ru", "new")],
      storage,
    });

    expect(report.linksExpireAt).toBe("2026-10-05T00:00:00.000Z");
  });

  it("без единой выпущенной ссылки срока в отчёте нет", async () => {
    deliverMock.mockResolvedValue({ issued: false, delivered: true });
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({ id: "u-boss", email: "boss@x.ru", name: "Босс" }),
    });

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "boss@x.ru", "privileged", { userId: "u-boss" })],
      storage,
    });

    // Привилегированному ссылка не выдаётся: срока действия ссылок у прогона
    // нет, и выдумывать его отчёт не должен — колонка книги останется пустой.
    expect(report.linksExpireAt).toBeNull();
  });

  it("в групповом режиме прежние токены тоже отзываются", async () => {
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({ id: "u-done", email: "done@x.ru", name: "Готов" }),
      getTestAssignments: vi.fn().mockResolvedValue([{ id: "as-old", userId: "u-done", groupId: null }]),
    });

    await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "done@x.ru", "assigned", { userId: "u-done" })],
      groupName: "Поток 12",
      storage,
    });

    // The person is delivered against the NEW group assignment, so the link of
    // the assignment they already had would otherwise stay live (FR-16).
    expect(storage.revokeAssignmentAccessTokensByAssignmentAndUser)
      .toHaveBeenCalledWith("as-old", "u-done");
    expect(deliverMock).toHaveBeenCalledWith(expect.objectContaining({ assignmentId: "as-1" }));
  });

  it("привилегированному ссылка не выдаётся, но назначение делается", async () => {
    deliverMock.mockResolvedValue({ issued: false, delivered: true });
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({ id: "u-boss", email: "boss@x.ru", name: "Босс" }),
    });

    const report = await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "boss@x.ru", "privileged", { userId: "u-boss" })],
      storage,
    });

    expect(storage.createTestAssignment).toHaveBeenCalledTimes(1);
    expect(report).toMatchObject({ created: 0, reused: 1, assigned: 1 });
    expect(report.results[0].magicLink).toBeUndefined();
    expect(report.results[0].delivered).toBe(true);
  });

  it("уже назначенному второго назначения не создаётся, ссылка перевыпускается", async () => {
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({ id: "u-done", email: "done@x.ru", name: "Готов" }),
      getTestAssignments: vi.fn().mockResolvedValue([{ id: "as-old", userId: "u-done", groupId: null }]),
    });

    await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "done@x.ru", "assigned", { userId: "u-done" })],
      storage,
    });

    // FR-16: the person keeps one assignment; the previous link is revoked by the
    // delivery seam because the run asks it to.
    expect(storage.createTestAssignment).not.toHaveBeenCalled();
    expect(deliverMock).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: "as-old", revokeExisting: true,
    }));
  });

  it("два назначения одного теста — отзываются токены обоих", async () => {
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({ id: "u-x", email: "x@x.ru", name: "Икс" }),
      // The test reached the person twice over: personally, and through a group
      // they belong to. Each assignment carries its own live token.
      getTestAssignments: vi.fn().mockResolvedValue([
        { id: "as-group", userId: null, groupId: "g1" },
        { id: "as-personal", userId: "u-x", groupId: null },
      ]),
      getGroupUsers: vi.fn().mockResolvedValue([{ id: "u-x" }]),
    });

    await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "x@x.ru", "assigned", { userId: "u-x" })],
      storage,
    });

    // FR-16: after the run exactly one link works — the new one. Revoking only
    // the assignment the run delivers against would leave the other one live.
    expect(storage.revokeAssignmentAccessTokensByAssignmentAndUser.mock.calls).toEqual(
      expect.arrayContaining([["as-personal", "u-x"], ["as-group", "u-x"]]),
    );
    // One new link, on the personal record — no second assignment is made.
    expect(storage.createTestAssignment).not.toHaveBeenCalled();
    expect(deliverMock).toHaveBeenCalledTimes(1);
    expect(deliverMock).toHaveBeenCalledWith(expect.objectContaining({
      assignmentId: "as-personal", revokeExisting: true,
    }));
  });

  it("имя из файла не затирает уже заполненное, признак не навешивается", async () => {
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({ id: "u-staff", email: "staff@x.ru", name: "Своё имя" }),
    });

    await runParticipantsInvite({
      ...runDefaults,
      rows: [previewRow(0, "staff@x.ru", "learner", { userId: "u-staff", name: "Из файла" })],
      storage,
    });

    // The account is left exactly as it was: the file may fill a gap, never
    // overwrite, and the external flag is never written onto an ordinary account.
    expect(storage.updateUser).not.toHaveBeenCalled();
  });
});
