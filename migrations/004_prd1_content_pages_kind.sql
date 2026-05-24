-- PRD-1 §4.3: introduce variant.kind on content_pages.
-- Adds the `kind` column (5-value enum) which determines variant binding rules
-- and lifecycle (system kinds vs user `info` pages). Backfills from the legacy
-- `type` column so existing rows acquire a kind without manual fix-up.
--
-- Anti-goals (per docs/prd-7-decisions.md §1):
--   * `type` column is NOT removed (kept for backward compat in this release).
--   * Existing `content_pages` row identities are preserved.
--
-- Backfill rules:
--   * type = 'intro'   -> kind = 'intro'
--   * type = 'summary' -> kind = 'summary'
--   * type = 'info'    -> kind = 'info'
--   * type = 'html'    -> kind = 'info'   -- html is a render mode (mode='html'), not a kind (PRD-1 §4.3)
--
-- New kind values 'router' and 'questions' do not exist in legacy rows; they
-- appear only on rows the system creates after this migration.

ALTER TABLE "content_pages"
  ADD COLUMN IF NOT EXISTS "kind" text;

UPDATE "content_pages"
   SET "kind" = CASE
                  WHEN "type" = 'intro'   THEN 'intro'
                  WHEN "type" = 'summary' THEN 'summary'
                  WHEN "type" = 'info'    THEN 'info'
                  WHEN "type" = 'html'    THEN 'info'
                  ELSE NULL
                END
 WHERE "kind" IS NULL;

ALTER TABLE "content_pages"
  ALTER COLUMN "kind" SET NOT NULL;

ALTER TABLE "content_pages"
  DROP CONSTRAINT IF EXISTS "content_pages_kind_check";

ALTER TABLE "content_pages"
  ADD CONSTRAINT "content_pages_kind_check"
  CHECK ("kind" IN ('questions', 'router', 'summary', 'intro', 'info'));

-- Filtering index: most reads target rows of a specific kind for one test
-- (e.g., "find the router row for test X"). Adding it cheap up front.
CREATE INDEX IF NOT EXISTS "content_pages_test_kind_idx"
  ON "content_pages" ("test_id", "kind");
