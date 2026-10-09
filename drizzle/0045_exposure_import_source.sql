-- PRD-55 FR-08/FR-09: выгрузки LMS пополняют счётчик выдач.
--
-- `question_exposure.source` разделяет два способа пополнения: `live` (веб и телеметрия,
-- инкрементом в момент выдачи) и `import` (выгрузки LMS, ПЕРЕСЧЁТОМ среза теста — повторная
-- загрузка того же файла идемпотентна, и инкремент удвоил бы счётчик). Источник входит в ключ,
-- чтобы пересчёт импорта заменял только свои строки и не трогал живые.
--
-- Порядок шагов ручной: сгенерированная миграция ставила новый ключ раньше, чем появлялась
-- колонка. Существующие строки получают `live` умолчанием — других источников до этой
-- миграции не было.
--
-- `scorm_attempts.delivered_question_ids` — выданный состав импортированного прохождения; из
-- него пересчитывается вклад импорта. У строк, загруженных раньше, поле пусто: их выдачи не
-- известны, и повторная загрузка того же файла его заполнит.
ALTER TABLE "question_exposure" ADD COLUMN "source" text DEFAULT 'live' NOT NULL;--> statement-breakpoint
ALTER TABLE "question_exposure" DROP CONSTRAINT "question_exposure_question_id_test_id_bucket_month_pk";--> statement-breakpoint
ALTER TABLE "question_exposure" ADD CONSTRAINT "question_exposure_question_id_test_id_bucket_month_source_pk" PRIMARY KEY("question_id","test_id","bucket_month","source");--> statement-breakpoint
ALTER TABLE "scorm_attempts" ADD COLUMN "delivered_question_ids" jsonb;
