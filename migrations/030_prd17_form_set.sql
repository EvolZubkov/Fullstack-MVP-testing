-- PRD-17 / BR-12 (2026-06-25): fixed VARIANTS of question delivery per section.
-- Adds an optional `form_set_json` to `test_sections`. Presence puts the section
-- into "variants mode": one author-curated variant is picked at topic start and
-- delivered whole (the section's draw_count/draw_all/draw_blueprint are then not
-- applied). Absence keeps today's behaviour (uniform draw / tag quotas), so the
-- change is fully backward-compatible — every existing row reads NULL.
--
-- Shape (validated by shared/schema.ts `formSetSchema`):
--   { "forms": [ { "id": "...", "label": "Вариант 1", "questionIds": ["q1", ...] }, ... ] }
--
-- The schema structure is the source of truth (applied via `drizzle-kit push`,
-- npm run db:push). This file documents the change and is safe to run directly:
-- ADD COLUMN IF NOT EXISTS is idempotent and needs no data backfill.

BEGIN;

ALTER TABLE "test_sections" ADD COLUMN IF NOT EXISTS "form_set_json" jsonb;

COMMIT;
