-- TD-02 r.3 final (2026-06-12): drop the legacy topic_courses / topic_events
-- tables. Recommended courses/events have been part of topics.feedback_json
-- since migration 023 (backfilled there) and are the single source delivery
-- reads (D2). The tables are write-dead and read-dead; published-test snapshots
-- keep their own copy inside content_json, so dropping the tables affects
-- neither live delivery nor frozen snapshots.
--
-- Destructive but safe: the data was migrated into feedback_json in 023.
-- Idempotent (IF EXISTS). In deployment the schema is applied via
-- `drizzle-kit push`; this file is the manual/historical record.

BEGIN;

DROP TABLE IF EXISTS "topic_courses";
DROP TABLE IF EXISTS "topic_events";

COMMIT;
