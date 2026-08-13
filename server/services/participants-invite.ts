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

/** What the pipeline refused on, told apart without reading the message. */
export type ParticipantsInviteErrorKind =
  | "empty_file"
  | "too_many_rows"
  | "test_not_found"
  | "group_name_taken";

/**
 * A refusal the operator has to resolve before the run can happen.
 *
 * The route used to tell these apart by comparing the text of the message,
 * which made every wording change a silent change of status code. It reads
 * {@link kind} instead. The messages here are English on purpose — they go to
 * the log and to developers; the Russian sentence the operator reads is
 * composed by the route out of `kind` and {@link detail}.
 */
export class ParticipantsInviteError extends Error {
  constructor(
    readonly kind: ParticipantsInviteErrorKind,
    message: string,
    /** Values the route needs to phrase its own message, by kind. */
    readonly detail: { groupName?: string; maxRows?: number } = {},
  ) {
    super(message);
    this.name = "ParticipantsInviteError";
  }
}

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
 * @throws {WorkbookReadError} From `readWorkbookFromBuffer`, when the upload is
 *   not an OOXML package at all (a csv, a pdf, a renamed file) or is a zip that
 *   holds no readable workbook. The commonest refusal on a live file, and the
 *   route answers it through `respondWorkbookReadError`.
 * @throws {ParticipantsInviteError} `empty_file` when the book has no sheet or
 *   no data rows, `too_many_rows` when it holds more than `maxRows` of them.
 */
export async function parseParticipantsWorkbook(
  buf: Buffer,
  opts: { maxRows: number },
): Promise<ParticipantRow[]> {
  const wb = await readWorkbookFromBuffer(buf);
  const ws = wb.worksheets[0];
  if (!ws) throw new ParticipantsInviteError("empty_file", "File is empty");

  const raw = sheetToObjects(ws, { defval: "" });
  if (raw.length === 0) throw new ParticipantsInviteError("empty_file", "File is empty");
  if (raw.length > opts.maxRows) {
    throw new ParticipantsInviteError(
      "too_many_rows",
      `Maximum ${opts.maxRows} rows per upload`,
      { maxRows: opts.maxRows },
    );
  }

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
 * Map every user who already holds this test to ALL the assignments that give
 * it to them — directly, or through a group they belong to.
 *
 * Group membership counts: a member of an assigned group holds the test just as
 * a personally assigned user does (`server/routes/assignments.ts` enumerates the
 * members the same way when it sends the letters). Ignoring it would let the run
 * create a SECOND assignment for the same person and hand them a second link,
 * while the "already assigned" branch — which reissues and revokes the old one —
 * never fires.
 *
 * Every assignment is kept, not just one, because a person can hold the same
 * test twice over: once through a group, once in person. Each of those carries
 * its own access tokens, and FR-16 promises ONE working link per person per
 * test — so the run has to be able to revoke all of them, not the newest one it
 * happened to see last.
 *
 * A personal assignment comes FIRST in the list: it is the narrower record, it
 * is the one the "current assignments" tab lets the operator revoke by hand, and
 * the head of the list is what the run delivers against.
 */
async function collectAssignmentsByUser(
  testId: string,
  storage: IStorage,
): Promise<Map<string, string[]>> {
  const assignments = await storage.getTestAssignments(testId);
  const byUser = new Map<string, string[]>();
  const add = (userId: string, assignmentId: string, personal: boolean) => {
    const held = byUser.get(userId) ?? [];
    if (held.includes(assignmentId)) return;
    if (personal) held.unshift(assignmentId);
    else held.push(assignmentId);
    byUser.set(userId, held);
  };
  for (const assignment of assignments) {
    if (!assignment.groupId) continue;
    const members = await storage.getGroupUsers(assignment.groupId);
    for (const member of members) add(member.id, assignment.id, false);
  }
  for (const assignment of assignments) {
    if (assignment.userId) add(assignment.userId, assignment.id, true);
  }
  return byUser;
}

/**
 * How many rows are looked up at once during classification.
 *
 * Every row costs a `getUserByEmail` (which decrypts addresses) and possibly a
 * `getUserRoles`, and the file may carry `limits.participantsImportMaxRows`
 * (500) of them. Opening all of those at once would ask the connection pool for
 * hundreds of parallel round-trips on the FIRST thing the operator clicks,
 * while the run that follows is strictly sequential — an asymmetry with nothing
 * behind it. A small window keeps the preview quick without the spike.
 */
const CLASSIFY_CHUNK_SIZE = 16;

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

  const classifyRow = async (row: ParticipantRow): Promise<ParticipantPreviewRow> => {
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
  };

  const preview: ParticipantPreviewRow[] = [];
  for (let from = 0; from < rows.length; from += CLASSIFY_CHUNK_SIZE) {
    const chunk = rows.slice(from, from + CLASSIFY_CHUNK_SIZE);
    preview.push(...(await Promise.all(chunk.map(classifyRow))));
  }
  return preview;
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

/**
 * A row that did not go all the way through, and what it left behind (FR-18).
 *
 * A row fails in stages, and the later ones fail on a system that has already
 * been written to: the account may exist, the person may be in the new group,
 * the assignment may be made. Reporting the reason alone would leave the
 * operator unable to tell "nothing happened" from "half of it did", and the
 * half-done rows are exactly the ones a blind retry would duplicate.
 */
export interface ParticipantFailure {
  email: string;
  reason: string;
  /** An account for this address was brought into being before the failure. */
  accountCreated: boolean;
  /** The person holds the test after this run, despite the failure. */
  assignmentCreated: boolean;
}

/** What the whole run amounted to; the operator sees this as the report screen. */
export interface ParticipantsReport {
  /**
   * Accounts this run brought into being, counted for rows that went ALL the
   * way through. An account created by a row that failed later is not here — it
   * is in {@link failed}, flagged `accountCreated`.
   */
  created: number;
  /** Accounts that were already there and were used as they are (successful rows only). */
  reused: number;
  /**
   * People who hold the test after this run and were told about it (per person,
   * not per assignment row). A row that got an assignment but fell over before
   * the letter is in {@link failed}, flagged `assignmentCreated`, so no
   * assignment this run made is missing from the report altogether.
   */
  assigned: number;
  /** The group created from the list, when the operator asked for one AND anyone got through. */
  groupId: string | null;
  /**
   * When the links this run issued stop working, as an ISO stamp; `null` when
   * the run issued none (every recipient privileged, or every row failed).
   *
   * One field for the whole run, not one per row: every token minted here is
   * given the SAME expiry, resolved once by `resolveAssignmentTokenExpiry`.
   *
   * It travels in the report because the links workbook is assembled on the
   * CLIENT (раздел 7), and the client cannot work the date out: when the
   * operator leaves «Ссылка активна до» empty, the actual expiry comes from the
   * due date or from the default 30 days, both of which are decided here. The
   * client used to print what the operator had typed, so the column read «—»
   * on every row of every run where they had typed nothing.
   */
  linksExpireAt: string | null;
  results: ParticipantResult[];
  failed: ParticipantFailure[];
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

/** Traces a row leaves in the database, gathered as the row goes through. */
interface RowResidue {
  accountCreated: boolean;
  assignmentCreated: boolean;
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
 *
 * @param ctx.residue Marked the moment the account exists, BEFORE the role set
 *   is written: a failure between the two still leaves an account behind, and
 *   the report has to say so (FR-18).
 */
async function resolveParticipant(
  row: ParticipantPreviewRow,
  ctx: { actorId: string; storage: IStorage; residue: RowResidue },
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
  ctx.residue.accountCreated = true;
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
 * A row that fails takes only itself down: the reason lands in `failed`, with
 * what it left behind ({@link ParticipantFailure}), and the run carries on —
 * because a half-processed list the operator cannot re-run safely is worse than
 * a complete one with holes marked in it.
 *
 * @throws {ParticipantsInviteError} Before touching anything: `test_not_found`
 *   or `group_name_taken` — the two conditions the operator must resolve first.
 */
export async function runParticipantsInvite(
  opts: RunParticipantsInviteOptions,
): Promise<ParticipantsReport> {
  const { testId, rows, actorId, dueDate, linkExpiresAt, groupName, storage } = opts;

  const test = await storage.getTest(testId);
  if (!test) throw new ParticipantsInviteError("test_not_found", "Test not found");

  const expiresAt = resolveAssignmentTokenExpiry(linkExpiresAt, dueDate);
  const assignmentByUser = await collectAssignmentsByUser(testId, storage);

  // ── 1. The group name, checked before anything else changes ─────────────────
  // A taken name is refused here and not half-way through: adding people to an
  // existing group would give them its other assignments too (раздел 5.1), and
  // the operator must be able to rename and retry against an untouched system.
  const wantedGroupName = groupName?.trim() ?? "";
  if (wantedGroupName) {
    const groups = await storage.getGroups();
    if (groups.some((g) => g.name.trim().toLowerCase() === wantedGroupName.toLowerCase())) {
      throw new ParticipantsInviteError(
        "group_name_taken",
        `Group name already taken: ${wantedGroupName}`,
        { groupName: wantedGroupName },
      );
    }
  }

  const report: ParticipantsReport = {
    created: 0, reused: 0, assigned: 0, groupId: null, linksExpireAt: null,
    results: [], failed: [],
  };

  let groupId: string | null = null;
  /**
   * Create the group on the FIRST participant that gets through, and not before.
   *
   * Creating it up front took the name even when every row then failed, and the
   * operator's retry with the same name was refused because of their own failed
   * attempt — the opposite of "rename and retry against an untouched system".
   * Deferring beats deleting an empty group afterwards: a cleanup is a second
   * thing that can fail (and would have to fail silently, mid-report), while a
   * group that is never created cannot be left behind.
   */
  const ensureGroup = async (): Promise<string | null> => {
    if (!wantedGroupName || groupId) return groupId;
    const group = await storage.createGroup({ name: wantedGroupName, createdBy: actorId });
    groupId = group.id;
    report.groupId = groupId;
    return groupId;
  };

  // ── 2. Accounts, and membership of the new group ────────────────────────────
  const participants: {
    row: ParticipantPreviewRow;
    user: User;
    created: boolean;
    residue: RowResidue;
  }[] = [];
  for (const row of rows) {
    // A row the preview marked as an error is not acted on, whatever came back
    // from the client: the operator could not tick it, and the reason it failed
    // (no address, a deactivated account) has not gone away since.
    if (row.status === "error") continue;
    const residue: RowResidue = { accountCreated: false, assignmentCreated: false };
    try {
      const { user, created } = await resolveParticipant(row, { actorId, storage, residue });
      const listGroupId = await ensureGroup();
      if (listGroupId) await storage.addUserToGroup(user.id, listGroupId);
      participants.push({ row, user, created, residue });
    } catch (e) {
      // Counted nowhere yet: `created`/`reused` are tallied once the row is
      // through, so what this row did leave behind is carried by the flags.
      report.failed.push({ email: row.email, reason: (e as Error).message, ...residue });
    }
  }

  // ── 3. The group assignment: one for the whole list ─────────────────────────
  let groupAssignmentId: string | null = null;
  if (groupId && participants.length > 0) {
    const assignment = await storage.createTestAssignment({
      testId, userId: null, groupId, dueDate, linkExpiresAt, assignedBy: actorId,
    });
    groupAssignmentId = assignment.id;
    // From this moment everyone in the list holds the test; a row that falls
    // over later still leaves that behind, and the report has to say so.
    for (const participant of participants) participant.residue.assignmentCreated = true;
  }

  // ── 4-5. Assignment per person, then the link and the letter ────────────────
  for (const { row, user, created, residue } of participants) {
    try {
      const heldAssignmentIds = assignmentByUser.get(user.id) ?? [];
      // Every link the person already holds for this test goes, not only the
      // one of the assignment they are delivered against (FR-16: one working
      // link per person per test). A test given both to a group and in person
      // leaves TWO live tokens, and revoking one of them while minting a third
      // would leave the person with two working ways in — the very thing the
      // run is supposed to prevent. The delivery seam revokes again for the
      // assignment it mints on (`revokeExisting`); a second revoke of an
      // already-revoked token changes nothing.
      for (const heldId of heldAssignmentIds) {
        await storage.revokeAssignmentAccessTokensByAssignmentAndUser(heldId, user.id);
      }

      let assignmentId: string;
      if (groupAssignmentId) {
        assignmentId = groupAssignmentId;
      } else if (heldAssignmentIds.length > 0) {
        // Already assigned: no second assignment, the link is reissued on the
        // one they hold — the personal record when there is one.
        assignmentId = heldAssignmentIds[0];
      } else {
        const assignment = await storage.createTestAssignment({
          testId, userId: user.id, groupId: null, dueDate, linkExpiresAt, assignedBy: actorId,
        });
        assignmentId = assignment.id;
        residue.assignmentCreated = true;
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

      // The row is through: only now is the account counted as created or
      // reused, so every count in the summary stands for a row that finished.
      if (created) report.created++;
      else report.reused++;
      report.assigned++;
      // Set on the first link actually issued, and not before: a run that hands
      // out no link has no expiry to report, and stamping one would put a date
      // in the operator's workbook that nothing lives by.
      if (outcome.issued && !report.linksExpireAt) report.linksExpireAt = expiresAt.toISOString();
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
      report.failed.push({ email: row.email, reason: (e as Error).message, ...residue });
    }
  }

  return report;
}
