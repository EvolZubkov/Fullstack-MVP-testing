-- PRD-19 (2026-06-28): test-level flow/navigation settings (Блок A1).
-- Adds three boolean columns to `tests`:
--   * allow_return_to_unanswered — skip a question and return to unanswered ones within an
--     attempt (FR-01). Schema default true (new tests); this migration backfills EXISTING tests
--     to false to preserve their strict-linear navigation.
--   * allow_answer_change — permit changing an already-submitted answer before section/test
--     finish (FR-04a). Default false. Depends on allow_return_to_unanswered=true and is mutually
--     exclusive with show_correct_answers (FR-04b) — enforced in the editor/service layer, not
--     as a DB CHECK (the dependency chain is complex and would block valid transitional states).
--   * show_section_results — show the section-results screen after a section finishes (FR-05a).
--     Default true; not applicable to linear_flat (no sections) and ignored by the runtime there.
--
-- The schema structure is the source of truth (applied via `drizzle-kit push`, npm run db:push).
-- This file documents the change and is safe to run directly: ADD COLUMN IF NOT EXISTS is
-- idempotent; the backfill is keyed on a FIXED date (the migration date), so re-running only
-- ever touches rows created before it — tests created afterwards keep the schema default (true).

BEGIN;

-- ─── allow_return_to_unanswered (FR-01) ──────────────────────────────────────────
ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "allow_return_to_unanswered" boolean NOT NULL DEFAULT true;

-- Backfill: pre-existing tests keep strict-linear navigation (false). Fixed-date predicate
-- ⇒ idempotent (a re-run flips nothing new) and never disables tests created after this migration.
UPDATE "tests"
  SET "allow_return_to_unanswered" = false
  WHERE "created_at" < TIMESTAMP '2026-06-28';

-- ─── allow_answer_change (FR-04a) ────────────────────────────────────────────────
ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "allow_answer_change" boolean NOT NULL DEFAULT false;

-- ─── show_section_results (FR-05a) ───────────────────────────────────────────────
ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "show_section_results" boolean NOT NULL DEFAULT true;

COMMIT;
