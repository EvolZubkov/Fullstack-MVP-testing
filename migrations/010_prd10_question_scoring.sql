-- PRD-10 (2026-06-04): graded answer scoring (цена ответа). Adds the optional
-- per-question `scoring_json` column — the correctness axis (how many points an
-- answer earns), orthogonal to question_measurements (PRD-5, the scale axis).
--
-- NULL = exact match, sMax = 1: existing questions stay bit-identical
-- (scoring-model §11; PRD-10 FR-02). Stored in its own column, NOT mixed into
-- correct_json which the answer checker parses. Unit identity stays index-based
-- (option index / matching pair / ranking position), consistent with the PRD-5
-- source_key convention — no durable-id migration (PRD-10 OQ-3).
--
-- The `kind` enum CHECK cannot be expressed by the Drizzle schema, so it lives
-- here. Idempotent (IF NOT EXISTS column, guarded constraint).

BEGIN;

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "scoring_json" jsonb;

-- Guard: when present, scoring_json.kind must be one of the known modes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'questions_scoring_json_kind_check'
  ) THEN
    ALTER TABLE "questions"
      ADD CONSTRAINT "questions_scoring_json_kind_check"
      CHECK (
        "scoring_json" IS NULL
        OR ("scoring_json" ->> 'kind') IN ('exact', 'weighted', 'tiered')
      );
  END IF;
END $$;

COMMIT;
