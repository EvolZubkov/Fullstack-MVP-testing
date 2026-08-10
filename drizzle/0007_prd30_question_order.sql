ALTER TABLE "questions" ADD COLUMN "order_index" integer;--> statement-breakpoint
ALTER TABLE "test_sections" ADD COLUMN "question_order" text DEFAULT 'random' NOT NULL;