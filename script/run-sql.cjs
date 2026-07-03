/**
 * @module script/run-sql
 *
 * Minimal SQL-file runner used by the deploy pipeline to apply data migrations
 * that `drizzle-kit push` cannot perform. Push syncs SCHEMA only; it never runs
 * the data steps carried by the SQL migration files — notably the PRD-13 role
 * backfill (migrations/016), which MUST run BEFORE push drops the legacy
 * `users.role` column, or every existing account loses all roles (and the
 * original role cannot be recovered once the column is gone).
 *
 * Plain CommonJS on purpose: it runs directly with `node` inside the production
 * image (built with `npm ci --omit=dev`, so no `tsx`/`esbuild`/`psql`). Depends
 * only on `pg` and `dotenv`, both production dependencies, and reads
 * `DATABASE_URL` exactly like the app and `drizzle.config.ts` do (dotenv ->
 * /app/.env or the process environment).
 *
 * The referenced SQL is expected to be idempotent (`IF NOT EXISTS`, column-
 * existence guards, "insert only when missing"), so re-running a deploy is safe.
 *
 * Accepts ONE OR MORE files, applied in the given order in a single connection
 * (each file is its own transaction via its own BEGIN/COMMIT). The deploy passes
 * the ordered chain of data/destructive migrations that `drizzle-kit push`
 * cannot perform (backfills before drops) so push runs only an additive no-op.
 *
 * Usage: node script/run-sql.cjs <path-to-sql-file> [<more-files> ...]
 */

"use strict";

const fs = require("node:fs");
const { Client } = require("pg");

async function main() {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    console.error("[run-sql] usage: node script/run-sql.cjs <file.sql> [<file.sql> ...]");
    process.exit(1);
  }

  // CommonJS on Node 20 cannot `require` the ESM loader — use dynamic import.
  // Resolve DATABASE_URL through the standard getConfig loader (config maps
  // database.url -> { env: "DATABASE_URL" }, resolved from the loaded env).
  const { loadEnv, loadConfiguration } = await import("../server/config-loader.mjs");
  loadEnv();
  const cfg = await loadConfiguration();
  const connectionString = (cfg.database || {}).url;
  if (!connectionString) {
    console.error("[run-sql] DATABASE_URL is not set");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of files) {
      const sql = fs.readFileSync(file, "utf8");
      // Simple-query protocol: runs the whole file (multiple statements, DO
      // blocks, its own BEGIN/COMMIT) in one round-trip. Files run in order;
      // a failure aborts the run (non-zero exit) so a later DROP never executes
      // after an earlier backfill failed.
      await client.query(sql);
      console.log(`[run-sql] applied: ${file}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(`[run-sql] failed: ${err && err.message ? err.message : String(err)}`);
  process.exit(1);
});
