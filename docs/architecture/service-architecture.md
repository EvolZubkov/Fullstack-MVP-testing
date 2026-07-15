# Архитектура серверных сервисов

> Актуализировано 2026-07-01 (релиз 2.6.0-beta): маршрутизация разнесена на модульные роутеры
> (`server/routes/`), выделен слой сервисов (`server/services/`), добавлены доменные движки
> в `shared/` и единый шаблонный рендерер `shared/template/` (PRD-12). Списки роутеров и
> сервисов в §6 приведены в соответствие с актуальным составом (PRD-13/14/15/18).
>
> Актуализировано 2026-07-05: слой доступа к данным (`DatabaseStorage`) разбит на 14 доменных
> репозиториев за фасадом `IStorage` (`server/storage/*`); многошаговые мутации переведены в
> транзакции, добавлен белый список записываемых колонок и индексы на горячих колонках.
> Хеширование паролей переведено на scrypt (`@vvlad1973/crypto`, PRD-9) — `bcryptjs` остаётся
> legacy-only для проверки старых хешей.

## Обзор

Серверная часть проекта построена на Express.js с TypeScript, с выделенным слоем доступа
к данным (Repository pattern). Основные компоненты:

- **DatabaseStorage** -- тонкий делегирующий фасад интерфейса `IStorage`; query-логика разнесена
  по 14 доменным репозиториям в `server/storage/*`
- **Routes** -- модульные роутеры по доменам в `server/routes/`, смонтированные тонким
  `server/routes.ts` (`registerRoutes`)
- **Services** -- доменные сервисы (`server/services/`): расчёт результата, контекст итогов,
  retake-гейт, рендер-пейлоад, валидаторы
- **Shared-движки** -- чистые модули в `shared/` (scoring/scales/formula/eligibility/draw/tags),
  общие для клиента, сервера и SCORM-пакета
- **SCORM Exporter** -- подсистема генерации SCORM 2004 пакетов
- **Единый рендерер (PRD-12)** -- `shared/template/`: DSL + `renderScreenInto` для обоих хостов
- **Email Service** -- отправка писем (сброс пароля)
- **Crypto Utilities** -- шифрование и хеширование email

---

## Диаграмма зависимостей

```text
                    index.ts (Entry Point)
                         |
          +--------------+--------------+
          |              |              |
   routes.ts          static.ts     vite.ts (dev)
 (registerRoutes —
  тонкий оркестратор)
          |
    routes/ (модульные роутеры: auth, users, topics, questions,
    |        tests, attempts, scales, result-variables, ...)
    |
    +-----------+-----------+------------------+
    |           |           |                  |
 services/   storage.ts   scorm/            shared/ (движки + рендерер)
 (расчёт,       |           |                  |
  контекст,   db.ts    +----+----+----+    +---+-----+------+------+
  retake,       |      | zip builders   |  | scoring scales formula |
  render)    drizzle   | assets template|  | eligibility draw tags  |
             + pg pool |  templates/<id>|  | template/ (dsl, render,|
                       +----------------+  |  context, dnd)         |
                                           +------------------------+
```

> Веб-хост и SCORM-пакет рендерят ученические экраны из `shared/template/` (PRD-12):
> веб импортирует напрямую, SCORM получает через esbuild-бандл `TBTemplate`.

---

## 1. DatabaseStorage (фасад) + доменные репозитории

**Файлы:** [storage.ts](../../server/storage.ts) (фасад) +
[storage/](../../server/storage/) (14 доменных репозиториев + `shared.ts`).

### Интерфейс IStorage

Определяет контракт для всех операций с базой данных (~80 методов, сгруппированных по
доменным сущностям). Маршруты и сервисы зависят только от `IStorage`, а не от конкретных
репозиториев.

### Класс DatabaseStorage

**Паттерны:** Facade + Repository (композиция-делегирование), Singleton (экспортируется
единственный экземпляр `storage`). Фасад не содержит собственной query-логики: каждый метод
делегирует в per-domain репозиторий под `server/storage/*` (users, groups, access, topics,
questions, tests, attempts, scorm, adaptive, scales-variables, content-pages, assignments,
folders; общие хелперы — `shared.ts`). Транзакции многошаговых мутаций (атомарность/каскады),
белый список записываемых колонок (защита от mass-assignment) и крипто-шов живут в
репозиториях; корневой агрегат владеет каскадами своих дочерних таблиц.

**Зависимости (репозиториев):**

- `drizzle-orm` -- построение запросов
- `server/utils/crypto.ts` -- шов хеширования пароля (scrypt, PRD-9) + шифрование/хеширование email
- `crypto.randomUUID()` -- генерация идентификаторов
- `@shared/schema` -- определения таблиц

**Группы методов:**

| Группа | Методы | Описание |
| --- | --- | --- |
| Users | `getUser`, `getUserByEmail`, `createUser`, `validatePassword`, `updateUser`, `deactivateUser`, `activateUser` и др. | CRUD пользователей, аутентификация |
| Groups | `getGroups`, `createGroup`, `updateGroup`, `deleteGroup` | Управление группами |
| User-Group | `getUserGroups`, `getGroupUsers`, `addUserToGroup`, `setUserGroups` | Связи M:N |
| Test Assignments | `getTestAssignments`, `createTestAssignment`, `getAssignedTestsForUser` | Назначение тестов |
| Password Reset | `createPasswordResetToken`, `getPasswordResetToken`, `markTokenAsUsed`, `getRecentTokensCount` | Токены сброса пароля |
| Folders | `getFolders`, `createFolder`, `updateFolder`, `deleteFolder` | Папки для тем |
| Topics | `getTopics`, `createTopic`, `deleteTopic`, `duplicateTopicWithQuestions` | Темы вопросов (рекомендации теперь в `topics.feedback_json`, не в отдельных таблицах) |
| User Roles | `getUserRoles`, `setUserRoles`, `addUserRole` | Мультироль пользователя (PRD-13; `user_roles`) |
| Access Grants | `getTestAccessGrants`, гранты доступа к темам | Объектные области: гранты теста / темы (PRD-13/15) |
| Snapshots & Scoring | `createTestSnapshot`, `getTestQuestionScoring`, `upsertTestQuestionScoring` | Публикация версий и переопределения оценки (PRD-15) |
| Questions | `getQuestions`, `getQuestionsByTopic`, `createQuestion`, `duplicateQuestion`, `deleteQuestionsBulk` | Вопросы 4 типов |
| Tests | `getTests`, `createTest`, `updateTest`, `deleteTest`, `getTestSections` | Тесты и секции |
| Attempts | `createAttempt`, `updateAttempt`, `getAttemptsByUser`, `getAttemptsByUserAndTest` | Попытки прохождения |
| Adaptive | `getAdaptiveTopicSettings`, `getAdaptiveLevels`, `getAdaptiveLevelLinks` и CRUD для каждого | Адаптивное тестирование |
| SCORM Packages | `createScormPackage`, `getScormPackages`, `updateScormPackage` | Пакеты SCORM |
| SCORM Attempts | `createScormAttempt`, `getScormAttemptBySession`, `getNextAttemptNumber` | Попытки из LMS |
| SCORM Answers | `createScormAnswer`, `getScormAnswersByAttempt` | Ответы из LMS |

**Особенности реализации:**

- Все email шифруются при записи (`encryptEmail`) и дешифруются при чтении (`decryptEmail`)
- Поиск по email выполняется через SHA-256 хеш (`emailHash`), без расшифровки
- `duplicateTopicWithQuestions` -- транзакционное дублирование темы со всеми вопросами
- `createTest` и `updateTest` работают с секциями в рамках одной транзакции
- `seedDatabase` -- заполнение начальными данными (2 пользователя, 2 темы, 12 вопросов)

---

## 2. Database Connection

**Файл:** [db.ts](../../server/db.ts)

**Экспортируемые объекты:**

| Имя | Тип | Описание |
| --- | --- | --- |
| `pool` | `pg.Pool` | PostgreSQL connection pool (max: 20, idle timeout: 30s) |
| `db` | `Drizzle` | Экземпляр Drizzle ORM |

**Функции:**

| Функция | Описание |
| --- | --- |
| `checkDatabaseHealth()` | Проверка через `SELECT 1` |
| `getDatabaseStatus()` | Статус пула: размер, idle, waiting |
| `withRetry(operation, maxRetries, delayMs)` | Повтор операций с exponential backoff |
| `closeDatabaseConnection()` | Graceful shutdown |
| `waitForDatabase()` | Ожидание доступности БД при старте |

**Паттерн:** Singleton -- один пул и один экземпляр ORM на процесс.
Graceful shutdown при SIGTERM/SIGINT.

---

## 3. Email Service

**Файл:** [email.ts](../../server/email.ts)

**Функции:**

| Функция | Описание |
| --- | --- |
| `sendPasswordResetEmail(to, resetLink, userName?)` | Отправка письма со ссылкой сброса пароля |
| `verifySmtpConnection()` | Проверка SMTP соединения |

**Особенности:**

- Lazy-инициализация Nodemailer транспортера (Singleton)
- Fallback на `console.log` если SMTP не настроен
- HTML и plain-text версии письма
- Зависимости: `nodemailer`, переменные `SMTP_*`

---

## 4. Crypto Utilities

**Файл:** [utils/crypto.ts](../../server/utils/crypto.ts)

| Функция | Алгоритм | Описание |
| --- | --- | --- |
| `encryptEmail(email)` | AES (custom lib) | Шифрование email перед записью в БД |
| `decryptEmail(encrypted)` | AES (custom lib) | Расшифровка при чтении |
| `hashEmail(email)` | SHA-256 | Хеш для быстрого поиска |
| `verifyEmailHash(email, hash)` | SHA-256 | Проверка совпадения хеша |

**Зависимости:** `@vvlad1973/crypto`, Node.js `crypto`.

**Файл:** [utils/mask-email.ts](../../server/utils/mask-email.ts)

| Функция | Описание |
| --- | --- |
| `maskEmail(email)` | Маскирование: `user@mail.com` -> `us***@mail.com` |

---

## 5. Подсистема SCORM Export

### 5.1 Точка входа

**Файл:** [scorm-exporter.ts](../../server/scorm-exporter.ts) -- реэкспортирует `generateScormPackage`.

### 5.2 Оркестратор

**Файл:** [scorm/index.ts](../../server/scorm/index.ts)

```text
generateScormPackage(data: ExportData): Promise<Buffer>
  |
  +-- buildTestJson(data)           --> JSON с данными теста
  +-- extractEmbeddedMediaIntoAssets() --> медиафайлы из base64/uploads
  +-- readAsset(name)               --> загрузка шаблонов JS/CSS/HTML
  +-- buildManifest(test, data)     --> imsmanifest.xml
  +-- buildMetadataXml(test)        --> metadata.xml
  +-- buildZip(files)               --> ZIP-архив (Buffer)
```

**Интерфейс ExportData:**

```typescript
interface ExportData {
  test: Test
  sections: (TestSection & {
    topic: Topic
    questions: Question[]
    // courses/events -- legacy-поля типа; таблицы удалены (миграция 024),
    // приходят пустыми, рекомендации берутся из topics.feedback_json
  })[]
  questionScoring?: TestQuestionScoring[]   // PRD-15 блок D: эффективная оценка запекается в TEST_DATA
  adaptiveSettings?: AdaptiveSettingsExport | null
  contentPages?: ContentPage[]              // PRD-1/19: контент-страницы и системные узлы разделов
  resultVariables?: ResultVariable[]        // PRD-2
  scales?: Scale[]; measurements?: QuestionMeasurement[]  // PRD-5
  designSettings?: DesignSettingsExport     // PRD-7: выбранный шаблон и его параметры
  templateDir?: string                      // резолвится роутом (built-in или загруженный PRD-3)
  telemetry?: { enabled: boolean; packageId: string; secretKey: string; apiBaseUrl: string } | null
}
```

> `ExportData` собирается общим ассемблером `buildScormExportData(testId, {source})`
> ([build-export-data.ts](../../server/scorm/build-export-data.ts)), который используют И
> экспорт SCORM, И встроенный плеер отладки (PRD-18) -- «отлаживаешь то, что отгружается».

### 5.3 Builders

| Файл | Функция | Описание |
| --- | --- | --- |
| [builders/test-json.ts](../../server/scorm/builders/test-json.ts) | `buildTestJson(data)` | Сериализация теста в JSON для runtime |
| [builders/manifest.ts](../../server/scorm/builders/manifest.ts) | `buildManifest(test, data, extraFiles?)` | Генерация imsmanifest.xml (SCORM 2004 4th Ed.) |
| [builders/metadata.ts](../../server/scorm/builders/metadata.ts) | `buildMetadataXml(test)` | Генерация LOM metadata.xml |
| [builders/media-assets.ts](../../server/scorm/builders/media-assets.ts) | `extractEmbeddedMediaIntoAssets(testObj, opts?)` | Извлечение медиа (base64, uploads) в assets ZIP |

**Manifest -- дополнительные функции:**

- `getOrCreateScormCode(test)` -- стабильный идентификатор теста (кешируется
  в `uploads/scorm/identifiers.json`)
- Транслитерация кириллицы в латиницу для идентификаторов
- Objectives: primary + по каждой теме с порогами прохождения

### 5.4 Вспомогательные модули

| Файл | Функция | Описание |
| --- | --- | --- |
| [scorm/zip.ts](../../server/scorm/zip.ts) | `buildZip(files)` | Создание ZIP (archiver, compression: 9) |
| [scorm/assets/read-asset.ts](../../server/scorm/assets/read-asset.ts) | `readAsset(name)` | Чтение шаблонов из нескольких путей (dev/prod fallback) |
| [scorm/utils/escape.ts](../../server/scorm/utils/escape.ts) | `escapeXml(str)` | Экранирование XML-спецсимволов |

---

## 6. Routes (API Layer)

**Файл:** [routes.ts](../../server/routes.ts) -- тонкий оркестратор (~100 строк):
настраивает session/middleware и монтирует модульные роутеры.

**Экспортируемая функция:** `registerRoutes(httpServer, app)`.

**Модульные роутеры:** [server/routes/](../../server/routes/) -- по одному файлу на домен,
монтируются через массив `routerConfig` в [server/routes/index.ts](../../server/routes/index.ts):

- Ядро: `auth`, `users`, `groups`, `topics`, `questions`, `tests`, `attempts`, `assignments`,
  `folders`, `test-folders`, `content-pages`, `result-variables`, `scales`, `logs`.
- Доступ и шаблоны: `access` (PRD-13 гранты доступа), `templates` (PRD-7), `admin-templates`
  (PRD-3 админ-реестр внешних ZIP).
- Excel (PRD-14): `workbook` + `tests-workbook` (мультилист импорт/экспорт).
- SCORM и отладка: `scorm-telemetry`, `debug-player` (PRD-18 встроенный плеер/отладчик),
  `analytics/` (подпапка: general, combined, attempts, test-details, export, scorm).

**Слой сервисов:** [server/services/](../../server/services/) -- бизнес-логика вынесена из
route-хендлеров:

- Расчёт и оценка: `result-compute.ts` (серверный расчёт результата, PRD-2/5/10),
  `result-context.ts` (контекст экрана итогов), `scoring-config.ts`, `effective-scoring.ts`
  (резолвер эффективной цены/градуировки/сложности, PRD-15 блок D).
- Поток и настройки теста: `flow-policy-validator.ts`, `variant-binding.ts`,
  `content-pages-lifecycle.ts`, `test-settings.ts`, `required-fields-validator.ts`,
  `retake-gate.ts` (PRD-6).
- Доступ (PRD-13/15): `access.ts` (роли/права + конфиг-суперадмины), `test-access.ts`
  (владелец/гранты теста), `topic-access.ts` (видимость/гранты темы, двухрежимный отзыв).
- Целостность и публикация (PRD-15): `content-guard.ts` + `draw-feasibility.ts` (защита
  зависимого контента, 409 + dry-run), `test-snapshot.ts` (снапшоты публикации, дрейф).
- Импорт/экспорт (PRD-14): `workbook-import.ts`, `questions-import.ts`, `questions-export.ts`.
- Шаблоны (PRD-3/7/12): `template-render.ts` (layout+CSS для веб-хоста), `template-dir.ts`,
  `template-package.ts`, `template-rebind.ts`, `template-validation.ts`.

### Middleware авторизации

| Middleware | Описание |
| --- | --- |
| `requireAuth` | Проверка наличия сессии |
| `requirePermission(...)` | Проверка права из ролевой модели PRD-13 (объединение по ролям + конфиг-суперадмин) |
| Object scope | Область объекта поверх роли: владелец/гранты теста (`test-access`), видимость/гранты темы (`topic-access`) |
| `rejectBase64MediaUrl` | Блокировка inline base64 в mediaUrl |

> Устаревшие `requireAuthor` / `requireLearner` удалены с закрытием PRD-13 (T-10, миграция 017):
> роли живут только в `user_roles`, доступ гейтится через `requirePermission` + область объекта.

### Конфигурация

- **Session:** `express-session` + `memorystore`, TTL 24 часа
- **File upload:** `multer`, лимит 200MB, whitelist MIME (image/audio/video)
- **Media directory:** `uploads/media/`

### Группы эндпоинтов

| Группа | Кол-во | Примеры |
| --- | --- | --- |
| Authentication | 8 | `/api/auth/login`, `/api/auth/forgot-password` |
| Users | 10 | `/api/users`, `/api/users/:id/deactivate` |
| Groups | 7 | `/api/groups`, `/api/groups/:id/users` |
| Test Assignments | 4 | `/api/tests/:id/assignments`, bulk |
| Folders | 4 | `/api/folders` CRUD |
| Topics | 7 | `/api/topics`, `/api/topics/:id/duplicate` |
| Questions | 8 | `/api/questions`, import/export XLSX |
| Tests | 6 | `/api/tests`, `/api/tests/:id/export/scorm` |
| Learner Test Taking | 5 | `start`, `start-adaptive`, `save-progress`, `resume` |
| Answer Submission | 2 | `answer-adaptive`, `finish` |
| Results | 2 | `result`, `attempts` |
| Analytics | 7 | `/api/analytics`, export Excel |
| SCORM Telemetry | 3 | `start`, `answer`, `finish` |
| SCORM Packages | 5 | CRUD + regenerate key |
| Export | 3 | Excel, Excel-LMS |
| SCORM Analytics | 2 | SCORM attempts |

**Итого:** ~83 эндпоинта.

---

## 7. Shared Schema

**Файл:** [shared/schema.ts](../../shared/schema.ts)

Содержит определения всех таблиц (Drizzle ORM) и Zod-схемы валидации.

### Таблицы

| Таблица | Описание |
| --- | --- |
| `users` | Пользователи (encrypted email, status, GDPR; столбец `role` удалён миграцией 017) |
| `userRoles` | Мультироль пользователя (PRD-13; единственный источник хранимых ролей) |
| `groups` | Группы пользователей |
| `userGroups` | M:N связь users-groups |
| `testAssignments` | Назначения тестов (user/group) |
| `assignmentAccessTokens` | Magic-link токены доступа к назначению |
| `passwordResetTokens` | Токены сброса пароля (HMAC-SHA256, TTL 30 мин) |
| `folders` | Иерархия папок для тем |
| `topics` | Темы вопросов (owner/visibility/feedback_json/code) |
| `topicAccessGrants` | Гранты доступа к теме (use/manage; PRD-15) |
| `questions` | Вопросы (4 типа: single, multiple, matching, ranking) |
| `tests` | Тесты (standard/adaptive, versioned, status draft/published/archived) |
| `testAccessGrants` | Гранты доступа к тесту (edit/assign; PRD-13) |
| `testFolders` | Иерархия папок для тестов |
| `testSections` | Секции теста (тема + drawCount + form_set + draw_blueprint) |
| `adaptiveTopicSettings` | Настройки адаптивного режима по темам |
| `adaptiveLevels` | Уровни адаптивного тестирования |
| `adaptiveLevelLinks` | Ссылки на материалы уровня |
| `attempts` | Попытки прохождения тестов (пин `snapshot_id`) |
| `testSnapshots` | Неизменные опубликованные версии теста (PRD-15) |
| `testQuestionScoring` | Переопределение оценки по (тест, вопрос) (PRD-15 блок D) |
| `scormPackages` | Экспортированные SCORM пакеты |
| `scormAttempts` | Попытки из LMS |
| `scormAnswers` | Ответы из LMS |
| `templates` | Дизайн-шаблоны (PRD-7) + админ-реестр внешних ZIP (PRD-3) |
| `contentPages` | Контентные страницы и системные узлы разделов (PRD-1/19) |
| `resultVariables` | Показатели результата `result.*` (PRD-2) |
| `scales`, `questionMeasurements` | Шкалы и вклады вопросов (PRD-5) |

Всего 29 таблиц. Legacy `topicCourses` / `topicEvents` удалены (миграция 024): рекомендации
темы живут в `topics.feedback_json`. Столбцы `questions.points` / `scoring_json` удалены
(миграция 028): оценка -- свойство теста (PRD-15 блок D, T-40).

Опциональные PRD-колонки (все nullable/с дефолтом, отсутствие = легаси-поведение):
`questions.tags` (PRD-11/2), `questions.difficulty` nullable (PRD-16, миграция 029),
`test_sections.draw_blueprint_json` (PRD-11), `test_sections.form_set_json` (PRD-17 варианты),
`tests.retake_policy_json` (PRD-6), `tests.allow_return_to_unanswered` / `allow_answer_change` /
`show_section_results` (PRD-19, миграция 031), `topics.code` (PRD-2, миграция 032).

### Доменные движки (shared/)

Помимо схемы, `shared/` содержит чистые browser-safe движки, общие для клиента, сервера и
SCORM-пакета: `scoring/` (цена ответа PRD-10 + эффективная оценка PRD-15), `scales/` + `formula/`
(шкалы/показатели PRD-5/2), `eligibility/` (retake PRD-6), `draw/` + `tags.ts` (квоты выдачи PRD-11 и фиксированные
варианты/формы PRD-17), `access/` (ролевая модель и права PRD-13), `template/`
(единый рендерер PRD-12). Единый источник логики -- без копий на хост.

---

## 8. Паттерны проектирования

| Паттерн | Применение |
| --- | --- |
| **Facade + Repository** | `IStorage` / `DatabaseStorage` (фасад) над 14 доменными репозиториями `server/storage/*` |
| **Singleton** | `storage`, `db`, `pool`, email transporter |
| **Builder** | SCORM пакеты собираются поэтапно через цепочку builders |
| **Factory** | `buildZip()`, `buildManifest()`, `buildTestJson()` |
| **Middleware** | `requireAuth`, `requirePermission` (PRD-13) + scope-мидлвары теста/темы |
| **Strategy** | standard vs adaptive режимы, percent vs absolute pass rules |
| **Template Method** | `readAsset()` -- поиск файла по нескольким путям |

---

## 9. Безопасность

| Аспект | Реализация |
| --- | --- |
| Аутентификация | Express-session, scrypt (PRD-9; legacy bcrypt через ленивый rehash при логине), 24h TTL |
| Авторизация | Ролевая модель PRD-13 (5 ролей, мультироль, `requirePermission`) + объектные области (владелец/гранты теста и темы) |
| Email | AES шифрование в БД, SHA-256 хеш для поиска |
| Сброс пароля | HMAC-SHA256 токены, 30 мин TTL, rate limit 3/час |
| Загрузка файлов | Whitelist MIME, лимит 200MB, блокировка base64 URL |
| SCORM | Secret key per package |
| XML | Экранирование спецсимволов в manifest |
| Path traversal | Защита в media-assets extractor |

---

## 10. Известные архитектурные особенности

1. **In-memory session store** -- `memorystore` не подходит для
   горизонтального масштабирования
2. **Единственная реализация IStorage** -- интерфейс определён,
   но используется только `DatabaseStorage`
3. **SCORM identifiers** хранятся в JSON-файле на диске,
   а не в базе данных

### Устранено (исторические пункты)

- ~~Монолитный `routes.ts` (~6000 строк)~~ -- маршрутизация разнесена на модульные роутеры
  в `server/routes/`; `routes.ts` стал тонким оркестратором (см. §6).
- ~~Отсутствие слоя сервисов~~ -- бизнес-логика вынесена в `server/services/` (см. §6).
