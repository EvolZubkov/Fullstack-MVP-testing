CREATE TABLE "report_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"mode" text NOT NULL,
	"block" text NOT NULL,
	"template_key" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"values_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"settings_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "report_blocks" ADD CONSTRAINT "report_blocks_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "report_blocks_test_mode_sort_idx" ON "report_blocks" USING btree ("test_id","mode","sort_order");