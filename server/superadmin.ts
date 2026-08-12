/**
 * @module server/superadmin
 *
 * Runtime superadmin resolution (PRD-13). The configured superadmin emails come
 * from {@link config.access.superadminEmails} (non-secret authorization config);
 * matching is done by SHA-256 email hash — the same hash used by the
 * `users.email_hash` lookup column — because emails are stored encrypted.
 *
 * Read at CALL time (config is populated by initConfig at startup, the DI model),
 * never at import. Superadmin status is computed per request from the cached
 * hashes and never stored in the database or session, so removing an address (and
 * restarting) immediately ends that account's privileges.
 *
 * This lives in its own module rather than in `server/config` so that `config`
 * stays free of application dependencies (it is imported by `logger`, while
 * `hashEmail` transitively imports `logger` — keeping them apart avoids a cycle).
 */

import { hashEmail } from "./utils/crypto";
import { config } from "./config";

/** Configured superadmin emails (normalized). Read from config at call time. */
export function superadminEmails(): readonly string[] {
  return config.access.superadminEmails;
}

let hashes: Set<string> | undefined;

/** SHA-256 hashes of the configured superadmin emails, computed once on demand. */
function getHashes(): Set<string> {
  if (!hashes) {
    hashes = new Set(config.access.superadminEmails.map((email) => hashEmail(email)));
  }
  return hashes;
}

/** Whether the given email hash belongs to a configured superadmin. */
export function isSuperadminEmailHash(emailHash: string | null | undefined): boolean {
  return emailHash != null && getHashes().has(emailHash);
}
