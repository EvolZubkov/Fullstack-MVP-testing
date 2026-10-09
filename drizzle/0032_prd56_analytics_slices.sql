CREATE TABLE "analytics_slices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"test_id" varchar(36),
	"conditions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" varchar(36) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "analytics_slices_owner_idx" ON "analytics_slices" USING btree ("created_by");--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_slices_owner_name_uq" ON "analytics_slices" USING btree ("created_by","name");