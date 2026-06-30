-- PRD-19 section-boundary nodes (2026-06-30): replace the legacy per-topic
-- system pages `intro` («Введение раздела») and `summary` («Итоги раздела») with
-- the runtime nodes `review` (обзор / section-finish) and `section-results`
-- (итоги раздела).
--
-- Background: the content-pages lifecycle used to auto-create one `intro` and one
-- `summary` system content_pages row PER TOPIC (server/services/
-- content-pages-lifecycle.ts `planPerTopicOnlyKind`). In the runtime these entered
-- the page-flow as ordinary content pages (server/scorm/.../contentFlow.js):
--   * the empty `intro` rendered as a near-blank page with just a «Далее» button at
--     the start of every section;
--   * the `summary` rendered a second «Итоги раздела» page IN ADDITION to the
--     PRD-19 computed section-results screen — duplicate итоги.
-- PRD-19 contract §3.2 supersedes this: section intro/summary content is authored
-- via the `topic-before`/`topic-after` `info` zones, and the section boundary
-- screens are the system nodes `review` + `section-results` (template-backed,
-- design-selectable, gated by the «возврат к неотвеченным» / `showSectionResults`
-- settings). The planner now creates `review`/`section-results` test-level
-- singletons and no longer creates `intro`/`summary`.
--
-- This migration realigns EXISTING data so already-created tests behave correctly
-- without a re-save. Idempotent: every step guards on the current state, so a
-- re-run changes nothing.

BEGIN;

-- 0) Extend the kind CHECK constraint to admit the new system kinds `review` and
--    `section-results` (migration 018 last set it to the 7-kind set incl. start/
--    results). MUST run before the backfill below so the new-kind INSERTs pass.
--    Drizzle-push DBs carry no such constraint; the DROP IF EXISTS keeps this a
--    no-op there, while numbered-migration deployments get the widened set.
ALTER TABLE "content_pages"
  DROP CONSTRAINT IF EXISTS "content_pages_kind_check";

ALTER TABLE "content_pages"
  ADD CONSTRAINT "content_pages_kind_check"
  CHECK ("kind" IN ('start', 'questions', 'router', 'summary', 'results', 'intro', 'info', 'review', 'section-results'));

-- 1) Remove the legacy auto-created section `intro` («Введение раздела») and
--    `summary` («Итоги раздела») system pages entirely. These produced the phantom
--    «Далее» page at section start and the duplicate «Итоги раздела» page (alongside
--    the computed section-results screen). This matches the result of re-importing a
--    test under the new planner (which no longer creates them), so legacy and
--    freshly-imported tests get the IDENTICAL clean structure. NOTE: any author text
--    typed into these auto-pages is removed — section intro/summary content is now
--    authored as `info` pages in the topic-before/after zones.
DELETE FROM "content_pages"
  WHERE "kind" IN ('intro', 'summary');

-- 3) Backfill the `review` (обзор) singleton design binding for every test that
--    lacks one. All tests currently bind to the built-in `default` template (or
--    fall back to it for kinds their template does not declare), so the default
--    variant key `review.standard` is correct; the next settings-save reconcile
--    rebinds any non-default template that declares its own review variant.
INSERT INTO "content_pages"
  (id, test_id, topic_id, position, mode, type, kind, template_key, sort_order, values_json, auto_advance, created_at, updated_at)
SELECT gen_random_uuid(), t.id, NULL, 'after', 'template', 'info', 'review', 'review.standard', 0, '{}'::jsonb, false, now(), now()
FROM "tests" t
WHERE NOT EXISTS (
  SELECT 1 FROM "content_pages" cp WHERE cp.test_id = t.id AND cp.kind = 'review'
);

-- 4) Backfill the `section-results` (итоги раздела) singleton ONLY for tests with
--    sections (per-topic flow modes) — a flat test has no sections, so no итоги node.
INSERT INTO "content_pages"
  (id, test_id, topic_id, position, mode, type, kind, template_key, sort_order, values_json, auto_advance, created_at, updated_at)
SELECT gen_random_uuid(), t.id, NULL, 'after', 'template', 'summary', 'section-results', 'section-results.standard', 0, '{}'::jsonb, false, now(), now()
FROM "tests" t
WHERE COALESCE(t.flow_policy_json ->> 'mode', 'linear_flat') IN ('linear_by_topics', 'router_by_topics')
  AND NOT EXISTS (
    SELECT 1 FROM "content_pages" cp WHERE cp.test_id = t.id AND cp.kind = 'section-results'
  );

COMMIT;
