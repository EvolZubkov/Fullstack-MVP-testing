-- Э3 UX-аудита аналитики: срезы живут на уровне теста (решение владельца 2026-10-03).
--
-- РАЗРУШАЮЩАЯ миграция. Срез без теста существовать не может — его нельзя ни посчитать, ни
-- открыть, — и такие срезы удаляются (в фильтры не переводятся, решение владельца). Опись
-- 2026-10-03: в dev-БД таких 0; прод проверить чтением перед выкатом:
--   SELECT count(*) FROM analytics_slices WHERE kind = 'slice' AND test_id IS NULL;
-- Затем правило закрепляется ограничением, а уникальность имени разводится по видам записи:
-- у среза — в пределах владельца и теста, у фильтра — в пределах владельца.
DELETE FROM "analytics_slices" WHERE "kind" = 'slice' AND "test_id" IS NULL;--> statement-breakpoint
DROP INDEX "analytics_slices_owner_name_uq";--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_slices_owner_test_name_uq" ON "analytics_slices" USING btree ("created_by","test_id","name") WHERE "analytics_slices"."kind" = 'slice';--> statement-breakpoint
CREATE UNIQUE INDEX "analytics_slices_owner_filter_name_uq" ON "analytics_slices" USING btree ("created_by","name") WHERE "analytics_slices"."kind" = 'filter';--> statement-breakpoint
ALTER TABLE "analytics_slices" ADD CONSTRAINT "analytics_slices_slice_has_test" CHECK ("analytics_slices"."kind" <> 'slice' OR "analytics_slices"."test_id" IS NOT NULL);