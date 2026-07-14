-- PRD-15 block D, T-34 (2026-06-12): scoring becomes a property of the test.
--
--   * test_question_scoring - per-(test, question) override of the price,
--     the graded config (PRD-10 scoring_json) and the difficulty (FR-30).
--     Every value column is independently nullable: a NULL link falls through
--     the effective chain (override -> section default -> test default ->
--     system "1 point, exact match"; shared/scoring/effective-scoring).
--     pinned_content_hash is the question's contentHash at authoring time;
--     a mismatch with the current hash marks the override as stale (FR-30).
--   * test_sections.default_points  - per-section default price (FR-31).
--   * tests.default_question_points - test-wide default price (FR-31).
--
-- Behaviour does NOT change on apply (BRC-26): additive table and nullable
-- columns, no backfill here. The runtime keeps reading questions.points /
-- questions.scoring_json through the resolver's transitional `legacy` link
-- until the backfill (migration 027) and the column drop (T-40, a separate
-- release). Idempotent. In deployment the schema is applied via
-- `drizzle-kit push`; this file is the manual/historical record.

BEGIN;

CREATE TABLE IF NOT EXISTS "test_question_scoring" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "test_id" varchar(36) NOT NULL REFERENCES "tests"("id") ON DELETE CASCADE,
  "question_id" varchar(36) NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "points" integer,
  "scoring_json" jsonb,
  "difficulty" integer,
  "pinned_content_hash" text,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "test_question_scoring_test_question_idx"
  ON "test_question_scoring" ("test_id", "question_id");

CREATE INDEX IF NOT EXISTS "test_question_scoring_question_id_idx"
  ON "test_question_scoring" ("question_id");

ALTER TABLE "test_sections"
  ADD COLUMN IF NOT EXISTS "default_points" integer;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "default_question_points" integer;

COMMIT;
