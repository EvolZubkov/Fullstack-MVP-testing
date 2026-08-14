ALTER TABLE "users" ADD COLUMN "is_external" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;
