-- Structure rework Phase 1/2: introduce the `start` (test landing) and
-- `results` (final test results) system variant kinds on content_pages.
--
-- Migration 004 created `content_pages_kind_check` allowing only the original
-- five kinds (questions/router/summary/intro/info). The lifecycle now also
-- materialises single test-level `start` and `results` system pages
-- (PRD-1 §4.3: «Стартовый экран» / «Итоги теста»), so the check must accept them.
--
-- Idempotent: drops the constraint if present and re-adds it with the full set.

ALTER TABLE "content_pages"
  DROP CONSTRAINT IF EXISTS "content_pages_kind_check";

ALTER TABLE "content_pages"
  ADD CONSTRAINT "content_pages_kind_check"
  CHECK ("kind" IN ('start', 'questions', 'router', 'summary', 'results', 'intro', 'info'));
