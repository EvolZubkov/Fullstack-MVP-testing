-- PRD-52 14.8 (owner's decision 2026-10-19): a person may both assign a test and review it.
-- The single unique (test_id, user_id) index allowed one grant per pair, so inviting a manager
-- with `assign` to review replaced that grant. Two slots instead, each unique per pair: the
-- WORKING grant (`edit` | `assign`, still mutually exclusive) and the REVIEW grant. Existing
-- rows fit both indexes as they stand (one row per pair), so no data is moved.
-- DESTRUCTIVE by the dev check (DROP INDEX): `npm run dev` will not apply it to the shared dev
-- DB; run `npm run db:migrate`.
DROP INDEX "test_access_grants_test_user_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "test_access_grants_work_idx" ON "test_access_grants" USING btree ("test_id","user_id") WHERE "test_access_grants"."access_level" <> 'review';--> statement-breakpoint
CREATE UNIQUE INDEX "test_access_grants_review_idx" ON "test_access_grants" USING btree ("test_id","user_id") WHERE "test_access_grants"."access_level" = 'review';