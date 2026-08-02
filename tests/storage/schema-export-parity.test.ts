// @vitest-environment node
/**
 * @module tests/storage/schema-export-parity.test
 *
 * @description Guards `tests/it/schema.sql` — the DDL the pglite harness applies —
 * against falling behind the drizzle schema (`shared/schema.ts`).
 *
 * Why this guard exists: the exported DDL is maintained BY HAND, one edit per
 * migration. When an edit is forgotten the schema itself stays valid, so nothing
 * reports the gap — instead an unrelated DAL test dies deep inside drizzle with
 * `column "..." of relation "..." does not exist`, because drizzle builds its
 * INSERT column list from `schema.ts` while the database was built from the stale
 * file. That has already happened twice: `section_timer_json` (PRD-20, fixed in
 * 7b99d7e) and `attempts.assignment_id` (PRD-31, migration 037).
 *
 * The rule: every table and column declared in `shared/schema.ts` exists in the
 * exported DDL, and the DDL declares nothing the schema does not. Types, defaults
 * and constraints are deliberately NOT compared — the harness only needs the shape
 * the query builder addresses, and a type-level diff would fight pglite's own
 * normalisation without buying a caught bug.
 *
 * Runs in the `node` environment (per-file override) so pglite works under the
 * otherwise-jsdom unit run, and lives under `tests/` (not `tests/it/`) on purpose:
 * the drift breaks the MAIN suite, so the guard must run there too.
 */
import fs from "node:fs";
import path from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";

const SCHEMA_SQL = path.resolve(__dirname, "..", "it", "schema.sql");

/** Column names per table, as the exported DDL actually creates them. */
let exported: Map<string, Set<string>>;
let client: PGlite;

/** Column names per table, as `shared/schema.ts` declares them. */
function declaredTables(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const value of Object.values(schema)) {
    if (!is(value as never, PgTable)) continue;
    const cfg = getTableConfig(value as never);
    out.set(cfg.name, new Set(cfg.columns.map((c) => c.name)));
  }
  return out;
}

beforeAll(async () => {
  client = new PGlite();
  await client.exec(fs.readFileSync(SCHEMA_SQL, "utf8"));
  const { rows } = await client.query<{ table_name: string; column_name: string }>(
    "SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'",
  );
  exported = new Map();
  for (const r of rows) {
    if (!exported.has(r.table_name)) exported.set(r.table_name, new Set());
    exported.get(r.table_name)!.add(r.column_name);
  }
});

afterAll(async () => {
  await client?.close();
});

describe("tests/it/schema.sql tracks shared/schema.ts", () => {
  it("creates every table the schema declares", () => {
    const missing = [...declaredTables().keys()].filter((t) => !exported.has(t)).sort();
    expect(missing, "tables missing from tests/it/schema.sql").toEqual([]);
  });

  it("creates every column the schema declares", () => {
    const missing: string[] = [];
    for (const [table, columns] of declaredTables()) {
      const live = exported.get(table);
      if (!live) continue; // reported by the table spec above
      for (const c of columns) if (!live.has(c)) missing.push(`${table}.${c}`);
    }
    expect(missing.sort(), "columns missing from tests/it/schema.sql").toEqual([]);
  });

  it("creates nothing the schema no longer declares", () => {
    const declared = declaredTables();
    const stale: string[] = [];
    for (const [table, columns] of exported) {
      const expectedCols = declared.get(table);
      if (!expectedCols) {
        stale.push(table);
        continue;
      }
      for (const c of columns) if (!expectedCols.has(c)) stale.push(`${table}.${c}`);
    }
    expect(stale.sort(), "dropped tables/columns still in tests/it/schema.sql").toEqual([]);
  });
});
