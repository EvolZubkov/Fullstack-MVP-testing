/**
 * @module tests/services.participants-invite
 * @description PRD-28 (FR-10..FR-18): the bulk-participant pipeline — workbook
 * to rows, rows to statuses, statuses to a run and a report.
 *
 * The three stages are pinned separately because they fail differently: parsing
 * is about what the operator's file says, classification about what the system
 * already knows, and the run about what must and must not happen to accounts.
 */
import { describe, it, expect, vi } from "vitest";
import ExcelJS from "exceljs";
import { addAoaSheet, workbookToBuffer } from "../server/utils/excel";
import {
  classifyParticipants,
  parseParticipantsWorkbook,
  type ParticipantRow,
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
    getTestAssignments: vi.fn().mockResolvedValue([]),
    getGroupUsers: vi.fn().mockResolvedValue([]),
    getUserByEmail: vi.fn().mockResolvedValue(undefined),
    getUserRoles: vi.fn().mockResolvedValue(["learner"]),
    ...overrides,
  };
  return mock as unknown as IStorage & Record<string, ReturnType<typeof vi.fn>>;
}

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
