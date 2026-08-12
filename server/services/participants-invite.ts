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
import { deliverAssignmentLink, resolveAssignmentTokenExpiry } from "./assignment-link";
import type { IStorage } from "../storage";
import type { User } from "@shared/schema";

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
 * Map every user who already holds this test to the assignment that gives it to
 * them — directly, or through a group they belong to.
 *
 * Group membership counts: a member of an assigned group holds the test just as
 * a personally assigned user does (`server/routes/assignments.ts` enumerates the
 * members the same way when it sends the letters). Ignoring it would let the run
 * create a SECOND assignment for the same person and hand them a second link,
 * while the "already assigned" branch — which reissues and revokes the old one —
 * never fires.
 *
 * A personal assignment wins over a group one for the same person: it is the
 * narrower record, and it is the one the "current assignments" tab lets the
 * operator revoke by hand.
 */
async function collectAssignmentsByUser(
  testId: string,
  storage: IStorage,
): Promise<Map<string, string>> {
  const assignments = await storage.getTestAssignments(testId);
  const byUser = new Map<string, string>();
  for (const assignment of assignments) {
    if (!assignment.groupId) continue;
    const members = await storage.getGroupUsers(assignment.groupId);
    for (const member of members) byUser.set(member.id, assignment.id);
  }
  for (const assignment of assignments) {
    if (assignment.userId) byUser.set(assignment.userId, assignment.id);
  }
  return byUser;
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
  const assignedUserIds = new Set((await collectAssignmentsByUser(ctx.testId, ctx.storage)).keys());

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

/** What happened to one recipient during a run. */
export interface ParticipantResult {
  email: string;
  name: string | null;
  status: ParticipantStatus;
  /** Present only when a one-time link was minted for this recipient. */
  magicLink?: string;
  /** Whether the letter was accepted by the transport. */
  delivered: boolean;
}

/** What the whole run amounted to; the operator sees this as the report screen. */
export interface ParticipantsReport {
  /** Accounts this run brought into being. */
  created: number;
  /** Accounts that were already there and were used as they are. */
  reused: number;
  /** People who hold the test after this run (per person, not per assignment row). */
  assigned: number;
  /** The group created from the list, when the operator asked for one. */
  groupId: string | null;
  results: ParticipantResult[];
  failed: { email: string; reason: string }[];
}

/** Input to {@link runParticipantsInvite}. */
export interface RunParticipantsInviteOptions {
  testId: string;
  /** Rows the operator confirmed; `error` ones are ignored if any slipped through. */
  rows: readonly ParticipantPreviewRow[];
  /** The operator, recorded as the author of everything this run creates. */
  actorId: string;
  dueDate: Date | null;
  linkExpiresAt: Date | null;
  /** Name for a NEW group holding the list; `null` means personal assignments. */
  groupName: string | null;
  storage: IStorage;
}

/**
 * Find the account behind a row, or bring it into being.
 *
 * The address is looked up afresh rather than trusted from the preview: the
 * preview may be minutes old, and acting on a stale `userId` would either create
 * a duplicate or write to an account that has since changed hands.
 *
 * A new account is external by construction (PRD-28 раздел 5.2): no password at
 * all, role `learner`, `pending` until the link is used. An existing one is left
 * as it is — in particular the external flag is NEVER written onto an ordinary
 * account, because there is no way back from it — and the name from the file
 * only fills a gap, never overwrites what the person already has.
 */
async function resolveParticipant(
  row: ParticipantPreviewRow,
  ctx: { actorId: string; storage: IStorage },
): Promise<{ user: User; created: boolean }> {
  const existing = await ctx.storage.getUserByEmail(row.email);
  if (existing) {
    if (!existing.name && row.name) {
      const updated = await ctx.storage.updateUser(existing.id, { name: row.name });
      return { user: updated ?? { ...existing, name: row.name }, created: false };
    }
    return { user: existing, created: false };
  }

  const user = await ctx.storage.createUser({
    email: row.email,
    passwordHash: null,
    isExternal: true,
    name: row.name,
    status: "pending",
    // Nothing to change on the next sign-in: the account has no password.
    mustChangePassword: false,
    createdBy: ctx.actorId,
  });
  await ctx.storage.setUserRoles(user.id, ["learner"], ctx.actorId);
  return { user, created: true };
}

/**
 * Run the confirmed rows: accounts, optional group, assignment, delivery, report
 * (PRD-28 разделы 5.1, 5.2 и 6).
 *
 * Not a password path at all — no token of that kind is minted anywhere in here
 * (FR-15). Entry is the assignment link and nothing else.
 *
 * A row that fails takes only itself down: the reason lands in `failed` and the
 * run carries on, because a half-processed list the operator cannot re-run
 * safely is worse than a complete one with holes marked in it.
 *
 * @throws Error Before touching anything, when the test is gone or the group
 *   name is taken — the two conditions the operator must resolve first.
 */
export async function runParticipantsInvite(
  opts: RunParticipantsInviteOptions,
): Promise<ParticipantsReport> {
  const { testId, rows, actorId, dueDate, linkExpiresAt, groupName, storage } = opts;

  const test = await storage.getTest(testId);
  if (!test) throw new Error("Test not found");

  const expiresAt = resolveAssignmentTokenExpiry(linkExpiresAt, dueDate);
  const assignmentByUser = await collectAssignmentsByUser(testId, storage);

  // ── 1. The group, if asked for, before anything else changes ────────────────
  // A taken name is refused here and not half-way through: adding people to an
  // existing group would give them its other assignments too (раздел 5.1), and
  // the operator must be able to rename and retry against an untouched system.
  let groupId: string | null = null;
  const wantedGroupName = groupName?.trim() ?? "";
  if (wantedGroupName) {
    const groups = await storage.getGroups();
    if (groups.some((g) => g.name.trim().toLowerCase() === wantedGroupName.toLowerCase())) {
      throw new Error(`Группа с таким именем уже есть: ${wantedGroupName}`);
    }
    const group = await storage.createGroup({ name: wantedGroupName, createdBy: actorId });
    groupId = group.id;
  }

  const report: ParticipantsReport = {
    created: 0, reused: 0, assigned: 0, groupId, results: [], failed: [],
  };

  // ── 2. Accounts, and membership of the new group ────────────────────────────
  const participants: { row: ParticipantPreviewRow; user: User }[] = [];
  for (const row of rows) {
    if (row.status === "error") continue;
    try {
      const { user, created } = await resolveParticipant(row, { actorId, storage });
      if (created) report.created++;
      else report.reused++;
      if (groupId) await storage.addUserToGroup(user.id, groupId);
      participants.push({ row, user });
    } catch (e) {
      report.failed.push({ email: row.email, reason: (e as Error).message });
    }
  }

  // ── 3. The group assignment: one for the whole list ─────────────────────────
  let groupAssignmentId: string | null = null;
  if (groupId && participants.length > 0) {
    const assignment = await storage.createTestAssignment({
      testId, userId: null, groupId, dueDate, linkExpiresAt, assignedBy: actorId,
    });
    groupAssignmentId = assignment.id;
  }

  // ── 4-5. Assignment per person, then the link and the letter ────────────────
  for (const { row, user } of participants) {
    try {
      const existingAssignmentId = assignmentByUser.get(user.id) ?? null;
      let assignmentId: string;
      if (groupAssignmentId) {
        assignmentId = groupAssignmentId;
        // The person is delivered against the group assignment, so a link they
        // hold from an earlier one would be a second live way in. Revoke it:
        // FR-16 promises one working link per person per test.
        if (existingAssignmentId) {
          await storage.revokeAssignmentAccessTokensByAssignmentAndUser(existingAssignmentId, user.id);
        }
      } else if (existingAssignmentId) {
        // Already assigned: no second assignment, the link is reissued on the
        // existing one and the previous one is revoked by `revokeExisting`.
        assignmentId = existingAssignmentId;
      } else {
        const assignment = await storage.createTestAssignment({
          testId, userId: user.id, groupId: null, dueDate, linkExpiresAt, assignedBy: actorId,
        });
        assignmentId = assignment.id;
      }

      // Whether the recipient may hold a passwordless link at all is decided
      // there, not here (rule D-3): a privileged one gets the letter without it.
      const outcome = await deliverAssignmentLink({
        user,
        email: user.email,
        assignmentId,
        testId,
        testTitle: test.title,
        testDescription: test.description,
        dueDate,
        expiresAt,
        revokeExisting: true,
      });

      report.assigned++;
      report.results.push({
        email: user.email,
        name: user.name ?? null,
        status: row.status,
        ...(outcome.magicLink ? { magicLink: outcome.magicLink } : {}),
        // An undelivered letter does not undo the link: it stays valid and goes
        // into the operator's export (PRD-28 раздел 6).
        delivered: outcome.delivered,
      });
    } catch (e) {
      report.failed.push({ email: row.email, reason: (e as Error).message });
    }
  }

  return report;
}
