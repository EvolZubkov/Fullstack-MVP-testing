CREATE TABLE "test_scenarios" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"topic_id" varchar(36) NOT NULL,
	"question_id" varchar(36),
	"title" text,
	"required" boolean DEFAULT true NOT NULL,
	"time_limit_minutes" integer,
	"image_url" text,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX "test_scenarios_topic_id_idx" ON "test_scenarios" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX "test_scenarios_test_id_sort_order_idx" ON "test_scenarios" USING btree ("test_id","sort_order");