/**
 * @module tests/it/db-harness
 * @description In-process Postgres (pglite) harness for integration tests that
 * exercise the REAL DAL and SQL — transactions, FK cascades, predicate
 * correctness and round-trips — which the mock-based unit suite cannot cover.
 *
 * The schema applied is the production-faithful DDL exported from
 * `shared/schema.ts` (`tests/it/schema.sql`), NOT the `migrations/*.sql` files:
 * the deploy reconciles the database to `schema.ts` via `drizzle-kit push`, so
 * migration-only objects are dropped and running the migrations would test a
 * schema that does not match production.
 *
 * Regenerate the schema after any change to `shared/schema.ts`:
 *   npx drizzle-kit export --sql | grep -v '^DATABASE_URL:' > tests/it/schema.sql
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@shared/schema";

// vitest always runs from the project root; resolve the committed schema from
// there (import.meta.url is not a file URL under the vite transform).
const SCHEMA_SQL = readFileSync(join(process.cwd(), "tests", "it", "schema.sql"), "utf8");

function makeDb(client: PGlite) {
  return drizzle(client, { schema });
}

/** A drizzle instance backed by the in-process pglite database. */
export type TestDb = ReturnType<typeof makeDb>;

export interface Harness {
  db: TestDb;
  client: PGlite;
  /** Truncate every table — fast, isolated reset between test cases. */
  reset(): Promise<void>;
  close(): Promise<void>;
}

/**
 * Spin up a fresh in-memory Postgres, apply the exported schema and return a
 * drizzle instance over it. One harness per test file (`beforeAll`), reset per
 * case (`beforeEach`).
 */
export async function createHarness(): Promise<Harness> {
  const client = new PGlite();
  await client.exec(SCHEMA_SQL);
  const db = makeDb(client);

  const { rows } = await client.query<{ tablename: string }>(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public'",
  );
  const tableList = rows.map((r) => `"${r.tablename}"`).join(", ");

  return {
    db,
    client,
    async reset() {
      if (tableList) {
        await client.exec(`TRUNCATE ${tableList} RESTART IDENTITY CASCADE;`);
      }
    },
    async close() {
      await client.close();
    },
  };
}
