ALTER TABLE "scorm_attempts" ADD COLUMN "snapshot_id" varchar(36);--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "forms_json" jsonb;