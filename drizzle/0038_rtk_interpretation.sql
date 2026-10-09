-- Толкование темы и подтемы: текст, который ОБЪЯСНЯЕТ результат, а не советует, что делать.
--
-- Все три колонки nullable: тест, ничего не заполнивший, печатает ровно то же, что печатал.
--   topics.interpretation_json                  — текст самой темы (переиспользуется тестами);
--   test_sections.interpretation_json           — текст ЭТОГО теста, заменяет текст темы целиком;
--   test_sections.breakdown_interpretation_json — тексты подтем (тегов) этого раздела.
--
-- Своя колонка, а не ветвь `*_feedback_json`: та несёт РЕКОМЕНДАЦИЮ со своим правилом выдачи
-- (доля подтемы ниже общего порога теста) и печатается в сводном блоке «Рекомендации», тогда как
-- толкование печатается всегда и стоит при своей теме или своей полосе.
ALTER TABLE "test_sections" ADD COLUMN "interpretation_json" jsonb;--> statement-breakpoint
ALTER TABLE "test_sections" ADD COLUMN "breakdown_interpretation_json" jsonb;--> statement-breakpoint
ALTER TABLE "topics" ADD COLUMN "interpretation_json" jsonb;