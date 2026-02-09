# План рефакторинга объектной модели серверных сервисов

## Текущее состояние

### Проблемы

#### 1. Монолитный routes.ts (6055 строк)

Файл `server/routes.ts` содержит ~83 эндпоинта и совмещает три роли:

- Маршрутизация HTTP-запросов
- Бизнес-логика (оценка ответов, аналитика, адаптивное тестирование)
- Форматирование данных (Excel, SCORM)

Это нарушает Single Responsibility Principle и делает код трудным
для тестирования, навигации и поддержки.

#### 2. Отсутствие сервисного слоя

Между маршрутами (routes) и хранилищем (storage) нет промежуточного слоя.
Бизнес-логика встроена непосредственно в обработчики маршрутов:

- Оценка ответов -- inline в handler `/finish` (~130 строк)
- Адаптивное тестирование -- inline в handler `/answer-adaptive` (~533 строк)
- Аналитика -- inline в нескольких handlers (~600+ строк с дублированием)
- Excel-экспорт -- inline в 3 handlers (~700+ строк с дублированием)

#### 3. Дублирование кода

Повторяющаяся логика в нескольких эндпоинтах:

| Логика | Где повторяется | Примерный объем |
| --- | --- | --- |
| Агрегация попыток | 4 endpoints аналитики | ~200 строк x4 |
| Построение Excel-таблиц | 3 endpoints экспорта | ~300 строк x3 |
| Загрузка связанных данных | Аналитика + экспорт | ~30 строк x5 |
| Проверка лимита попыток | standard + adaptive start | ~15 строк x2 |

#### 4. God Object в IStorage

Интерфейс `IStorage` содержит ~80 методов для всех сущностей. Класс
`DatabaseStorage` (~840 строк) реализует их все. Это затрудняет:

- Понимание API каждой доменной области
- Написание моков для тестирования
- Независимое развитие модулей

#### 5. Нетестируемая бизнес-логика

Бизнес-логика внутри route handlers невозможно протестировать без
поднятия HTTP-сервера. Функция `checkAnswer()` (строки 5995--6055) --
единственная вынесенная функция оценки, но она не экспортируется
и недоступна для unit-тестов.

---

## Целевая архитектура

### Слои приложения

```text
HTTP Request
     |
     v
+-----------+
|  Routes   |  Маршрутизация, валидация входных данных, HTTP-ответы
+-----------+
     |
     v
+-----------+
| Services  |  Бизнес-логика, оркестрация, расчеты
+-----------+
     |
     v
+-----------+
| Storage   |  CRUD-операции с БД (Repository pattern)
+-----------+
     |
     v
+-----------+
| Database  |  PostgreSQL через Drizzle ORM
+-----------+
```

### Принцип разделения

- **Routes** -- принимает HTTP-запрос, извлекает параметры, вызывает сервис,
  возвращает HTTP-ответ. Не содержит бизнес-логики.
- **Services** -- реализует бизнес-правила, оркестрирует вызовы к storage,
  выполняет расчеты. Не знает о HTTP (Request/Response).
- **Storage** -- CRUD-операции с базой данных. Не содержит бизнес-логики.

---

## Предлагаемые сервисы

### Приоритет 1 -- критичные (наибольший объем встроенной логики)

#### 1.1 ScoringService

**Обоснование:** Логика оценки ответов -- ядро приложения. Сейчас функция
`checkAnswer()` находится в конце routes.ts (строки 5995--6055) и не
экспортируется. Логика расчета результатов попытки (~130 строк) дублируется
между стандартным и адаптивным режимами.

**Что извлекается из routes.ts:**

- `checkAnswer()` (строки 5995--6055) -- проверка ответа по типу вопроса
- Расчет результата попытки из `/finish` (строки 2789--2919)
- Расчет частичного балла для `multiple` и `matching`
- Проверка `PassRule` (percent vs absolute)

**Целевой API:**

```text
server/services/scoring.ts

  checkAnswer(question, userAnswer) -> { isCorrect, points, partialPoints }
  calculateAttemptResult(variant, answers, passRule, topicPassRules) -> AttemptResult
  evaluatePassRule(rule, achieved, total) -> boolean
```

**Объем:** ~200 строк из routes.ts

---

#### 1.2 AdaptiveTestService

**Обоснование:** Handler `/answer-adaptive` -- самый длинный в проекте
(533 строк, строки 2095--2627). Содержит сложную логику навигации между
уровнями сложности, которую невозможно протестировать без HTTP-сервера.

**Что извлекается из routes.ts:**

- Построение адаптивного варианта из `/start-adaptive` (строки 1951--2092)
- Оценка ответа и переход между уровнями из `/answer-adaptive` (строки 2095--2627)
- Логика определения следующего уровня
- Завершение адаптивной попытки

**Целевой API:**

```text
server/services/adaptive-test.ts

  buildAdaptiveVariant(test, sections, levels, questions) -> AdaptiveVariant
  evaluateAdaptiveAnswer(attempt, questionId, answer) -> AdaptiveStepResult
  determineLevelTransition(currentLevel, results) -> NextLevelDecision
  finalizeAdaptiveAttempt(attempt) -> AttemptResult
```

**Зависимости:** `ScoringService` (для `checkAnswer`)

**Объем:** ~600 строк из routes.ts

---

#### 1.3 AnalyticsService

**Обоснование:** Логика аналитики разбросана по 7 endpoints (~600+ строк)
с существенным дублированием. Одна и та же агрегация попыток выполняется
в 4 разных местах.

**Что извлекается из routes.ts:**

- Расчет метрик теста из `/analytics/tests/:testId` (строки 3211--3555)
- Статистика по темам (строки 3264--3318)
- Статистика по вопросам (строки 3320--3410)
- Распределение сложности из `/topics/:id/difficulty-distribution` (строки 1473--1553)
- Агрегация Web + LMS попыток из `/analytics/combined` (строки 3732--5994)
- Статистика SCORM-попыток (строки 3556--3730)

**Целевой API:**

```text
server/services/analytics.ts

  calculateTestMetrics(testId) -> TestMetrics
  calculateTopicStats(attempts, sections) -> TopicStats[]
  calculateQuestionStats(attempts, questions) -> QuestionStats[]
  calculateDifficultyDistribution(questions) -> DifficultyDistribution
  aggregateAttempts(webAttempts, scormAttempts) -> CombinedMetrics
```

**Объем:** ~600 строк из routes.ts (с устранением дублирования ~350 строк)

---

#### 1.4 ExcelExportService

**Обоснование:** Три endpoint формируют Excel-файлы с повторяющейся логикой
построения листов и форматирования данных (~700 строк). Вспомогательные
функции форматирования (`formatQuestionType`, `formatAllOptions`,
`formatCorrectAnswerText`, `formatUserAnswerText`) используются в нескольких
endpoints.

**Что извлекается из routes.ts:**

- Экспорт аналитики теста из `/export/excel` (строки 4123--4463)
- Экспорт для LMS из `/export/excel-lms` (строки 5009--5346)
- Функции форматирования (строки 4467--4603)
- Построение фильтров из `/export/filters` (строки 4604--4704)

**Целевой API:**

```text
server/services/excel-export.ts

  generateTestAnalyticsExcel(testId) -> Buffer
  generateCombinedExcel(filters) -> Buffer
  generateLmsExcel(filters) -> Buffer

server/services/formatters.ts  (вспомогательный)

  formatQuestionType(type) -> string
  formatAllOptions(question) -> string
  formatCorrectAnswerText(question) -> string
  formatUserAnswerText(question, answer) -> string
```

**Зависимости:** `AnalyticsService` (для получения данных)

**Объем:** ~700 строк из routes.ts

---

### Приоритет 2 -- высокий

#### 2.1 TestVariantService

**Обоснование:** Логика построения варианта теста (случайный отбор вопросов
из тем, перемешивание) дублируется между стандартным и адаптивным режимами.
Отдельный сервис позволит тестировать алгоритм отбора вопросов независимо.

**Что извлекается из routes.ts:**

- Построение стандартного варианта из `/start` (строки 2630--2701)
- Проверка лимита попыток
- Логика `drawCount` и перемешивания

**Целевой API:**

```text
server/services/test-variant.ts

  buildStandardVariant(test, sections, questions) -> TestVariant
  checkAttemptsLimit(userId, testId, maxAttempts) -> { allowed, remaining }
```

**Объем:** ~80 строк из routes.ts

---

#### 2.2 ScormTelemetryService

**Обоснование:** SCORM-телеметрия включает верификацию HMAC-подписей,
rate limiting и управление состоянием попыток. Эта логика критична
для безопасности и должна быть изолирована для тестирования.

**Что извлекается из routes.ts:**

- Верификация подписей (строки 5376--5407)
- Rate limiting (строки 5358--5374)
- Start/answer/finish (строки 5411--5592)

**Целевой API:**

```text
server/services/scorm-telemetry.ts

  verifySignature(packageId, payload, signature) -> boolean
  checkRateLimit(packageId) -> boolean
  startSession(packageId, sessionId) -> ScormAttempt
  saveAnswer(attemptId, answer) -> ScormAnswer
  finishSession(attemptId, result) -> ScormAttempt
```

**Объем:** ~240 строк из routes.ts

---

#### 2.3 QuestionImportExportService

**Обоснование:** Парсинг Excel при импорте вопросов (строки 1360--1471) --
сложная логика с обработкой 4 типов вопросов и валидацией. Экспорт вопросов
(строки 1299--1359) также содержит логику форматирования.

**Целевой API:**

```text
server/services/question-import-export.ts

  importFromExcel(buffer) -> { questions: InsertQuestion[], errors: string[] }
  exportToExcel(questions, topics) -> Buffer
```

**Объем:** ~170 строк из routes.ts

---

### Приоритет 3 -- средний

#### 3.1 AuthService

**Обоснование:** Логика аутентификации разбросана между routes.ts
(middleware + password reset) и storage.ts (`validatePassword`).
Выделение в сервис упростит добавление новых механизмов (JWT, OAuth).

**Целевой API:**

```text
server/services/auth.ts

  login(email, password) -> { user, session }
  logout(sessionId) -> void
  requestPasswordReset(email, ip) -> void
  verifyResetToken(token) -> { valid, userId }
  resetPassword(token, newPassword) -> void
  completeFirstLogin(userId, newPassword, gdprConsent) -> User
```

**Объем:** ~200 строк из routes.ts

---

#### 3.2 ScormExportService

**Обоснование:** Эндпоинт `/tests/:id/export/scorm` (строки 1816--1907)
содержит логику подготовки данных для SCORM-пакета (загрузка секций,
тем, вопросов, курсов, адаптивных настроек, генерация ключей телеметрии).
Основная генерация уже вынесена в `server/scorm/`, но оркестрация осталась
в routes.

**Целевой API:**

```text
server/services/scorm-export.ts

  exportTestAsScorm(testId, userId) -> { buffer: Buffer, filename: string, packageId: string }
```

**Объем:** ~90 строк из routes.ts

---

## Рефакторинг Storage (IStorage)

### Текущая проблема

Интерфейс `IStorage` -- God Interface с ~80 методами. При тестировании
любого сервиса приходится мокировать все 80 методов, даже если сервис
использует только 3.

### Предложение: декомпозиция на доменные репозитории

```text
server/storage/
  index.ts              # Реэкспорт всех репозиториев
  user.repository.ts    # UserRepository (getUser, createUser, ...)
  group.repository.ts   # GroupRepository
  topic.repository.ts   # TopicRepository + TopicCourseRepository
  question.repository.ts # QuestionRepository
  test.repository.ts    # TestRepository + TestSectionRepository
  attempt.repository.ts # AttemptRepository
  adaptive.repository.ts # AdaptiveTopicSettings, Levels, Links
  scorm.repository.ts   # ScormPackage, ScormAttempt, ScormAnswer
  folder.repository.ts  # FolderRepository
  assignment.repository.ts # TestAssignment
  password-reset.repository.ts # PasswordResetToken
```

### Обоснование

| Критерий | Сейчас (1 класс) | После (12 репозиториев) |
| --- | --- | --- |
| Размер класса | ~840 строк | ~50-120 строк каждый |
| Мокирование в тестах | 80 методов | 3-5 методов для нужного репозитория |
| Навигация по коду | Ctrl+F в одном файле | Переход к конкретному файлу |
| Добавление метода | Изменение IStorage + DatabaseStorage | Изменение одного репозитория |
| Обратная совместимость | Сохраняется через фасад `storage` | Фасад реэкспортирует все |

### Стратегия миграции

Для обратной совместимости объект `storage` можно сохранить как фасад:

```text
// server/storage/index.ts
export const storage = {
  ...userRepository,
  ...groupRepository,
  ...testRepository,
  // ... и т.д.
}
```

Это позволяет мигрировать сервисы постепенно: новый код использует
конкретные репозитории, старый продолжает работать через фасад.

---

## Рефакторинг маршрутов

### Текущая проблема

Один файл routes.ts содержит все 83 эндпоинта.

### Предложение: разделение по доменам

```text
server/routes/
  index.ts          # registerRoutes() -- импортирует все роутеры
  auth.routes.ts    # /api/auth/*
  user.routes.ts    # /api/users/*
  group.routes.ts   # /api/groups/*
  topic.routes.ts   # /api/topics/*
  question.routes.ts # /api/questions/*
  test.routes.ts    # /api/tests/*
  attempt.routes.ts # /api/attempts/*, /api/learner/*
  analytics.routes.ts # /api/analytics/*
  export.routes.ts  # /api/export/*
  scorm.routes.ts   # /api/scorm-telemetry/*, /api/scorm-packages/*
  media.routes.ts   # /api/media/*
```

### Middleware

```text
server/middleware/
  auth.middleware.ts     # requireAuth, requireAuthor, requireLearner
  upload.middleware.ts   # multer configuration
  validation.middleware.ts # rejectBase64MediaUrl
```

---

## Целевая структура файлов

```text
server/
  index.ts
  db.ts
  email.ts
  middleware/
    auth.middleware.ts
    upload.middleware.ts
    validation.middleware.ts
  routes/
    index.ts
    auth.routes.ts
    user.routes.ts
    group.routes.ts
    topic.routes.ts
    question.routes.ts
    test.routes.ts
    attempt.routes.ts
    analytics.routes.ts
    export.routes.ts
    scorm.routes.ts
    media.routes.ts
  services/
    scoring.ts
    adaptive-test.ts
    analytics.ts
    excel-export.ts
    formatters.ts
    test-variant.ts
    scorm-telemetry.ts
    scorm-export.ts
    question-import-export.ts
    auth.ts
  storage/
    index.ts
    user.repository.ts
    group.repository.ts
    topic.repository.ts
    question.repository.ts
    test.repository.ts
    attempt.repository.ts
    adaptive.repository.ts
    scorm.repository.ts
    folder.repository.ts
    assignment.repository.ts
    password-reset.repository.ts
  scorm/
    ... (без изменений)
  utils/
    crypto.ts
    mask-email.ts
```

---

## Порядок выполнения

### Этап 1: Извлечение сервисов (без изменения routes.ts)

Создать сервисы как отдельные модули, вынеся в них логику из routes.ts.
На этом этапе routes.ts импортирует сервисы и вызывает их методы
вместо inline-кода. Структура файлов routes.ts не меняется.

**Порядок:**

1. `ScoringService` -- базовый сервис, от которого зависят остальные
2. `TestVariantService` -- используется в start handlers
3. `AdaptiveTestService` -- использует ScoringService
4. `AnalyticsService` -- независимый
5. `ExcelExportService` + `formatters` -- использует AnalyticsService
6. `ScormTelemetryService` -- независимый
7. `QuestionImportExportService` -- независимый
8. `AuthService` -- независимый
9. `ScormExportService` -- независимый

**Результат:** routes.ts уменьшается с ~6000 до ~2000 строк.

### Этап 2: Разделение routes.ts на модули

После извлечения сервисов в routes.ts останутся только тонкие обработчики.
Разделить на доменные файлы маршрутов.

**Результат:** каждый файл маршрутов -- 100-300 строк.

### Этап 3: Декомпозиция Storage

Разделить `DatabaseStorage` на доменные репозитории. Создать фасад
для обратной совместимости.

**Результат:** вместо одного файла 840 строк -- 12 файлов по 50-120 строк.

### Этап 4: Извлечение middleware

Вынести middleware в отдельные файлы.

**Результат:** чистое разделение ответственности.

---

## Ожидаемый результат

### Метрики до и после

| Метрика | До | После |
| --- | --- | --- |
| Размер routes.ts | 6055 строк | Удален (12 файлов по 100-300 строк) |
| Размер storage.ts | 983 строк | 12 файлов по 50-120 строк |
| Максимальный handler | 533 строк | 10-30 строк |
| Тестируемость бизнес-логики | Невозможна без HTTP | Unit-тесты сервисов |
| Дублирование кода (аналитика) | ~800 строк | ~350 строк (общие методы) |
| Количество файлов в server/ | 8 | ~35 |

### Преимущества

1. **Тестируемость.** Сервисы -- чистые функции/классы без привязки к HTTP.
   Unit-тесты пишутся с минимальными моками.

2. **Навигация.** Разработчик находит нужный код за секунды:
   логика оценки -- в `scoring.ts`, аналитика -- в `analytics.ts`.

3. **Повторное использование.** `ScoringService.checkAnswer()` вызывается
   из стандартного, адаптивного и SCORM режимов без дублирования.

4. **Параллельная разработка.** Изменения в аналитике не конфликтуют
   с изменениями в адаптивном тестировании (разные файлы).

5. **Устранение дублирования.** Общая логика агрегации
   и форматирования -- в одном месте.

### Риски

| Риск | Вероятность | Митигация |
| --- | --- | --- |
| Регрессия при извлечении сервисов | Средняя | Unit-тесты на каждый сервис до рефакторинга routes |
| Циклические зависимости между сервисами | Низкая | Строгая иерархия: сервисы зависят только от storage и друг от друга "вниз" |
| Увеличение числа файлов усложняет навигацию | Низкая | Предсказуемая структура каталогов, JSDoc |
| Обратная совместимость storage | Низкая | Фасад `storage` сохраняет существующий API |
