/**
 * @module server/services/recipient-list
 * @description What the two recipient-list routes share (PRD-28 раздел 16,
 * PRD-52 раздел 14): reading a hand-typed list out of a request body, the
 * Russian sentence for a refusal, and the template workbook.
 *
 * These live together, and outside both routers, because назначение and
 * рецензирование now have SEPARATE gates over the SAME list: a second copy of
 * the refusal wording would drift from the first, and the operator would then be
 * told two different things about one and the same list.
 */
import ExcelJS from "exceljs";
import { ParticipantsInviteError, type ParticipantRow } from "./participants-invite";
import { addAoaSheet, workbookToBuffer } from "../utils/excel";

/**
 * Rows a hand-typed list arrives as (PRD-28 FR-29).
 *
 * The text itself is read in the browser by `shared/recipients` — the module the
 * unit tests pin — so what lands here is already the shape the workbook yields.
 * Only the three fields the pipeline uses are kept: the body is operator input,
 * and a `status` or `userId` smuggled into it must not decide anything, because
 * the whole point of the preview is that the SERVER classifies the rows.
 *
 * @param value The `rows` field of the request body, untrusted.
 * @param maxRows Ceiling from configuration (`limits.participantsImportMaxRows`),
 *   checked here rather than in the browser: it is a system setting, and the
 *   browser has no business knowing it.
 * @returns Rows in the order given, ready for `classifyParticipants`.
 * @throws {ParticipantsInviteError} `empty_list` when nothing was given at all
 *   (no file and no rows), `too_many_rows` above the ceiling.
 */
export function readGivenRows(value: unknown, maxRows: number): ParticipantRow[] {
  const given = Array.isArray(value) ? value : [];
  if (given.length === 0) throw new ParticipantsInviteError("empty_list", "No rows given");
  if (given.length > maxRows) {
    throw new ParticipantsInviteError("too_many_rows", `Maximum ${maxRows} rows per upload`, { maxRows });
  }
  return given.map((row: Record<string, unknown>, position) => {
    const name = typeof row?.name === "string" ? row.name.trim() : "";
    return {
      index: typeof row?.index === "number" ? row.index : position,
      email: typeof row?.email === "string" ? row.email.trim() : "",
      name: name || null,
    };
  });
}

/**
 * The sentence the operator reads for a refusal the pipeline raised.
 *
 * The pipeline speaks English — its messages go to the log and to developers —
 * and the Russian phrasing is composed here, out of `kind` and the values the
 * refusal carries. Routes branch on `kind`, never on this text: rewording the
 * prose must not silently change a status code.
 */
export function recipientRefusalMessage(error: ParticipantsInviteError): string {
  switch (error.kind) {
    case "empty_file":
      return "В файле нет ни одной строки с участниками.";
    case "empty_list":
      return "В списке нет ни одного адреса.";
    case "too_many_rows":
      return `Слишком много строк: за один раз можно загрузить не больше ${error.detail.maxRows}.`;
    case "group_name_taken":
      return `Группа с таким именем уже есть: ${error.detail.groupName}`;
    case "test_not_found":
      return "Тест не найден.";
  }
}

/**
 * The template workbook offered next to the file zone.
 *
 * Unlike the users-import template, `role` and `group` are not offered: they
 * are ignored in this scenario (the role is always `learner`, the group comes
 * from the form), and offering them would promise behaviour that does not exist.
 * The org-structure columns are offered only to the assignment scenario, which
 * reads them (BR-54-29); the review scenario does not, and keeps two columns.
 *
 * @param opts.withOrgFields Add organisation, unit and position columns.
 */
export async function buildRecipientTemplateWorkbook(
  opts: { withOrgFields?: boolean } = {},
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  addAoaSheet(wb, "Участники", opts.withOrgFields
    ? [
      ["email", "name", "organization", "unit", "position"],
      ["ivanov@example.com", "Иван Иванов", "ООО «Пример»", "Отдел продаж", "Менеджер по продажам"],
      ["petrova@example.com", "Анна Петрова", "", "", ""],
    ]
    : [
      ["email", "name"],
      ["ivanov@example.com", "Иван Иванов"],
      ["petrova@example.com", "Анна Петрова"],
    ]);
  return workbookToBuffer(wb);
}
