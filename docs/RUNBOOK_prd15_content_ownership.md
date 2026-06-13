# Runbook - выкладка PRD-15 (владение контентом, целостность, публикация)

Порядок включения трека PRD-15 (целостность общего контента, публикация через снапшоты, владение
темами, оценка как свойство теста) с возможностью поэтапного отката. Нормативные документы:
[content-ownership.md](specs/prd-15/content-ownership.md),
[implementation-plan.md](specs/prd-15/implementation-plan.md),
[acceptance-matrix.md](specs/prd-15/acceptance-matrix.md),
[role-model.md](specs/access-control/role-model.md).

## Принцип безопасной выкладки

Все миграции трека (кроме финального удаления колонок оценки - T-40) аддитивны и не меняют
поведение в день включения:

- Целостность (блок A): `created_by` у новых строк, legacy-строки остаются `NULL`.
- Снапшоты (блок B): переходный режим - тест без снапшота доставляется «вживую» по-старому;
  перевод на снапшот происходит при первом действии публикации/переопубликации.
- Владение темами (блок C): `owner_id = NULL`, `visibility = shared` для существующих тем -
  общий пул сохраняется; гранты пусты; инвариант доставки - права на контент не проверяются
  в попытках и SCORM.
- Оценка (блок D): backfill материализует только значения, отличающиеся от системного умолчания;
  эффективная цепочка возвращает ровно то же, что транзитное legacy-звено (`q.points || 1`,
  `q.scoringJson`). Умолчания теста/секции реально вступают в силу только после T-40.

Откат возможен на каждом шаге: код возвращается к предыдущей версии, аддитивные объекты БД можно
оставить.

## Предусловия

- Доступ к БД для применения миграций (`DATABASE_URL`; dev - Docker на `localhost:55432`, см. `.env`).
- Зелёный прогон `npm run check` и `npm test`.
- Применён трек PRD-13 (роли, владелец и гранты тестов) - PRD-15 опирается на `readableTestScope`
  и `canGrantAccess`.
- Резервная копия БД перед прогоном миграций на проде.

## КРИТИЧНО: `drizzle-kit push` НЕДОСТАТОЧЕН для выкладки

`drizzle-kit push` (`npm run db:push`) синхронизирует ТОЛЬКО схему (DDL) и НЕ выполняет
data-миграции из SQL-файлов. Полагаться на один push на БД с данными ОПАСНО по двум причинам:

1. **Потеря данных при дропах.** push дропнет `topic_courses`/`topic_events` и
   `questions.points`/`scoring_json` БЕЗ предшествующего backfill (023 → `feedback_json`,
   027/028 → `test_question_scoring`). Backfill живёт только в SQL-файлах. Если push дропнет
   раньше backfill — рекомендации и нестандартные цены теряются безвозвратно.
2. **Потеря индексов.** Ряд индексов и частичных уникальных ограничений рукописные в миграциях
   (002/004/007/008/009: `content_pages_*`, `question_measurements_*`, `result_variables_*`
   (вкл. partial-unique `one_success_per_test`/`one_completion_per_test`), `scales_test_id_idx`,
   `test_sections_test_id_sort_order_idx`) и НЕ выражены в `shared/schema.ts` (regex-CHECK,
   частичные предикаты). push их не создаёт и при реконсиляции может удалить — деградация
   производительности. Эмпирически: на стенде, поднятом через push, этих индексов НЕТ.

**Канонический механизм выкладки:** прогон нумерованных SQL-файлов через `script/run-sql.cjs`
(`node script/run-sql.cjs <file.sql> [<file.sql> ...]`, читает `DATABASE_URL`, exit ≠ 0 при
ошибке — блокирует пайплайн, поддерживает несколько файлов по порядку). Этот скрипт и предназначен
для data-шагов, которые push не делает. push — ТОЛЬКО как финальная аддитивная синхронизация ПОСЛЕ
прогона SQL, и только если подтверждено, что он не предлагает деструктивных изменений.

Деплой-скрипты `docker/scripts/deploy.sh` и `deploy-test.sh` это УЖЕ ДЕЛАЮТ: в pre-push шаге гоняют
цепочку `016, 023, 024, 026, 027, 028` (deploy-test роли бэкфиллит инлайном) через `run-sql.cjs`
ДО `drizzle-kit push --force`, поэтому push выходит no-op (создание `test_question_scoring` и дропы
уже сделаны корректно с backfill). Раньше прогонялась только `016` — это и был баг (push спрашивал
create/rename `test_question_scoring` и дропнул бы источники без backfill). На push-деплоенной БД
`025` НЕ включают в цепочку (push создаёт `topic_access_grants` уже без `grantee_type`); все
миграции цепочки идемпотентны и защищены гаржами на существование источников (023 — `topic_courses`,
027/028 — `questions.points`), поэтому повторный деплой на уже мигрированной БД — чистый no-op
(проверено).

## Порядок миграций

Файлы `migrations/` применяются последовательно по номеру через `script/run-sql.cjs` (все шаги
идемпотентны: `IF [NOT] EXISTS`, `ON CONFLICT DO NOTHING`, backfill только по NULL/отсутствию).
push — после, и только аддитивно.

| Шаг | Миграция | Блок | Содержание |
| --- | --- | --- | --- |
| 1 | `019_prd15_content_created_by.sql` | A | `created_by` в `topics`/`questions`/`folders`/`test_folders`; индекс `test_sections.topic_id` |
| 2 | `020_prd15_test_snapshots.sql` | B | Таблица `test_snapshots`; пин `attempts.snapshot_id` |
| 3 | `021_prd15_topic_ownership.sql` | C | `topics.owner_id`/`visibility`; таблица `topic_access_grants` |
| 4 | `022_prd15_topic_name_normalized.sql` | C | `topics.name_normalized`; частичный уникальный индекс по владельцу |
| 5 | `023_td02_topic_feedback_json.sql` | TD-02 | `topics.feedback_json` (backfill из плоского `feedback` + курсов/мероприятий) — ОБЯЗАН пройти до шага 6 |
| 6 | `024_td02_drop_topic_courses_events.sql` | TD-02 | Дроп `topic_courses`/`topic_events` (источник - `feedback_json`) |
| 7 | `025_td01_topic_grants_user_only.sql` | TD-01 | Гранты тем - только пользователи (дроп `grantee_type`) |
| 8 | `026_prd15_test_question_scoring.sql` | D | Таблица `test_question_scoring`; `default_points` на тесте и секции |
| 9 | `027_prd15_scoring_backfill.sql` | D | Backfill переопределений, отличающихся от системного умолчания (пин `contentHash`) |
| 10 | `028_prd15_drop_question_scoring_columns.sql` | D (T-40) | Идемпотентный re-backfill (повтор 027) + дроп `questions.points`/`scoring_json`. ОБЯЗАН пройти ДО push |

Замечания по шагам:

- Шаг 4: частичный уникальный индекс по «владелец + нормализованное имя» строится после
  административной выверки дублей (отчёт `GET /api/topics/duplicates`). На общем пуле
  (`owner_id = NULL`) индекс не действует.
- Шаги 5-7 (TD-01/TD-02) - постфактум-решения трека, применяются вместе с блоком C; таблицы
  `topic_courses`/`topic_events` к этому моменту write-dead и read-dead.
- Шаг 9: явный `0` баллов трактуется как системное умолчание (все рантаймы коэрсили `q.points || 1`),
  поэтому в backfill не попадает; реальная нулевая цена выражается переопределением. Сложность не
  бэкфиллится - базовое значение остаётся на вопросе (FR-34).

## Проверка беспотерийности (до/после дропов)

Pre-flight (перед шагами 6 и 10): снять бэкап и зафиксировать счётчики.

```bash
pg_dump -Fc "$DATABASE_URL" -f "backup-$(date +%s).dump"   # хранить >= 30 дней
```

```sql
-- BEFORE: эталонные счётчики
SELECT 'tqs_rows' k, count(*) v FROM test_question_scoring
UNION ALL SELECT 'pairs_need_backfill',
  count(DISTINCT (ts.test_id, q.id)) FROM test_sections ts
  JOIN questions q ON q.topic_id = ts.topic_id
  WHERE q.points NOT IN (0,1) OR q.scoring_json IS NOT NULL
UNION ALL SELECT 'topics_feedback_null_with_legacy',  -- ДОЛЖНО быть 0 перед шагом 6
  count(*) FROM topics t WHERE t.feedback_json IS NULL
    AND (EXISTS(SELECT 1 FROM topic_courses c WHERE c.topic_id=t.id)
      OR EXISTS(SELECT 1 FROM topic_events e WHERE e.topic_id=t.id));
```

Если `topics_feedback_null_with_legacy` > 0 — СТОП: 023 не отработал, дропать `topic_courses`
нельзя. После шага 10:

```sql
-- AFTER: колонки удалены, оценка сохранена, нет сирот/дублей
SELECT count(*) FROM information_schema.columns
  WHERE table_name='questions' AND column_name IN ('points','scoring_json');   -- = 0
SELECT count(*) FROM test_question_scoring;                                     -- >= pairs_need_backfill
SELECT count(*) FROM (SELECT test_id,question_id FROM test_question_scoring
  GROUP BY 1,2 HAVING count(*)>1) d;                                            -- = 0 (нет дублей)
SELECT count(*) FROM test_question_scoring t
  WHERE NOT EXISTS(SELECT 1 FROM tests x WHERE x.id=t.test_id)
     OR NOT EXISTS(SELECT 1 FROM questions q WHERE q.id=t.question_id);         -- = 0 (нет сирот)
```

Авторские переопределения сохраняются: `ON CONFLICT DO NOTHING` не перетирает строку, выставленную
автором (напр. вопрос с `points=2` и override `points=5` в тесте → останется 5). Проверено на
docker-стенде 2026-06-13: `test_question_scoring` 1 → 9 строк, авторский override сохранён,
эффективная оценка идентична до/после.

## Переходный режим снапшотов (блок B)

После шага 2 доставка остаётся живой для тестов без снапшота. Первый снапшот опубликованного теста
создаётся при первом действии публикации или переопубликации (`PATCH /api/tests/:id/status`,
`POST /api/tests/:id/republish-force`). Попытка при старте пиннит версию снапшота
(`attempts.snapshot_id`); доигрывание и оценивание идут по этой версии. Попытки без пина (legacy)
доигрываются по живому контенту. Это позволяет переводить тесты на снапшоты по одному, без общего
простоя.

## Приёмка

Прогнать автотесты трека и сверить [acceptance-matrix.md](specs/prd-15/acceptance-matrix.md):

```bash
npm run check
npm test
npm run lint:md
npm run scorm:sample
npm run scorm:player
```

Точечно проверить: матрицу E-1 - E-13 (блокировки/предупреждения разрушающих операций), инвариант
доставки (отзыв гранта и приватная тема не меняют опубликованный тест и SCORM), паритет golden-
тестов скоринга, round-trip книги Excel с листом «Оценка», эффективные цены и состав выдачи в
SCORM-пакете против снапшота.

## Откат

- Откат приложения: вернуть предыдущую версию кода. Аддитивные объекты БД (шаги 1-8) безопасны при
  откате кода - новые таблицы/нулевые столбцы не влияют на старую логику.
- Снапшоты: при откате кода уже созданные снапшоты остаются в БД; доставка вернётся к живой, если
  откатываемая версия не читает снапшоты. Попытки с пином доиграются корректно после повторного
  наката.
- Backfill оценки (шаг 9): идемпотентен и поведенчески нейтрален; отдельный откат обычно не нужен.
  При необходимости строки `test_question_scoring`, появившиеся из backfill, удаляются - цепочка
  вернётся к чтению `questions.points`/`scoring_json` (пока колонки живы, до T-40).
- Точечный откат по домену: домены независимы; при проблеме правится конкретный роутер/сервис.

## Финальный шаг (T-40, миграция 028) - ВЫПОЛНЕНО 2026-06-13

Удаление `questions.points` и `questions.scoring_json` - НЕОБРАТИМАЯ миграция, выполнена отдельным
релизом после подтверждённого паритета golden-тестами и полным прогоном. Содержание `028`:

1. Идемпотентный re-backfill (повтор `027`) - ловит пары «тест-вопрос», созданные между `027` и
   `028`, чтобы ни одна не потеряла неумолчательную оценку.
2. Дроп колонок `points` / `scoring_json` из `questions`.

Порядок развёртывания: прогнать `028` ДО `drizzle-kit push` (backfill обязан случиться раньше
исчезновения колонок). `028` идемпотентна (шаг 1 - `ON CONFLICT DO NOTHING`, шаг 2 - `IF EXISTS`),
повторный прогон после push безопасен.

Сопутствующие изменения кода (в том же релизе): снято legacy-звено серверной обвязки резолвера
(`server/services/effective-scoring`), `check-answer` без fallback на `question.scoring_json`,
Questions API и standalone-лист «Вопросы» больше не принимают/не эмитят «Балл»/«Цена ответа»
(оценка - только test-scoped лист «Оценка»). Защита инварианта запиненной попытки: до-блок-D
снапшоты грейдятся через синтез override-строк из замороженных `points`/`scoring_json`
(`snapshotDataSource`), поэтому идущие попытки не меняют результат.

После T-40 единственный источник цены и градуировки - `test_question_scoring` плюс умолчания
теста/секции (`tests.default_question_points`, `test_sections.default_points`) и системное
умолчание; умолчания теста/секции теперь действуют (раньше их перекрывало legacy-звено).

### Откат T-40

Дроп колонок необратим по данным. Для отката кода (вернуть предыдущую версию) колонки нужно
воссоздать и восстановить из бэкапа: `ALTER TABLE questions ADD COLUMN points integer NOT NULL
DEFAULT 1; ADD COLUMN scoring_json jsonb;` затем восстановить значения. Поэтому перед `028`
обязателен бэкап и стабильный период. Сами данные оценки не теряются - они в `test_question_scoring`
(backfill), откат влияет лишь на прямое чтение колонок старым кодом.
