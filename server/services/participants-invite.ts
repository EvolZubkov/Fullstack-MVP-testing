/**
 * @module server/services/participants-invite
 *
 * The bulk-participant pipeline of PRD-28: turn an uploaded workbook into rows,
 * classify each row against the current state of the system, and run the chosen
 * rows through account creation, assignment and delivery, collecting one report.
 *
 * Routes stay thin: `server/routes/assignments.ts` only resolves permissions and
 * hands the buffer (or the chosen rows) over. Keeping the three stages here, and
 * apart from each other, is what lets the preview and the run agree — the
 * operator confirms rows carrying the very statuses the run acts on.
 */
import { readWorkbookFromBuffer, sheetToObjects } from "../utils/excel";

/** One participant as read from the uploaded sheet, before anything is known about them. */
export interface ParticipantRow {
  /** Zero-based position in the uploaded sheet, used to keep preview and run aligned. */
  index: number;
  email: string;
  name: string | null;
}

/**
 * Read the first worksheet of an uploaded workbook into participant rows.
 *
 * Only `email` and `name` are read (in the spellings the users-import template
 * already accepts). Every other column — `role`, `group` — is ignored on
 * purpose: a participant's role is always `learner`, and the group name comes
 * from the form, one for the whole run (PRD-28 раздел 5).
 *
 * @param buf The uploaded file; csv is not accepted, the reader takes OOXML only.
 * @param opts.maxRows Ceiling from configuration (`limits.participantsImportMaxRows`).
 * @returns Rows in sheet order, repeated addresses collapsed.
 * @throws Error When the book has no sheet, no data rows, or more than `maxRows` of them.
 */
export async function parseParticipantsWorkbook(
  buf: Buffer,
  opts: { maxRows: number },
): Promise<ParticipantRow[]> {
  const wb = await readWorkbookFromBuffer(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new Error("File is empty");

  const raw = sheetToObjects(ws, { defval: "" });
  if (raw.length === 0) throw new Error("File is empty");
  if (raw.length > opts.maxRows) throw new Error(`Maximum ${opts.maxRows} rows per upload`);

  const seen = new Set<string>();
  const rows: ParticipantRow[] = [];
  raw.forEach((row: Record<string, unknown>, index) => {
    const email = String(row.email ?? row.Email ?? row.EMAIL ?? "").trim();
    const name = String(row.name ?? row.Name ?? row["ФИО"] ?? row["имя"] ?? "").trim();
    const key = email.toLowerCase();
    // A repeated address is one participant, not two: the first occurrence wins
    // and later ones are dropped before anything is created.
    if (key && seen.has(key)) return;
    if (key) seen.add(key);
    rows.push({ index, email, name: name || null });
  });
  return rows;
}
