-- One-time baseline for a PRE-EXISTING test-builder database (prod, or a test
-- clone) whose schema was built by the retired `drizzle-kit push` era. Run this
-- ONCE, against such a database, BEFORE its first `drizzle-kit migrate` deploy.
--
-- It records 0000_baseline as already applied so `drizzle-kit migrate` SKIPS it
-- (migrate applies a migration only when its journal `when` is greater than the
-- newest recorded created_at). Without this, migrate would try to CREATE tables
-- that already exist and fail.
--
-- Do NOT run this on a fresh/empty database: there, migrate itself applies 0000
-- to build the schema. Idempotent: the INSERT is skipped if the tracking table
-- already holds any row.
--
-- Precondition: the database's live schema must already match shared/schema.ts
-- (it does if it was kept in sync by `drizzle-kit push`). Verify first — see
-- drizzle/README.md.
--
-- Apply (same connection the deploy uses — DATABASE_URL from /app/.env):
--   docker compose run --rm --no-deps \
--     -v /tmp/baseline-existing-db.sql:/tmp/baseline.sql:ro \
--     --entrypoint sh <project> -c "node script/run-sql.cjs /tmp/baseline.sql"
-- (the file also ships in the image at /app/drizzle/baseline-existing-db.sql).

CREATE SCHEMA IF NOT EXISTS drizzle;

CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
  id SERIAL PRIMARY KEY,
  hash text NOT NULL,
  created_at bigint
);

-- 0000_baseline: created_at = the journal `when` (this is the value migrate
-- compares against; it is what makes 0000 be skipped). hash = sha256 of
-- drizzle/0000_baseline.sql, recorded for parity with what migrate would store.
INSERT INTO drizzle.__drizzle_migrations (hash, created_at)
SELECT
  '3fc039608e92f01127dc741f747c1c68428b8a0d6005bfc5240c6b2430267d74',
  1784322963798
WHERE NOT EXISTS (SELECT 1 FROM drizzle.__drizzle_migrations);
