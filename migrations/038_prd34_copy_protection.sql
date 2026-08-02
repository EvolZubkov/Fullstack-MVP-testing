-- PRD-34 (2026-08-02): protection of the question text from copying (FR-01, FR-03).
-- Adds three INDEPENDENT boolean columns to `tests` (FR-02 — none of them gates another):
--   * copy_protection      — the five measures over the perimeter. Default TRUE, and
--     EXISTING tests get it too: that is the accepted decision (FR-03), so there is no
--     backfill to false here. An author who needs the text copyable turns it off.
--   * protection_watermark — anonymised mark over the scene (FR-16). Default false.
--   * protection_hide_on_blur — hide the task on focus loss (FR-21). Default false.
--
-- The schema structure is the source of truth (applied via `drizzle-kit`). This file
-- documents the change and is safe to run directly: ADD COLUMN IF NOT EXISTS is idempotent.

BEGIN;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "copy_protection" boolean NOT NULL DEFAULT true;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "protection_watermark" boolean NOT NULL DEFAULT false;

ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "protection_hide_on_blur" boolean NOT NULL DEFAULT false;

COMMIT;
