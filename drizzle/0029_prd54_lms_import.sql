CREATE TABLE "lms_import_batches" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"test_id" varchar(36) NOT NULL,
	"group_id" varchar(36),
	"file_name" text NOT NULL,
	"file_hash" text NOT NULL,
	"anonymized" boolean NOT NULL,
	"source_anonymized" boolean NOT NULL,
	"link_users" boolean NOT NULL,
	"imported_by" varchar(36) NOT NULL,
	"imported_at" timestamp DEFAULT now() NOT NULL,
	"rows_total" integer DEFAULT 0 NOT NULL,
	"rows_created" integer DEFAULT 0 NOT NULL,
	"rows_updated" integer DEFAULT 0 NOT NULL,
	"rows_skipped" integer DEFAULT 0 NOT NULL,
	"rows_linked" integer DEFAULT 0 NOT NULL,
	"warnings_json" jsonb
);
--> statement-breakpoint
DROP INDEX "scorm_attempts_session_attempt_idx";--> statement-breakpoint
ALTER TABLE "scorm_answers" ALTER COLUMN "correct_answer_json" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scorm_answers" ALTER COLUMN "is_correct" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scorm_answers" ALTER COLUMN "points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scorm_answers" ALTER COLUMN "max_points" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ALTER COLUMN "package_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ALTER COLUMN "session_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "scorm_answers" ADD COLUMN "result" text DEFAULT 'incorrect' NOT NULL;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "test_id" varchar(36);--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "origin" text DEFAULT 'telemetry' NOT NULL;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "batch_id" varchar(36);--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "group_id" varchar(36);--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "participant_key" text;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "user_id" varchar(36);--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "scales_json" jsonb;--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "variables_json" jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "external_key" text;--> statement-breakpoint
CREATE INDEX "lms_import_batches_test_id_idx" ON "lms_import_batches" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scorm_attempts_import_row_idx" ON "scorm_attempts" USING btree ("test_id","participant_key","started_at") WHERE "scorm_attempts"."origin" = 'import';--> statement-breakpoint
CREATE INDEX "scorm_attempts_test_id_idx" ON "scorm_attempts" USING btree ("test_id");--> statement-breakpoint
CREATE UNIQUE INDEX "scorm_attempts_session_attempt_idx" ON "scorm_attempts" USING btree ("package_id","session_id","attempt_number") WHERE "scorm_attempts"."package_id" IS NOT NULL;--> statement-breakpoint
-- PRD-54. Ниже — то, чего drizzle-kit не генерирует: перенос данных и индекс по выражению.
-- Тест прохождения переезжает на саму попытку. Дальше именно эта колонка отвечает на вопрос
-- «к какому тесту относится прохождение», и аналитике не нужен join через пакет. У части старых
-- пакетов тест уже удалён (scorm_packages.test_id IS NULL) — такие строки остаются с NULL,
-- поэтому колонка и объявлена необязательной.
UPDATE "scorm_attempts" a
   SET "test_id" = p."test_id"
  FROM "scorm_packages" p
 WHERE p."id" = a."package_id" AND a."test_id" IS NULL;--> statement-breakpoint
-- Колонка result добавлена со значением по умолчанию 'incorrect', поэтому доразметить надо только
-- верные ответы. Состояние 'neutral' задним числом не восстановить: до этой миграции измерительный
-- ответ и неверный были в базе неразличимы — это и есть та ошибка, которую миграция закрывает
-- на будущее.
UPDATE "scorm_answers" SET "result" = 'correct' WHERE "is_correct" IS TRUE;--> statement-breakpoint
-- Индекс по выражению: drizzle-kit такие не генерирует. Регистр в ключе не значим, потому что
-- ключом чаще всего оказывается hex-хеш или табельный код.
CREATE UNIQUE INDEX "users_external_key_idx" ON "users" (lower("external_key")) WHERE "external_key" IS NOT NULL;