ALTER TABLE "test_scenarios" ADD COLUMN "default_points" integer;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "sim_scoring_json" jsonb;