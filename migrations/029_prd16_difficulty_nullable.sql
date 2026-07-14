-- PRD-16 FR-10 (2026-06-16): question difficulty becomes OPTIONAL.
-- Difficulty is a number 0–100; absence (NULL) means «не задано». Existing
-- values are preserved; the column default (50) stays for inserts that omit the
-- field, while the editor can now store an explicit NULL.
--
-- The schema structure is applied via `drizzle-kit push` (shared/schema.ts is the
-- source of truth). This file documents the change and is safe to run directly:
-- DROP NOT NULL is idempotent (a re-run on an already-nullable column is a no-op).
-- No data backfill is needed — current rows keep their numeric values.

BEGIN;

ALTER TABLE "questions" ALTER COLUMN "difficulty" DROP NOT NULL;

COMMIT;
