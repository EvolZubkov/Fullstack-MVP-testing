-- PRD-3 (2026-06-07): startup template-validation optimization. Adds a cheap
-- source fingerprint (hash of each file's path/size/mtime) so the startup
-- reconcile can skip re-validating templates whose on-disk files are unchanged.
--
-- Backward compatible: nullable column, NULL means "not yet fingerprinted" and
-- forces a one-time validation on the next boot. Idempotent (IF NOT EXISTS).
-- In deployment the schema is applied via `drizzle-kit push`; this file is the
-- manual/historical record.

BEGIN;

ALTER TABLE "templates"
  ADD COLUMN IF NOT EXISTS "source_fingerprint" text;

COMMIT;
