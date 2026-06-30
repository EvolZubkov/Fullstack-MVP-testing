-- PRD-1 §4.3 «Введение раздела» restore (2026-06-30): the per-topic `intro`
-- system page was wrongly removed by migration 034 (it followed a draft contract
-- that dropped section intro). PRD-1 §4.3 requires it as a per-topic system node
-- shown at the start of each section — topic name / description / question count /
-- time limit (auto) + an author instruction.
--
-- The planner (server/services/content-pages-lifecycle.ts) creates `intro` rows
-- again on the next settings-save. This migration backfills them for EXISTING
-- per-topic tests so the «Введение раздела» row appears without a re-save, bound to
-- the default `intro.standard` variant. Idempotent: the NOT EXISTS guard skips any
-- (test, topic) that already has an intro row. The `kind` CHECK constraint already
-- admits 'intro' (migration 034).

BEGIN;

INSERT INTO "content_pages"
  (id, test_id, topic_id, position, mode, type, kind, template_key, sort_order, values_json, auto_advance, created_at, updated_at)
SELECT gen_random_uuid(), ts.test_id, ts.topic_id, 'before_topic', 'template', 'intro', 'intro', 'intro.standard', 0, '{}'::jsonb, false, now(), now()
FROM "test_sections" ts
JOIN "tests" t ON t.id = ts.test_id
WHERE COALESCE(t.flow_policy_json ->> 'mode', 'linear_flat') IN ('linear_by_topics', 'router_by_topics')
  AND ts.topic_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "content_pages" cp
    WHERE cp.test_id = ts.test_id AND cp.topic_id = ts.topic_id AND cp.kind = 'intro'
  );

COMMIT;
