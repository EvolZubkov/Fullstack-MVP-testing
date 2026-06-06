# Контракты редактора теста

**Статус:** актуально (описывает текущую модель данных и API редактора теста)  
**Дата актуализации:** 2026-06-06  
**Назначение:** единственный источник истины по контрактам редактора теста — enum,
JSON-shapes, API, маппинг legacy-полей, правила версионирования. Прозовое описание
параметров и UX — в [test-settings-parameter-structure.md](./test-settings-parameter-structure.md);
серверная архитектура — в [service-architecture.md](./service-architecture.md).

## Содержание

- [Enum-контракты](#enum-контракты)
- [JSON-shapes](#json-shapes)
- [Маппинг legacy-полей](#маппинг-legacy-полей)
- [API-контракты](#api-контракты)
- [Правила маппинга editorModelToPayload](#правила-маппинга-editormodeltopayload)
- [Правила маппинга apiToEditorModel](#правила-маппинга-apitoeditormodel)
- [Версионирование](#версионирование)
- [Точки расширения](#точки-расширения)

---

## Enum-контракты

Все enum фиксируются здесь. Изменение требует обновления этого документа.

### 2.1 `tests.mode`

```ts
type TestMode = "standard" | "adaptive";
```

Default: `"standard"` (для legacy без поля).

### 2.2 `tests.status`

```ts
type TestStatus = "draft" | "published" | "archived";
```

Default: `"draft"`. Заменяет legacy `tests.published boolean` (см. маппинг §4.1).

### 2.3 `flowMode`

```ts
type FlowMode = "linear_flat" | "linear_by_topics" | "router_by_topics";
```

Default: `"linear_flat"`. Хранится в `tests.flow_policy_json.mode`, в `TestEditorModel`
доступен как поле первого уровня для удобства UI.

| Значение | Поведение runtime (PRD-4) | UI вкладка "Структура" |
| --- | --- | --- |
| `linear_flat` | Плоский поток вопросов с зонами До/После теста | Единый блок вопросов из всех выбранных тем + зоны «До теста» и «После теста» для авторских страниц; без группировки по темам |
| `linear_by_topics` | Секционный последовательный | Темы и страницы до/после внутри каждой темы |
| `router_by_topics` | Router-flow (PRD-8) | Зоны «До теста» / «После теста» как в `linear_flat` + системная страница-маршрутизатор (`kind: router`) с темами как ветками иерархии (см. §2.3b) |

Enum содержит три значения. Ранее существовавшее `"mixed"` («плоский с явными зонами»)
удалено как функциональный дубль `linear_flat` после того, как зоны До/После вошли в
определение `linear_flat`. Режим «плоский с перемешиванием вопросов» при необходимости
решается параметром `shuffleQuestions: boolean` внутри `linear_flat`, а не отдельным `flowMode`.

### 2.3b Архитектура `router_by_topics` (модель Drawer / Structure)

`router_by_topics` строится на основе `linear_flat` (зоны «До теста» / «После теста» — обычные
авторские страницы с inline-expand), плюс системная страница-маршрутизатор и темы как ветки
иерархии.

```text
┌─ Зона «До теста» ────────────────────────────┐
│  обычные авторские страницы (kind: info),    │
│  + Добавить страницу                         │
└──────────────────────────────────────────────┘

┌─ Внутри теста ───────────────────────────────┐
│  page-row, kind: router (единственная,       │  ← корень иерархии
│  неудаляемая, без insert до/после;            │
│  тихая привязка варианта по §4.3.2 PRD-1)    │
│   ├── topic-block «Тема 1»                    │  ← ветка
│   ├── topic-block «Тема 2»                    │  ← ветка
│   └── topic-block «Тема 3»                    │  ← ветка
└──────────────────────────────────────────────┘

┌─ Зона «После теста» ─────────────────────────┐
│  обычные авторские страницы (kind: info),    │
│  + Добавить страницу                         │
└──────────────────────────────────────────────┘
```

Визуальная связь router-row и тем-веток — tree-connectors `├─` `└─` тонкими DS-линиями
(`--ou-border-soft`, `1px`).

Что НЕ входит в вкладку «Структура»:

- `completionPolicy` и `sectionUnlockRules` — это настройки сценария, живут во вкладке
  «Настройки → Сценарий», условно при `flowMode = router_by_topics` (см. PRD-8 и §2.9/§2.10).
- Состояния прогресса разделов (`not-started` / `in-progress` / `done-pass` / `done-fail` /
  `done` / `locked`) — runtime-визуализация, не авторская настройка.

Жизненный цикл системной страницы `kind: router`:

1. При переключении `flowMode` → `router_by_topics` система создаёт единственную страницу
   `kind: router` с тихой привязкой default-варианта по §4.3.2 PRD-1.
2. Если в шаблоне нет варианта `kind: router` — fallback на вариант стандартного шаблона +
   warning «Используется маршрутизатор из стандартного шаблона».
3. Если в шаблоне > 1 router-вариантов — тихая привязка default + хинт «Доступно N вариантов»;
   смена через `…` row-menu → «Сменить вариант».
4. При смене `flowMode` обратно на `linear_*` router-row и её параметры сохраняются в draft до
   закрытия редактора (info-banner `s-mode-change`); после сохранения в режиме `linear_*`
   параметры маршрутизатора очищаются. Никакого `s-mapping` диалога.
5. Темы не удаляются и не «переходят» — остаются во вкладке «Состав» с теми же настройками;
   меняется только их визуализация в «Структуре».

Темы как ветки — те же `.topic-block`, что в `linear_by_topics` (страницы темы, пороги,
inline-expand). DnD меняет авторский порядок веток; runtime-порядок задаётся
`flowSettings.router.sectionOrder` (см. PRD-8).

### 2.4 `passDecisionPolicy`

```ts
type PassDecisionPolicy =
  | "overall_only"
  | "overall_and_required_topics"
  | "required_topics_only"
  | "all_topics_passed";
```

Default-логика:

- если `passRules.byTopic` пуст или все темы используют `inherit_overall` без custom правил → `"overall_only"`;
- если есть хотя бы одна тема с `custom` или `none` → `"overall_and_required_topics"`.

### 2.5 `passRules.overall.type`

```ts
type OverallPassType = "percent" | "absolute" | "none";
```

### 2.6 `passRules.byTopic[topicId].source`

```ts
type TopicPassSource = "inherit_overall" | "custom" | "none";
```

Запрещённая комбинация: `passDecisionPolicy = "all_topics_passed"` AND `topic.source = "inherit_overall"`
AND `overall.type = "none"`. Валидация блокирует сохранение (FR-15g).

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

Default MVP: `"all_required_completed"` (см. PRD-8 §3.2). Настройка живёт во вкладке
«Настройки → Сценарий», условно видима только при `flowMode = router_by_topics`.

### 2.10 `flowSettings.router.sectionUnlockRules[sectionId].mode`

```ts
type SectionUnlockMode =
  | "always_available"
  | "after_sections_completed"
  | "after_sections_passed";
```

Default: `"always_available"`. Редактируется по каждой теме (`sectionId`) во вкладке
«Настройки → Сценарий».

---

## JSON-shapes

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

### 3.4 `tests.feedback_json`

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

Та же структура, что и `tests.feedback_json` (§3.4), но scope — тема.

### 3.6 `tests.design_settings_json`

Структура из PRD-1: `{ templateId, params }`. Значения media-типов хранятся envelope
`MediaParamValue` (см. [test-settings-parameter-structure.md §4](./test-settings-parameter-structure.md)).

---

## Маппинг legacy-полей

### 4.1 `published` → `status`

| `tests.published` | `tests.status` | `apiToEditorModel()` для legacy без `status` |
| --- | --- | --- |
| `true` | `"published"` | `"published"` |
| `false` | `"draft"` | `"draft"` |
| `null` | `"draft"` | `"draft"` |

При write-path: `status` пишется всегда, `published` синхронизируется
(`status === "published"` → `published = true`). Колонка `published` не удалена (backward compat).

### 4.2 `start_page_content` → `content_pages`

Для каждого `tests.start_page_content != null` SQL-миграция создаёт запись `content_pages`
(`topic_id = NULL`, `position = before`, `type/kind = intro`, `mode = html`). Поле
`tests.start_page_content` помечено deprecated, но не удалено в этом релизе. Новый код не читает
и не пишет `start_page_content`.

### 4.3 `feedback string` → `FeedbackContent`

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

## API-контракты

### 5.1 Endpoints

```text
GET    /api/tests
GET    /api/tests/:id
POST   /api/tests
PUT    /api/tests/:id
DELETE /api/tests/:id
PATCH  /api/tests/:id/status
POST   /api/tests/:id/restore
```

`POST` и `PUT` принимают как старый payload (с `published`), так и новый (с `status`). При наличии
`status` приоритет у него; `published` синхронизируется обратно. `GET /api/tests/:id` идемпотентно
вызывает `reconcileExisting()`, досоздавая отсутствующие системные страницы.

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
  204 — переводит из archived в draft
```

### 5.2 Optimistic version check

Все мутирующие endpoints (`PUT`, `PATCH`) принимают `expectedVersion` и возвращают `409` при mismatch.
Поле `version` существует в `tests` (`integer not null default 1`).

```text
PUT /api/tests/:id
  body: { ...payload, expectedVersion: 5 }
  200: { ...test, version: 6 }
  409: { error: "version_conflict", currentVersion: 7, expectedVersion: 5 }
```

### 5.3 Структурированные ошибки валидации

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

Коды ошибок: `required`, `range`, `range_overlap`, `duplicate`, `unknown_reference`,
`title_mismatch`, `version_conflict`, `forbidden_combination`.

---

## Правила маппинга editorModelToPayload

1. `required` темы берётся из `model.sections[].required`, НЕ из `model.passRules.byTopic`
   (`passRules.byTopic` не содержит `required`, FR-45).
2. В payload пишется `status`, НЕ `published`. Backend синхронизирует `published` из `status`.
3. `flow_policy_json` пишется только если `model.flowMode != "linear_flat"` или есть router-настройки.
4. Скрытые draft-настройки несовместимого режима НЕ попадают в payload (FR-25h, FR-25i).
5. `feedback.assets[].scormHref` НЕ пишется в payload — заполняется backend при сохранении файла.
6. `expectedVersion` берётся из `model.version` (snapshot при открытии редактора).
7. `tests.start_page_content` НЕ пишется — стартовая страница управляется через `content_pages`
   типа `intro` без `topic_id` (FR-44).
8. Пустые строки нормализуются в `null` для nullable-полей (`description`, `webhookUrl`).

---

## Правила маппинга apiToEditorModel

1. Применить все default-значения из §4.4.
2. Для legacy `published` без `status` — см. §4.1.
3. Для legacy `feedback: string` — см. §4.3.
4. `flow_policy_json: null` → `flowMode: "linear_flat"` и `flowSettings.router: undefined`.
5. Для legacy `start_page_content != null` без content page — показать баннер, НЕ создавать запись
   автоматически на frontend (это работа SQL-миграции).
6. Поле `model.version` берётся из API response для optimistic conflict check.
7. Скрытые draft-настройки несовместимого режима инициализируются пустыми, НЕ восстанавливаются
   из API (FR-25i).

---

## Версионирование

| Изменение | `version++` | Триггер write |
| --- | --- | --- |
| `title`, `description`, `feedback`, `webhookUrl`, `telemetryEnabled` | да | `PUT /api/tests/:id` |
| `mode`, `flowMode`, `passRules`, `runtime`, `sections`, `adaptive` | да | `PUT /api/tests/:id` |
| `designSettingsJson` | да | `PUT /api/tests/:id/design` или `PUT /api/tests/:id` |
| `content_pages` (CRUD) | да (на тесте) | соответствующие endpoints content-pages |
| `status` через `PATCH /status` | нет | `PATCH /api/tests/:id/status` |
| `feedback.assets` метаданные | да | `PUT /api/tests/:id` |

---

## UI-контракты

### 8.1 Drawer

| Параметр | Значение |
| --- | --- |
| Width desktop | `min(1120px, calc(100vw - 48px))` |
| Min width для двухпанельной "Настройки" | `960px` |
| Side nav threshold | `>= 960px` — side nav, `< 960px` — selector сверху |
| Focus on open | первый интерактивный элемент (NFR-19) |

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

### 8.4 Confirmation dialogs

| Сценарий | Поведение |
| --- | --- |
| Закрытие с dirty | Dialog: "Сохранить", "Выйти без сохранения", "Отмена" |
| Закрытие с error | "Сохранить" disabled + переход к первой ошибочной секции |
| Удаление теста | Ввод точного названия теста (case-sensitive) |
| Переключение `mode`/`flowMode` | НЕТ modal, только inline warning (данные не удаляются) |
| Optimistic conflict | Dialog: "Обновить данные" / "Сохранить поверх" |

---

## Точки расширения

Реализованные PRD добавляли разделы в этот контракт без рефакторинга. Открытые точки:

| PRD | Точка добавления |
| --- | --- |
| PRD-6 (Phase 2) | Админ-реестр конфигов retake gate; `tests.retake_policy_json` уже в контракте |
| PRD-3 | Расширение секции "Оформление" статусами и actions из админ-API загружаемых шаблонов |
| PRD-9 | Замена password-hashing (вне модели редактора) |

### Порядок секций тем — `test_sections.sort_order`

Колонка `test_sections.sort_order integer` добавлена миграцией 007 (backfill включён).
`getTestSections` упорядочивает секции по `sortOrder`; `_insertSections()` пишет индекс по
порядку массива. DnD во вкладке «Структура» меняет авторский порядок тем для `linear_by_topics`
и порядок веток-тем в `router_by_topics`.
