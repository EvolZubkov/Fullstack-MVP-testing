-- PRD-30 (расширение, спека раздел 14): порядок выдачи становится настройкой ТЕСТА,
-- а настройка темы — переопределением этого умолчания.
ALTER TABLE "test_sections" ALTER COLUMN "question_order" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "test_sections" ALTER COLUMN "question_order" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN "question_order" text DEFAULT 'random' NOT NULL;--> statement-breakpoint
-- FR-18: явный `random` темы был умолчанием колонки, а не выбором автора — гасим его
-- в NULL («как в тесте»). Умолчание теста тоже `random`, поэтому выдача не меняется.
-- Явные `fixed` остаются переопределением.
UPDATE "test_sections" SET "question_order" = NULL WHERE "question_order" = 'random';--> statement-breakpoint
-- PRD-34: колонки защиты от копирования уже живут в shared/schema.ts и в БД —
-- их накатывал легаси-файл migrations/038_prd34_copy_protection.sql мимо журнала
-- drizzle, поэтому diff подхватил их сюда. `IF NOT EXISTS` даёт журналу догнать
-- схему, не ломая базы, где легаси-файл уже отработал.
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "copy_protection" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "protection_watermark" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "tests" ADD COLUMN IF NOT EXISTS "protection_hide_on_blur" boolean DEFAULT false NOT NULL;
