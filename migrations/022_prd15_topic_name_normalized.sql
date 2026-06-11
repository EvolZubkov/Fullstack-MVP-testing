-- PRD-15 block C, T-30 (2026-06-11): topic same-name policy (FR-27).
--
--   * topics.name_normalized - the comparison key (lowercase, collapsed spaces,
--     ё->е). Backs the per-owner uniqueness index and the same-name warning.
--   * topics_owner_name_normalized_idx - PARTIAL unique index: hard uniqueness
--     only within one owner (owner_id IS NOT NULL). Legacy unowned rows are
--     excluded, so cross-owner same names are allowed (warning only, FR-27).
--
-- The backfill expression mirrors shared/topics/naming.ts (trim, collapse inner
-- whitespace, lowercase, ё->е). Idempotent. In deployment the schema is applied
-- via `drizzle-kit push`; this file is the manual/historical record.
--
-- NOTE: the partial unique index assumes no pre-existing duplicate normalized
-- names among OWNED topics (owners are assigned only to topics created after
-- T-25). If a collision exists, resolve it before applying.

BEGIN;

ALTER TABLE "topics"
  ADD COLUMN IF NOT EXISTS "name_normalized" text;

UPDATE "topics"
  SET "name_normalized" =
    btrim(regexp_replace(translate(lower("name"), 'ё', 'е'), '\s+', ' ', 'g'))
  WHERE "name_normalized" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "topics_owner_name_normalized_idx"
  ON "topics" ("owner_id", "name_normalized")
  WHERE "owner_id" IS NOT NULL;

COMMIT;
