-- PRD-50 §16 (FR-53, FR-56).
-- Переключатель «учитывать подтемы в вердикте темы». NOT NULL DEFAULT false: существующие
-- тесты судятся ровно как судились, и включает его только автор.
ALTER TABLE "tests" ADD COLUMN "breakdown_gate_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Индивидуальные пороги подтем отменены владельцем 2026-09-04: порог подтемы производный от
-- порога темы. Вердикта колонка не меняла с 2026-09-03, поэтому её снятие не влияет ни на
-- один сохранённый результат.
ALTER TABLE "test_sections" DROP COLUMN "breakdown_rules_json";
