/**
 * @module server/services/assignment-link
 *
 * Single choke point for issuing — or withholding — a passwordless assignment
 * link and sending the notification e-mail that goes with it. Every place
 * that used to mint a magic link by hand now calls {@link deliverAssignmentLink}
 * instead: direct and group assignment creation, the three "resend" endpoints
 * (`server/routes/assignments.ts`), and adding a user to a group that already
 * has an active assignment (`server/routes/groups.ts`).
 *
 * This module exists because of D-3 (PLAN_MAGIC_LINK_SCOPE.md, Этап 3): a
 * recipient holding any role other than `learner` must never receive a
 * password-free entry link. Before this module existed, the
 * check-then-mint-or-withhold logic was duplicated by hand at every call site,
 * and one site (`server/routes/groups.ts`) was missed entirely because it
 * never imported the helper it should have consulted. Centralizing the
 * decision here means a future sixth call site gets the gate "for free" by
 * construction, rather than by remembering to copy it correctly again.
 */
import { createHash, randomBytes } from "crypto";
import { logger } from "../logger";
import { appBaseUrl } from "../config";
import { storage } from "../storage";
import { sendAssignmentEmail } from "../email";
import { mayReceiveAssignmentLink } from "./access";
import type { User } from "@shared/schema";

/** Default lifetime of an assignment access token when nothing else says otherwise. */
const DEFAULT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * When a freshly minted assignment link stops working: the operator's explicit
 * choice, else the due date of the assignment, else 30 days from now.
 *
 * Lives next to the minting itself rather than at the call sites, so the senders
 * — the assignment routes and the bulk participant run (PRD-28) — cannot come to
 * disagree about how long a link lasts.
 */
export function resolveAssignmentTokenExpiry(
  linkExpiresAt?: Date | null,
  dueDate?: Date | null,
): Date {
  if (linkExpiresAt) return linkExpiresAt;
  if (dueDate) return dueDate;
  return new Date(Date.now() + DEFAULT_TOKEN_TTL_MS);
}

/** Input to {@link deliverAssignmentLink}. */
export interface DeliverAssignmentLinkOptions {
  /** The recipient, already resolved (used for the role check and the greeting). */
  user: Pick<User, "id" | "name" | "emailHash">;
  /** The recipient's resolved (decrypted, if needed) e-mail address. */
  email: string;
  assignmentId: string;
  testId: string;
  testTitle: string;
  testDescription?: string | null;
  dueDate?: Date | null;
  /** Expiry for a newly-minted token; ignored when the link is withheld. */
  expiresAt: Date;
  /**
   * Whether to revoke the recipient's existing tokens for this assignment
   * before minting a new one. Defaults to `true`. Pass `false` when the
   * caller already revoked (e.g. a bulk revoke-then-resend loop over an
   * entire assignment) to avoid a redundant call.
   */
  revokeExisting?: boolean;
}

/** Result of {@link deliverAssignmentLink}: which of the two things happened. */
export interface DeliverAssignmentLinkResult {
  /** `true` when a token was minted and the letter carries a magic link; `false` when withheld. */
  issued: boolean;
  /**
   * The freshly minted link, present only when `issued` is true. Returned so a
   * bulk run can offer the operator a one-time export (PRD-28 раздел 7) — the
   * raw token is never stored, so this is the only moment it exists.
   *
   * The log lines below deliberately name the user and the test but not the
   * link. That is a statement about THIS module only: the letter itself is
   * written by `server/email.ts`, and when the transport refuses it, that
   * module logs the undelivered letter — including the link, but in a
   * development environment only (`mayLogEntryLink`). In production a raw
   * token reaches no log on any path.
   */
  magicLink?: string;
  /** Whether the notification letter was actually accepted by the transport. */
  delivered: boolean;
}

/**
 * Decide whether the recipient may receive a passwordless assignment link
 * ({@link mayReceiveAssignmentLink}, D-3), then either:
 *
 * - mint a token and send the letter WITH `magicLink` (`/access/<token>`); or
 * - send the letter WITHOUT one — it falls back to the ordinary login page
 *   and says nothing about why the quick link is absent (`server/email.ts`).
 *
 * A withheld recipient is normal operation, not an error: logged as info,
 * never thrown. Callers only need to resolve the recipient and their e-mail
 * beforehand (decrypt errors are handled by the caller, since the desired
 * response — 400, skip, silent return — differs by call site).
 *
 * The result reports what happened per recipient: whether a link was issued,
 * the link itself (see {@link DeliverAssignmentLinkResult.magicLink}) and
 * whether the transport accepted the letter, so a bulk run can tally failures
 * and offer the operator a one-time export of the links it just minted.
 */
export async function deliverAssignmentLink(
  opts: DeliverAssignmentLinkOptions,
): Promise<DeliverAssignmentLinkResult> {
  const {
    user, email, assignmentId, testId, testTitle, testDescription, dueDate, expiresAt,
  } = opts;
  const revokeExisting = opts.revokeExisting ?? true;

  if (!(await mayReceiveAssignmentLink(user))) {
    logger.info(
      `Assignment link withheld (privileged account) for user ${user.id}, test "${testTitle}"`,
      "assignments",
    );
    const delivered = await sendAssignmentEmail({
      to: email,
      userName: user.name || undefined,
      testId,
      testTitle,
      testDescription,
      dueDate,
    });
    logger.info(`Assignment email sent to ${email} for test "${testTitle}"`, "assignments");
    return { issued: false, delivered };
  }

  if (revokeExisting) {
    await storage.revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId, user.id);
  }

  const raw = randomBytes(32).toString("hex");
  const tokenHash = createHash("sha256").update(raw).digest("hex");
  await storage.createAssignmentAccessToken({
    assignmentId,
    userId: user.id,
    testId,
    tokenHash,
    expiresAt,
  });

  const magicLink = `${appBaseUrl()}/access/${raw}`;
  logger.info(
    `Assignment link generated for user ${user.id}, test "${testTitle}", expires ${expiresAt.toISOString()}`,
    "assignments",
  );

  const delivered = await sendAssignmentEmail({
    to: email,
    userName: user.name || undefined,
    testId,
    testTitle,
    testDescription,
    dueDate,
    magicLink,
  });
  logger.info(`Assignment email sent to ${email} for test "${testTitle}"`, "assignments");

  return { issued: true, magicLink, delivered };
}
