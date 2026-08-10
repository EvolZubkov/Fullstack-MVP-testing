CREATE TABLE "media_assets" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"byte_size" integer NOT NULL,
	"kind" text NOT NULL,
	"original_name" text NOT NULL,
	"title" text,
	"owner_id" varchar(36),
	"visibility" text DEFAULT 'shared' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media_usages" (
	"asset_id" varchar(36) NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" varchar(36) NOT NULL,
	"field" text NOT NULL,
	CONSTRAINT "media_usages_asset_id_entity_type_entity_id_field_pk" PRIMARY KEY("asset_id","entity_type","entity_id","field")
);
--> statement-breakpoint
ALTER TABLE "media_usages" ADD CONSTRAINT "media_usages_asset_id_media_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."media_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "media_assets_owner_checksum_idx" ON "media_assets" USING btree ("owner_id","checksum");--> statement-breakpoint
CREATE INDEX "media_assets_checksum_idx" ON "media_assets" USING btree ("checksum");--> statement-breakpoint
CREATE INDEX "media_usages_entity_idx" ON "media_usages" USING btree ("entity_type","entity_id");