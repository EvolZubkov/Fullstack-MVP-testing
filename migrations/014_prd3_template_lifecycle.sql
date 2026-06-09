-- PRD-3 (2026-06-06): admin lifecycle of SCORM templates. Extends the shared
-- `templates` registry with lifecycle/admin columns so built-in and uploaded
-- templates share one table (NFR-07).
--
-- Backward compatible: every column is nullable or defaulted, so rows synced
-- before this migration (all built-in) read back as an active, builtin source.
-- The `status` and `source_type` enum CHECKs cannot be expressed by the Drizzle
-- schema, so they live here. Idempotent (IF NOT EXISTS columns, guarded checks).

BEGIN;

ALTER TABLE "templates"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "source_type" text NOT NULL DEFAULT 'builtin',
  ADD COLUMN IF NOT EXISTS "source_path" text,
  ADD COLUMN IF NOT EXISTS "validation_json" jsonb,
  ADD COLUMN IF NOT EXISTS "smoke_test_json" jsonb,
  ADD COLUMN IF NOT EXISTS "installed_at" timestamp NOT NULL DEFAULT now();

-- Backfill: pre-existing rows are all built-in. Reflect that explicitly so the
-- source adapter and lifecycle state are consistent with is_builtin/is_active.
UPDATE "templates"
SET "source_type" = 'builtin'
WHERE "is_builtin" = true AND "source_type" IS DISTINCT FROM 'builtin';

UPDATE "templates"
SET "status" = CASE WHEN "is_active" = true THEN 'active' ELSE 'inactive' END
WHERE "is_builtin" = true;

-- Guard: status must be one of the lifecycle FSM states (PRD-3 §5.1).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'templates_status_check'
  ) THEN
    ALTER TABLE "templates"
      ADD CONSTRAINT "templates_status_check"
      CHECK ("status" IN ('draft', 'active', 'inactive', 'invalid'));
  END IF;
END $$;

-- Guard: source_type must be a known source adapter (PRD-3 §6).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'templates_source_type_check'
  ) THEN
    ALTER TABLE "templates"
      ADD CONSTRAINT "templates_source_type_check"
      CHECK ("source_type" IN ('builtin', 'uploaded'));
  END IF;
END $$;

COMMIT;
