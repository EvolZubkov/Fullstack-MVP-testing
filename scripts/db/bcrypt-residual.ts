/**
 * @module scripts/db/bcrypt-residual
 * @description Read-only operational report: how many users still carry a legacy
 * bcrypt password hash versus the current scrypt format (PRD-9). It is the DURABLE
 * gate for PRD-9 Этап 3 (removing `bcryptjs`).
 *
 * The in-process `auth.legacy_bcrypt_rehash` counter (see {@link module:server/metrics})
 * resets on restart and only counts migrations since boot, so it CANNOT answer
 * "is any bcrypt hash left?". This script asks the database directly and is the
 * signal Этап 3 should be gated on — never the counter.
 *
 * Lazy rehash-on-login (PRD-9 Этап 2) only migrates users who actually log in, so
 * dormant accounts (never logged in, `pending`, or expired) keep their bcrypt hash
 * forever and will NOT self-drain. The report breaks the residual down by that axis
 * so an operator can decide how to clear it (force a password reset / prune the
 * accounts) before deleting the bcrypt code path. There is NO way to batch-convert
 * bcrypt to scrypt: the plaintext password is required and a bcrypt hash does not
 * contain it.
 *
 * Accounts with NO password at all (external participants, PRD-28) are reported on
 * their own line and kept out of the scrypt/bcrypt split: they carry no hash of
 * either format, so counting them as migrated would overstate the progress.
 *
 * READ-ONLY: issues a single SELECT, writes nothing. Safe to point at production —
 * in fact that is the intended target when deciding whether Этап 3 can proceed.
 *
 * Required environment variables:
 *   - DATABASE_URL   the database to inspect (point it at PROD to gate Этап 3)
 *
 * Usage:
 *   npm run bcrypt:residual
 */

import pg from "pg";
import { loadEnv, loadConfiguration } from "../../server/config-loader.mjs";
import { isLegacyBcryptHash } from "../../server/utils/crypto";

const { Pool } = pg;

/**
 * The columns this report reads from `users` (see `shared/schema.ts`).
 * `password_hash` is nullable: an external participant (PRD-28) has no password at
 * all, and such rows are neither bcrypt nor scrypt — they are counted separately.
 */
interface UserRow {
  status: string;
  password_hash: string | null;
  last_login_at: Date | null;
  expires_at: Date | null;
}

/**
 * Formats a count as a percentage of the total, guarding against divide-by-zero.
 * @param n - The numerator (a subset count).
 * @param total - The total user count.
 * @returns The percentage with one decimal, as a string.
 */
function pct(n: number, total: number): string {
  return total === 0 ? "0.0" : ((n / total) * 100).toFixed(1);
}

/**
 * Classifies every user row, prints the residual report and a go/no-go verdict for
 * PRD-9 Этап 3. Pure formatting — the caller owns the database connection.
 * @param rows - All user rows (status + password hash + activity timestamps).
 */
function report(rows: UserRow[]): void {
  const now = new Date();
  const total = rows.length;
  // PRD-28: passwordless accounts (external participants, and any legacy row with a
  // NULL hash) hold no hash of either format. They must be excluded before the
  // scrypt/bcrypt split — counting them as "on scrypt" would overstate the
  // migration progress that gates PRD-9 Этап 3.
  const passwordless = rows.filter((r) => r.password_hash == null).length;
  const withPassword = rows.filter((r) => r.password_hash != null);
  const legacy = withPassword.filter((r) => isLegacyBcryptHash(r.password_hash));
  const onScrypt = withPassword.length - legacy.length;

  const byStatus = (s: string): number => legacy.filter((r) => r.status === s).length;
  // Dormant on bcrypt: never logged in => the rehash-on-login path never fires, so
  // these accounts will NOT migrate on their own.
  const neverLoggedIn = legacy.filter((r) => r.last_login_at == null).length;
  // Logged in at least once but still on bcrypt => their last login predates the
  // PRD-9 rehash logic; the next successful login migrates them.
  const willMigrateOnLogin = legacy.length - neverLoggedIn;
  const expired = legacy.filter((r) => r.expires_at != null && r.expires_at < now).length;

  console.log("");
  console.log("PRD-9 bcrypt residual (read-only)");
  console.log("---------------------------------");
  console.log(`Users total:          ${total}`);
  console.log(`On scrypt (current):  ${onScrypt} (${pct(onScrypt, total)}%)`);
  console.log(`On bcrypt (legacy):   ${legacy.length} (${pct(legacy.length, total)}%)`);
  console.log(`No password (PRD-28): ${passwordless} (${pct(passwordless, total)}%)`);
  if (passwordless > 0) {
    console.log("  (external participants — no hash of either format, excluded from the split above)");
  }

  if (legacy.length > 0) {
    console.log("");
    console.log("Legacy bcrypt breakdown:");
    console.log(
      `  by status:   active ${byStatus("active")} / ` +
        `pending ${byStatus("pending")} / inactive ${byStatus("inactive")}`,
    );
    console.log(`  never logged in (will NOT self-migrate):    ${neverLoggedIn}`);
    console.log(`  logged in before (migrates on next login):  ${willMigrateOnLogin}`);
    console.log(`  expired accounts (expires_at in the past):  ${expired}`);
  }

  console.log("");
  if (legacy.length === 0) {
    console.log(
      "VERDICT: SAFE — no legacy bcrypt hashes remain. PRD-9 Этап 3 (remove bcryptjs) can proceed.",
    );
  } else if (neverLoggedIn > 0) {
    console.log(
      `VERDICT: HOLD — ${legacy.length} account(s) still on bcrypt; ${neverLoggedIn} will never ` +
        "self-migrate. Force a password reset or prune those accounts before Этап 3.",
    );
  } else {
    console.log(
      `VERDICT: HOLD — ${legacy.length} account(s) still on bcrypt; they migrate as they log in. ` +
        "Re-run until this reaches zero before Этап 3.",
    );
  }
  console.log("");
}

/**
 * Entry point: resolves `DATABASE_URL`, reads the user rows and prints the report.
 * Exits non-zero only on a configuration or database error (a residual > 0 is a
 * normal, expected report, not a failure).
 */
async function main(): Promise<void> {
  loadEnv();
  const cfg = await loadConfiguration();
  const databaseUrl = (cfg.database as { url?: string } | undefined)?.url ?? "";
  if (!databaseUrl) {
    console.error("[bcrypt-residual] DATABASE_URL must be set");
    process.exit(1);
  }

  // Fail fast with a clear error instead of hanging when the database is
  // unreachable — this is an operator tool that may be pointed at any host.
  const pool = new Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  try {
    const { rows } = await pool.query<UserRow>(
      "SELECT status, password_hash, last_login_at, expires_at FROM users",
    );
    report(rows);
  } catch (err) {
    // Pass the whole error: an unreachable host yields an AggregateError (IPv6 + IPv4
    // both refused) whose `.message` is empty, so log the object, not just `.message`.
    console.error("[bcrypt-residual] database error:", err);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

// Exit explicitly. Importing `server/utils/crypto` initializes the pino logger,
// whose transport keeps a worker/handle alive, so the process would not terminate
// on its own after the report. All output is written synchronously before this runs.
main().then(
  () => process.exit(process.exitCode ?? 0),
  (err) => {
    console.error(`[bcrypt-residual] ${(err as Error).message}`);
    process.exit(1);
  },
);
