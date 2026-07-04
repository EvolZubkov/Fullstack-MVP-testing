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
- [x] 10. `seedDatabase` удалён из `server/storage.ts` и вынесен в ручной
  dev-скрипт `script/seed-db.ts` (`npm run seed`): гейт против production (exit 1
  до касания БД), креды из env с dev-дефолтами, хеширование через шов
  `hashPassword`. Безусловный авто-вызов на старте сервера убран — прод-БД не
  получает демо-аккаунтов. Гейт проверен (раздел 5.4).

## Приоритет 4 — поддерживаемость и архитектура

- [x] 11. Контракт `IStorage` достроен: 12 живых методов добавлены (topic
  ownership/grants ×10, `duplicateQuestion`, `duplicateTopicWithQuestions`);
  `getTopicByName` не добавлен — 0 вызовов (мёртв, → пункт 13). Сняты
  `(storage as any)`-касты в маршрутах. `tsc` чист (раздел 6.2).
- [x] 13. Мёртвый код и единый JSDoc (разделы 6.3, 6.4). Аудит вызовов:
  `getTopicByName` (0 вызовов, вне контракта) удалён; `duplicateQuestion`,
  `duplicateTopicWithQuestions`, `getMigrationHealth` живые (маршруты + тесты) —
  сохранены; `mapLegacyTest` сохранён (не мёртв: `getTests`/`getTest`), его снятие
  — отдельный deploy-gated шаг, `getMigrationHealth` его не гейтит (считает
  несвязанную величину). Все русские комментарии `storage.ts` переведены на
  английский (data-литералы `" (копия)"` и лист «Оценка» — доменные, сохранены);
  добавлен module-level JSDoc `@module server/storage`. Пункты «единый писатель
  секций» и «мёртвая ветка `updateTest(sections)`» закрыты в пункте 6. `tsc` чист;
  главный (2940) + интеграционный (22) сьюты зелёные.
- [~] 12. Разбить `DatabaseStorage` на доменные репозитории за фасадом
  `IStorage`, инкрементально по доменам (раздел 6.1). Подход —
  композиция-делегирование; общие хелперы в `server/storage/shared.ts`; фасад
  `server/storage.ts` сохраняет экспорты, доменные модули — в `server/storage/*`
  (без `index.ts`, чтобы `../storage` резолвился в файл). Порядок извлечения
  скорректирован: изолированные/средние домены (Scorm/Adaptive/Attempts/
  ScalesVariables) вперёд, самый связный **Tests** (глубокий `deleteTest`,
  снапшоты, `mapLegacyTest`) — последним, на уже тонком фасаде.
  - [x] 12.1. Пилот **Users** — `server/storage/users-repository.ts` (10 методов),
    `pickDefined` вынесен в `shared.ts`, фасад делегирует. `tsc` + оба сьюта
    зелёные, маршруты не тронуты.
  - [x] 12.2. Groups — `server/storage/groups-repository.ts` (`GroupsRepository`,
    10 методов групп + членства, транзакции `deleteGroup`/`setUserGroups`). Внешние
    вызовы `getUserGroups` (`isTestAssignedToUser`, `getAssignedTestsForUser`)
    перенаправлены на `this.groupsRepo`; из фасада убраны таблицы
    `users`/`groups`/`userGroups` и `decryptEmail`. `tsc` + оба сьюта зелёные.
  - [x] 12.3. Access — `server/storage/access-repository.ts` (`AccessRepository`,
    21 метод: роли `user_roles`, владение+гранты тестов `tests.owner_id`/
    `test_access_grants`, владение/видимость+гранты тем `topics`/
    `topic_access_grants`). Слой RBAC пишет колонки владения `tests`/`topics`,
    контент-CRUD остаётся в своих доменах. Внешних вызовов не было. Из фасада
    убраны таблицы `userRoles`/`topicAccessGrants` (`testAccessGrants` оставлена —
    её чистит `deleteTest`). `tsc` + оба сьюта зелёные.
  - [x] 12.4. Topics — `server/storage/topics-repository.ts` (`TopicsRepository`,
    весь домен: CRUD, `moveTopicsToFolder`, feedback-аксессоры, каскадные
    `deleteTopic`/`deleteTopicsBulk`, `renameTopicInFormulas`,
    `duplicateTopicWithQuestions` + приватные `topicInsertValues`/`uniqueTopicName`).
    Правило: каскады корневого агрегата (тема) следуют за корнем, репозиторий
    импортирует затрагиваемые таблицы (questions/testSections/contentPages/
    resultVariables); в `duplicate` вызов `getQuestionsByTopic` заменён прямым
    запросом. Из фасада убраны импорты `normalizeTopicName`/`topicCoursesFromFeedback`/
    `topicEventsFromFeedback`/`renameTopicByNameInFormula` (таблица `topics`
    оставлена — используется в `deleteFolder` и валидации формул). `tsc` + оба
    сьюта зелёные.
  - [x] 12.5. Questions — `server/storage/questions-repository.ts`
    (`QuestionsRepository`, 10 методов на таблице `questions`: CRUD, lookup
    id/ids/topic, `duplicateQuestion`, `getContentHashesByTopic`). Справочные
    запросы `getTestSectionsByTopic`/`getMeasurementsForQuestions`/
    `getTopicPageRefs` читают чужие таблицы (testSections/questionMeasurements/
    contentPages) — по правилу границы оставлены на фасаде до извлечения их
    доменов. Внешний `getQuestion` (`getTestsUsingQuestion`) перенаправлен на
    `this.questionsRepo`; таблица `questions` убрана из импорта фасада. `tsc` +
    оба сьюта зелёные.
  - [x] 12.6. Tests — `server/storage/tests-repository.ts` (`TestsRepository`):
    жизненный цикл `tests` (чтение с legacy-нормализацией, версионный `updateTest`,
    `patchTestStatus`, глубокий `deleteTest`), чтение секций, публикационные
    снапшоты, референс-запросы `getTestsUsingTopic`/`getTestsUsingQuestion`/
    `getTestSectionsByTopic`/`getTopicPageRefs`, `getMigrationHealth`. Каскад
    `deleteTest` (adaptive/sections/assignments/grants/attempts/snapshots) уехал
    сюда по правилу корневого агрегата. `mapLegacyTest` и тип `TestUsageRef`
    перенесены в репозиторий; фасад реэкспортирует `TestUsageRef` (потребитель —
    `draw-feasibility`). В `getTestsUsingQuestion` вызов `questionsRepo.getQuestion`
    заменён прямым чтением `questions`. `tsc` + оба сьюта зелёные.
  - Остаток фасада (вне исходных 10 доменов, полный сплит по согласованию):
    - [ ] 12.11. ContentPages (`content_pages` CRUD).
    - [ ] 12.12. Assignments (назначения + токены доступа к назначениям).
    - [ ] 12.13. Folders (папки контента + папки тестов).
    - [ ] 12.14. PasswordResetTokens — в `UsersRepository` (токены пользователя).
  - [x] 12.7. Attempts — `server/storage/attempts-repository.ts`
    (`AttemptsRepository`, 8 методов на таблице `attempts`: create/lookup/
    whitelist-update/deletes; `annulInProgressAttempts` PRD-15 FR-14). Внутренний
    `getAttempt` (в `updateAttempt`) остался в репозитории. Таблица `attempts`
    оставлена на фасаде — её читает `getReferencedSnapshotIds` и чистит
    `deleteTest`. `pickDefined` (последний потребитель — `updateAttempt`) и `isNull`
    убраны из импортов фасада. `tsc` + оба сьюта зелёные.
  - [x] 12.8. Scorm — `server/storage/scorm-repository.ts` (`ScormRepository`,
    14 методов: пакеты/попытки/ответы SCORM-телеметрии). Полностью изолирован —
    ни внешних вызовов, ни использования `scorm*`-таблиц вне домена (`deleteTest`
    сохраняет пакеты, nullable `testId`). Таблицы `scormPackages`/`scormAttempts`/
    `scormAnswers` убраны из импорта фасада. `tsc` + оба сьюта зелёные.
    (Извлечён раньше очереди — изолированный, low-risk.)
  - [x] 12.9. Adaptive — `server/storage/adaptive-repository.ts`
    (`AdaptiveRepository`, 14 методов: настройки `adaptive_topic_settings`, уровни
    `adaptive_levels`, связи `adaptive_level_links`; by-test удаления через
    subquery, атомарно). Изолирован — внешних вызовов нет. Adaptive-таблицы
    оставлены в импорте фасада: их напрямую чистит `deleteTest` (та же таблица в
    одной транзакции; при извлечении Tests уедет туда). `tsc` + оба сьюта зелёные.
  - [x] 12.10. ScalesVariables — `server/storage/scales-variables-repository.ts`
    (`ScalesVariablesRepository`, 19 методов: показатели PRD-2 `result_variables`,
    шкалы+измерения PRD-5 `scales`/`question_measurements`, скоринг PRD-15 D
    `test_question_scoring`, `validateResultVariableFormula`,
    `getMeasurementsForQuestions`). `validate`-метод укоренён в показателе, читает
    соседние `test_sections`/`topics`/`scales`; внутренний `getResultVariables`
    остался в репозитории. Из фасада убраны таблицы `resultVariables`/`scales`/
    `testQuestionScoring` (deleteTest уносит по FK) и функция `validate`;
    `questionMeasurements` оставлена (нужна `getTestsUsingQuestion`). `tsc` + оба
    сьюта зелёные.
