-- TD-01 (2026-06-12): topic access grants address USERS only. Groups are for
-- test assignment, not content access, so the grantee_type column is removed.
--
--   * delete any group-addressed grants (none in practice — the UI only ever
--     granted to users — but defensive);
--   * drop the (topic, grantee_type, grantee) unique index and the grantee_type
--     column;
--   * recreate the uniqueness on (topic_id, grantee_id).
--
-- Idempotent. In deployment the schema is applied via `drizzle-kit push`; this
-- file is the manual/historical record.

BEGIN;

-- Guarded so the file is idempotent on a push-deployed DB where grantee_type
-- never existed (drizzle-kit push creates topic_access_grants from the post-025
-- schema, sans grantee_type): an unguarded DELETE on a missing column would error.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'topic_access_grants' AND column_name = 'grantee_type') THEN
    DELETE FROM "topic_access_grants" WHERE "grantee_type" = 'group';
  END IF;
END $$;

DROP INDEX IF EXISTS "topic_access_grants_topic_grantee_idx";

ALTER TABLE "topic_access_grants" DROP COLUMN IF EXISTS "grantee_type";

CREATE UNIQUE INDEX IF NOT EXISTS "topic_access_grants_topic_grantee_idx"
  ON "topic_access_grants" ("topic_id", "grantee_id");

COMMIT;
