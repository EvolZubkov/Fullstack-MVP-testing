-- Router page position fix (2026-06-30): the router hub is a test-scope
-- («До теста») navigation page (topic_id = NULL) shown before the topics. The
-- lifecycle (server/services/test-settings.ts `positionForKind`) historically
-- materialised it at position 'before_topic' — the same slot as the per-topic
-- `questions` placeholder. But the router runtime seeds the initial page
-- sequence from the test-scope 'before' pages only (PRD-4 v1.1 §4.7,
-- contentFlow.rebuildPageSequence: `contentPagesFor(null, "before")`). A
-- null-topic page at 'before_topic' matches no per-topic loop either, so the
-- hub was orphaned: the flow skipped straight to the questions and the router
-- page never rendered (visible in the in-service debug player / any SCORM
-- export of a router_by_topics test).
--
-- `positionForKind` now returns 'before' for `router`; this migration realigns
-- EXISTING rows so already-created router tests render the hub without a
-- re-save (the lifecycle keeps existing system rows by id and never rewrites
-- their position).
--
-- Idempotent: the predicate only touches router rows not already at 'before',
-- so a re-run changes nothing.

BEGIN;

UPDATE "content_pages"
  SET "position" = 'before', "updated_at" = now()
  WHERE "kind" = 'router'
    AND "position" <> 'before';

COMMIT;
