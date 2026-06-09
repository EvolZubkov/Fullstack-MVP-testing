-- PRD-7 S13.5 / G48 (2026-05-28): backfill missing system content_pages rows
-- for tests that pre-date the kind:router variant in the default template.
--
-- Root cause: bindSystemVariant() returned null for kind:router because no
-- built-in template declared one; planSingletonKind silently kept no rows.
-- Result: every test with flow_policy_json->>'mode' = 'router_by_topics'
-- was missing its `content_pages.kind = 'router'` row. Seed-data tests
-- (te-4/te-7 etc.) were missing intro/summary as well, because they were
-- inserted without going through TestSettingsService reconcile.
--
-- The migration is purely additive — it does NOT touch existing rows or
-- their values_json. It seeds rows using the default-template's variant keys
-- (intro.hero / summary.result / router.menu / question.standard). Any test
-- that, on next editor load, resolves a different variant via reconcile will
-- have its template_key rebound automatically; values_json starts as {} so
-- no author content is at risk.
--
-- Idempotent: every INSERT is guarded by NOT EXISTS on the target (test_id,
-- kind, COALESCE(topic_id, '')) tuple.

BEGIN;

-- ── intro (singleton, topic_id = NULL, position = 'before') ────────────────
INSERT INTO content_pages (test_id, topic_id, position, mode, type, kind, template_key, sort_order, values_json)
SELECT t.id, NULL, 'before', 'template', 'intro', 'intro', 'intro.hero', 0, '{}'::jsonb
FROM tests t
WHERE NOT EXISTS (
  SELECT 1 FROM content_pages cp
  WHERE cp.test_id = t.id AND cp.kind = 'intro' AND cp.topic_id IS NULL
);

-- ── summary (singleton, topic_id = NULL, position = 'after_topic') ─────────
INSERT INTO content_pages (test_id, topic_id, position, mode, type, kind, template_key, sort_order, values_json)
SELECT t.id, NULL, 'after_topic', 'template', 'summary', 'summary', 'summary.result', 0, '{}'::jsonb
FROM tests t
WHERE NOT EXISTS (
  SELECT 1 FROM content_pages cp
  WHERE cp.test_id = t.id AND cp.kind = 'summary' AND cp.topic_id IS NULL
);

-- ── router (singleton, only when flow_policy_json.mode = 'router_by_topics') ─
INSERT INTO content_pages (test_id, topic_id, position, mode, type, kind, template_key, sort_order, values_json)
SELECT t.id, NULL, 'before_topic', 'template', 'info', 'router', 'router.menu', 0, '{}'::jsonb
FROM tests t
WHERE t.flow_policy_json->>'mode' = 'router_by_topics'
  AND NOT EXISTS (
    SELECT 1 FROM content_pages cp
    WHERE cp.test_id = t.id AND cp.kind = 'router' AND cp.topic_id IS NULL
  );

-- ── questions per topic (linear_by_topics / router_by_topics) ──────────────
-- One row per (test, topic) when flowMode is per-topic. linear_flat tests get
-- a single topic_id=NULL row in the next block.
INSERT INTO content_pages (test_id, topic_id, position, mode, type, kind, template_key, sort_order, values_json)
SELECT t.id, ts.topic_id, 'before_topic', 'template', 'info', 'questions', 'question.standard', 0, '{}'::jsonb
FROM tests t
JOIN test_sections ts ON ts.test_id = t.id
WHERE t.flow_policy_json->>'mode' IN ('linear_by_topics', 'router_by_topics')
  AND NOT EXISTS (
    SELECT 1 FROM content_pages cp
    WHERE cp.test_id = t.id AND cp.kind = 'questions' AND cp.topic_id = ts.topic_id
  );

-- ── questions flat (linear_flat OR missing flow_policy_json) ───────────────
-- Default flowMode per FR-40 is linear_flat → singleton questions row with
-- topic_id = NULL.
INSERT INTO content_pages (test_id, topic_id, position, mode, type, kind, template_key, sort_order, values_json)
SELECT t.id, NULL, 'before_topic', 'template', 'info', 'questions', 'question.standard', 0, '{}'::jsonb
FROM tests t
WHERE COALESCE(t.flow_policy_json->>'mode', 'linear_flat') = 'linear_flat'
  AND NOT EXISTS (
    SELECT 1 FROM content_pages cp
    WHERE cp.test_id = t.id AND cp.kind = 'questions' AND cp.topic_id IS NULL
  );

COMMIT;
