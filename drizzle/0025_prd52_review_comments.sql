CREATE TABLE "test_review_comments" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"author_id" varchar(36) NOT NULL,
	"parent_id" varchar(36),
	"body" text NOT NULL,
	"anchor_kind" text NOT NULL,
	"question_id" varchar(36),
	"topic_id" varchar(36),
	"content_page_id" uuid,
	"context_label" text,
	"pinned_content_hash" text,
	"status" text,
	"resolved_by" varchar(36),
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "assignment_access_tokens" ALTER COLUMN "assignment_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "assignment_access_tokens" ADD COLUMN "purpose" text DEFAULT 'attempt' NOT NULL;--> statement-breakpoint
ALTER TABLE "test_review_comments" ADD CONSTRAINT "test_review_comments_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_review_comments_test_idx" ON "test_review_comments" USING btree ("test_id","created_at");--> statement-breakpoint
CREATE INDEX "test_review_comments_test_question_idx" ON "test_review_comments" USING btree ("test_id","question_id");--> statement-breakpoint
CREATE INDEX "test_review_comments_parent_idx" ON "test_review_comments" USING btree ("parent_id");