# PRD-7: Контракты и решения для реализации

**Версия:** 1.0
**Статус:** Утверждено для реализации
**Назначение:** Единственный источник истины по контрактам PRD-7. Младшие модели (Sonnet, Haiku)
работают с этим документом, а не с PRD-7 целиком, чтобы исключить ошибки от объёма контекста.
**Связанные документы:**

- [PRD-7](prd-7-test-settings-editor-refactor.md)
- [PRD-4](prd-4-course-flow-sections.md)
- [Стратегия реализации](prd-7-execution-strategy.md)
- [TODO](prd-7-implementation-todo.md)

---

## 1. Anti-goals

Что НЕ делать в рамках PRD-7:

- НЕ менять SCORM runtime (`server/scorm/`).
- НЕ менять модель вопросов (`questions`, `questionOptions`, `matchingPairs`).
- НЕ реализовывать новый `flowPolicy` runtime - только подготовить поверхность редактора.
- НЕ реализовывать новый `retakePolicy` runtime - только подготовить поверхность редактора.
- НЕ удалять `tests.published` и `tests.start_page_content` колонки в этом релизе - только пометить deprecated.
- НЕ удалять backward compatibility текущих endpoints `POST /api/tests` и `PUT /api/tests/:id`.
- НЕ менять схемы аналитики (`server/routes/analytics/*`).
- НЕ менять authentication/session.
- НЕ добавлять auto-save в `localStorage`/`sessionStorage` (FR-25j).
- НЕ создавать modal confirmation для переключения режимов, если данные не удаляются (FR-25e).

---

## 2. Enum-контракты

Все enum фиксируются здесь и не обсуждаются в коде. Изменение требует обновления этого документа.

### 2.1 `tests.mode`

```ts
type TestMode = "standard" | "adaptive";
```

Default: `"standard"` (для legacy без поля).

### 2.2 `tests.status`

```ts
type TestStatus = "draft" | "published" | "archived";
```

Default: `"draft"`. Заменяет legacy `tests.published boolean`.

### 2.3 `flowMode`

```ts
type FlowMode = "linear_flat" | "linear_by_topics" | "mixed" | "router_by_topics";
```

Default: `"linear_flat"` (соответствует текущему поведению). Хранится в `tests.flow_policy_json.mode`,
но в `TestEditorModel` доступен как поле первого уровня для удобства UI.

| Значение | Поведение runtime (PRD-4) | UI вкладка "Структура" |
| --- | --- | --- |
| `linear_flat` | Текущий плоский режим | Темы как источник вопросов, без секционных страниц |
| `linear_by_topics` | Секционный последовательный | Темы и страницы до/после |
| `mixed` | Плоский с явными зонами | Зоны "Перед тестом" / "Блок вопросов" / "После теста" |
| `router_by_topics` | Router-flow (PRD-8) | Сценарная карта Router -> Раздел -> Возврат -> Итог |

### 2.4 `passDecisionPolicy`

```ts
type PassDecisionPolicy =
  | "overall_only"
  | "overall_and_required_topics"
  | "required_topics_only"
  | "all_topics_passed";
```

Default-логика:

- если `passRules.byTopic` пуст или все темы используют `inherit_overall` без custom правил -> `"overall_only"`;
- если есть хотя бы одна тема с `custom` или `none` -> `"overall_and_required_topics"`.

### 2.5 `passRules.overall.type`

```ts
type OverallPassType = "percent" | "absolute" | "none";
```

### 2.6 `passRules.byTopic[topicId].source`

```ts
type TopicPassSource = "inherit_overall" | "custom" | "none";
```

Запрещённая комбинация: `passDecisionPolicy = "all_topics_passed"` AND `topic.source = "inherit_overall"` AND
`overall.type = "none"`. Валидация блокирует сохранение (FR-15g).

### 2.7 `sections[].timeLimit.source`

```ts
type SectionTimeLimitSource = "inherit_test" | "custom" | "none";
```

Default: `"inherit_test"`.

### 2.8 `feedback.format`

```ts
type FeedbackFormat = "plain" | "richText" | "html";
```

Default: `"plain"` (для legacy `feedback: string`).

### 2.9 `flowSettings.router.completionPolicy`

```ts
type RouterCompletionPolicy = "all_required_completed" | "all_required_passed";
```

Default MVP: `"all_required_completed"` (см. PRD-8 §3.2).

### 2.10 `flowSettings.router.sectionUnlockRules[sectionId].mode`

```ts
type SectionUnlockMode =
  | "always_available"
  | "after_sections_completed"
  | "after_sections_passed";
```

Default: `"always_available"`.

---

## 3. JSON-shapes

### 3.1 `tests.flow_policy_json`

Пишется только если `flowMode != "linear_flat"` или явно настроены router-параметры. Для legacy и
default-случая колонка `null`.

```json
{
  "mode": "linear_by_topics",
  "router": null
}
```

Для `router_by_topics`:

```json
{
  "mode": "router_by_topics",
  "router": {
    "completionPolicy": "all_required_completed",
    "sectionOrder": "fixed",
    "showSectionResult": true,
    "allowReturnToCompleted": "summary_only",
    "finalResultButton": "enabled_after_completion",
    "sectionUnlockRules": {
      "section-id-1": { "mode": "always_available" },
      "section-id-2": {
        "mode": "after_sections_completed",
        "sectionIds": ["section-id-1"]
      }
    }
  }
}
```

### 3.2 `tests.overall_pass_rule_json`

Не меняется относительно текущей структуры.

```json
{ "type": "percent", "value": 70 }
```

Для `type: "none"` поле `value` игнорируется, но сохраняется как `0` для совместимости.

### 3.3 `test_sections.topic_pass_rule_json`

```json
{ "source": "inherit_overall" }
```

```json
{ "source": "custom", "type": "percent", "value": 60 }
```

```json
{ "source": "none" }
```

### 3.4 `tests.feedback_json` (новая структура)

Заменяет legacy `tests.feedback text`. На переходный период обе колонки существуют параллельно.

```json
{
  "format": "plain",
  "text": "Спасибо за прохождение теста.",
  "links": [
    { "title": "Документация", "url": "https://example.com/docs" }
  ],
  "assets": [
    {
      "id": "asset-uuid",
      "title": "Сертификат",
      "fileName": "certificate.pdf",
      "mimeType": "application/pdf",
      "scormHref": "feedback/certificate.pdf"
    }
  ]
}
```

### 3.5 `test_sections.feedback_json`

Та же структура, что и `tests.feedback_json` (§3.4), но scope - тема.

### 3.6 `tests.design_settings_json`

Не меняется относительно PRD-1.

---

## 4. Маппинг legacy-полей

### 4.1 `published` -> `status`

| `tests.published` | `tests.status` после миграции | `apiToEditorModel()` для legacy без `status` |
| --- | --- | --- |
| `true` | `"published"` | `"published"` |
| `false` | `"draft"` | `"draft"` |
| `null` | `"draft"` | `"draft"` |

При write-path: `status` пишется всегда, `published` синхронизируется (`status === "published"` -> `published = true`).

### 4.2 `start_page_content` -> `content_pages`

При SQL-миграции: для каждого `tests.start_page_content != null` создаётся запись:

```sql
INSERT INTO content_pages (id, test_id, topic_id, position, type, mode, ...)
VALUES (
  gen_random_uuid(),
  :test_id,
  NULL,                  -- стартовая страница без topic
  'before',              -- позиция before (до первой темы / на старте)
  'intro',
  'html',
  ...
);
```

Поле `tests.start_page_content` помечается deprecated, но не удаляется в этом релизе.

При `apiToEditorModel()`: если миграция не применена (legacy окружение), редактор не дублирует
content page - проверяет только наличие `start_page_content` и показывает баннер "требуется
миграция".

### 4.3 `feedback string` -> `FeedbackContent`

| Legacy | После маппинга |
| --- | --- |
| `null` или `""` | `{ format: "plain", text: "", links: [], assets: [] }` |
| `"some text"` | `{ format: "plain", text: "some text", links: [], assets: [] }` |
| Уже объект (новый формат) | Используется как есть, валидируется по zod-схеме |

### 4.4 Отсутствующие поля

| Поле | Default при отсутствии |
| --- | --- |
| `mode` | `"standard"` |
| `showDifficultyLevel` | `true` |
| `designSettingsJson` | `{}` |
| `flow_policy_json` | `null` (трактуется как `mode: "linear_flat"`) |
| `telemetryEnabled` | `false` |
| `webhookUrl` | `null` |
| `timeLimitMinutes` | `null` |
| `maxAttempts` | `null` |
| `showCorrectAnswers` | `false` |
| `test_sections.required` | `true` |
| `test_sections.time_limit_minutes` | `null` (трактуется как `inherit_test`) |
| `test_sections.feedback_json` | `{ format: "plain", text: "", links: [], assets: [] }` |
| `feedback.format` | `"plain"` |

---

## 5. API-контракты

### 5.1 Существующие endpoints (backward compatibility)

```text
GET  /api/tests
GET  /api/tests/:id
POST /api/tests
PUT  /api/tests/:id
DELETE /api/tests/:id
```

`POST` и `PUT` принимают как старый payload (с `published`), так и новый (с `status`). При наличии
`status` в payload приоритет у него; `published` синхронизируется обратно.

### 5.2 Новые endpoints

```text
PATCH /api/tests/:id/status
  body: { status: "draft" | "published" | "archived", expectedVersion: number }
  200: { id, status, version }
  409: { error: "version_conflict", currentVersion, expectedVersion }

DELETE /api/tests/:id
  body: { confirmTitle: string }
  204
  400: { error: "title_mismatch" }

POST /api/tests/:id/restore
  204 - переводит из archived в draft
```

### 5.3 Optimistic version check

Все мутирующие endpoints (`PUT`, `PATCH`) принимают `expectedVersion` и возвращают `409` при mismatch.
Поле `version` уже существует в `tests` (`integer not null default 1`).

```text
PUT /api/tests/:id
  body: { ...payload, expectedVersion: 5 }
  200: { ...test, version: 6 }
  409: { error: "version_conflict", currentVersion: 7, expectedVersion: 5 }
```

Версия инкрементируется только если изменения влияют на прохождение/экспорт (FR-25):

- изменения базовых настроек -> `version++`;
- изменения секций, adaptive, flow, design, content pages -> `version++`;
- изменения `status` через `PATCH /status` -> `version` не меняется (статус - метаданные);
- изменения `feedback.assets` метаданных без замены файла -> `version++`.

### 5.4 Структурированные ошибки валидации

Backend возвращает 400 с полем `fields` для всех validation-ошибок:

```json
{
  "error": "Validation failed",
  "fields": [
    {
      "field": "adaptive.topics[0].levels[1].minDifficulty",
      "code": "range_overlap",
      "message": "Минимальная сложность должна быть меньше максимальной"
    }
  ]
}
```

Коды ошибок:

```text
required
range
range_overlap
duplicate
unknown_reference
title_mismatch
version_conflict
forbidden_combination
```

---

## 6. Правила маппинга `editorModelToPayload()`

Все следующие правила обязательны и покрываются unit-тестами.

1. `required` темы берётся из `model.sections[].required`. НЕ из `model.passRules.byTopic`.
   `passRules.byTopic` не содержит поля `required` (FR-45).
2. В payload пишется `status`, НЕ `published`. Backend синхронизирует `published` из `status`.
3. `flow_policy_json` пишется только если `model.flowMode != "linear_flat"` или есть router-настройки.
4. Скрытые draft-настройки несовместимого режима (например, adaptive levels при `mode: "standard"`)
   НЕ попадают в payload (FR-25h, FR-25i).
5. `feedback.assets[].scormHref` НЕ пишется в payload - заполняется backend при сохранении файла.
6. `expectedVersion` берётся из `model.version` (snapshot при открытии редактора).
7. `tests.start_page_content` НЕ пишется новым кодом - стартовая страница управляется через
   `content_pages` типа `intro` без `topic_id` (FR-44).
8. Пустые строки нормализуются в `null` для nullable-полей (`description`, `webhookUrl`).

---

## 7. Правила маппинга `apiToEditorModel()`

1. Применить все default-значения из §4.4.
2. Для legacy `published` без `status` - см. §4.1.
3. Для legacy `feedback: string` - см. §4.3.
4. `flow_policy_json: null` -> `flowMode: "linear_flat"` и `flowSettings.router: undefined`.
5. Для legacy `start_page_content != null` без content page - показать баннер, НЕ создавать запись
   автоматически на frontend (это работа SQL-миграции).
6. Поле `model.version` берётся из API response для optimistic conflict check.
7. Скрытые draft-настройки несовместимого режима инициализируются пустыми, НЕ восстанавливаются
   из API (FR-25i).

---

## 8. UI-контракты

### 8.1 Drawer

| Параметр | Значение |
| --- | --- |
| Width desktop | `min(1120px, calc(100vw - 48px))` |
| Min width для двухпанельной "Настройки" | `960px` |
| Side nav threshold | `>= 960px` - side nav, `< 960px` - selector сверху |
| Focus on open | первый интерактивный элемент (NFR-19) |
| Tab trap | работает без ловушки фокуса вне Drawer (NFR-20) |

### 8.2 Валидация

| Параметр | Значение |
| --- | --- |
| Debounce | 300 мс (NFR-18) |
| Trigger | `blur` или значимое изменение значения |
| `warning` | не блокирует сохранение |
| `error` | блокирует сохранение |
| Отображение | у поля + в сводке секции с anchor |

### 8.3 Footer Drawer

| Элемент | Поведение |
| --- | --- |
| "Сохранить" | active только при dirty + нет error |
| "Показать изменения" | видна только при dirty, открывает grouped summary |
| "Сбросить всё" | НЕ присутствует (FR-05b) |
| Строка изменённых областей | список вкладок с локальными dirty-индикаторами |

### 8.4 Confirmation dialogs

| Сценарий | Поведение |
| --- | --- |
| Закрытие с dirty | Dialog: "Сохранить", "Выйти без сохранения", "Отмена" |
| Закрытие с error | "Сохранить" disabled + переход к первой ошибочной секции |
| Удаление теста | Ввод точного названия теста (case-sensitive) |
| Переключение `mode`/`flowMode` | НЕТ modal, только inline warning (если данные не удаляются) |
| Optimistic conflict | Dialog: "Обновить данные" / "Сохранить поверх" |

---

## 9. Версионирование

| Изменение | `version++` | Триггер write |
| --- | --- | --- |
| `title`, `description`, `feedback`, `webhookUrl`, `telemetryEnabled` | да | `PUT /api/tests/:id` |
| `mode`, `flowMode`, `passRules`, `runtime`, `sections`, `adaptive` | да | `PUT /api/tests/:id` |
| `designSettingsJson` | да | `PUT /api/tests/:id/design` или `PUT /api/tests/:id` |
| `content_pages` (CRUD) | да (на тесте) | соответствующие endpoints content-pages |
| `status` через `PATCH /status` | нет | `PATCH /api/tests/:id/status` |
| `feedback.assets` метаданные | да | `PUT /api/tests/:id` |

---

## 10. Файловая структура

Целевая структура frontend:

```text
client/src/features/tests/editor/
  test-editor.tsx                 -- Drawer контейнер
  test-editor.types.ts            -- TestEditorModel, DTO, FeedbackContent
  test-editor.schema.ts           -- zod-схемы (опционально, можно объединить с validation)
  test-editor.mappers.ts          -- apiToEditorModel, editorModelToPayload
  test-editor.validation.ts       -- валидация полей и секций
  use-test-editor.ts              -- draft-state hook
  sections/
    basic-settings-section.tsx
    topics-structure-section.tsx
    pass-rules-section.tsx
    adaptive-settings-section.tsx
    start-pages-section.tsx
    design-section.tsx
  __tests__/
    test-editor.mappers.test.ts
    test-editor.validation.test.ts
    test-editor.test.tsx
    sections/
      basic-settings-section.test.tsx
      ...
```

Целевая структура backend:

```text
server/services/
  test-settings.ts                -- TestSettingsService с transaction
server/routes/
  tests.ts                        -- thin route handlers, делегируют в service
server/validation/
  test-settings.schema.ts         -- zod-схема для request validation
```

---

## 11. Команды для проверки

| Команда | Что проверяет |
| --- | --- |
| `npm run check` | TypeScript типы во всём проекте |
| `npx vitest run client/src/features/tests/editor` | Тесты frontend редактора |
| `npx vitest run tests/services/test-settings.test.ts` | Тесты backend сервиса |
| `npx vitest run tests/routes.tests.test.ts` | Тесты route handlers |
| `npx vitest run tests/migration-prd7.test.ts` | Тесты SQL-миграции |
| `npx vitest run` | Полный test suite (проверка регрессии) |

---

## 12. Точки расширения для следующих PRD

После завершения PRD-7 следующие PRD добавляют разделы в существующий контракт без рефакторинга:

| PRD | Точка добавления |
| --- | --- |
| PRD-4 | `flowMode` runtime реализация, `tests.flow_policy_json` runtime использование |
| PRD-6 | Новая секция "Повторное прохождение" в side nav вкладки "Настройки", `tests.retake_policy_json` |
| PRD-8 | Расширение `flowSettings.router` runtime, вкладка "Структура" в `router_by_topics` |
| PRD-2 | Новая вкладка "Показатели", `result_variables` |
| PRD-5 | Новая вкладка "Шкалы", `scales`, `question_measurements` |
| PRD-3 | Расширение секции "Оформление" статусами и actions из админ-API |

### 12.1 Колонки, отложенные на следующие PRD

#### `test_sections.sort_order integer` -> PRD-4

Колонка не добавляется в PRD-7. Причины:

- Порядок секций задействует `flowMode` runtime
  (`linear_flat` / `linear_by_topics` / `mixed`); без рантайма PRD-4 у колонки нет потребителя.
- PRD-7 frontend полагается на порядок массива `sections[]` в payload.
- Бэкенд сохраняет тот же порядок при INSERT в `TestSettingsService._insertSections()`.
