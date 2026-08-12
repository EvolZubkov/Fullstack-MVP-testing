-- PRD-7 S13.5 / G47 (2026-05-28): make topic order in a test explicit and
-- author-controlled. Without this, getTestSections() returned rows in
-- implementation-defined order — usually insertion order, but not
-- guaranteed — so topic-drag in the Structure tab had no persistence layer.
--
-- Adds `sort_order` INT NOT NULL DEFAULT 0; backfills existing rows with
-- ROW_NUMBER() per test partitioned by id, so the current (implicit) order
-- is preserved through the deploy.

BEGIN;

ALTER TABLE "test_sections"
  ADD COLUMN IF NOT EXISTS "sort_order" INTEGER NOT NULL DEFAULT 0;

-- Backfill: rank rows by id within each test_id so each test gets a unique
-- 0..N-1 sort_order. Idempotent — re-running on already-populated rows
-- yields the same ranking.
WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY test_id ORDER BY id) - 1 AS rn
  FROM test_sections
)
UPDATE test_sections ts
   SET sort_order = ranked.rn
  FROM ranked
 WHERE ts.id = ranked.id
   AND ts.sort_order <> ranked.rn;

-- Index supports getTestSections(testId) WHERE test_id = ? ORDER BY sort_order.
CREATE INDEX IF NOT EXISTS "test_sections_test_id_sort_order_idx"
  ON "test_sections" ("test_id", "sort_order");

COMMIT;
