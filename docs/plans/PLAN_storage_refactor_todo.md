# Чек-лист рефакторинга `server/storage.ts`

**Версия:** 1.1
**Дата:** 2026-07-04 (актуализация: закрыты пункты 1-5; интеграционные тесты
вынесены в `npm run test:it`)
**Связанный документ:** [PLAN_storage_refactor.md](./PLAN_storage_refactor.md)

Порядок отражает приоритеты раздела 7 плана. Инструменты верификации: `pglite`
для целостности (атомарность/каскады/предикаты/round-trip), `EXPLAIN ANALYZE` на
dev Docker PG для индексов, `npm run check` и `npm test` на каждом шаге.

## Приоритет 1 — производительность и фундамент верификации

- [x] 1. Индексы на горячих колонках через `schema.ts` (`index()`) + `db:push`
  — НЕ SQL-миграцией (push сносит индексы, объявленные только в миграциях;
  раздел 4.1). Добавлен 21 индекс (12 таблиц): `attempts` ×3, `questions.topicId`,
  `test_assignments` ×3, `scorm_answers.attemptId`, `scorm_packages.testId`,
  `content_pages.topicId`, `password_reset_tokens` ×2 + восстановлены снесённые
  push-ом (`test_sections(testId,sortOrder)`, композиты `content_pages`,
  `tests.status`, `scales/result_variables/question_measurements`). dev-БД 41 → 62
  индекса; `questions WHERE topic_id` Seq Scan 11.6 мс → Bitmap Index Scan 1.24 мс;
  `tsc` и `vitest` зелёные. Побочная находка (снесённые push-ом CHECK/партиальные
  unique) — отдельным треком (раздел 4.1).
- [x] 2. Интеграционный слой на `pglite` (`@electric-sql/pglite` +
  `drizzle-orm/pglite`): харнесс `tests/it/db-harness.ts`. Схема применяется из
  `tests/it/schema.sql` — production-верный DDL из `schema.ts` через
  `drizzle-kit export` (НЕ `migrations/*.sql`, иначе дрейф снесённых push-ом
  объектов). `reset()` (TRUNCATE) между кейсами; глоб `tests/it/*.it.test.ts`
  подменяет `server/db` на pglite (без мока запросов). Смоук
  `harness-smoke.it.test.ts` (5 спеков): реальный round-trip, инварианты темы,
  каскад `deleteTopic`, изоляция `reset()`, откат транзакции. `tsc` зелёный;
  интеграционные тесты позже вынесены в отдельный прогон `npm run test:it`
  (см. пункт 4), юнит-`npm test` остаётся полностью параллельным.

## Приоритет 2 — целостность данных

- [x] 3. Многошаговые мутации в транзакциях (раздел 3.1). Восемь по списку
  (`deleteTopic`, `deleteTopicsBulk`, `deleteGroup`, `deleteFolder`,
  `deleteTestFolder`, `deleteTestFolderCascade`, `setUserGroups`, `setUserRoles`);
  полным аудитом закрыты ещё четыре: `duplicateTopicWithQuestions` (topic+вопросы
  атомарно), `deleteAdaptiveLevelsByTest` / `deleteAdaptiveLevelLinksByTest`
  (циклы → один subquery-delete), `renameTopicInFormulas` (пакет `update` одной
  транзакцией). `deleteGroup` переведён с `rowCount` на `returning().length`
  (портируемо между драйверами; pglite не заполняет rowCount без RETURNING). Тест
  атомарности `tests/it/dal-transactions.it.test.ts` (откат `setUserGroups` при
  нарушении unique). Все многошаговые мутации DAL атомарны.
- [x] 4. Атомарное глубокое удаление теста — реализовано усилением `deleteTest`
  (единственный владелец, без «мелкого» варианта). В одной транзакции удаляются
  adaptive, `test_sections`, `test_assignments`, `test_access_grants`, `attempts`,
  `test_snapshots`; FK-каскад уносит content_pages/scales/result_variables/
  question_measurements/test_question_scoring; SCORM сохраняется (nullable
  testId — пакет живёт в LMS). Ручная очистка убрана из `DELETE /:id`. Тест «ноль
  сирот» `tests/it/delete-test-deep.it.test.ts`. Интеграционные тесты вынесены в
  `npm run test:it` (vitest.it.config.ts, последовательно). Раздел 3.2.
- [x] 5. `duplicateTopicWithQuestions(id, createdBy?)`: инварианты копии
  (`nameNormalized`, `ownerId` = дублирующий, приватная `visibility`, `folderId`)
  вычисляются общим билдером `topicInsertValues` (общий с `createTopic`); код не
  переносится (per-test алиас); имя копии уникально в пределах владельца
  (повторное дублирование не конфликтует с owner-scoped индексом); вопросы
  копируются с `contentHash`/`difficulty`/`createdBy`. Topic + вопросы копируются
  атомарно (одна транзакция, см. пункт 3). Маршрут передаёт `req.currentUser?.id`.
  Тест `tests/it/duplicate-topic.it.test.ts`. Раздел 3.3.
- [x] 6. Единый источник записи секций (раздел 3.4). Аудит: единственный живой
  писатель — `TestSettingsService._insertSections` (с `formSetJson`+`sortOrder`);
  обе storage-копии мёртвые. Консолидация удалением: убран мёртвый
  `storage.createTest` (метод + декларация `IStorage` + импорт + мок-заглушки) и
  параметр/ветка `sections` из `updateTest`. Round-trip на живом пути
  `tests/it/section-roundtrip.it.test.ts` (`formSetJson`+`sortOrder` сохраняются).

## Приоритет 3 — безопасность

- [x] 7. Белый список записываемых колонок в `updateUser`, `updateGroup`,
  `updateAttempt` через хелпер `pickDefined` (убран `any`-каст; пустой набор →
  no-op). Разрешено: user — `name/status/mustChangePassword/gdprConsent(+At)`
  (email отдельно, `emailHash`/`passwordHash`/аудит недоступны); group —
  `name/description`; attempt — `variantJson/answersJson/resultJson/finishedAt`.
  Тест `tests/it/mass-assignment.it.test.ts` (раздел 5.1).
- [x] 8. Централизация хеширования пароля: обёртки `hashPassword`/`verifyPassword`
  в `server/utils/crypto.ts` над `bcryptjs` (фактор стоимости — одна константа);
  все точки проведены через них (`createUser`, `validatePassword`,
  `updateUserPassword`, сидер, `script/create-admin.ts`); прямой импорт `bcryptjs`
  убран из `server/storage.ts` (DAL крипто-агностичен, примитив только в шве).
  Детекция формата/scrypt/rehash НЕ строились (тело PRD-9). Тест обёрток
  `tests/crypto-password.test.ts`. Раздел 5.2.
- [x] 9. `validatePassword`: проведён через обёртку `verifyPassword` (пункт 8) +
  добавлен `dummyVerifyPassword` в шов `crypto.ts`; ветка «пользователь не найден»
  вызывает фиктивную сверку (той же стоимости) перед `return null` — время ответа
  не зависит от существования аккаунта. Тесты: `crypto-password.test.ts` +
  `storage.test.ts` (проверка вызова). Ленивый rehash — в PRD-9 (раздел 5.3).
- [ ] 10. `seedDatabase`: гейт по окружению (не выполнять в production) или креды
  из env; вынести функцию из слоя доступа к данным в `scripts/`; хеширование —
  через шов `hashPassword` (раздел 5.4).

## Приоритет 4 — поддерживаемость и архитектура

- [ ] 11. Достроить контракт `IStorage` до полной поверхности (добавить
  недостающие методы владения/грантов тем, `duplicate*`, `getTopicByName`
  и прочие) (раздел 6.2).
- [ ] 12. Разбить `DatabaseStorage` на доменные репозитории за фасадом
  `IStorage` (Users / Groups / Access / Topics / Questions / Tests / Attempts /
  Scorm / Adaptive / ScalesVariables), инкрементально по доменам (раздел 6.1).
- [ ] 13. Удалить мёртвый код (после проверки востребованности `getTopicByName`,
  `duplicate*`, `getMigrationHealth`, `mapLegacyTest`); привести комментарии к
  единому английскому JSDoc (разделы 6.3, 6.4).
