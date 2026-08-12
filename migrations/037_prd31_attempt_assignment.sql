-- PRD-31 (2026-08-01): the assignment becomes the unit of access.
-- Adds `attempts.assignment_id` — the assignment an attempt was taken under:
--   * maxAttempts and the new hour interval (barrier B) are counted INSIDE an assignment;
--   * the calendar cooldown (barrier A) gates the FIRST attempt of a NEW assignment.
--
-- Existing rows keep NULL: the link cannot be reconstructed after the fact and must not be
-- guessed. All NULL rows behave as ONE implicit legacy assignment (spec FR-13).
--
-- No foreign key by design — a deleted assignment stops being "current", which is correct.
-- No index by design either: callers load a learner's attempts of one test through the
-- existing (user_id, test_id) index and split them by assignment in memory, so another
-- index on the fastest-growing table would cost writes and buy no reads.
--
-- The schema structure is the source of truth (applied via `drizzle-kit push`, npm run db:push).
-- This file documents the change and is safe to run directly: ADD COLUMN IF NOT EXISTS is idempotent.

BEGIN;

ALTER TABLE "attempts"
  ADD COLUMN IF NOT EXISTS "assignment_id" varchar(36);

COMMIT;
