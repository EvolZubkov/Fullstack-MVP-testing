-- PRD-7 schema additions: tests.status, telemetry, feedback_json, flow_policy_json,
-- test_sections (required, time_limit_minutes, feedback_json) and migration of
-- legacy tests.start_page_content into a content_pages 'intro' row.
--
-- Anti-goals (per docs/prd-7-decisions.md §1):
--   * tests.published is NOT removed (only deprecated; backward-compat path).
--   * tests.start_page_content is NOT removed (only deprecated).
--   * Existing content_pages rows are NOT modified.
--
-- Mapping rules (per docs/prd-7-decisions.md §4):
--   * §4.1: published=true -> status='published'; published=false/null -> status='draft'.
--   * §4.2: every test with non-empty start_page_content gets a content_pages row
--           with type='intro', topic_id=NULL, position='before', mode='html'.

-- ─── tests.status ────────────────────────────────────────────────────────────
ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'draft';

ALTER TABLE "tests"
  DROP CONSTRAINT IF EXISTS "tests_status_check";

ALTER TABLE "tests"
  ADD CONSTRAINT "tests_status_check"
  CHECK ("status" IN ('draft', 'published', 'archived'));

UPDATE "tests"
   SET "status" = CASE WHEN COALESCE("published", false) THEN 'published' ELSE 'draft' END;

-- ─── tests.telemetry_enabled / feedback_json / flow_policy_json ──────────────
ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "telemetry_enabled" boolean NOT NULL DEFAULT false;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "feedback_json" jsonb;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "flow_policy_json" jsonb;

-- ─── test_sections additions ────────────────────────────────────────────────
ALTER TABLE "test_sections"
  ADD COLUMN IF NOT EXISTS "required" boolean NOT NULL DEFAULT true;

ALTER TABLE "test_sections"
  ADD COLUMN IF NOT EXISTS "time_limit_minutes" integer;

ALTER TABLE "test_sections"
  ADD COLUMN IF NOT EXISTS "feedback_json" jsonb;

-- ─── tests_status_idx ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "tests_status_idx" ON "tests" ("status");

-- ─── content_pages: relax topic_id and position for start pages ──────────────
-- Start page is a content_pages row without topic_id and with position='before'.
-- Existing rows keep their topic_id and 'before_topic'/'after_topic' positions.
ALTER TABLE "content_pages"
  ALTER COLUMN "topic_id" DROP NOT NULL;

ALTER TABLE "content_pages"
  DROP CONSTRAINT IF EXISTS "content_pages_position_check";

ALTER TABLE "content_pages"
  ADD CONSTRAINT "content_pages_position_check"
  CHECK ("position" IN ('before', 'before_topic', 'after_topic'));

-- ─── Migrate legacy tests.start_page_content -> content_pages('intro') ───────
-- Idempotent: skips tests that already have an intro row without topic_id.
INSERT INTO "content_pages" (
  "id",
  "test_id",
  "topic_id",
  "position",
  "mode",
  "type",
  "template_key",
  "sort_order",
  "values_json",
  "auto_advance",
  "auto_advance_delay_ms"
)
SELECT
  gen_random_uuid(),
  t."id",
  NULL,
  'before',
  'html',
  'intro',
  NULL,
  0,
  jsonb_build_object(
    'values', jsonb_build_object('html', t."start_page_content")
  ),
  false,
  NULL
FROM "tests" t
WHERE t."start_page_content" IS NOT NULL
  AND length(trim(t."start_page_content")) > 0
  AND NOT EXISTS (
    SELECT 1
      FROM "content_pages" cp
     WHERE cp."test_id" = t."id"
       AND cp."type" = 'intro'
       AND cp."topic_id" IS NULL
  );
