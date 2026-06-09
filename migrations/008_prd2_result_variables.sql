-- PRD-2 (2026-06-02): user-defined result variables (показатели результата).
-- Adds the test-scoped, formula-driven `result_variables` table whose values are
-- published to the result.* namespace at attempt completion, plus the
-- `questions.tags` column consumed by result-variable aggregate formulas.
--
-- Mirrors the content_pages convention (migration 002): uuid id, varchar(36)
-- test_id FK to tests(id). The name regex CHECK and the two partial unique
-- indexes (one success / one completion per test) cannot be expressed by the
-- Drizzle schema, so they live here. Idempotent (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS "result_variables" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "test_id"         varchar(36) NOT NULL REFERENCES "tests"("id") ON DELETE CASCADE,
  "name"            text NOT NULL CHECK ("name" ~ '^[a-z][a-z0-9_]{0,63}$'),
  "label"           text NOT NULL,
  "type"            text NOT NULL CHECK ("type" IN ('boolean', 'number', 'string')),
  "formula"         text NOT NULL,
  "show_to_learner" boolean NOT NULL DEFAULT false,
  "scorm_target"    text NOT NULL DEFAULT 'both'
                      CHECK ("scorm_target" IN ('interaction', 'suspend_data', 'both', 'none')),
  "controls_status" text NOT NULL DEFAULT 'none'
                      CHECK ("controls_status" IN ('none', 'success', 'completion')),
  "sort_order"      integer NOT NULL DEFAULT 0,
  "created_at"      timestamp NOT NULL DEFAULT now(),
  "updated_at"      timestamp NOT NULL DEFAULT now(),
  UNIQUE ("test_id", "name")
);

-- At most one boolean result variable may drive success_status per test.
CREATE UNIQUE INDEX IF NOT EXISTS "result_variables_one_success_per_test"
  ON "result_variables" ("test_id") WHERE "controls_status" = 'success';

-- At most one boolean result variable may drive completion_status per test.
CREATE UNIQUE INDEX IF NOT EXISTS "result_variables_one_completion_per_test"
  ON "result_variables" ("test_id") WHERE "controls_status" = 'completion';

-- Supports getResultVariables(testId) WHERE test_id = ? ORDER BY sort_order.
CREATE INDEX IF NOT EXISTS "result_variables_test_id_idx"
  ON "result_variables" ("test_id", "sort_order");

-- PRD-2 §8.2: question tags feed result-variable aggregate formulas; chip input
-- in the question card.
ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "tags" jsonb NOT NULL DEFAULT '[]'::jsonb;

COMMIT;
