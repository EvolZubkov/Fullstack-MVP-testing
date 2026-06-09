-- PRD-11 (2026-06-04): simplify the draw blueprint shape. The mode is now PER-TAG
-- only (strata[i].mode, default "exact"); the topic-level `modeGranularity` and
-- `mode` keys are dropped (see docs/specs/prd-11/tag-draw-quotas.md §3a, FR-03b).
--
-- Migration 011's CHECK validated the removed top-level keys, so it is now stale.
-- Replace it with a guard that only asserts `strata` is an array when a blueprint
-- is present; per-stratum `mode` validity is enforced by Zod (cannot be expressed
-- as a plain SQL CHECK over array elements). Idempotent.
--
-- Stored blueprints from migration 011 (which had modeGranularity/mode) still pass
-- the new constraint; the runtime ignores the extra keys.

BEGIN;

ALTER TABLE "test_sections"
  DROP CONSTRAINT IF EXISTS "test_sections_draw_blueprint_check";

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'test_sections_draw_blueprint_check'
  ) THEN
    ALTER TABLE "test_sections"
      ADD CONSTRAINT "test_sections_draw_blueprint_check"
      CHECK (
        "draw_blueprint_json" IS NULL
        OR jsonb_typeof("draw_blueprint_json" -> 'strata') = 'array'
      );
  END IF;
END $$;

COMMIT;
