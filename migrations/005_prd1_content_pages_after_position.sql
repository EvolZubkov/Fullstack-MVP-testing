-- PRD-7 closeout of PRD-1 §4.2: add the test-scope `after` position.
-- The linear_flat «После теста» zone needs an author-page position that is
-- test-scoped (topic_id = NULL) and renders after the questions stream — the
-- mirror of the existing 'before' («До теста») position. Widens the
-- content_pages position CHECK constraint from
-- ('before', 'before_topic', 'after_topic') to add 'after'.
--
-- Anti-goals:
--   * No data is rewritten; existing rows keep their position values.
--   * topic-scoped positions ('before_topic'/'after_topic') are unchanged.
--
-- Idempotent: drops the constraint if present, then re-adds the widened set.

ALTER TABLE "content_pages"
  DROP CONSTRAINT IF EXISTS "content_pages_position_check";

ALTER TABLE "content_pages"
  ADD CONSTRAINT "content_pages_position_check"
  CHECK ("position" IN ('before', 'after', 'before_topic', 'after_topic'));
