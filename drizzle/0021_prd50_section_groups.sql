ALTER TABLE "test_sections" ADD COLUMN "group_key" text;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "section_groups_json" jsonb;