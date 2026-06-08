-- PRD-13 (2026-06-08), T-10: drop the legacy single-role column `users.role`.
--
-- Roles now live solely in `user_roles` (many-to-many) plus the configuration-
-- derived superadmin (matched by email hash, never stored). The transitional
-- fallback that read `users.role` has been removed from the application
-- (server/services/access.ts), so the column is no longer referenced.
--
-- Precondition: migration 016 has backfilled `user_roles` for every existing
-- user (author -> administrator, learner -> learner). Verify before applying:
--   SELECT count(*) FROM users u
--   WHERE NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id);
-- The result must be 0 (every account has at least one stored role), otherwise
-- those accounts would lose all access once the column is gone.
--
-- This change is irreversible by column drop; roll back by restoring the column
-- and the application version if needed (see docs/RUNBOOK_prd13_rbac.md).

ALTER TABLE users DROP COLUMN IF EXISTS role;
