ALTER TABLE "result_variables" ADD COLUMN "config_json" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "result_variables" ADD COLUMN "learner_visibility" text DEFAULT 'hidden' NOT NULL;--> statement-breakpoint
ALTER TABLE "scales" ADD COLUMN "learner_visibility" text DEFAULT 'hidden' NOT NULL;--> statement-breakpoint
UPDATE "result_variables" SET "learner_visibility" = 'level_and_value' WHERE "show_to_learner" IS TRUE;--> statement-breakpoint
UPDATE "scales" SET "learner_visibility" = 'level_and_value' WHERE "show_to_learner" IS TRUE;--> statement-breakpoint
ALTER TABLE "result_variables" DROP COLUMN "show_to_learner";--> statement-breakpoint
ALTER TABLE "scales" DROP COLUMN "show_to_learner";
