# Приёмочная матрица - PRD-15 (владение контентом, целостность, публикация)

Документ фиксирует приёмку трека PRD-15 (фаза 5, задача T-41): соответствие функциональным
требованиям `FR-01`..`FR-36`, матрице граничных случаев деградации `E-1`..`E-13`
([аудит](../../AUDIT_DATA_OWNERSHIP.md), раздел 4.1) и критериям приёмки PRD
([content-ownership.md](./content-ownership.md), раздел 8). Нормативная модель прав -
[role-model.md](../access-control/role-model.md); план - [implementation-plan.md](./implementation-plan.md).

Обозначения столбца «Проверка»:

- Авто - покрыто автоматическим тестом (`vitest`), указан файл.
- Локально - проверено локальной сборкой и плеером SCORM (`npm run scorm:sample` + `npm run scorm:player`).
- Lint - проверяется `npm run lint:md`.

## Сводный прогон фазы 5

| Проверка | Команда | Результат |
| --- | --- | --- |
| Типизация | `npm run check` (`tsc`) | Чисто |
| Тесты | `npm test` (`vitest run`) | 137 файлов, 2607 тестов - зелёные |
| Сборка SCORM | `npm run scorm:sample` | `out/sample-default-template.zip` (738 КБ) |
| Плеер SCORM | `npm run scorm:player` | Доставка, протокол, шкалы (2), показатели (3), эффективная цена/балл |
| Markdown | `npm run lint:md` | Без ошибок |

Дата прогона: 2026-06-13.

## Матрица граничных случаев E-1 - E-13

Каждый сценарий: «эффект сегодня» воспроизведён и «правило предотвращения» подтверждено
автоматическим тестом. Политика по умолчанию: затронут опубликованный тест - блокировка `409`
со списком зависимостей (с админ-переопределением `?force`); только черновики - предупреждение.

| № | Сценарий | Правило предотвращения | Проверка |
| --- | --- | --- | --- |
| E-1 | Удаление вопросов: пул меньше `drawCount` опубликованного теста | Блокировка для опубликованных, предупреждение для черновиков | Авто: `draw-feasibility.test.ts` (pool vs drawCount), `content-protection.test.ts` (question deletion vs drawCount) |
| E-2 | Удаление темы, используемой опубликованными тестами | Блокировка; удаление после исключения темы; `?force` для администратора | Авто: `content-protection.test.ts` (topic deletion vs dependent tests + override) |
| E-3 | Перетегирование/удаление, делающее квоты `drawBlueprintJson` невыполнимыми | Проверка выполнимости квот по тегам по каждому зависимому тесту | Авто: `draw-feasibility.test.ts` (blueprint quotas), `content-protection.test.ts` (re-tagging vs quotas) |
| E-4 | Правка `difficulty`/переопределения, опустошающая уровень адаптивной выдачи | Проверка минимального пула по уровням адаптивных тестов | Авто: `draw-feasibility.test.ts` (adaptive levels), `content-protection.test.ts` (difficulty change vs levels) |
| E-5 | Удаление вопроса с вкладами в шкалы PRD-5 | Блокировка при вкладах в опубликованных/чужих тестах | Авто: `draw-feasibility.test.ts` (scale contributions), `content-protection.test.ts` (question feeds scales) |
| E-6 | Удаление/перетегирование, обнуляющее агрегаты формул PRD-2 по тегам | Предупреждение со списком показателей; блокировка для опубликованных | Авто: `draw-feasibility.test.ts` (formula loss), `content-protection.test.ts` (empties a tag used by a formula) |
| E-7 | Правка состава вариантов вопроса опубликованных тестов | Пометка устаревших переопределений (`contentHash`); полная защита - снапшот | Авто: `effective-scoring-context.test.ts` (stale override via contentHash pin), `routes.tests.test.ts` (PUT пинит текущий `contentHash`) |
| E-8 | Удаление вопроса во время идущих попыток | Знаменатель и состав фиксируются версией попытки (снапшот) | Авто: `test-snapshot-delivery.test.ts` (pinned attempt served from snapshot, ignores live edits) |
| E-9 | Сжатие пула темы при секциях `drawAll` | Предупреждение, без блокировки | Авто: `draw-feasibility.test.ts` (drawAll shrink advisory), `content-protection.test.ts` (drawAll shrink warns, never blocks) |
| E-10 | Массовые операции (`bulk-delete`) и импорт PRD-14 в режиме замены | Те же проверки во всех путях; dry-run импорта показывает влияние | Авто: `content-protection.test.ts` (bulk delete passes the same protection), `routes.questions-import-export.test.ts` (dry-run impact) |
| E-11 | Перевод темы в `private` при использовании чужими тестами | Доставка не страдает; индикатор недоступной темы в редакторе | Авто: `content-ownership-acceptance.test.ts` (re-saving keeps a referenced topic, no 403), `routes.topic-access.test.ts` |
| E-12 | Публикация теста с заведомо невыполнимой выдачей | Publish-time валидация выполнимости | Авто: `content-protection.test.ts` (publishing an infeasible test is rejected), `routes.tests.test.ts` (publish runs draw-feasibility) |
| E-13 | Отзыв гранта на тему у автора, чьи тесты её используют | Мягкий отзыв по умолчанию (производное чтение в контексте теста); жёсткий - через разрешение зависимостей | Авто: `content-ownership-acceptance.test.ts` (hard-revoke lists deps but never blocks by itself; derived in-context read), `routes.topic-access.test.ts` |

## Функциональные требования

### Блок A: целостность (FR-01 - FR-09)

| FR | Содержание | Проверка |
| --- | --- | --- |
| FR-01 | `created_by` в `topics`/`questions`/`folders`/`test_folders`; заполнение актором | Авто: `routes.test-folders.test.ts`, `eligibility-gate-blockwall.test.ts`; миграция `019` |
| FR-02 | Разрушающие операции - создателю/администратору; `NULL` - только администратору | Авто: `content-protection.test.ts`, `routes.questions-users-assignments.test.ts` |
| FR-03 | DAL использования: `getTestsUsingTopic`/`getTestsUsingQuestion` | Авто: `content-protection.test.ts`, `routes.topics-folders-groups.test.ts` |
| FR-04 | Сервис выполнимости выдачи (пул/квоты/уровни/шкалы от эффективного состояния) | Авто: `draw-feasibility.test.ts` |
| FR-05 | Сервис выполнимости во всех путях; `409` со списком, dry-run импорта | Авто: `content-protection.test.ts`, `routes.questions-import-export.test.ts` |
| FR-06 | Publish-валидация выполнимости (`flow-policy-validator`) | Авто: `routes.tests.test.ts`, `draw-blueprint.test.ts` |
| FR-07 | `deleteTopic` дочищает зависимые `test_sections` | Авто: `storage.test.ts`, `routes.topics-folders-groups.test.ts` |
| FR-08 | Scope аналитики по области видимости (`readableTestScope`/`canReadTestAnalytics`) | Авто: `access/test-access.test.ts` (`readableTestScope`); реализация - `analyticsScope` в `server/routes/analytics/helpers.ts` |
| FR-09 | `canReadTest` + ветвь «назначен пользователю»; `/design` и `/screen-template` объектная проверка | Авто: `access/test-access.test.ts`, `routes.design-settings.test.ts` |

### Блок B: публикация через снапшоты (FR-10 - FR-17)

| FR | Содержание | Проверка |
| --- | --- | --- |
| FR-10 | `test_snapshots`; снапшот при публикации с разрешёнными значениями | Авто: `test-snapshot-delivery.test.ts`, `test-snapshot.test.ts`; миграция `020` |
| FR-11 | Доставка из снапшота; предпросмотр черновика живой | Авто: `test-snapshot-delivery.test.ts`, `test-snapshot.test.ts` (frozen reads) |
| FR-12 | Состояния публикации; дрейф по `contentHash` | Авто: `test-snapshot-delivery.test.ts` (drift detection), `routes.tests.test.ts` |
| FR-13 | Пин версии попытки; доигрывание на своей версии | Авто: `test-snapshot-delivery.test.ts` (isolation), `routes.attempts-tests.test.ts` |
| FR-14 | Экстренная переопубликация без списания лимита PRD-6 | Авто: `routes.tests.test.ts` (emergency republish) |
| FR-15 | Аналитика по версиям; вопросные статистики из снапшота | Авто: `routes.scorm-telemetry-analytics.test.ts` (per-version distribution) |
| FR-16 | Экспорт SCORM из актуального снапшота | Авто: `test-snapshot-delivery.test.ts` (SCORM from snapshot); Локально: `scorm:sample` + `scorm:player` |
| FR-17 | Удержание и очистка снапшотов; сжатие `content_json` | Авто: `test-snapshot-delivery.test.ts` (versioning and retention) |

### Блок C: владение темами и гранты (FR-18 - FR-29)

| FR | Содержание | Проверка |
| --- | --- | --- |
| FR-18 | `owner_id` и `visibility`; новая тема приватная, владелец - создатель | Авто: `topic-access.test.ts`, `prd-4-acceptance.test.ts`; миграция `021` |
| FR-19 | `topic_access_grants` - получатель пользователь, уровень `use`/`manage` (TD-01) | Авто: `topic-access.test.ts`, `routes.topic-access.test.ts`; миграция `025` |
| FR-20 | Гранты выдаёт владелец/администратор; журналирование | Авто: `routes.topic-access.test.ts` |
| FR-21 | Унификация тестов: ветвь владельца в `canGrantAccess` | Авто: `access/test-access.test.ts` (owner can grant on own test, BRC-27) |
| FR-22 | Фильтрация списков тем/вопросов и экспорта по области видимости | Авто: `routes.topic-access.test.ts`, `content-ownership-acceptance.test.ts` |
| FR-23 | Валидация: секции ссылаются только на доступные на `use` темы | Авто: `routes.topic-access.test.ts` (sections cite visible topics) |
| FR-24 | Инвариант доставки: контентные права не проверяются в попытках и SCORM | Авто: `content-ownership-acceptance.test.ts` (delivery invariant, BRC-08) |
| FR-25 | Мягкий отзыв: производное чтение «тема в контексте моего теста» | Авто: `content-ownership-acceptance.test.ts` (derived in-context read), `topic-access.test.ts` |
| FR-26 | Жёсткий отзыв через разрешение зависимостей с админ-переопределением | Авто: `topic-access.test.ts` (hard revoke), `content-ownership-acceptance.test.ts` |
| FR-27 | Одноимённость: нормализация, предупреждение, частичный уникальный индекс, отчёт о дублях | Авто: `topic-access.test.ts`, `routes.topic-access.test.ts`; миграция `022` |
| FR-28 | Импорт PRD-14: темы в видимой области, владелец-импортёр для новых | Авто: `routes.questions-import-export.test.ts` |
| FR-29 | Каталог прав «использовать»/«управлять»; правка role-model.md | Lint: `role-model.md`; реализация - `shared/access`, `server/services/topic-access.ts` |

### Блок D: оценка - свойство теста (FR-30 - FR-36)

| FR | Содержание | Проверка |
| --- | --- | --- |
| FR-30 | `test_question_scoring`; пиннинг к `contentHash` помечает устаревшие | Авто: `effective-scoring-context.test.ts` (stale via pin), `routes.tests.test.ts`, `storage.test.ts`; миграция `026` |
| FR-31 | Умолчания `test_sections.default_points`/`tests.default_question_points`; цепочка цены | Авто: `effective-scoring.test.ts`, `effective-scoring-context.test.ts` |
| FR-32 | Единый резолвер цены/сложности в `shared/`; веб, пересчёт, SCORM, снапшоты | Авто: `effective-scoring.test.ts`, `scorm-testjson-scoring-overrides.test.ts`, `routes.attempts-tests.test.ts`, `test-snapshot-delivery.test.ts` |
| FR-33 | Двухшаговая миграция: backfill (T-37) + удаление колонок (T-40) | Авто: `mbi-golden.test.ts`, `rtk-golden.test.ts` (паритет до/после); миграции `027` (backfill) и `028` (re-backfill + дроп); T-40 ВЫПОЛНЕН 2026-06-13 |
| FR-34 | Эффективная сложность в адаптивной выдаче | Авто: `effective-scoring-context.test.ts` (difficultyOf), `scorm-testjson-scoring-overrides.test.ts`, `routes.attempts-tests.test.ts` |
| FR-35 | Клиент: умолчания/переопределения в редакторе, перенос конструктора градуировки | Авто: `routes.tests.test.ts` (PUT/DELETE question-scoring); сверено в живом приложении (T-39) |
| FR-36 | Книга Excel: лист «Оценка» в test-scoped листе; шаблон, инспекция, round-trip | Авто: `scoring-excel.test.ts`, `workbook-sheets.test.ts`, `routes.tests-workbook.test.ts` |

## Критерии приёмки PRD (раздел 8)

| Критерий | Проверка | Статус |
| --- | --- | --- |
| Матрица E-1 - E-13: каждый сценарий воспроизведён и предотвращён тестом | См. таблицу E-1 - E-13 выше | Готово |
| Golden-тесты скоринга зелёные до и после блока D | Авто: `mbi-golden.test.ts`, `rtk-golden.test.ts`, `scoring-engine.test.ts` | Готово |
| Round-trip книги Excel с новым размещением колонок оценки | Авто: `routes.tests-workbook.test.ts`, `scoring-excel.test.ts` | Готово |
| Инвариант доставки: отзыв/приватность не меняют опубликованный тест и SCORM | Авто: `content-ownership-acceptance.test.ts` (BRC-08) | Готово |
| Локальная проверка SCORM: эффективные цены и состав соответствуют снапшоту | Локально: `scorm:sample` + `scorm:player` (см. сводный прогон) | Готово |
| Полный прогон `npm test` и `npm run check` | См. сводный прогон | Готово |

## Открытые пункты

- Нет. T-40 (удаление `questions.points`/`scoring_json`, миграция 028) выполнен 2026-06-13:
  паритет подтверждён golden-тестами и полным прогоном (137 файлов / 2605 тестов, tsc чисто).
  Цепочка умолчаний цены больше не содержит legacy-звена — умолчания теста/секции действуют.
- Справочно: глубокий scope тяжёлых аналитических агрегатов унаследован из PRD-13 и закрыт в
  PRD-15 (`analyticsScope`/`canReadTestAnalytics`, FR-08) по области видимости актора.
