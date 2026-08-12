-- PRD-15 block A, T-05 (2026-06-11): content creation audit and the
-- "where used" index.
--
--   * topics.created_by / questions.created_by / folders.created_by /
--     test_folders.created_by - who created the row (PRD-15 FR-01; BRD
--     BRC-14). Legacy rows stay NULL; the access policy treats NULL-creator
--     content as administrator-managed.
--   * test_sections(topic_id) index - powers getTestsUsingTopic(), the
--     referential-protection lookup behind the draw-feasibility checks
--     (PRD-15 FR-03..FR-05; audit matrix E-1..E-13).
--
-- Behaviour does NOT change on apply (BRC-26): the columns are nullable, no
-- backfill is needed, and no code path reads them until the phase-1 services
-- ship. Idempotent: IF NOT EXISTS on every statement. In deployment the schema
-- is applied via `drizzle-kit push`; this file is the manual/historical record.

BEGIN;

ALTER TABLE "topics"
  ADD COLUMN IF NOT EXISTS "created_by" varchar(36);

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "created_by" varchar(36);

ALTER TABLE "folders"
  ADD COLUMN IF NOT EXISTS "created_by" varchar(36);

ALTER TABLE "test_folders"
  ADD COLUMN IF NOT EXISTS "created_by" varchar(36);

CREATE INDEX IF NOT EXISTS "test_sections_topic_id_idx"
  ON "test_sections" ("topic_id");

COMMIT;
