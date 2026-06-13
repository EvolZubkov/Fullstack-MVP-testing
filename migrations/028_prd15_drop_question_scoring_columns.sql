-- PRD-15 block D, T-40 (2026-06-13): drop questions.points / questions.scoring_json.
-- The FINAL step of block D — scoring is now wholly a property of the test
-- (test_question_scoring overrides + test_sections.default_points +
-- tests.default_question_points + the system default "1 point, exact match";
-- shared/scoring/effective-scoring). The question row carries only content.
--
-- This is a SEPARATE, IRREVERSIBLE release, run only after golden-test parity is
-- confirmed (FR-33, BRC-26). Two self-contained steps, in order:
--
--   1. Re-run the migration-027 backfill (idempotent). 027 materialized every
--      (test, question) pair whose question-side points/scoring_json DIFFERED
--      from the system default into a per-test override row. Re-running here
--      catches any test/section created AFTER 027 ran but before this drop, so
--      no (test, question) pair silently loses its non-default scoring. The
--      `points NOT IN (0, 1)` filter preserves the historical coercion: every
--      pre-block-D runtime read `q.points || 1`, so 0 behaved as the system
--      default 1 and is NOT materialized (a true zero price is expressed by an
--      override). ON CONFLICT keeps any author-set override untouched.
--
--   2. Drop the columns. After this the effective-scoring resolver has no
--      `legacy` link to feed (server/services/effective-scoring no longer reads
--      the columns), so test/section defaults finally take effect.
--
-- Snapshots (block B): pre-block-D snapshots froze full question rows with their
-- own points/scoring_json in content_json and no override rows. The snapshot
-- data source (server/services/test-snapshot.ts) now synthesizes overrides from
-- those frozen values when a snapshot has no explicit questionScoring, so pinned
-- attempts grade exactly as before the drop (the 0-change-for-pinned invariant).
-- Their content_json is untouched by this migration.
--
-- In deployment the schema is applied via `drizzle-kit push`; running this file
-- first guarantees the backfill happens BEFORE the columns disappear. Step 1 is
-- idempotent; step 2 uses IF EXISTS so a re-run after push is a no-op.

BEGIN;

-- Step 1: idempotent re-backfill (mirrors migration 027). Guarded on the source
-- columns existing so a re-run AFTER the drop below is a clean no-op (the SELECT
-- reads questions.points/scoring_json; unguarded it would error once dropped).
-- plpgsql plans the branch only when entered.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'questions' AND column_name = 'points') THEN
    INSERT INTO "test_question_scoring"
      ("test_id", "question_id", "points", "scoring_json", "pinned_content_hash")
    SELECT DISTINCT
      ts."test_id",
      q."id",
      CASE WHEN q."points" NOT IN (0, 1) THEN q."points" END,
      q."scoring_json",
      q."content_hash"
    FROM "test_sections" ts
    JOIN "questions" q ON q."topic_id" = ts."topic_id"
    WHERE q."points" NOT IN (0, 1) OR q."scoring_json" IS NOT NULL
    ON CONFLICT ("test_id", "question_id") DO NOTHING;
  END IF;
END $$;

-- Step 2: drop the now-unused question scoring columns.
ALTER TABLE "questions" DROP COLUMN IF EXISTS "points";
ALTER TABLE "questions" DROP COLUMN IF EXISTS "scoring_json";

COMMIT;
