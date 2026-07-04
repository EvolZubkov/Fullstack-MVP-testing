# Реконсиляция констрейнтов корректности схемы

**Версия:** 1.0
**Статус:** К выполнению
**Дата:** 2026-07-04
**Связано:** [PLAN_storage_refactor.md](./PLAN_storage_refactor.md) раздел 4.1
(находка при добавлении индексов).

## 1. Находка

Источник истины по структуре БД в проекте — `schema.ts` (`drizzle-kit push`
синхронизирует БД под него; SQL-миграции несут только data-шаги). Объекты БД,
объявленные ТОЛЬКО в SQL-миграциях и не отражённые в `schema.ts`, при
последующем `push` не создаются / сносятся. Помимо индексов (устранено в
разделе 4.1 storage-плана) это затронуло объекты **корректности**: в живой
dev-БД отсутствуют ВСЕ CHECK-констрейнты миграций 001-013 и обе партиальные
unique-контроллеры result-переменных.

Проверка на dev-БД (`test-builder-db`, `localhost:55432`): `pg_constraint`
contype='c' — пусто; индексы `result_variables_one_*` — отсутствуют.

Следствие: инварианты, которые эти объекты гарантировали на уровне БД, сейчас
держатся только прикладной валидацией (Zod на API, TS-enum в Drizzle). Прямой
SQL, импорт в обход API или дефект валидации ничем не ограничены; ключевой
бизнес-инвариант «не более одного контроллера success/completion на тест» не
гарантирован вовсе.

## 2. Область (что отсутствует)

**Статус реализации (2026-07-04): раздел 2.1 РЕАЛИЗОВАН на dev.** Объявлено в
`schema.ts` через `check()` / `uniqueIndex().where()`, применено `db:push`
(dev-таблицы `result_variables`/`scales` пусты — ALTER безопасен), покрыто
интеграционным тестом `tests/it/result-variable-constraints.it.test.ts` (дубль
контроллера / дубль имени / невалидный идентификатор отклоняются). ОСТАЁТСЯ:
скан нарушений на проде ДО выкатки (раздел 4, шаг 1) и раздел 2.2 (опционально).

### 2.1. Высокий приоритет — настоящая корректность

| Объект | Инвариант | Механизм в `schema.ts` |
| --- | --- | --- |
| `result_variables_one_success_per_test` | UNIQUE `(test_id)` WHERE `controls_status='success'` — не более одного контроллера success на тест | `uniqueIndex(...).on(testId).where(sql...)` |
| `result_variables_one_completion_per_test` | то же для `completion` | `uniqueIndex(...).on(testId).where(sql...)` |
| `result_variables_test_id_name_uq` | UNIQUE `(test_id, name)` — нет дублей имён показателей в тесте (имя адресуется `var()`) | `uniqueIndex(...).on(testId, name)` |
| `scales_test_id_key_uq` | UNIQUE `(test_id, key)` — нет дублей ключей шкал в тесте | `uniqueIndex(...).on(testId, key)` |
| `result_variables.name` | regex `^[a-z][a-z0-9_]{0,63}$` (имя используется в формулах/DSL) | `check(...)` |
| `scales.key` | regex `^[a-z][a-z0-9_]{0,63}$` (ключ используется в формулах/DSL) | `check(...)` |

Без контроллеров тест может получить два success-контроллера -> неоднозначный
`cmi.success_status`. Natural-unique `(test_id, name)`/`(test_id, key)` тоже были
объявлены миграциями 008/009 и снесены push-ом. Regex-имена/ключи участвуют в
DSL показателей и шкал.

### 2.2. Низкий приоритет — эшелонированная защита (опционально)

Enum- и JSON-CHECK, дублирующие прикладную валидацию (Drizzle `text({ enum })`
на уровне TS + Zod `createInsertSchema` на API). Ценность на уровне БД — только
защита от прямого SQL и дефектов валидации; при желании можно пропустить, чтобы
не плодить шум.

- `users.status`; `content_pages.position/mode/type/kind`; `tests.status`;
  `result_variables.type/scorm_target/controls_status`;
  `scales.type/aggregation/normalization/direction/scorm_target`;
  `question_measurements.source_type` — enum-CHECK.
- `tests.retake_policy_json`, `test_sections.draw_blueprint_json` — JSON-shape
  CHECK (форму валидирует Zod-схема).

Примечание: `content_pages.kind` CHECK, если восстанавливать, должен
использовать ТЕКУЩИЙ enum схемы (`start, questions, router, summary, results,
intro, info, review, section-results`), а не устаревший набор миграции 004.
CHECK `questions_scoring_json_kind_check` (010) не восстанавливать — колонка
`scoring_json` удалена миграцией 028.

## 3. Первопричина и конвенция

Констрейнты корректности исторически клались в SQL-миграции (008/009 прямо
отмечают «не выразимо схемой Drizzle на тот момент»), но `drizzle-kit push`
приводит БД к `schema.ts` и не сохраняет то, чего в схеме нет. Установленный
`drizzle-orm@0.45.2` уже экспортирует `check()` и поддерживает
`uniqueIndex().where()` — то есть эти объекты теперь ВЫРАЗИМЫ в `schema.ts`.

**Конвенция (зафиксировать):** любые структурные объекты (индексы, CHECK,
партиальные/уникальные индексы) объявляются в `schema.ts`; SQL-миграции несут
только data-шаги (бэкфиллы, дропы, backfill-then-constrain). Иначе push их
снесёт.

## 4. Порядок выполнения

- [x] 1. Скан нарушений в данных ДО добавления констрейнтов. Dev: таблицы
  `result_variables`/`scales` пусты (0 строк) — нарушений нет. ПРОД: скан ещё НЕ
  выполнен (нет доступа из dev-сессии) — обязателен перед выкаткой: тесты с >1
  контроллером success/completion, дубли `(test_id, name)`/`(test_id, key)`,
  `name`/`key` вне regex.
- [x] 2. Решение по нарушениям — на dev не потребовалось (пусто). Для прода —
  по результату шага 1.
- [x] 3. Объекты 2.1 объявлены в `schema.ts` (`check()` +
  `uniqueIndex().on(...).where(...)`), включая natural-unique. Раздел 2.2 не
  добавлялся (дублирует Zod).
- [x] 4. `db:push` на dev применён; `pg_constraint`/`pg_indexes` подтверждают
  наличие; `tsc` + `vitest` зелёные.
- [x] 5. Интеграционный тест `tests/it/result-variable-constraints.it.test.ts`
  (5 спеков: дубль контроллера отклоняется, success+completion допускается, дубль
  имени/невалидный идентификатор отклоняются). Конвенция раздела 3 — зафиксировать
  отдельно (в шапке `schema.ts` или гайде).

## 5. Риски

- Добавление CHECK/UNIQUE на таблицу с нарушающими данными проваливает ALTER —
  шаги 1-2 обязательны и первичны.
- Прод мог накопить нарушения за период без констрейнтов (в отличие от чистого
  dev); скан на проде обязателен.
- Enum-CHECK (раздел 2.2) в основном дублируют прикладную валидацию — не
  переинвестировать; приоритет на 2.1.
