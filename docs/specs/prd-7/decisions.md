# PRD-7: Контракты и решения для реализации

**Версия:** 1.0
**Статус:** Утверждено для реализации
**Назначение:** Единственный источник истины по контрактам PRD-7. Младшие модели (Sonnet, Haiku)
работают с этим документом, а не с PRD-7 целиком, чтобы исключить ошибки от объёма контекста.
**Связанные документы:**

- [PRD-7 S0-S8 closed](./s0-s8-closed.md)
- [PRD-7 S9-S11 in progress](./s9-s11-in-progress.md)
- [PRD-4](../prd-4/course-flow-sections.md)
- [Стратегия реализации](./execution-strategy.md)
- [TODO](./implementation-todo.md)

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
type FlowMode = "linear_flat" | "linear_by_topics" | "router_by_topics";
```

Default: `"linear_flat"`. Хранится в `tests.flow_policy_json.mode`, в `TestEditorModel`
доступен как поле первого уровня для удобства UI.

| Значение | Поведение runtime (PRD-4) | UI вкладка "Структура" |
| --- | --- | --- |
| `linear_flat` | Плоский поток вопросов с зонами До/После теста | Единый блок вопросов из всех выбранных тем + зоны «До теста» и «После теста» для авторских страниц; без группировки по темам |
| `linear_by_topics` | Секционный последовательный | Темы и страницы до/после внутри каждой темы |
| `router_by_topics` | Router-flow (PRD-8) | Зоны «До теста» / «После теста» как в `linear_flat` + системная страница-маршрутизатор (`kind: router`) с темами как ветками иерархии (см. §2.3b) |

> **Историческое замечание.** Ранее enum содержал четвёртое значение `"mixed"`
> («плоский с явными зонами»), отличавшееся от `linear_flat` («плоский без
> секционных страниц») только наличием зон. После согласованного с эскизами
> переопределения `linear_flat` (зоны теперь входят в этот режим), `mixed` стал
> функциональным дублем и удалён из enum, см. §2.3a.

### 2.3a Удаление `mixed` из FlowMode

**Решение:** значение `"mixed"` удалено из `FlowMode` enum. До-`mixed` контракт
сохраняется через переопределение `linear_flat`.

**Обоснование.** До этого решения `linear_flat` определялся как «текущий плоский
режим (темы как источник вопросов, без секционных страниц)», а `mixed` —
как «плоский с зонами Перед/Блок/После». В approved-эскизе
`docs/wireframes/approved/prd7-structure-linear-flat.html` `linear_flat` уже
показывает зоны «До теста» и «После теста» с возможностью добавить авторские
страницы. Таким образом `mixed` функционально совпал с `linear_flat`:

- одинаковый UI вкладки «Структура» (две зоны + единый поток вопросов);
- одинаковое поведение runtime (плоский поток с авторскими страницами вне блока);
- единственная разница, ради которой раньше выделялся `mixed` (наличие зон),
  ушла внутрь нового определения `linear_flat`.

**Последствия:**

- enum `FlowMode` сокращён с 4 значений до 3 (`linear_flat`, `linear_by_topics`,
  `router_by_topics`);
- эскиз `docs/wireframes/prd7-structure-mixed.html` не создаётся; §10
  `wireframes-acceptance-checklist.md` удалён;
- PRD-4, specs/prd-7/s0-s8-closed.md, architecture/test-settings-parameter-structure.md
  обновлены — везде убраны упоминания `mixed`;
- миграции БД: ранее `tests.flow_policy_json.mode = 'mixed'` нигде не сохранялись
  (новый enum только в PRD-7, до релиза), миграции данных не требуется.

**Если в будущем потребуется** режим «плоский с перемешиванием вопросов внутри
блока» — это решается параметром `shuffleQuestions: boolean` внутри
`linear_flat`-конфигурации, а не отдельным значением `flowMode`.

### 2.3b Архитектура `router_by_topics` (модель Drawer / Structure)

**Решение:** `router_by_topics` строится на основе `linear_flat` (зоны «До теста» /
«После теста» — там обычные авторские страницы с inline-expand), плюс системная
страница-маршрутизатор и темы как ветки иерархии.

**Структура вкладки «Структура»:**

```text
┌─ Зона «До теста» ────────────────────────────┐
│  обычные авторские страницы (kind: info),    │
│  + Добавить страницу                         │
└──────────────────────────────────────────────┘

┌─ Внутри теста ───────────────────────────────┐
│  page-row, kind: router (единственная,       │  ← корень иерархии
│  неудаляемая, без insert до/после;            │
│  тихая привязка варианта по §4.3.2 PRD-1)    │
│   │                                           │
│   ├── topic-block «Тема 1»                    │  ← ветка
│   ├── topic-block «Тема 2»                    │  ← ветка
│   └── topic-block «Тема 3»                    │  ← ветка
│       (полноценные .topic-block из           │
│        linear_by_topics: страницы темы,      │
│        пороги, inline-expand)                │
└──────────────────────────────────────────────┘

┌─ Зона «После теста» ─────────────────────────┐
│  обычные авторские страницы (kind: info),    │
│  + Добавить страницу                         │
└──────────────────────────────────────────────┘
```

**Визуальная связь router-row и тем-веток** — tree-connectors `├─` `└─`
тонкими DS-линиями (`--ou-border-soft`, `1px`), без угловых акцентов и теней.
Реализация — отдельным wireframe `prd7-structure-router.html` (§11 чек-листа).

**Что НЕ входит в вкладку «Структура»:**

- `completionPolicy` и `sectionUnlockRules` — это **настройки сценария**, живут
  во вкладке «Настройки → Сценарий», условно при `flowMode = router_by_topics`
  (см. PRD-8 и §2.9/§2.10 настоящего документа). Структура отвечает только за
  «что внутри теста», не за «как тест работает в runtime».
- Состояния разделов прогресса (`not-started` / `in-progress` / `done-pass` /
  `done-fail` / `done` / `locked`) — это runtime-визуализация, не авторская
  настройка; в Drawer'е не показываются.
- `final-result-block`, `connector-wrap` со SVG-стрелками, `compact-router`
  strip, `sdp` detail-panel — устаревшие элементы старой «сценарной карты»
  модели, удалены.

**Жизненный цикл системной страницы `kind: router`:**

1. При переключении `flowMode` → `router_by_topics`: система создаёт
   единственную страницу `kind: router` с тихой привязкой default-варианта
   по §4.3.2 PRD-1.
2. Если в шаблоне теста нет варианта `kind: router` — fallback на вариант из
   стандартного шаблона + warning «Используется маршрутизатор из стандартного
   шаблона» возле бейджа.
3. Если в шаблоне > 1 router-вариантов — тихая привязка default + хинт
   «Доступно N вариантов» возле бейджа; смена через `…` row-menu → «Сменить
   вариант».
4. При смене `flowMode` обратно на `linear_flat` / `linear_by_topics`:
   router-row и её параметры (`completionPolicy`, `sectionUnlockRules`)
   **сохраняются в draft до закрытия редактора**. Во вкладке «Структура»
   состояние `s-mode-change` показывает info-banner: «Маршрутизатор и его
   параметры сохраняются до закрытия редактора — если вернуться к router
   в этой же сессии, настройки восстановятся. После сохранения теста в
   режиме linear* параметры маршрутизатора будут очищены». Никакого
   `s-mapping` диалога и предупреждения о потере; UX-правило — содержимое
   Состава и Структуры при смене режима не меняется, меняется только
   рендер.
5. Темы не удаляются и не «переходят» — они **остаются** во вкладке Состав
   с теми же draw-count / max-настройками. Меняется только их визуализация
   в Структуре: ветки router-page → плоский список тем (linear_by_topics)
   → плоский поток без группировки (linear_flat).

**Темы как ветки** — это те же `.topic-block`, что в `linear_by_topics`
(полноценные, с раскрытием страниц темы, порогами, inline-expand). Внутри
каждой темы — собственная `questions-row` (`kind: questions`, см. PRD-1 §4.3.5)
с **локальным** variant'ом: разные темы могут использовать разные варианты
макета вопросов. DnD тем работает: порядок веток меняется автором, но
runtime-порядок задаётся параметром `flowSettings.router.sectionOrder`
(см. PRD-8).

**Empty-states:**

- `s-empty-topics` — в составе теста нет тем: router-row есть, на месте веток
  показывается empty-state «В тесте нет тем» + CTA на вкладку «Состав».
- Empty-state для router-row отсутствует: вариант всегда привязан тихой логикой
  или fallback'ом; «нет варианта» — невозможное состояние.

**Валидация обязательных параметров** (см. PRD-1 §4.3.6) — применяется
универсально к router-row, всем questions-row внутри тем-веток, всем info-row
в зонах «До теста» / «После теста». Незаполненное обязательное поле любого
из них зажигает error-индикатор на табе «Структура» и блокирует Save до
устранения.

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

**UI:** настройка живёт во вкладке Drawer **«Настройки → Сценарий»**, условно
видима только при `flowMode = router_by_topics`. В вкладке «Структура» эта
настройка не отображается (§2.3b).

### 2.10 `flowSettings.router.sectionUnlockRules[sectionId].mode`

```ts
type SectionUnlockMode =
  | "always_available"
  | "after_sections_completed"
  | "after_sections_passed";
```

Default: `"always_available"`.

**UI:** настройка живёт во вкладке Drawer **«Настройки → Сценарий»**, условно
видима только при `flowMode = router_by_topics`. Редактируется по каждой теме
(`sectionId`). В вкладке «Структура» не отображается (§2.3b).

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
  (`linear_flat` / `linear_by_topics`); без рантайма PRD-4 у колонки нет потребителя.
- PRD-7 frontend полагается на порядок массива `sections[]` в payload.
- Бэкенд сохраняет тот же порядок при INSERT в `TestSettingsService._insertSections()`.
