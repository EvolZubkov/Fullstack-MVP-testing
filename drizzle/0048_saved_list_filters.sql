CREATE TABLE "saved_list_filters" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"name" text NOT NULL,
	"conditions_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" varchar(36) NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "saved_list_filters_scope_known" CHECK ("saved_list_filters"."scope" IN ('content', 'tests', 'users'))
);
--> statement-breakpoint
ALTER TABLE "saved_list_filters" ADD CONSTRAINT "saved_list_filters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_list_filters_owner_scope_idx" ON "saved_list_filters" USING btree ("created_by","scope");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_list_filters_owner_scope_name_uq" ON "saved_list_filters" USING btree ("created_by","scope","name");