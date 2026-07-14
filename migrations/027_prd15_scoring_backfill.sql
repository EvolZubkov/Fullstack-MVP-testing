-- PRD-15 block D, T-37 (2026-06-12): backfill of question-side scoring values
-- that DIFFER from the system default into per-test override rows (FR-33,
-- step 1 of 2; step 2 — dropping questions.points / questions.scoring_json —
-- is T-40, a separate release after golden-test parity is confirmed).
--
-- For every (test, question) pair reachable through the test's sections:
--   * points       - materialized only when it differs from the system default.
--     Both 1 (the default) and 0 are skipped: every pre-block-D runtime coerced
--     an explicit 0 to 1 (`q.points || 1`), so 0 was behaviourally the system
--     default; a true zero price is a NEW capability expressed via an override.
--   * scoring_json - materialized verbatim when set (PRD-10 graded config).
--   * difficulty   - NOT backfilled: the base value stays on the question
--     (FR-34); an override appears only when an author sets one.
--   * pinned_content_hash - the question's current contentHash, so later edits
--     to the question mark the materialized override as stale (FR-30).
--
-- Behaviour does NOT change on apply (BRC-26): the effective chain returns for
-- every backfilled pair exactly what the transitional legacy link returned
-- before (override values == legacy values). Note the transitional semantics
-- AFTER apply: editing points in the question card no longer affects tests
-- whose override was materialized — scoring is now a property of the test
-- (this is the block-D target model; the question-card price field is removed
-- by T-39/T-40).
--
-- Idempotent: ON CONFLICT on the (test_id, question_id) unique index skips
-- pairs that already have an override row.

BEGIN;

-- Guarded on the source columns existing so the file is idempotent AFTER T-40
-- (028) has dropped questions.points/scoring_json: the backfill SELECT reads
-- those columns, so an unguarded re-run would error with "column does not
-- exist". plpgsql only plans the branch when entered, so a post-drop re-run is
-- a clean no-op.
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

COMMIT;
