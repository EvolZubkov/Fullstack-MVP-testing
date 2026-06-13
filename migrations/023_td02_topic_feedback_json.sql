-- TD-02 r.2 (2026-06-12, variant A, additive): unify topic feedback into one
-- rich `feedback_json` column, mirroring tests/test_sections.
--
--   * topics.feedback_json - { format, text, links (courses), assets (PDF),
--     events } per shared feedbackContentSchema. Backed by the unified topic
--     feedback editor (T-32 Drawer).
--
-- Backfill maps the three legacy sources into one object:
--   * legacy `feedback` text       -> feedback_json.text  (format = plain)
--   * topic_courses (title, url)   -> feedback_json.links (recommended courses)
--   * topic_events  (title)        -> feedback_json.events (url unknown -> omitted)
--
-- This is ADDITIVE only: the legacy `feedback` column and the topic_courses /
-- topic_events tables stay in place and remain the source of truth for delivery
-- (web results, SCORM export, published-test snapshots) until r.3. Nothing about
-- runtime behaviour changes here.
--
-- Idempotent: the column is added IF NOT EXISTS and the backfill only touches
-- rows still NULL. In deployment the schema is applied via `drizzle-kit push`;
-- this file is the manual/historical record.

BEGIN;

ALTER TABLE "topics"
  ADD COLUMN IF NOT EXISTS "feedback_json" jsonb;

-- Guarded on the source tables existing so the file is idempotent AFTER migration
-- 024 has dropped topic_courses/topic_events: the UPDATE's subqueries reference
-- those tables and Postgres plans the whole statement (even though WHERE matches
-- no rows once feedback_json is populated), so an unguarded re-run would error
-- with "relation topic_courses does not exist". plpgsql plans the branch only
-- when entered, so a post-024 re-run is a clean no-op.
DO $$
BEGIN
  IF to_regclass('public.topic_courses') IS NOT NULL THEN
    UPDATE "topics" t
      SET "feedback_json" = jsonb_build_object(
        'format', 'plain',
        'text', COALESCE(t."feedback", ''),
        'links', COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('title', tc."title", 'url', tc."url"))
             FROM "topic_courses" tc WHERE tc."topic_id" = t."id"),
          '[]'::jsonb),
        'assets', '[]'::jsonb,
        'events', COALESCE(
          (SELECT jsonb_agg(jsonb_build_object('title', te."title"))
             FROM "topic_events" te WHERE te."topic_id" = t."id"),
          '[]'::jsonb)
      )
      WHERE t."feedback_json" IS NULL;
  END IF;
END $$;

COMMIT;
