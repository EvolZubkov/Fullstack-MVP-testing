/**
 * @module tests/services.participants-invite
 * @description PRD-28 (FR-10..FR-18): the bulk-participant pipeline — workbook
 * to rows, rows to statuses, statuses to a run and a report.
 *
 * The three stages are pinned separately because they fail differently: parsing
 * is about what the operator's file says, classification about what the system
 * already knows, and the run about what must and must not happen to accounts.
 */
import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { addAoaSheet, workbookToBuffer } from "../server/utils/excel";
import { parseParticipantsWorkbook } from "../server/services/participants-invite";

/** Build an xlsx buffer from an array-of-arrays, first row being the header. */
async function workbookWith(rows: unknown[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Участники", rows);
  return workbookToBuffer(wb);
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
