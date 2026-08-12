-- PRD-13 (2026-06-07): role-based access control. Introduces the multi-role
-- model and per-test access control:
--   * user_roles        - a user holds a SET of roles (many-to-many);
--   * tests.owner_id     - the owner of a test (a content-role user);
--   * test_access_grants - explicit edit/assign access to a test for non-owners.
--
-- Data migration: each user's legacy users.role is copied into user_roles
-- (author -> administrator to preserve current full access, learner -> learner).
-- The legacy users.role column is kept during the transition and dropped in a
-- later migration; until then it still drives the running app.
--
-- tests.owner_id is left NULL on backfill: during the transition every former
-- author becomes an administrator and sees all tests regardless of owner, so no
-- test is orphaned. Owners are assigned later (once the superadmin exists, or
-- via the admin UI).
--
-- Backward compatible and idempotent: new tables (IF NOT EXISTS), nullable
-- column (IF NOT EXISTS), guarded CHECK constraints, and a backfill that only
-- inserts roles for users that have none yet. In deployment the schema is
-- applied via `drizzle-kit push`; this file is the manual/historical record and
-- carries the data backfill, which push does not perform.

BEGIN;

-- Multi-role membership (PRD-13 section 4.1). `superadmin` is never stored here.
CREATE TABLE IF NOT EXISTS "user_roles" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "user_id" varchar(36) NOT NULL,
  "role" text NOT NULL,
  "granted_by" varchar(36),
  "granted_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "user_roles_user_role_idx"
  ON "user_roles" ("user_id", "role");

-- Per-test access grants (PRD-13 section 6.2).
CREATE TABLE IF NOT EXISTS "test_access_grants" (
  "id" varchar(36) PRIMARY KEY NOT NULL,
  "test_id" varchar(36) NOT NULL,
  "user_id" varchar(36) NOT NULL,
  "access_level" text NOT NULL,
  "granted_by" varchar(36),
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "test_access_grants_test_user_idx"
  ON "test_access_grants" ("test_id", "user_id");

-- Test owner.
ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "owner_id" varchar(36);

-- Guard: role must be a known stored role (the Drizzle enum is not enforced in DB).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'user_roles_role_check'
  ) THEN
    ALTER TABLE "user_roles"
      ADD CONSTRAINT "user_roles_role_check"
      CHECK ("role" IN ('administrator', 'author', 'manager', 'learner'));
  END IF;
END $$;

-- Guard: access level must be one of the two grant kinds.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'test_access_grants_access_level_check'
  ) THEN
    ALTER TABLE "test_access_grants"
      ADD CONSTRAINT "test_access_grants_access_level_check"
      CHECK ("access_level" IN ('edit', 'assign'));
  END IF;
END $$;

-- Backfill: copy each user's legacy role into user_roles. Former authors become
-- administrators to preserve continuity; learners become learners. Only inserts
-- for users that have no role row yet, so re-running is safe.
--
-- Guarded by a column-existence check so the statement is also safe to run AFTER
-- `users.role` has been dropped (migration 017 / `drizzle-kit push`): in that
-- state the column is gone and the block is a no-op instead of failing with
-- "column role does not exist". This is what lets the deploy pipeline apply the
-- backfill on every deploy regardless of whether the column still exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = 'role'
  ) THEN
    INSERT INTO "user_roles" ("id", "user_id", "role", "granted_at")
    SELECT
      gen_random_uuid()::text,
      u."id",
      CASE WHEN u."role" = 'author' THEN 'administrator' ELSE 'learner' END,
      now()
    FROM "users" u
    WHERE NOT EXISTS (
      SELECT 1 FROM "user_roles" ur WHERE ur."user_id" = u."id"
    );
  END IF;
END $$;

COMMIT;
