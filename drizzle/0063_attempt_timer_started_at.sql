-- The test-wide countdown starts on the FIRST QUESTION shown, not on «Начать»
-- (`started_at`): intro pages and the router hub before the first topic no longer
-- spend the limit. The server stamps the start once (`startAttemptTimer`), and a
-- reload resumes the clock from it. NULL = the attempt has not reached a question.
ALTER TABLE "attempts" ADD COLUMN "timer_started_at" timestamp;--> statement-breakpoint
-- An attempt left unfinished before this rule was started under the old one: its
-- clock has been running since «Начать». Backfilling `started_at` keeps that clock,
-- so a learner resuming it does not get the full limit back. Finished attempts never
-- read the column and stay NULL.
UPDATE "attempts" SET "timer_started_at" = "started_at" WHERE "finished_at" IS NULL;
