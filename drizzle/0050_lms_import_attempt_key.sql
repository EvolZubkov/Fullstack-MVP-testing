-- PRD-54 раздел 8.1 (BR-54-34 - BR-54-37): различитель попыток одного участника за одну дату.
--
-- Ключ импорта был `(test_id, participant_key, started_at)`, а дата активации модуля приходит из
-- выгрузки без времени. Две попытки одного человека в один день склеивались: вторая строка файла
-- молча переписывала первую. `attempt_key` — метка регистрации SCO (`r:...`) или отпечаток
-- содержимого строки с порядковым номером (`c:...:n`).
--
-- Существующие строки остаются с NULL: их содержимое уже переписано, восстановить различитель не из
-- чего. NULL в уникальном индексе не конфликтует ни с чем, а импорт перенимает такую строку при
-- повторной загрузке её файла (BR-54-37) — дублей не возникает.
--
-- РАЗРУШИТЕЛЬНАЯ для параллельных сессий: код до этой миграции делает upsert по трёхколоночному
-- ключу, и после замены индекса его `ON CONFLICT` перестаёт находить ограничение. Поэтому `predev`
-- её не применяет — только `npm run db:migrate`.
ALTER TABLE "scorm_attempts" ADD COLUMN "attempt_key" text;--> statement-breakpoint
DROP INDEX "scorm_attempts_import_row_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "scorm_attempts_import_row_idx" ON "scorm_attempts" USING btree ("test_id","participant_key","started_at","attempt_key") WHERE "scorm_attempts"."origin" = 'import';
