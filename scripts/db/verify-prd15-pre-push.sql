-- PRD-15 pre-push safety gate. Run via `node scripts/db/run-sql.cjs` AFTER the
-- data-migration chain and BEFORE `drizzle-kit push`. It does NOT change the
-- schema — it asserts the destructive/ambiguous PRD-15 migrations have already
-- taken effect, and RAISES (non-zero exit -> deploy aborts) otherwise.
--
-- Without this gate, if the chain silently did not run (wrong order, an old
-- single-file run-sql that ignored extra args, a new migration missing from the
-- chain), `drizzle-kit push` would face an ambiguous diff: it would prompt
-- "create test_question_scoring vs rename from topic_courses" and, under
-- --force, DROP topic_courses/topic_events and questions.points/scoring_json
-- WITHOUT backfill — losing recommendations and custom scoring. This gate turns
-- that silent data-loss path into a loud, safe failure before push runs.

DO $$
BEGIN
  IF to_regclass('public.test_question_scoring') IS NULL THEN
    RAISE EXCEPTION
      'PRD-15 gate: table test_question_scoring missing -> migration 026 did not run before push. Run migrations 023,024,026,027,028 via scripts/db/run-sql.cjs, then retry. Aborting to avoid data loss.';
  END IF;

  IF to_regclass('public.topic_courses') IS NOT NULL
     OR to_regclass('public.topic_events') IS NOT NULL THEN
    RAISE EXCEPTION
      'PRD-15 gate: topic_courses/topic_events still present -> migrations 023 (backfill) + 024 (drop) did not run before push. Run them via scripts/db/run-sql.cjs, then retry. Aborting to avoid losing recommendations.';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'questions' AND column_name IN ('points', 'scoring_json')) THEN
    RAISE EXCEPTION
      'PRD-15 gate: questions.points/scoring_json still present -> migrations 027 (backfill) + 028 (re-backfill+drop) did not run before push. Run them via scripts/db/run-sql.cjs, then retry. Aborting to avoid losing custom scoring.';
  END IF;

  RAISE NOTICE 'PRD-15 pre-push gate OK: schema already migrated; push will be additive no-op.';
END $$;
