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
import type { IStorage } from "../storage";

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

/** Statuses a preview row can carry; `error` rows are never selectable. */
export type ParticipantStatus = "new" | "external" | "learner" | "privileged" | "assigned" | "error";

/** A parsed row plus what the system already knows about that address. */
export interface ParticipantPreviewRow extends ParticipantRow {
  status: ParticipantStatus;
  userId: string | null;
  /** Present only for `status: "error"`; shown verbatim in the preview table. */
  error?: string;
}

/**
 * Collect every user the test is already assigned to, directly or through a
 * group.
 *
 * Group membership counts: a member of an assigned group holds the test just as
 * a personally assigned user does (`server/routes/assignments.ts` enumerates the
 * members the same way when it sends the letters). Ignoring it would let the run
 * create a SECOND assignment for the same person and hand them a second link,
 * while the "already assigned" branch — which reissues and revokes the old one —
 * never fires.
 */
async function collectAssignedUserIds(testId: string, storage: IStorage): Promise<Set<string>> {
  const assignments = await storage.getTestAssignments(testId);
  const assigned = new Set<string>();
  for (const assignment of assignments) {
    if (assignment.userId) assigned.add(assignment.userId);
    if (assignment.groupId) {
      const members = await storage.getGroupUsers(assignment.groupId);
      for (const member of members) assigned.add(member.id);
    }
  }
  return assigned;
}

/**
 * Decide what the run would do with each row, without doing any of it (PRD-28
 * раздел 5.2). The operator sees these statuses in the preview table and ticks
 * the rows to run; the run then reads the same statuses back, so what was shown
 * and what happens cannot drift apart.
 *
 * @param rows Parsed rows, in sheet order.
 * @param ctx.testId The test being assigned; decides the `assigned` status.
 * @param ctx.storage Data access; read-only here by construction.
 * @returns One preview row per input row, in the same order.
 */
export async function classifyParticipants(
  rows: readonly ParticipantRow[],
  ctx: { testId: string; storage: IStorage },
): Promise<ParticipantPreviewRow[]> {
  const assignedUserIds = await collectAssignedUserIds(ctx.testId, ctx.storage);

  return Promise.all(rows.map(async (row): Promise<ParticipantPreviewRow> => {
    if (!row.email || !row.email.includes("@")) {
      return { ...row, status: "error", userId: null, error: "Некорректный адрес" };
    }

    const user = await ctx.storage.getUserByEmail(row.email);
    if (!user) return { ...row, status: "new", userId: null };
    if (user.status === "inactive") {
      return { ...row, status: "error", userId: user.id, error: "Учётная запись деактивирована" };
    }
    if (assignedUserIds.has(user.id)) return { ...row, status: "assigned", userId: user.id };

    const roles = await ctx.storage.getUserRoles(user.id);
    // Anything beyond `learner` is a privileged recipient: the assignment is
    // made, but no one-time link is issued (rule D-3, PRD-28 раздел 6).
    const privileged = roles.some((r) => r !== "learner");
    if (privileged) return { ...row, status: "privileged", userId: user.id };
    return { ...row, status: user.isExternal ? "external" : "learner", userId: user.id };
  }));
}
