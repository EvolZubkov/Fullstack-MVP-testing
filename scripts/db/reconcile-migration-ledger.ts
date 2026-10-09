/**
 * @module scripts/db/reconcile-migration-ledger
 *
 * Deploy-time repair step: realign the timestamps in `drizzle.__drizzle_migrations`
 * with `drizzle/meta/_journal.json` so `migrate` (`scripts/db/migrate.ts` on deploy,
 * `drizzle-kit migrate` in development — the same migrator) does not try to apply a
 * migration that is already in the database.
 *
 * WHY this exists. `migrate` decides what to apply by TIME, not by hash: it takes
 * `MAX(created_at)` from the ledger and runs every journal entry whose `when` is
 * greater. So a migration that was REGENERATED or rebased after it had already been
 * applied gets a new `when`, lands «in the future» relative to the ledger, and is
 * applied a second time — failing with `column ... already exists` and aborting the
 * release BEFORE the migrations that actually matter. The drift lives in the
 * DATABASE, so every instance carries its own copy of the problem.
 *
 * That is exactly what happened with `0018_prd28_external_participant` (regenerated
 * during PRD-28): dev could not apply the PRD-50 migrations until its ledger row was
 * realigned by hand. Doing that by hand on every stand is not a deploy — hence this
 * script.
 *
 * WHAT IT DOES, precisely: for every ledger row whose HASH matches a migration file
 * in the journal, it sets `created_at` to that entry's `when`. Nothing else.
 *
 * WHAT IT DELIBERATELY DOES NOT DO: it never INSERTS a row. Marking an unapplied
 * migration as applied would silently skip real DDL — the opposite failure, and a
 * much worse one. A migration that is genuinely missing from the ledger stays
 * missing, and `migrate` applies it as it should.
 *
 * Idempotent: a second run finds nothing to fix and reports 0.
 *
 * Usage (inside the production image, as the deploy does it):
 *   node dist/reconcile-migration-ledger.cjs [--dry-run]
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { db, closeDatabaseConnection } from "../../server/db";
import { initConfig } from "../../server/config";
import { loadEnv } from "../../server/config-loader.mjs";
import { describeError, errorCode } from "./db-error";

/** One journal entry as drizzle-kit writes it. */
interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
}

/** Result of one run, printed as the deploy log line. */
export interface ReconcileReport {
  /** Ledger rows whose hash matched a journal entry. */
  matched: number;
  /** Rows whose `created_at` disagreed with the journal and was realigned. */
  realigned: number;
  /** Human-readable lines about each realignment, for the deploy log. */
  details: string[];
}

/** Ledger location — must match `migrations` in `drizzle.config.ts`. */
const LEDGER = '"drizzle"."__drizzle_migrations"';

/**
 * Realign the ledger with the journal.
 *
 * @param dryRun When set, reports what would change without writing.
 * @param root Repository/image root that holds the `drizzle` folder.
 */
export async function reconcileLedger(dryRun = false, root = process.cwd()): Promise<ReconcileReport> {
  const journalPath = path.join(root, "drizzle", "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: JournalEntry[] };

  // hash -> expected `when`. The hash is what the ledger stores, so it is the only
  // reliable way to tell WHICH migration a row belongs to.
  const expected = new Map<string, JournalEntry>();
  for (const entry of journal.entries) {
    const sql = readFileSync(path.join(root, "drizzle", `${entry.tag}.sql`), "utf8");
    expected.set(createHash("sha256").update(sql).digest("hex"), entry);
  }

  const report: ReconcileReport = { matched: 0, realigned: 0, details: [] };
  const result = await db.execute(sql.raw(`SELECT hash, created_at FROM ${LEDGER} ORDER BY created_at`));
  const ledgerRows = (result as unknown as { rows: Array<{ hash: string; created_at: string }> }).rows;

  for (const row of ledgerRows) {
    const entry = expected.get(row.hash);
    if (!entry) continue; // a row we cannot attribute — left untouched on purpose
    report.matched++;
    if (String(row.created_at) === String(entry.when)) continue;
    report.details.push(`${entry.tag}: ${row.created_at} -> ${entry.when}`);
    report.realigned++;
    if (!dryRun) {
      await db.execute(
        sql`UPDATE "drizzle"."__drizzle_migrations" SET created_at = ${entry.when} WHERE hash = ${row.hash}`,
      );
    }
  }

  return report;
}

/** CLI entry: same shape as the other deploy-time scripts. */
async function main(): Promise<void> {
  loadEnv();
  await initConfig();
  const dryRun = process.argv.includes("--dry-run");
  const report = await reconcileLedger(dryRun);
  const prefix = dryRun ? "[dry-run] " : "";
  if (report.realigned === 0) {
    console.log(`${prefix}ledger in sync with the journal (${report.matched} rows checked)`);
  } else {
    console.log(`${prefix}realigned ${report.realigned} of ${report.matched} ledger rows:`);
    for (const line of report.details) console.log(`  ${line}`);
  }
  await closeDatabaseConnection();
}

// Same shape as the sibling deploy script: run on import, so the file works both as
// the bundled `dist/*.cjs` the deploy calls and under tsx during development.
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    // 42P01 undefined_table: a database that has never been migrated carries no
    // ledger yet. That is the NORMAL state of a brand-new instance, not a failure —
    // reporting it as one trains the reader to ignore this step's output, which is
    // exactly where the real error (a refused connection) then goes unnoticed.
    if (errorCode(error) === "42P01") {
      console.log("[reconcile-migration-ledger] no ledger table yet — nothing to reconcile (new database)");
      process.exit(0);
    }
    console.error("[reconcile-migration-ledger] failed:", describeError(error));
    process.exit(1);
  });
