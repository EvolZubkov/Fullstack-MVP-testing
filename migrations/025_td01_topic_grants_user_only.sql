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

DELETE FROM "topic_access_grants" WHERE "grantee_type" = 'group';

DROP INDEX IF EXISTS "topic_access_grants_topic_grantee_idx";

ALTER TABLE "topic_access_grants" DROP COLUMN IF EXISTS "grantee_type";

CREATE UNIQUE INDEX IF NOT EXISTS "topic_access_grants_topic_grantee_idx"
  ON "topic_access_grants" ("topic_id", "grantee_id");

COMMIT;
