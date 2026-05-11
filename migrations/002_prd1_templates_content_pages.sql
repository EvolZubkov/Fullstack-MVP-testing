ALTER TABLE "tests"
  ADD COLUMN IF NOT EXISTS "design_settings_json" jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS "templates" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "description" text,
  "version" text NOT NULL,
  "template_api_version" text NOT NULL DEFAULT '1.0',
  "is_builtin" boolean NOT NULL DEFAULT false,
  "is_active" boolean NOT NULL DEFAULT true,
  "manifest" jsonb NOT NULL,
  "preview_path" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "content_pages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "test_id" varchar(36) NOT NULL REFERENCES "tests"("id") ON DELETE CASCADE,
  "topic_id" varchar(36) NOT NULL REFERENCES "topics"("id"),
  "position" text NOT NULL,
  "mode" text NOT NULL DEFAULT 'template',
  "type" text NOT NULL,
  "template_key" text,
  "sort_order" integer NOT NULL DEFAULT 0,
  "values_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "auto_advance" boolean NOT NULL DEFAULT false,
  "auto_advance_delay_ms" integer,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "content_pages_position_check" CHECK ("position" IN ('before_topic', 'after_topic')),
  CONSTRAINT "content_pages_mode_check" CHECK ("mode" IN ('template', 'standard', 'html')),
  CONSTRAINT "content_pages_type_check" CHECK ("type" IN ('intro', 'info', 'summary', 'html'))
);

CREATE INDEX IF NOT EXISTS "content_pages_test_topic_position_sort_idx"
  ON "content_pages" ("test_id", "topic_id", "position", "sort_order");
