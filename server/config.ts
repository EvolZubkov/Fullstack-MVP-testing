/**
 * @module server/config
 *
 * Typed access to the environment configuration the access control layer needs
 * (PRD-13). Superadmins are defined by the `SUPERADMIN_EMAILS` variable
 * (comma-separated). The list is read once at startup; superadmin status is then
 * computed per request from the cached email hashes and is never stored in the
 * database or the session, so removing an address (and restarting) immediately
 * ends that account's superadmin privileges (role-model.md section 8, variant A).
 *
 * Emails are stored encrypted in the database, so matching is done by SHA-256
 * email hash (the same hash used by the `users.email_hash` lookup column).
 */

import { hashEmail } from "./utils/crypto";

/** Parse a comma-separated env list into normalized, de-duplicated entries. */
function parseEmailList(raw: string | undefined): string[] {
  if (!raw) return [];
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return Array.from(seen);
}

/** Configured superadmin emails (normalized). Empty when the variable is unset. */
export const SUPERADMIN_EMAILS: readonly string[] = parseEmailList(process.env.SUPERADMIN_EMAILS);

/** Precomputed hashes for matching against the encrypted `users` table. */
const SUPERADMIN_EMAIL_HASHES = new Set(SUPERADMIN_EMAILS.map((email) => hashEmail(email)));

/** Whether the given email hash belongs to a configured superadmin. */
export function isSuperadminEmailHash(emailHash: string | null | undefined): boolean {
  return emailHash != null && SUPERADMIN_EMAIL_HASHES.has(emailHash);
}
