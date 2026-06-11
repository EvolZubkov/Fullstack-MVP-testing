-- PRD-15 block B, T-14 (2026-06-11): publication snapshots.
--
--   * test_snapshots - a frozen, self-contained deliverable of a test, created
--     on publish/republish (FR-10). `content_json` holds the resolved test
--     (sections, per-topic question pools, adaptive config, scales, measurements,
--     result variables, content pages, topic courses/events). `version` is a
--     per-test monotonic counter; one row per (test_id, version).
--   * attempts.snapshot_id - the snapshot an attempt is delivered and graded
--     from (FR-13). NULL = legacy/live delivery (drafts, preview, or attempts
--     started before snapshots existed) — the transitional mode in which a test
--     without a snapshot still plays live.
--
-- Behaviour does NOT change on apply (BRC-26): additive table and nullable
-- column, no backfill. Snapshot creation and snapshot-backed delivery ship in
-- later tasks (T-15/T-16); until a test is (re)published its attempts keep the
-- live path. Idempotent. In deployment the schema is applied via
-- `drizzle-kit push`; this file is the manual/historical record.

BEGIN;

CREATE TABLE IF NOT EXISTS "test_snapshots" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "test_id" varchar(36) NOT NULL,
  "version" integer NOT NULL,
  "content_json" jsonb NOT NULL,
  "published_at" timestamp DEFAULT now() NOT NULL,
  "published_by" varchar(36)
);

CREATE UNIQUE INDEX IF NOT EXISTS "test_snapshots_test_version_idx"
  ON "test_snapshots" ("test_id", "version");

ALTER TABLE "attempts"
  ADD COLUMN IF NOT EXISTS "snapshot_id" varchar(36);

COMMIT;
