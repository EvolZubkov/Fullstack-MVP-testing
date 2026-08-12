-- PRD-11 (2026-06-04): tag draw quotas (квоты выдачи по тегам). Adds the optional
-- per-section `draw_blueprint_json` column — a stratified-draw blueprint that
-- guarantees coverage of sub-topics (tags) within a topic's `draw_count` sample.
--
-- NULL = today's uniform draw (shuffle(all).slice(0, draw_count)): existing tests
-- are unaffected (BR-10; PRD-11 FR-02). This is a DELIVERY mechanism, orthogonal
-- to scoring (PRD-10). Sub-topic = a value in questions.tags; no new entity.
--
-- The mode/granularity enum CHECK cannot be expressed by the Drizzle schema, so
-- it lives here. Idempotent (IF NOT EXISTS column, guarded constraint).

BEGIN;

ALTER TABLE "test_sections"
  ADD COLUMN IF NOT EXISTS "draw_blueprint_json" jsonb;

-- Guard: when present, strata is an array and the (optional) mode enums are valid.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'test_sections_draw_blueprint_check'
  ) THEN
    ALTER TABLE "test_sections"
      ADD CONSTRAINT "test_sections_draw_blueprint_check"
      CHECK (
        "draw_blueprint_json" IS NULL
        OR (
          jsonb_typeof("draw_blueprint_json" -> 'strata') = 'array'
          AND COALESCE("draw_blueprint_json" ->> 'modeGranularity', 'uniform') IN ('uniform', 'per_tag')
          AND COALESCE("draw_blueprint_json" ->> 'mode', 'exact') IN ('exact', 'min')
        )
      );
  END IF;
END $$;

COMMIT;
