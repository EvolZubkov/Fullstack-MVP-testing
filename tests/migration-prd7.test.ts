/**
 * @module migration-prd7
 * @description Integration tests for migration `003_prd7_test_settings.sql`.
 *
 * The migration is applied inside a transaction together with fixture rows;
 * the transaction is rolled back at the end of every case so the live database
 * remains untouched. Skips automatically if `DATABASE_URL` is not set or the
 * server is unreachable, so the suite stays green on machines without Postgres.
 *
 * Covers (per docs/prd-7-decisions.md §4):
 *   - §4.1: legacy `published=true`  -> `status='published'`
 *   - §4.1: legacy `published=false` -> `status='draft'`
 *   - §4.2: non-empty `start_page_content` -> `content_pages` (intro, no topic, position='before')
 *   - §4.4: `test_sections.required` defaults to `true` for existing rows
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import pg from "pg";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load env from common locations so the suite finds DATABASE_URL automatically.
loadEnv();
loadEnv({ path: resolve(__dirname, "..", ".env") });
loadEnv({ path: resolve(__dirname, "..", "tmp", ".env") });

const MIGRATION_SQL_PATH = resolve(__dirname, "..", "migrations", "003_prd7_test_settings.sql");
const MIGRATION_SQL = readFileSync(MIGRATION_SQL_PATH, "utf-8");

// Migration 004 adds content_pages.kind and backfills it from `type`.
const MIGRATION_004_SQL = readFileSync(
  resolve(__dirname, "..", "migrations", "004_prd1_content_pages_kind.sql"),
  "utf-8",
);

/**
 * Reproduces the historical deploy order for content_pages. Migration 003's
 * legacy INSERT predates the `kind` column (introduced by 004), so against the
 * already-fully-migrated dev DB we temporarily relax `kind` NOT NULL, run 003
 * (the intro row lands with kind = NULL), then run 004 which backfills `kind`
 * from `type` and restores NOT NULL — exactly as it happened at deploy time.
 *
 * @param repeat003 how many times to apply migration 003 (for idempotency checks).
 */
async function applyPrd7ContentPageMigrations(
  client: pg.PoolClient,
  repeat003 = 1,
): Promise<void> {
  await client.query(`ALTER TABLE "content_pages" ALTER COLUMN "kind" DROP NOT NULL`);
  for (let i = 0; i < repeat003; i++) {
    await client.query(MIGRATION_SQL);
  }
  // Migration 004's historical CHECK constraint only allowed the original 5 kinds.
  // The live DB has since gained `start`/`results` (migration 018) and PRD-19
  // `review`/`section-results` (migration 034) rows, which that constraint would
  // reject when re-applied against the whole (committed) table. Widen the kind list
  // in the replayed SQL to the CURRENT valid set so the constraint addition reflects
  // reality — this test verifies migration 003's behaviour, not the kind enumeration.
  const widened004 = MIGRATION_004_SQL.replace(
    /CHECK\s*\(\s*"kind"\s+IN\s*\([^)]*\)\s*\)/i,
    `CHECK ("kind" IN ('start', 'questions', 'router', 'summary', 'results', 'intro', 'info', 'review', 'section-results'))`,
  );
  await client.query(widened004);
}

/**
 * Applies ONLY migration 003 for cases that assert its `tests`/`test_sections`
 * effects (not content_pages). Migration 003's bulk content_pages INSERT predates
 * the `kind` column and runs over the WHOLE tests table, so against the fully-
 * migrated live DB (kind NOT NULL) it would violate the constraint for any existing
 * test that has `start_page_content`. Relaxing NOT NULL inside the rolled-back
 * transaction lets 003 complete without affecting what these cases verify.
 */
async function applyMig003(client: pg.PoolClient): Promise<void> {
  await client.query(`ALTER TABLE "content_pages" ALTER COLUMN "kind" DROP NOT NULL`);
  await client.query(MIGRATION_SQL);
}

const databaseUrl = process.env.DATABASE_URL;
const SUITE = databaseUrl ? describe : describe.skip;

let pool: pg.Pool | null = null;
let dbReachable = false;

beforeAll(async () => {
  if (!databaseUrl) return;
  pool = new pg.Pool({ connectionString: databaseUrl, connectionTimeoutMillis: 5000, max: 2 });
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      dbReachable = true;
    } finally {
      client.release();
    }
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  if (pool) await pool.end();
});

/**
 * Runs `body` against a fresh transaction that is unconditionally rolled back.
 * Ensures the migration's DDL and any inserted fixtures never leak out of the test.
 *
 * Migration 003 re-adds `content_pages_position_check` *without* `'after'`
 * (that value was introduced later by migration 005). On a real dev DB that
 * has already migrated past 005, existing `position = 'after'` rows would
 * fail the constraint when re-applied. Rewrite them to `'after_topic'` inside
 * the transaction so the ADD CONSTRAINT validates; the trailing ROLLBACK
 * restores the original rows. No effect on production data.
 */
async function withRollback(body: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  if (!pool) throw new Error("Pool is not initialized");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    try {
      await client.query(
        `UPDATE "content_pages" SET "position" = 'after_topic' WHERE "position" = 'after'`,
      );
      // Migration 004 re-adds `content_pages_kind_check` with only the original
      // five kinds; the later `start`/`results` system kinds (migration 018) would
      // fail it. Rewrite them to a legacy kind inside this rolled-back transaction
      // so the historical ADD CONSTRAINT validates; ROLLBACK restores them.
      await client.query(
        `UPDATE "content_pages" SET "kind" = 'intro' WHERE "kind" IN ('start', 'results')`,
      );
      await body(client);
    } finally {
      await client.query("ROLLBACK");
    }
  } finally {
    client.release();
  }
}

const FIXTURE_PREFIX = "prd7-mig-test-";

/** Inserts a minimally valid `tests` row using only legacy columns. */
async function insertLegacyTest(
  client: pg.PoolClient,
  opts: { id: string; published: boolean | null; startPageContent?: string | null },
): Promise<void> {
  await client.query(
    `INSERT INTO "tests" ("id", "title", "mode", "show_difficulty_level",
                           "overall_pass_rule_json", "published", "version",
                           "show_correct_answers", "start_page_content",
                           "design_settings_json")
     VALUES ($1, $2, 'standard', true, $3::jsonb, $4, 1, false, $5, '{}'::jsonb)`,
    [
      opts.id,
      `Migration fixture ${opts.id}`,
      JSON.stringify({ type: "percent", value: 70 }),
      opts.published,
      opts.startPageContent ?? null,
    ],
  );
}

SUITE("migration 003_prd7_test_settings", () => {
  it("connects to the database before running cases", () => {
    expect(dbReachable, `DATABASE_URL=${databaseUrl} did not respond to SELECT 1`).toBe(true);
  });

  it("legacy published=true is mapped to status='published'", async () => {
    if (!dbReachable) return;
    await withRollback(async (client) => {
      const id = `${FIXTURE_PREFIX}pub-true`;
      await insertLegacyTest(client, { id, published: true });
      await applyMig003(client);
      const { rows } = await client.query<{ status: string }>(
        `SELECT "status" FROM "tests" WHERE "id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("published");
    });
  });

  it("legacy published=false is mapped to status='draft'", async () => {
    if (!dbReachable) return;
    await withRollback(async (client) => {
      const id = `${FIXTURE_PREFIX}pub-false`;
      await insertLegacyTest(client, { id, published: false });
      await applyMig003(client);
      const { rows } = await client.query<{ status: string }>(
        `SELECT "status" FROM "tests" WHERE "id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].status).toBe("draft");
    });
  });

  it("non-empty start_page_content creates a content_pages 'intro' row without topic", async () => {
    if (!dbReachable) return;
    await withRollback(async (client) => {
      const id = `${FIXTURE_PREFIX}intro`;
      const html = "<p>Welcome to the test</p>";
      await insertLegacyTest(client, { id, published: false, startPageContent: html });
      await applyPrd7ContentPageMigrations(client);
      const { rows } = await client.query<{
        topic_id: string | null;
        position: string;
        mode: string;
        type: string;
        kind: string;
        values_json: { values?: { html?: string } };
      }>(
        `SELECT "topic_id", "position", "mode", "type", "kind", "values_json"
           FROM "content_pages" WHERE "test_id" = $1`,
        [id],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].topic_id).toBeNull();
      expect(rows[0].position).toBe("before");
      expect(rows[0].type).toBe("intro");
      expect(rows[0].kind).toBe("intro"); // backfilled from `type` by migration 004
      expect(rows[0].mode).toBe("html");
      expect(rows[0].values_json?.values?.html).toBe(html);
    });
  });

  it("empty start_page_content does NOT create a content_pages row", async () => {
    if (!dbReachable) return;
    await withRollback(async (client) => {
      const id = `${FIXTURE_PREFIX}empty-intro`;
      await insertLegacyTest(client, { id, published: false, startPageContent: "   " });
      await applyMig003(client);
      const { rowCount } = await client.query(
        `SELECT 1 FROM "content_pages" WHERE "test_id" = $1`,
        [id],
      );
      expect(rowCount).toBe(0);
    });
  });

  it("test_sections.required defaults to true for pre-existing rows", async () => {
    if (!dbReachable) return;
    await withRollback(async (client) => {
      const testId = `${FIXTURE_PREFIX}sections`;
      const sectionId = `${FIXTURE_PREFIX}section-1`;
      await insertLegacyTest(client, { id: testId, published: true });

      // Fetch any topic id so the FK-style varchar column is referentially valid for the test.
      const topicRow = await client.query<{ id: string }>(`SELECT "id" FROM "topics" LIMIT 1`);
      const topicId = topicRow.rows[0]?.id ?? `${FIXTURE_PREFIX}topic-1`;
      if (!topicRow.rows[0]) {
        await client.query(
          `INSERT INTO "topics" ("id", "name") VALUES ($1, $2)`,
          [topicId, "Migration fixture topic"],
        );
      }

      // Insert without `required` so the migration's DEFAULT path is exercised.
      await client.query(
        `INSERT INTO "test_sections" ("id", "test_id", "topic_id", "draw_count")
         VALUES ($1, $2, $3, 5)`,
        [sectionId, testId, topicId],
      );

      await applyMig003(client);

      const { rows } = await client.query<{ required: boolean; time_limit_minutes: number | null; feedback_json: unknown }>(
        `SELECT "required", "time_limit_minutes", "feedback_json"
           FROM "test_sections" WHERE "id" = $1`,
        [sectionId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].required).toBe(true);
      expect(rows[0].time_limit_minutes).toBeNull();
      expect(rows[0].feedback_json).toBeNull();
    });
  });

  it("adds expected new columns and index to tests/test_sections", async () => {
    if (!dbReachable) return;
    await withRollback(async (client) => {
      await applyMig003(client);

      const cols = await client.query<{ table_name: string; column_name: string }>(
        `SELECT table_name, column_name
           FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND (
              (table_name = 'tests' AND column_name IN ('status','telemetry_enabled','feedback_json','flow_policy_json'))
              OR
              (table_name = 'test_sections' AND column_name IN ('required','time_limit_minutes','feedback_json'))
            )`,
      );
      const got = new Set(cols.rows.map((r) => `${r.table_name}.${r.column_name}`));
      for (const expected of [
        "tests.status",
        "tests.telemetry_enabled",
        "tests.feedback_json",
        "tests.flow_policy_json",
        "test_sections.required",
        "test_sections.time_limit_minutes",
        "test_sections.feedback_json",
      ]) {
        expect(got, `missing column ${expected}`).toContain(expected);
      }

      const idx = await client.query<{ indexname: string }>(
        `SELECT indexname FROM pg_indexes
          WHERE schemaname = current_schema()
            AND tablename = 'tests'
            AND indexname = 'tests_status_idx'`,
      );
      expect(idx.rowCount).toBe(1);
    });
  });

  it("does NOT drop legacy columns published / start_page_content", async () => {
    if (!dbReachable) return;
    await withRollback(async (client) => {
      await applyMig003(client);
      const { rows } = await client.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = current_schema()
            AND table_name = 'tests'
            AND column_name IN ('published','start_page_content')`,
      );
      const names = rows.map((r) => r.column_name).sort();
      expect(names).toEqual(["published", "start_page_content"]);
    });
  });

  it("is idempotent: re-applying the migration is safe", async () => {
    if (!dbReachable) return;
    await withRollback(async (client) => {
      const id = `${FIXTURE_PREFIX}idempotent`;
      await insertLegacyTest(client, { id, published: true, startPageContent: "<p>X</p>" });

      // Apply migration 003 twice (the idempotency check), then 004.
      await applyPrd7ContentPageMigrations(client, 2);

      const { rowCount } = await client.query(
        `SELECT 1 FROM "content_pages" WHERE "test_id" = $1 AND "topic_id" IS NULL`,
        [id],
      );
      expect(rowCount).toBe(1);
    });
  });
});
