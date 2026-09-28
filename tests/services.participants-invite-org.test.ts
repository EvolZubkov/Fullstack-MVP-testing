/**
 * @module tests/services.participants-invite-org
 * @description Org-structure columns in the participants list of an assignment
 * (org-structure plan, task 2; PRD-54 BR-54-29).
 *
 * Participants created by a list are external accounts nobody opens one by one,
 * so the list is the only place their unit can come from. Rules asserted:
 *  - the workbook's org columns are read; a file without them yields the same
 *    rows as before (the columns appear on the row only when filled);
 *  - a new account is created with them;
 *  - an existing account gets only the fields it lacks — the same rule the list
 *    already follows for the name: a list fills gaps, it never overwrites.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import ExcelJS from "exceljs";

const { deliverMock } = vi.hoisted(() => ({ deliverMock: vi.fn() }));
vi.mock("../server/services/assignment-link", () => ({
  deliverAssignmentLink: deliverMock,
  resolveAssignmentTokenExpiry: (linkExpiresAt: Date | null, dueDate: Date | null) =>
    linkExpiresAt ?? dueDate ?? new Date("2026-09-01T00:00:00.000Z"),
}));

import { addAoaSheet, readWorkbookFromBuffer, workbookToBuffer } from "../server/utils/excel";
import {
  parseParticipantsWorkbook,
  runParticipantsInvite,
  type ParticipantPreviewRow,
} from "../server/services/participants-invite";
import { buildRecipientTemplateWorkbook } from "../server/services/recipient-list";
import type { IStorage } from "../server/storage";

async function workbookWith(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Участники", rows);
  return workbookToBuffer(wb);
}

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
    createGroup: vi.fn(),
    addUserToGroup: vi.fn().mockResolvedValue(undefined),
    createTestAssignment: vi.fn((a: Record<string, unknown>) => Promise.resolve({ ...a, id: "as-1" })),
    revokeAssignmentAccessTokensByAssignmentAndUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return mock as unknown as IStorage & Record<string, ReturnType<typeof vi.fn>>;
}

const runDefaults = { testId: "t1", actorId: "op1", dueDate: null, linkExpiresAt: null, groupName: null };

function row(extra: Partial<ParticipantPreviewRow>): ParticipantPreviewRow {
  return { index: 0, email: "a@x.ru", name: "Анна", status: "new", userId: null, ...extra };
}

beforeEach(() => {
  deliverMock.mockReset();
  deliverMock.mockResolvedValue({ issued: true, magicLink: "https://host/access/abc", delivered: true });
});

describe("разбор книги участников — оргполя", () => {
  it("читает организацию, подразделение и должность, русские заголовки тоже", async () => {
    const buf = await workbookWith([
      ["email", "name", "Организация", "unit", "Должность"],
      ["a@x.ru", "Анна", "ООО «Партнёр»", " Логистика ", ""],
    ]);
    const rows = await parseParticipantsWorkbook(buf, { maxRows: 500 });
    expect(rows).toEqual([
      { index: 0, email: "a@x.ru", name: "Анна", organization: "ООО «Партнёр»", unit: "Логистика" },
    ]);
  });
});

describe("прогон — оргполя", () => {
  it("создаёт нового участника с оргполями", async () => {
    const storage = makeStorage();
    await runParticipantsInvite({
      ...runDefaults,
      rows: [row({ organization: "ООО «Партнёр»", unit: "Логистика", position: "Кладовщик" })],
      storage,
    });
    expect(storage.createUser).toHaveBeenCalledWith(expect.objectContaining({
      organization: "ООО «Партнёр»", unit: "Логистика", position: "Кладовщик",
    }));
  });

  it("у существующего заполняет только пустые поля", async () => {
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({
        id: "u-a", email: "a@x.ru", name: "Анна", isExternal: true, status: "active",
        organization: null, unit: "Склад", position: null,
      }),
    });
    await runParticipantsInvite({
      ...runDefaults,
      rows: [row({ status: "external", organization: "ООО «Партнёр»", unit: "Логистика", position: "Кладовщик" })],
      storage,
    });
    expect(storage.updateUser).toHaveBeenCalledTimes(1);
    const patch = storage.updateUser.mock.calls[0][1];
    expect(patch).toEqual({ organization: "ООО «Партнёр»", position: "Кладовщик" });
  });

  it("не трогает существующего, если заполнять нечего", async () => {
    const storage = makeStorage({
      getUserByEmail: vi.fn().mockResolvedValue({
        id: "u-a", email: "a@x.ru", name: "Анна", isExternal: true, status: "active",
        organization: "АО", unit: "Склад", position: "Кладовщик",
      }),
    });
    await runParticipantsInvite({ ...runDefaults, rows: [row({ status: "external", unit: "Логистика" })], storage });
    expect(storage.updateUser).not.toHaveBeenCalled();
  });
});

describe("шаблон списка", () => {
  async function headerOf(buf: Buffer): Promise<unknown[]> {
    const wb = await readWorkbookFromBuffer(buf);
    return (wb.worksheets[0].getRow(1).values as unknown[]).slice(1);
  }

  it("у назначения предлагает оргколонки", async () => {
    expect(await headerOf(await buildRecipientTemplateWorkbook({ withOrgFields: true })))
      .toEqual(["email", "name", "organization", "unit", "position"]);
  });

  it("у рецензирования остаётся с двумя колонками", async () => {
    expect(await headerOf(await buildRecipientTemplateWorkbook())).toEqual(["email", "name"]);
  });
});
