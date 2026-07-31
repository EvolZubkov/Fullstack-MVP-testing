-- migrations/036_prd29_measurement_results.sql
-- PRD-29 (2026-07-30): показ шкал и показателей ученику.
--   * result_variables.config_json — толкование показателя: перечень исходов для строковых и
--     булевых, интервалы для числовых. У scales такая колонка уже есть.
--   * learner_visibility на обеих таблицах вместо булева show_to_learner. Средняя позиция
--     («уровень и толкование, без числа») невыразима булевым флагом, а именно она нужна
--     психодиагностике.
--
-- Структура схемы — источник правды (применяется через drizzle-kit). Файл документирует
-- изменение и безопасен при повторном запуске: ADD COLUMN IF NOT EXISTS идемпотентен, а
-- перенос данных выполняется только пока жива старая колонка.

BEGIN;

ALTER TABLE result_variables ADD COLUMN IF NOT EXISTS config_json jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE scales ADD COLUMN IF NOT EXISTS learner_visibility text NOT NULL DEFAULT 'hidden';
ALTER TABLE result_variables ADD COLUMN IF NOT EXISTS learner_visibility text NOT NULL DEFAULT 'hidden';

-- Перенос: false -> hidden (уже значение по умолчанию), true -> level_and_value.
-- Выполняется только пока жива старая колонка, поэтому обёрнут в проверку её наличия:
-- при повторном запуске (колонка уже удалена) блок ничего не делает.
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['scales', 'result_variables'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = current_schema()
        AND table_name = tbl
        AND column_name = 'show_to_learner'
    ) THEN
      EXECUTE format(
        'UPDATE %I SET learner_visibility = ''level_and_value''
           WHERE show_to_learner IS TRUE AND learner_visibility = ''hidden''',
        tbl
      );
    END IF;
  END LOOP;
END $$;

ALTER TABLE scales DROP CONSTRAINT IF EXISTS scales_learner_visibility_check;
ALTER TABLE scales ADD CONSTRAINT scales_learner_visibility_check
  CHECK (learner_visibility IN ('hidden', 'level', 'level_and_value'));
ALTER TABLE result_variables DROP CONSTRAINT IF EXISTS result_variables_learner_visibility_check;
ALTER TABLE result_variables ADD CONSTRAINT result_variables_learner_visibility_check
  CHECK (learner_visibility IN ('hidden', 'level', 'level_and_value'));

ALTER TABLE scales DROP COLUMN IF EXISTS show_to_learner;
ALTER TABLE result_variables DROP COLUMN IF EXISTS show_to_learner;

COMMIT;
