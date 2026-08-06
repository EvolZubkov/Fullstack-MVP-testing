-- The Developer role (PRD-13 extension).
--
-- A new stored role `developer`: the Author's permission set plus SCORM
-- generation (`tests.export.scorm`) and the design-template registry
-- (`adminTemplates.manage`). The Author loses SCORM generation and keeps the
-- in-service debug run under the new `tests.debug.play` capability.
--
-- Only the DB-side guard changes here: `user_roles.role` is plain text with a
-- CHECK constraint (legacy migration 016) that must now admit the new
-- identifier. The Drizzle `enum` on that column is TS-only and is updated in
-- shared/access/roles.ts, so `generate` sees no schema diff — hence a custom
-- migration.
--
-- No data migration: nobody holds `developer` until an administrator assigns it.
-- Existing authors keep their rows and simply lose the export action.

ALTER TABLE "user_roles"
  DROP CONSTRAINT IF EXISTS "user_roles_role_check";
--> statement-breakpoint
ALTER TABLE "user_roles"
  ADD CONSTRAINT "user_roles_role_check"
  CHECK ("role" IN ('administrator', 'developer', 'author', 'manager', 'learner'));
