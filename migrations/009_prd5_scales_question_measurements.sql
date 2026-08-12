-- PRD-5 (2026-06-02): scales and per-question measurement contributions
-- (шкалы и измерительные вклады). Adds the test-scoped `scales` table (named
-- aggregates of contributions, normalized and banded) and the
-- `question_measurements` table (explicit per-unit contributions of a question
-- into a scale). Published to the scale.* namespace at attempt completion,
-- before result.* (PRD-2).
--
-- Mirrors the result_variables convention (migration 008): uuid id, varchar(36)
-- test_id / question_id FKs to the varchar(36) primary keys of tests/questions.
-- The key regex CHECK and the enum CHECKs cannot be expressed by the Drizzle
-- schema, so they live here. Idempotent (IF NOT EXISTS).

BEGIN;

CREATE TABLE IF NOT EXISTS "scales" (
  "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "test_id"         varchar(36) NOT NULL REFERENCES "tests"("id") ON DELETE CASCADE,
  "key"             text NOT NULL CHECK ("key" ~ '^[a-z][a-z0-9_]{0,63}$'),
  "label"           text NOT NULL,
  "description"     text,
  "type"            text NOT NULL CHECK ("type" IN ('number', 'boolean', 'category', 'level')),
  "aggregation"     text NOT NULL DEFAULT 'sum'
                      CHECK ("aggregation" IN ('sum', 'avg', 'weighted_avg', 'max', 'min')),
  "normalization"   text NOT NULL DEFAULT 'none'
                      CHECK ("normalization" IN ('none', 'percent', 'custom')),
  "direction"       text NOT NULL DEFAULT 'positive'
                      CHECK ("direction" IN ('positive', 'inverse')),
  "config_json"     jsonb NOT NULL DEFAULT '{}'::jsonb,
  "show_to_learner" boolean NOT NULL DEFAULT false,
  "scorm_target"    text NOT NULL DEFAULT 'none'
                      CHECK ("scorm_target" IN ('none', 'suspend_data', 'interaction', 'both')),
  "sort_order"      integer NOT NULL DEFAULT 0,
  "created_at"      timestamp NOT NULL DEFAULT now(),
  "updated_at"      timestamp NOT NULL DEFAULT now(),
  UNIQUE ("test_id", "key")
);

-- Supports getScales(testId) WHERE test_id = ? ORDER BY sort_order.
CREATE INDEX IF NOT EXISTS "scales_test_id_idx"
  ON "scales" ("test_id", "sort_order");

CREATE TABLE IF NOT EXISTS "question_measurements" (
  "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "test_id"        varchar(36) NOT NULL REFERENCES "tests"("id") ON DELETE CASCADE,
  "question_id"    varchar(36) NOT NULL REFERENCES "questions"("id") ON DELETE CASCADE,
  "scale_id"       uuid NOT NULL REFERENCES "scales"("id") ON DELETE CASCADE,
  -- The contributing unit: whole question, an answer option, a matching pair or
  -- a ranking position (scoring-model §10.11). `source_key` identifies the unit
  -- (null for source_type='question').
  "source_type"    text NOT NULL
                     CHECK ("source_type" IN ('question', 'option', 'matching_pair', 'ranking_position')),
  "source_key"     text,
  -- Explicit contribution value (jsonb scalar). 0 and negatives are valid; an
  -- absent row means "no contribution". Correctness is orthogonal (§10.2-10.3).
  "value_json"     jsonb NOT NULL,
  "weight"         real NOT NULL DEFAULT 1,
  -- Reserved for conditional contributions (PRD-5 §4.4); null in the first stage.
  "condition_json" jsonb,
  "sort_order"     integer NOT NULL DEFAULT 0,
  "created_at"     timestamp NOT NULL DEFAULT now(),
  "updated_at"     timestamp NOT NULL DEFAULT now()
);

-- getQuestionMeasurements loads by test (matrix) and by question (per-card).
CREATE INDEX IF NOT EXISTS "question_measurements_test_id_idx"
  ON "question_measurements" ("test_id");
CREATE INDEX IF NOT EXISTS "question_measurements_question_id_idx"
  ON "question_measurements" ("question_id");
CREATE INDEX IF NOT EXISTS "question_measurements_scale_id_idx"
  ON "question_measurements" ("scale_id");

COMMIT;
