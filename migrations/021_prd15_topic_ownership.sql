-- PRD-15 block C, T-25 (2026-06-11): topic ownership and access grants.
--
--   * topics.owner_id  - the topic owner (FR-18). NULL = legacy (admin-managed).
--   * topics.visibility - `private` (owner + grants + admin) or `shared` (all
--     authors may use). New topics are created private; legacy rows are
--     backfilled to `shared` so the bank stays fully visible on day one.
--   * topic_access_grants - per-topic access for a non-owner (user or group),
--     level `use`/`manage`, with the soft-revoke `state` (FR-19/FR-25).
--
-- Behaviour does NOT change on apply (BRC-26): owner stays NULL and visibility
-- defaults to `shared` for every existing topic, so visibility scoping (which
-- ships in later tasks) sees the whole bank as shared until topics are made
-- private. Idempotent. In deployment the schema is applied via `drizzle-kit
-- push`; this file is the manual/historical record.

BEGIN;

ALTER TABLE "topics"
  ADD COLUMN IF NOT EXISTS "owner_id" varchar(36);

ALTER TABLE "topics"
  ADD COLUMN IF NOT EXISTS "visibility" text NOT NULL DEFAULT 'shared';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topics_visibility_check'
  ) THEN
    ALTER TABLE "topics"
      ADD CONSTRAINT "topics_visibility_check"
      CHECK ("visibility" IN ('private', 'shared'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "topic_access_grants" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "topic_id" varchar(36) NOT NULL,
  "grantee_type" text NOT NULL,
  "grantee_id" varchar(36) NOT NULL,
  "access_level" text NOT NULL,
  "state" text NOT NULL DEFAULT 'active',
  "granted_by" varchar(36),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "topic_access_grants_topic_grantee_idx"
  ON "topic_access_grants" ("topic_id", "grantee_type", "grantee_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topic_access_grants_type_check'
  ) THEN
    ALTER TABLE "topic_access_grants"
      ADD CONSTRAINT "topic_access_grants_type_check"
      CHECK ("grantee_type" IN ('user', 'group'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topic_access_grants_level_check'
  ) THEN
    ALTER TABLE "topic_access_grants"
      ADD CONSTRAINT "topic_access_grants_level_check"
      CHECK ("access_level" IN ('use', 'manage'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'topic_access_grants_state_check'
  ) THEN
    ALTER TABLE "topic_access_grants"
      ADD CONSTRAINT "topic_access_grants_state_check"
      CHECK ("state" IN ('active', 'revoked_in_use'));
  END IF;
END $$;

COMMIT;
