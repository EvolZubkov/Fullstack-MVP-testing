ALTER TABLE "topics" ADD COLUMN "updated_at" timestamp DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "topics_updated_at_idx" ON "topics" USING btree ("updated_at");