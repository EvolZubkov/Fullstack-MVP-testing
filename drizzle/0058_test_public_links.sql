CREATE TABLE "test_public_links" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"token" varchar(64) NOT NULL,
	"created_by" varchar(36),
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_public_links" ADD CONSTRAINT "test_public_links_test_id_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."tests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "test_public_links_test_idx" ON "test_public_links" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "test_public_links_token_idx" ON "test_public_links" USING btree ("token");