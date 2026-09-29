/**
 * @module scripts/db/migrate
 *
 * Deploy-time schema migration: apply the versioned SQL under `drizzle/` with the
 * migrator built into `drizzle-orm`.
 *
 * WHY not `drizzle-kit migrate`. The CLI's `migrate` is a thin wrapper around this
 * very function (same journal, same ledger, same per-migration transaction), but
 * shipping the CLI made `drizzle-kit` — with its deprecated `@esbuild-kit/*` loaders
 * and `drizzle.config.ts` — a production dependency of the image for one command.
 * The migrator is already inside `drizzle-orm`, which the application needs anyway.
 * It also fixes the CLI's worst habit: a refused CONNECTION made `drizzle-kit` exit
 * 1 with no message at all, while this script prints the driver's own complaint.
 *
 * WHAT IT DECIDES BY. Like the CLI, the migrator applies every journal entry whose
 * `when` is later than `MAX(created_at)` in the ledger — by TIME, not by hash. That
 * is why the deploy runs `reconcile-migration-ledger` first. The ledger location
 * below must stay identical to `migrations` in `drizzle.config.ts`, which the
 * development tooling (`npm run db:migrate`, `drizzle-kit generate`) still uses.
 *
 * Usage (inside the production image, as the deploy does it):
 *   node dist/migrate.cjs
 * Development (same code, TypeScript source):
 *   npx tsx scripts/db/migrate.ts
 */
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, closeDatabaseConnection } from "../../server/db";
import { initConfig } from "../../server/config";
import { loadEnv } from "../../server/config-loader.mjs";
import { describeError, errorCode } from "./db-error";

/** Ledger table name — must match `migrations.table` in `drizzle.config.ts`. */
const MIGRATIONS_TABLE = "__drizzle_migrations";
/** Ledger schema — must match `migrations.schema` in `drizzle.config.ts`. */
const MIGRATIONS_SCHEMA = "drizzle";

/**
 * Number of rows in the ledger, or 0 when the ledger does not exist yet.
 *
 * Used only to report how many migrations a run applied: the migrator itself
 * returns nothing, and «applied 0» on a no-op deploy is the reassuring line.
 */
async function ledgerSize(): Promise<number> {
  try {
    const result = await db.execute(
      sql.raw(`SELECT count(*)::int AS n FROM "${MIGRATIONS_SCHEMA}"."${MIGRATIONS_TABLE}"`),
    );
    return (result as unknown as { rows: Array<{ n: number }> }).rows[0]?.n ?? 0;
  } catch (error) {
    // 42P01 undefined_table / 3F000 invalid_schema_name: a brand-new database.
    const code = errorCode(error);
    if (code === "42P01" || code === "3F000") return 0;
    throw error;
  }
}

/**
 * Apply every pending migration from `<root>/drizzle`.
 *
 * @param root Repository/image root that holds the `drizzle` folder.
 * @returns How many migrations this run applied.
 */
export async function applyMigrations(root = process.cwd()): Promise<number> {
  const before = await ledgerSize();
  await migrate(db, {
    migrationsFolder: path.join(root, "drizzle"),
    migrationsTable: MIGRATIONS_TABLE,
    migrationsSchema: MIGRATIONS_SCHEMA,
  });
  return (await ledgerSize()) - before;
}

/** CLI entry: same shape as the other deploy-time scripts. */
async function main(): Promise<void> {
  loadEnv();
  await initConfig();
  const applied = await applyMigrations();
  console.log(
    applied === 0
      ? "[migrate] schema is up to date — nothing to apply"
      : `[migrate] applied ${applied} migration(s)`,
  );
  await closeDatabaseConnection();
}

// Run on import, so the file works both as the bundled `dist/migrate.cjs` the deploy
// calls and under tsx during development.
main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error("[migrate] failed:", describeError(error));
    process.exit(1);
  });
