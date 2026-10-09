-- Несколько показателей могут управлять одним статусом (решение владельца 2026-09-28). Раньше
-- «Ставит «Пройден», когда истина» и «Ставит «Завершён», когда истина» разрешались ровно одному
-- показателю в тесте, и держали это частичные уникальные индексы. Теперь вердикты показателей
-- одного статуса объединяются через ИЛИ (`shared/formula/result-variables.ts` и его копия в пакете
-- `server/scorm/template/app/dsl/formula.js`), и ограничение снимается.
--
-- Данных не трогает: исчезают только индексы. `IF EXISTS` — на случай базы, где их уже нет.
DROP INDEX IF EXISTS "result_variables_one_success_per_test";--> statement-breakpoint
DROP INDEX IF EXISTS "result_variables_one_completion_per_test";
