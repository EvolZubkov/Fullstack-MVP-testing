# TODO: Реализация PRD-7 - рефакторинг редактора параметров теста

**Связанный PRD:** [PRD-7](prd-7-test-settings-editor-refactor.md)
**Контракты и решения:** [decisions.md](prd-7-decisions.md) - читать ДО написания кода
**Baseline текущего поведения:** [prd-7-baseline.md](prd-7-baseline.md)
**Стратегия и промпты:** [execution-strategy.md](prd-7-execution-strategy.md)
**Roadmap:** [ROADMAP.md](ROADMAP.md) шаг 1
**Статус:** S0 закрыта (skeleton + decisions + baseline); ожидание старта S1
**Правило UI:** UI-разработка начинается только после подготовки и явного согласования wireframes
([BRD §2.6](brd-scorm-enhancements.md), NFR-14, NFR-19...NFR-21).

---

## 0. Перед началом любой задачи

### 0.1 Definition of Done (применяется к каждому пункту)

Чекбокс отмечается завершённым только если:

1. Код написан в указанном файле (см. §11 [decisions.md](prd-7-decisions.md)).
2. `npm run check` проходит без ошибок.
3. Затронутые тесты `vitest run <соответствующий файл>` зелёные.
4. Нет `console.log`, `debugger`, `TODO` в коммитуемом коде.
5. Все enum, JSON-shapes и default-значения соответствуют [decisions.md](prd-7-decisions.md).
6. Маппинг legacy-полей выполнен по §4 [decisions.md](prd-7-decisions.md).

### 0.2 Anti-goals

См. §1 [decisions.md](prd-7-decisions.md). Категорически:

- НЕ менять SCORM runtime, модель вопросов, аналитику, authentication.
- НЕ удалять `tests.published` и `tests.start_page_content` колонки.
- НЕ добавлять auto-save в `localStorage`.
- НЕ создавать modal confirmation для переключения режимов без удаления данных.

### 0.3 Если задача неясна

1. Перечитать соответствующий FR в [PRD-7](prd-7-test-settings-editor-refactor.md).
2. Проверить контракт в [decisions.md](prd-7-decisions.md).
3. Если решение требует нового enum/shape - НЕ изобретать, а эскалировать на Opus с описанием
   гэпа в decisions.md.

### 0.4 Карта сессий и разделов

Все разделы §1 привязаны к сессиям из [execution-strategy.md](prd-7-execution-strategy.md) §1.4.
Стартуя сессию, ищите её здесь, чтобы понять, какие разделы todo выполнить.

| Сессия | Фаза | Разделы todo | Что делает |
| --- | --- | --- | --- |
| S0 | Фаза 0 | §1.1, §1.2 | Контракты, baseline, skeleton (готово) |
| S1 | Фаза W | §1.3 | Wireframes (модель) + согласование (продакт) |
| S2 | Фаза 1A + 1B | §1.4, §1.10, §1.11 | SQL-миграция, backend сервис и endpoints |
| S3 | Фаза 2A + 2B + 3A + 3B | §1.5, §1.6, §1.13.1 (mappers/validation) | Типы, mappers, валидация + их unit-тесты |
| S4 | Фаза 4A + 4B | §1.7, §1.8 (только секция basic), §1.9 (открытие из карточки) | Drawer-каркас + reference-секция basic |
| S5 | Фаза 5A | §1.8 (topics-structure) | Секция "Состав" |
| S6 | Фаза 5B | §1.8 (pass-rules) | Секция правил прохождения |
| S7 | Фаза 5C | §1.8 (adaptive-settings) | Adaptive-секция |
| S8 | Фаза 5D + 5E | §1.8 (start-pages, design) | Start-pages + design секции |
| S9 | Фаза 6A + 6B | §1.13.2, §1.13.3, §1.13.4 | Component, API, regression тесты |
| S10 | Фаза 7A | §1.12, §1.9 (удаление wizard) | Удаление legacy |
| S11 | Фаза 7B + W.3C | §1.14, §1.13.1 (миграция unit финализация) | Acceptance pass + edge-state wireframes |

Правила:

- Разделы внутри сессии выполняются последовательно, через `/model`-переключение
  без `/clear` (см. [execution-strategy.md](prd-7-execution-strategy.md) §1.4).
- Между сессиями - commit + обновление [decisions.md](prd-7-decisions.md), затем `/clear`.
- Параллельно с S2/S3 идёт согласование wireframes продактом (внешний шаг S1).

---

## 1. Порядок выполнения

### 1.1 Подготовка и baseline (S0 / Фаза 0)

Полный snapshot baseline зафиксирован в [prd-7-baseline.md](prd-7-baseline.md).
Используется для regression-проверок в S2-S10.

- [x] Создать skeleton-каркас в `client/src/features/tests/editor/`
      (см. файлы каталога).
- [x] Зафиксировать текущее поведение `POST /api/tests` и `PUT /api/tests/:id`
      для standard и adaptive режимов (baseline §1.1, §1.2).
- [x] Зафиксировать текущее поведение dialogs: design, content pages,
      export SCORM (baseline §2).
- [x] Зафиксировать manual regression scenarios для текущего wizard (baseline §8).
      Автоматизированный regression-набор откладывается до S2 (там появятся
      service abstractions); до тех пор golden-сценарии прогоняются вручную.
- [x] Зафиксировать текущие места вызова `TestsPage` (baseline §5).
- [x] Зафиксировать текущие точки чтения `tests.published` и
      `tests.start_page_content` (baseline §3, §4).
- [x] Сделать инвентаризацию `console.log`, debug-кода и TODO-комментариев
      в `client/src/pages/author/tests.tsx` (baseline §6).

### 1.2 Доменные контракты с PRD-4 (S0 / Фаза 0)

PRD-7 проектирует поверхность для `flowMode`, `passDecisionPolicy`, `sections[].required`,
которые принадлежат скоупу PRD-4. Контракты согласованы одним заходом и зафиксированы
в [decisions.md](prd-7-decisions.md) §2 и §3.

- [x] Согласованы значения `flowMode`: `linear_flat`, `linear_by_topics`,
      `router_by_topics` (decisions.md §2.3). Значение `mixed` удалено
      как функциональный дубль `linear_flat` (decisions.md §2.3a).
- [x] Согласован `passDecisionPolicy`: `overall_only`, `overall_and_required_topics`,
      `required_topics_only`, `all_topics_passed` (decisions.md §2.4).
- [x] Согласованы источники правил темы: `inherit_overall`, `custom`, `none` (decisions.md §2.6).
- [x] Согласована структура `sections[].timeLimit`:
      `inherit_test`, `custom`, `none` (decisions.md §2.7).
- [x] Согласована структура `sections[].required` (decisions.md §6.1).
- [x] Согласован DTO `flowSettings.router` (decisions.md §3.1).
- [x] Зафиксировано: `tests.flow_policy_json` пишется только если `flowMode != linear_flat`
      или явно настроен (decisions.md §3.1, §6.3).

### 1.3 Wireframes и согласование UI (S1 / Фаза W)

Wireframes хранятся в `docs/wireframes/`. Существующие `design-tab.html` и `pages-tab.html`
требуют ревизии под новую информационную архитектуру PRD-7. Полный список целевых файлов
с привязкой к FR/NFR: [execution-strategy.md](prd-7-execution-strategy.md) §W.1.
Промпты W.3A (Opus) и W.3B (Sonnet): там же §W.3A, §W.3B.

- [ ] Подготовить wireframes списка тестов с компактными actions (FR-30, FR-31, FR-08 BRD).
- [ ] Подготовить wireframes wide Drawer редактора: header, footer, агрегированные статусы вкладок (FR-03, FR-43).
- [ ] Подготовить wireframes вкладки **"Состав"**: выбор тем, draw count, обязательность, feedback темы.
- [ ] Подготовить wireframes вкладки **"Настройки"** с двухпанельным side nav (>= 960px) и
      selector (< 960px) (FR-43, NFR-19, NFR-20).
- [ ] Подготовить wireframes вкладки **"Оформление"**: выбор шаблона, params, read-only
      `templateVersion`/`templateApiVersion` (FR-26, FR-41, FR-42).
- [ ] Обновить wireframes вкладки **"Структура"** для всех `flowMode`:
      `linear_flat`, `linear_by_topics`, `router_by_topics`
      (FR-29, FR-33, FR-40, блокер из §7 PRD-7).
- [ ] Полностью переписать `prd7-structure-router.html` под новую модель
      `router_by_topics`: системная router-row + темы как ветки иерархии через
      tree-connectors (см. [prd-7-decisions.md §2.3b](prd-7-decisions.md)).
- [ ] Создать `prd7-variant-replace.html` — модал смены варианта на page-row
      с diff-блоком потерь параметров; состояния: `s-replace-modal`,
      `s-replace-empty-diff`, `s-replace-no-fields`.
- [ ] Обновить `prd7-structure-linear-flat.html` и
      `prd7-structure-linear-by-topics.html`:
      (1) добавить questions-row как `page-row--system` с variant select,
      expand при непустой schema, `…` row-menu;
      (2) добавить `…` row-menu на page-row всех системных kind
      (`intro`/`summary`/`questions`) с пунктом «Сменить вариант»;
      (3) хинт «Доступно N вариантов» рядом с бейджем при N > 1 вариантах
      нужного `kind`;
      (4) warning fallback на стандартный шаблон при 0 вариантов нужного `kind`;
      (5) inline-alert + warning-цвет заголовка row при незаполненных
      обязательных параметрах варианта (см. PRD-1 §4.3.6).
- [ ] Покрыть состояния: пустое, loading/saving, ошибки API, ошибки валидации,
      read-only, mobile/narrow viewport.
- [ ] Покрыть edge cases: 20+ тем, тема без вопросов, ошибка загрузки difficulty
      distribution, конфликт версий при сохранении.
- [ ] Подготовить wireframes confirmation dialog при закрытии с несохранёнными изменениями (FR-05, FR-05a, FR-05b).
- [ ] Подготовить wireframes "Показать изменения" в виде grouped summary (FR-25c, FR-25c1, FR-25c2).
- [ ] Подготовить wireframes confirmation dialog удаления теста с вводом точного названия (FR-30).
- [ ] Подготовить wireframes раздела **"Архив"** и восстановления теста из архива (FR-31).
- [ ] Подготовить wireframes стартовой страницы как content page типа `intro` без `topic_id` (FR-44).
- [ ] Подготовить wireframes inline warning при переключении `standard/adaptive` и `flowMode` (FR-25d, FR-25e, FR-25f).
- [ ] Подготовить wireframes индикаторов `изменено`, `warning`, `error` на вкладках и секциях (FR-25b, NFR-21).
- [ ] Подготовить wireframes optimistic conflict dialog "Обновить данные" / "Сохранить поверх" (FR-25k).
- [ ] Явно согласовать wireframes до старта frontend-разработки.
- [ ] Зафиксировать, что изменение сценария или состава полей требует повторного согласования.

### 1.4 Модель данных и миграция (S2 / Фаза 1A, Opus)

- [x] Добавить колонку `tests.status enum('draft','published','archived')` с default `draft`.
- [x] SQL-миграция: заполнить `tests.status` из `tests.published` (`true -> published`, `false -> draft`).
- [x] Сохранить колонку `tests.published` на переходный период; синхронизация из `status` в обратный маппер.
      _(колонка сохранена в миграции, deprecated-маркер в schema;_
      _write-path sync — в `storage.ts`/`TestSettingsService`; read-path mapper — §1.11)_
- [x] SQL-миграция: для непустых `tests.start_page_content` создать запись
      в `content_pages` типа `intro` без `topic_id`.
- [x] Пометить `tests.start_page_content` как deprecated в `shared/schema.ts` и в комментариях.
- [x] Обновить Drizzle-схему `tests` с новой колонкой `status`.
- [x] Добавить индекс `tests_status_idx` для фильтрации списков и архива.
- [x] Добавить колонку `test_sections.required boolean not null default true`.
- [x] Добавить колонку `test_sections.time_limit_minutes integer null` для индивидуального лимита темы (FR-34).
- [x] Добавить колонку `test_sections.feedback_json jsonb` (FR-36).
      _(по [decisions.md §3.4](prd-7-decisions.md#34-testsfeedback_json-новая-структура)_
      _`links` и `assets` хранятся внутри `feedback_json` — отдельные колонки_
      _`feedback_links_json`/`feedback_assets_json` не создаются.)_
- [x] Описать структуру `feedback` с полем `format: 'plain' | 'richText' | 'html'` для теста и темы.
      _(zod-схемы `feedbackContentSchema`, `feedbackLinkSchema`, `feedbackAssetSchema`,_
      _`feedbackFormatSchema` в `shared/schema.ts` + unit-тест `tests/schema-prd7-feedback.test.ts`.)_
- [x] Добавить колонку `tests.telemetry_enabled boolean not null default false` (FR-35).
- [x] Подготовить структуру для feedback PDF assets с упаковкой в SCORM (FR-37).
      _(хранится в `feedback_json.assets[]` по_
      _[decisions.md §3.4](prd-7-decisions.md#34-testsfeedback_json-новая-структура);_
      _`mimeType: "application/pdf"` зафиксирован zod-схемой;_
      _упаковка в SCORM — runtime-задача §6.5.)_
- [x] Покрыть migration unit-тестом на legacy-данные:
      `published=true`, `published=false`, непустой `start_page_content`.
- [x] Согласовать с PRD-4 совместное добавление `test_sections.sort_order` (блокер UI PRD-1).
      _(перенесено в [decisions.md §12.1](prd-7-decisions.md#121-колонки-отложенные-на-следующие-prd)_
      _как зависимость PRD-4: без `flowMode` runtime у колонки нет потребителя,_
      _PRD-7 использует порядок массива `sections[]` в payload.)_
- [ ] Добавить enum `VariantKind` = `"questions" | "router" | "summary" | "intro" | "info"`
      в zod-схему манифеста шаблона (см. PRD-1 §4.3).
- [ ] Валидация манифеста шаблона: каждый `variant` обязан иметь `kind`;
      шаблон с минимум одним вариантом `kind: questions` (один ejs-файл,
      рендерящий обёртки под все четыре типа интерактивов) — обязательное
      требование для встроенного default-шаблона.
- [ ] Унификация хранения системных kind: все четыре (`questions`/`router`/
      `summary`/`intro`) живут в `content_pages` как обычные записи с особым
      `kind`, см. PRD-1 §4.3.5; **в `design_settings_json` отдельное поле для
      комбо НЕ заводится** — variant `kind: questions` локальный per-row.
- [ ] Server-side логика тихой привязки системных вариантов (типы 1-4) при
      сохранении/смене `flowMode` или `templateId`: 1 → молча, N → default + dirty
      flag для UI-хинта, 0 → fallback на стандартный шаблон + warning flag.
- [ ] Server-side логика: при смене `flowMode` с `router_by_topics` на любой
      `linear_*` — авто-удаление страницы `kind: router` из `content_pages`
      (без миграции параметров).
- [ ] Server-side логика: при смене `flowMode` между `linear_flat` и
      `linear_by_topics`/`router_by_topics` — пересборка записей `kind: questions`:
      `linear_flat` → одна запись с `topicId: null`; `linear_by_topics`/
      `router_by_topics` → по одной записи на каждую тему с `topicId: <id>`.
      Параметры одной из старых записей переносятся на новые по правилу
      «имя поля = контракт между вариантами одного `kind`».
- [ ] Server-side логика: при добавлении темы в `test_sections` (в режимах
      `linear_by_topics` / `router_by_topics`) — auto-create записи
      `kind: questions` с `topicId: <new-topic-id>` и тихой привязкой
      default-варианта. При удалении темы — каскадное удаление records.
- [ ] Server-side логика: при смене `templateId` для системных вариантов —
      пересчёт привязки по `kind` с применением контракта «имя поля = контракт
      между вариантами одного `kind`»; несовместимые параметры удаляются молча
      (без диалога `s-mapping`).
- [ ] API endpoint `POST /api/tests/:id/pages/:pageId/replace-variant`:
      смена варианта существующей страницы с возвратом diff потерь параметров
      (для UI confirm-модала из `prd7-variant-replace.html`).
- [ ] **Валидация обязательных параметров** (PRD-1 §4.3.6): сервер при
      `PUT /api/tests/:id` проверяет, что все поля `required: true` в schema
      привязанного варианта заполнены для каждой записи `content_pages`.
      При нарушении — возвращает структурированную ошибку с указанием конкретных
      `pageId` и имён полей. Save не выполняется.
- [ ] Frontend: для каждой записи `content_pages` сравнить `values_json.values`
      с `variant.schema.fields` (только поля `required: true`). При незаполненных
      полях:
      - помечать `page-row` модификатором `page-row--warn` (warning-цвет заголовка);
      - показывать список конкретных полей в `page-row-expand` (warning-баннер);
      - агрегировать в `.status-dot--error` на табе «Структура» (общий по всем
        вкладкам индикатор согласно FR-25b / NFR-21);
      - блокировать кнопку «Сохранить» в footer Drawer'а (disabled + tooltip).

### 1.5 Доменная модель редактора - frontend (S3 часть 1 / Фаза 2A + 2B, Opus -> Sonnet)

Целевая структура каталогов (создана в S0):

```text
client/src/features/tests/editor/
  test-editor.tsx
  test-editor.types.ts
  test-editor.mappers.ts
  test-editor.validation.ts
  use-test-editor.ts
  sections/
    basic-settings-section.tsx
    topics-structure-section.tsx
    pass-rules-section.tsx
    adaptive-settings-section.tsx
    start-pages-section.tsx
    design-section.tsx
```

- [x] Создать каталог `client/src/features/tests/editor/` (готово в S0).
- [x] Описать `TestEditorModel` в `test-editor.types.ts` согласно PRD-7 §6.2 (готово в S0).
- [x] Описать `TestSettingsPayload`, `TestSectionPayload`, `AdaptiveSettingsPayload`
      в `test-editor.types.ts` согласно §6.3 (готово в S0).
- [x] Описать `FeedbackContent` с обязательным полем `format` (готово в S0).
- [x] Описать `FeedbackAsset` с `mimeType: "application/pdf"` (готово в S0).
- [x] Описать `AdaptiveTestSettings` - тестовый уровень, отдельно от уровня темы (готово в S0).
- [x] Реализовать `apiToEditorModel()` в `test-editor.mappers.ts` для standard и adaptive тестов.
      _(sections + byTopic, adaptive topics/levels/links, flowSettings router — `test-editor.mappers.ts`,
      фазы 2A + 2B.)_
- [x] Реализовать `editorModelToPayload()` в `test-editor.mappers.ts` с правилом:
      `required` берётся из `sections[].required`, не из `passRules.byTopic`.
      _(`mapEditorSectionsToPayload`, FR-45, фаза 2B.)_
- [x] В `editorModelToPayload()` исключить из payload скрытые draft-настройки несовместимого режима
      (FR-25h, FR-25i).
      _(`mapEditorAdaptiveToPayload` возвращает `null` для `mode === "standard"`, фаза 2B.)_
- [x] В `apiToEditorModel()` обеспечить fallback для legacy-полей: см. §4 [decisions.md](prd-7-decisions.md).
      _(все defaults §4.4, фаза 2A.)_
- [x] В `apiToEditorModel()` маппить legacy `published` в `status` согласно §4.1
      [decisions.md](prd-7-decisions.md).
      _(фаза 2A.)_
- [x] В `apiToEditorModel()` для legacy `start_page_content` показать баннер "требуется миграция",
      запись content page создаётся SQL-миграцией.
      _(маппер не падает и не создаёт content page автоматически; поле не попадает в модель —
      decisions §7.5, тест #5 в §1.13.1, фаза 2B.)_

> Draft-state hook `useTestEditor()`, guard от `localStorage`/`sessionStorage` (FR-25j)
> и version-tracking для optimistic conflict detection (FR-25k) перенесены в §1.7
> (фаза 4A) — это часть UI-слоя редактора, а не доменной модели/мапперов.

### 1.6 Валидация - frontend (S3 часть 2 / Фаза 3A + 3B, Sonnet -> Haiku)

- [x] Описать схему валидации в `test-editor.validation.ts`.
      _(plain TypeScript без zod; функция `validateTestEditor(model)` возвращает_
      _`{ errors, warnings }`; severity-поле `ValidationIssue` уже в типах. Фаза 3A.)_
- [x] Валидировать `title` обязательное (FR-11).
      _(фаза 3A.)_
- [x] Валидировать минимум одну выбранную тему (FR-12).
      _(фаза 3A.)_
- [x] Валидировать `drawCount` для standard от 1 до количества доступных вопросов темы (FR-13).
      _(фаза 3B; диапазон `[1, section.maxQuestions]`.)_
- [x] Валидировать `percent` pass rule 0..100 (FR-14).
      _(фаза 3A.)_
- [x] Валидировать `absolute` pass rule не больше числа выбранных вопросов (FR-15).
      _(фаза 3B; overall ≤ Σ drawCount, byTopic ≤ section.drawCount.)_
- [x] Валидировать `passDecisionPolicy` как валидный enum (FR-15a).
      _(фаза 3A; код `required` при неизвестной политике.)_
- [x] FR-15b..e закрыты вне §1.6 (валидация):
      _FR-15b — default `passDecisionPolicy` при появлении topic-rule —_
      _ответственность mapper/UI (§1.5 mapper, §1.8 секция pass-rules);_
      _FR-15c — runtime-семантика «пройден/не пройден» — не входит в скоуп редактора;_
      _FR-15d — `sections[].required` — покрыт колонкой и типом (§1.4, §1.5);_
      _FR-15e — поддержка `all_topics_passed` — покрыта FR-15a и decisions §2._
- [x] Валидировать `inherit_overall` для темы при общем правиле `none` -> блокировать сохранение (FR-15f, FR-15g).
      _(фаза 3A; FR-15g — `forbidden_combination` при_
      _`all_topics_passed` + `overall.type=none` + `inherit_overall`.)_
- [x] Валидировать adaptive уровень: `minDifficulty < maxDifficulty`, оба 0..100 (FR-16).
      _(фаза 3B.)_
- [x] Валидировать `questionsCount >= 1` для adaptive уровня (FR-17).
      _(фаза 3B.)_
- [x] Валидировать `passThreshold` adaptive по типу: percent 0..100, absolute 0..questionsCount (FR-18).
      _(фаза 3B.)_
- [x] Валидировать link adaptive уровня: title и URL обязательны (FR-19).
      _(фаза 3B; XOR — оба заполнены или оба пусты.)_
- [x] Валидировать `webhookUrl` как URL или пустое значение (FR-20).
      _(фаза 3A; принимаются только http/https.)_

> UI-интеграция валидации (debounced trigger FR-20a, severity-поведение FR-20b,
> якоря FR-20c) перенесена в §1.7 (фаза 4A) — это UI-слой, а не доменная
> валидация. Pure-функция `validateTestEditor` уже выдаёт `severity` и
> `field`-пути, готовые к использованию в UI.

### 1.7 UI-каркас редактора (S4 / Фаза 4A, Opus)

- [ ] Реализовать draft-state hook `useTestEditor()` со скрытыми настройками режима в memory
      (FR-25d, FR-25g, FR-25i).
- [ ] Гарантировать, что скрытые draft-настройки не сохраняются в `localStorage`/`sessionStorage`
      (FR-25j); guard при закрытии Drawer вместо автосохранения.
- [ ] Реализовать version-tracking для optimistic conflict detection (FR-25k):
      обработать `409 Conflict` ответ с dialog "Обновить данные" / "Сохранить поверх"
      (маппер уже кладёт `model.version` и `expectedVersion`, фазы 2A + 2B).
- [ ] Подключить `validateTestEditor()` через debounced trigger (300 мс) на blur
      и значимое изменение (FR-20a, NFR-18).
- [ ] Различать `warning` (не блокирует сохранение) и `error` (блокирует)
      по полю `severity` из `ValidationIssue` (FR-20b).
- [ ] Реализовать ссылки-якоря из сводки секции к проблемным полям, используя
      `field`-пути из `ValidationIssue` (FR-20c).
- [ ] Реализовать wide Drawer как контейнер `TestEditor` (FR-43).
- [ ] Layout: desktop width `min(1120px, calc(100vw - 48px))`.
- [ ] Минимальная ширина двухпанельной вкладки "Настройки": `960px`.
- [ ] При `>= 960px` использовать side nav второго уровня.
- [ ] При `< 960px` использовать selector секции сверху и одноколоночную форму.
- [ ] Стабильные header и footer Drawer без зависимости от выбранной секции.
- [ ] Реализовать индикаторы агрегированного состояния на вкладках (FR-25b).
- [ ] Реализовать индикаторы локального состояния `изменено`, `warning`, `error` на секциях (FR-25b).
- [ ] Реализовать `aria-label` для всех индикаторов (NFR-21).
- [ ] При открытии Drawer фокус переходит на первый интерактивный элемент (NFR-19).
- [ ] Tab/Shift-Tab работают без ловушки фокуса вне Drawer (NFR-20).
- [ ] Реализовать единую кнопку **"Сохранить"** в footer (FR-25a).
- [ ] Кнопка активна только при наличии изменений и отсутствии блокирующих ошибок (FR-04).
- [ ] Footer показывает строку изменённых областей и опциональное действие
      **"Показать изменения"** (FR-25c).
- [ ] **"Показать изменения"** показывает grouped summary по вкладкам/секциям (FR-25c1).
- [ ] **"Показать изменения"** видна только в dirty-состоянии (FR-25c2).
- [ ] Confirmation dialog при закрытии с несохранёнными изменениями:
      "Сохранить", "Выйти без сохранения", "Отмена" (FR-05).
- [ ] При блокирующих ошибках кнопка "Сохранить" в confirmation dialog disabled
      с переходом к первой ошибочной секции (FR-05a).
- [ ] В footer нет постоянной кнопки "Сбросить всё" (FR-05b).

### 1.8 Доменные секции редактора

Распределение по сессиям:

- секция basic-settings - **S4 / Фаза 4B (Sonnet)** как reference;
- секция topics-structure - **S5 / Фаза 5A (Haiku)**;
- секция pass-rules - **S6 / Фаза 5B (Haiku)**;
- секция adaptive-settings - **S7 / Фаза 5C (Haiku)**;
- секция start-pages - **S8 часть 1 / Фаза 5D (Haiku)**;
- секция design - **S8 часть 2 / Фаза 5E (Sonnet)**.

Reference для всех секций после S4: `basic-settings-section.tsx` + его тест.
Не реализовывать секцию без reference - это нарушает паттерн копирования.

#### S4 / Фаза 4B (Sonnet) - basic-settings (reference)

- [ ] Реализовать секцию **"Основные"** (basic-settings-section.tsx):
      title, description, status, feedback, telemetry, webhook (FR-35, FR-36).
- [ ] Реализовать редактор feedback с базовым форматированием
      (bold, italic, ссылки, списки) (FR-36).
- [ ] Реализовать загрузку PDF-assets feedback и download links (FR-37).
- [ ] Реализовать `telemetryEnabled` отдельным переключателем (FR-35).
- [ ] Reference-тест по образцу для последующих секций.

#### S5 / Фаза 5A (Haiku) - topics-structure

- [ ] Реализовать секцию **"Состав"** - выбор тем, drawCount, required, timeLimit
      (FR-12, FR-13, FR-15d, FR-34).
- [ ] Реализовать индивидуальный лимит времени темы или наследование общего (FR-34).

#### S6 / Фаза 5B (Haiku) - pass-rules

- [ ] Реализовать раздел `passRules` с `decisionPolicy`, общим правилом, правилами по темам
      (FR-15a...FR-15g).
- [ ] Реализовать раздел `runtime`: `timeLimitMinutes`, `maxAttempts`, `showCorrectAnswers`.
- [ ] Реализовать селектор `flowMode` с пересборкой default-структуры (FR-33, FR-40).
- [ ] Скрывать несовместимые настройки текущего режима как warning-блок
      с раскрываемым списком (FR-25f).
- [ ] При возврате режима скрытые настройки снова отображаются (FR-25g).
- [ ] Реализовать переключатель `standard/adaptive` с inline warning,
      без modal confirmation если данные не удаляются (FR-25d, FR-25e).
- [ ] Реализовать секцию **"Настройки"** с side nav: основные, прохождение/flow,
      runtime, feedback, интеграции (FR-29, FR-33, FR-43).

#### S7 / Фаза 5C (Haiku) - adaptive-settings

- [ ] Реализовать секцию **"Адаптивные настройки"** с уровнями теста и темы (FR-38).
- [ ] В standard-режиме adaptive-секция полностью скрыта (FR-38).
- [ ] Параметр `showDifficultyLevel` находится в adaptive-секции,
      виден только для adaptive (FR-32).

#### S8 часть 1 / Фаза 5D (Haiku) - start-pages

- [ ] Реализовать секцию **"Структура"** как точку доступа к content pages (FR-27).
- [ ] Структура для `linear_by_topics`: темы и страницы до/после каждой темы.
- [ ] Структура для `linear_flat`: зоны «До теста», «Блок вопросов», «После теста»;
      вопросы из всех выбранных тем единым потоком без группировки.
- [ ] Структура для `router_by_topics`: зоны «До теста» / «После теста»
      (как `linear_flat`) + системная router-row внутри теста + темы как ветки
      иерархии под router-row через tree-connectors. См.
      [prd-7-decisions.md §2.3b](prd-7-decisions.md) и
      [prd-8-section-router-flow.md §4.1.1](prd-8-section-router-flow.md).
- [ ] При отсутствии нужного template/system element показывать warning во вкладке "Структура" (FR-39).

#### S8 часть 2 / Фаза 5E (Sonnet) - design

- [ ] Реализовать секцию **"Оформление"** как раздел редактора, не как отдельный dialog (FR-26).
- [ ] `templateVersion` и `templateApiVersion` показываются read-only (FR-41).
- [ ] UI параметров шаблона поддерживает типы `multiselect`, `url`, `file`, `downloadLink` (FR-42).

### 1.9 Список тестов и карточка теста

Распределение по сессиям:

- открытие нового Drawer из списка/карточки - **S4 / Фаза 4A (Opus)**;
- удаление inline wizard и старых dialogs - **S10 / Фаза 7A (Sonnet)**.

#### S4 - подключение нового редактора

- [ ] Список тестов открывает редактор для create и edit (FR-02).
- [ ] Карточка теста показывает компактные actions: открыть/редактировать, назначить,
      аналитика, меню действий.
- [ ] Расширенные действия сгруппированы в меню действий (FR-08 BRD, NFR-16).
- [ ] Экспорт SCORM доступен как действие карточки или пункт меню действий,
      не как вкладка Drawer (FR-28).
- [ ] Удаление теста только через меню действий с вводом точного названия (FR-30).
- [ ] Архивные тесты скрыты из общего списка и поиска, недоступны для назначения (FR-31).
- [ ] Реализовать раздел **"Архив"** с действием восстановления.

#### S10 - удаление старого UI

- [ ] Удалить inline wizard из `TestsPage` (см. §1.12).

### 1.10 Backend: API и сервис (S2 / Фаза 1B, Sonnet)

- [x] Создать сервисный слой `TestSettingsService` (`server/services/test-settings.ts`).
- [x] Вынести orchestration сохранения test + sections + adaptive settings из route handler в сервис.
- [x] Реализовать атомарное сохранение через transaction для standard-теста (FR-21).
- [x] Реализовать атомарное сохранение через transaction для adaptive-теста (FR-22).
- [x] При ошибке сохранения возвращать структурированную ошибку без частичного состояния (FR-23, BR-08-07).
      _(транзакция откатывает все изменения при любой ошибке)_
- [x] Добавить request validation schema для `POST /api/tests` (zod).
      _(`createTestBodySchema` в `server/routes/tests.ts`; тест в `tests/routes.tests.test.ts`.)_
- [x] Добавить request validation schema для `PUT /api/tests/:id` (zod).
      _(`updateTestBodySchema` в `server/routes/tests.ts`; тест в `tests/routes.tests.test.ts`.)_
- [x] Возвращать структурированные ошибки валидации с `field`, `code`, `message` (PRD-7 §6.4 пример).
      _(`zodToFields()` → `{ error, fields: [{field, code, message}] }` при 400.)_
- [x] Сохранить backward compatibility текущих endpoints `POST /api/tests` и `PUT /api/tests/:id`.
- [x] Добавить `published` синхронизацию из `status` в обратном маппере на переходный период.
      _(write-path sync реализован в `storage.ts` и service; read-path mapper — §1.11)_
- [x] Реализовать optimistic version check при сохранении:
      возвращать 409 Conflict при mismatch (FR-25k).
- [x] Версия теста увеличивается только при изменениях, влияющих на прохождение/экспорт (FR-25).
      _(`PATCH /status` не инкрементирует версию; `save()` инкрементирует всегда)_
- [x] Реализовать endpoint `PATCH /api/tests/:id/status` для смены статуса из меню карточки.
- [x] Реализовать endpoint `DELETE /api/tests/:id` с проверкой точного названия в payload.
- [x] Реализовать endpoint `POST /api/tests/:id/restore` для восстановления из архива.
- [x] Эндпоинт получения списка тестов поддерживает фильтрацию по `status`
      (по умолчанию `draft`/`published`, без `archived`).

### 1.11 Backend: совместимость и миграция данных (S2 / Фаза 1B, Sonnet)

- [x] Реализовать read-path: storage layer возвращает `status`,
      маппит legacy `published` если `status` пустой.
      _(`mapLegacyTest()` в `server/storage.ts` — применяется в `getTests()` и `getTest()`.)_
- [x] Реализовать write-path: storage layer пишет `status` и синхронизирует `published`.
      _(`createTest`/`updateTest` пишут оба поля; `TestSettingsService` идёт через storage.)_
- [x] При сохранении новых тестов писать только `status`, `published` синхронизируется маппером.
      _(POST handler использует `status` как источник; `published` вычисляется из него.)_
- [x] Логика создания intro content page при сохранении теста с legacy
      `start_page_content` (если миграция SQL не применена в окружении).
      _(safety-net INSERT в `content_pages` внутри транзакции `createTest` в `storage.ts`.)_
- [x] Добавить health-check для проверки полноты миграции legacy-полей.
      _(`getMigrationHealth()` в `storage.ts` + `GET /api/tests/migration-health` в route.)_

### 1.12 Удаление legacy-кода (S10 / Фаза 7A, Sonnet)

После стабилизации редактора и подтверждения, что все клиенты используют `status`:

- [ ] Удалить чтение `tests.published` из бизнес-логики (оставить только в обратном маппере).
- [ ] Удалить чтение `tests.start_page_content` из runtime/SCORM export.
- [ ] Удалить старый wizard и связанные dialogs из `client/src/pages/author/tests.tsx`.
- [ ] Удалить отдельные dialog state для design/content pages внутри `TestsPage`.
- [ ] Удалить debug `console.log` из старого wizard.
- [ ] Запланировать SQL-миграцию для удаления `tests.published` и `tests.start_page_content` (отдельный релиз).

### 1.13 Тестирование

Распределение по сессиям:

- migration unit-тесты - **S2 / Фаза 1A (Opus)** в составе §1.4;
- mappers unit-тесты - **S3 часть 1 / Фаза 2A + 2B (Opus -> Sonnet)** в составе §1.5;
- validation unit-тесты - **S3 часть 2 / Фаза 3A + 3B (Sonnet -> Haiku)** в составе §1.6;
- component-тесты секций - **S9 часть 1 / Фаза 6A (Haiku)**;
- API-тесты - **S9 часть 2 / Фаза 6B (Haiku)**;
- регрессия и совместимость - **S9 часть 2 / Фаза 6B (Haiku)**.

#### 1.13.1 Unit (распределено по S2 и S3)

- [x] `apiToEditorModel()` для standard теста.
- [x] `apiToEditorModel()` для adaptive теста.
- [x] `apiToEditorModel()` для legacy `published=true` -> `status='published'`.
- [x] `apiToEditorModel()` для legacy `published=false` -> `status='draft'`.
- [x] `apiToEditorModel()` для теста с `start_page_content`: маппер не падает,
      баннер — ответственность UI (decisions §7.5).
- [x] `apiToEditorModel()` для feedback без `format` ставит `format='plain'`.
- [x] `editorModelToPayload()` для create standard.
- [x] `editorModelToPayload()` для update adaptive.
- [x] `editorModelToPayload()` проверяет: `required` берётся из `sections[]`,
      не из `passRules.byTopic`.
- [x] `editorModelToPayload()` исключает скрытые draft-настройки несовместимого режима.
- [x] Validation: draw count корректен и не превышает доступное.
      _(FR-13 happy + sad path в `test-editor.validation.test.ts`, фаза 3B.)_
- [x] Validation: pass rule percent/absolute границы.
      _(FR-14 percent + FR-15 absolute overall + FR-15 absolute byTopic, фазы 3A + 3B.)_
- [x] Validation: adaptive levels диапазоны и questionsCount.
      _(FR-16 difficulty + FR-17 questionsCount + FR-18 passThreshold, фаза 3B.)_
- [x] Validation: webhook URL.
      _(FR-20 happy/empty/HTTPS + sad-path malformed, фаза 3A.)_
- [x] Validation: `passDecisionPolicy` валидный enum (FR-15a).
      _(фаза 3A.)_
- [x] Validation: `inherit_overall` темы при общем правиле `none` блокируется.
      _(FR-15g forbidden_combination, фаза 3A. FR-15b..e — не валидационные FR,_
      _см. пояснение в §1.6.)_

#### 1.13.2 Component (S9 часть 1 / Фаза 6A, Haiku)

- [ ] Create standard happy path в Drawer.
- [ ] Edit standard с existing sections.
- [ ] Create adaptive с загрузкой difficulty distribution.
- [ ] Edit adaptive с сохранёнными levels/links.
- [ ] Переключение standard/adaptive показывает inline warning без удаления данных.
- [ ] Переключение `flowMode` пересобирает структуру и сохраняет несовместимые элементы как скрытые.
- [ ] Возврат предыдущего режима восстанавливает скрытые настройки.
- [ ] Confirmation dialog при закрытии с несохранёнными изменениями.
- [ ] Confirmation dialog c блокирующими ошибками: "Сохранить" disabled.
- [ ] API error остаётся в редакторе.
- [ ] Optimistic conflict dialog "Обновить данные" / "Сохранить поверх".
- [ ] Удаление теста: confirmation с вводом точного названия.
- [ ] Архивные тесты скрыты из основного списка.
- [ ] Раздел **"Архив"** показывает архивные тесты и позволяет восстановить.
- [ ] Drawer открывается с данными за < 1.5 с на тесте с 20 темами (NFR-17).
- [ ] Валидация debounced 300 мс (NFR-18).
- [ ] Фокус переходит на первый интерактивный элемент при открытии (NFR-19).

#### 1.13.3 API (S9 часть 2 / Фаза 6B, Haiku)

- [ ] `POST /api/tests` standard создаёт test + sections атомарно.
- [ ] `PUT /api/tests/:id` standard атомарно обновляет sections.
- [ ] `POST /api/tests` adaptive создаёт test + adaptive settings атомарно.
- [ ] `PUT /api/tests/:id` adaptive откатывает изменения при ошибке уровня/link.
- [ ] Validation errors возвращают field-level payload.
- [ ] Optimistic version check возвращает 409 Conflict при mismatch.
- [ ] `PATCH /api/tests/:id/status` корректно меняет статус.
- [ ] `DELETE /api/tests/:id` требует точное совпадение названия.
- [ ] `POST /api/tests/:id/restore` восстанавливает из архива.
- [ ] Список тестов по умолчанию не показывает `archived`.

#### 1.13.4 Регрессия и совместимость (S9 часть 2 / Фаза 6B, Haiku)

- [ ] Старые тесты с `published=true/false` корректно открываются и сохраняются через новый редактор.
- [ ] Старые тесты с непустым `start_page_content` корректно мигрируются в `intro` content page.
- [ ] Старые тесты без `designSettingsJson` используют default template.
- [ ] Старые тесты без adaptive settings продолжают работать как standard.
- [ ] SCORM export старых тестов после миграции данных проходит golden-тест.

### 1.14 Acceptance pass (S11 / Фаза 7B, Opus)

- [ ] Пройти все acceptance criteria PRD-7 §10 (всего ~50 пунктов).
- [ ] Manual end-to-end: create/edit standard, create/edit adaptive,
      переключение режимов, удаление, архив, восстановление.
- [ ] Manual end-to-end: optimistic conflict при параллельной правке статуса.
- [ ] Manual end-to-end: SCORM export с feedback PDF assets.
- [ ] Lighthouse/axe accessibility audit Drawer.

---

## 2. MVP-срез

Минимальный срез, после которого PRD-7 можно проверять end-to-end. В скобках -
сессия, по завершении которой пункт становится выполнимым.

- [ ] (S1 + согласование) wireframes минимального набора согласованы.
- [x] (S2) SQL-миграция `tests.status` применена и протестирована на legacy-данных.
      _(`migrations/003_prd7_test_settings.sql` + `tests/migration-prd7.test.ts`.)_
- [x] (S3) `TestEditorModel`, DTO, mappers и validation покрыты unit-тестами.
      _(mappers — 16 тестов (фазы 2A + 2B); validation — 30 тестов (фазы 3A + 3B).)_
- [ ] (S4) Drawer редактора открывается из списка тестов и работает для create/edit standard.
- [ ] (S4 + S7) Drawer работает для create/edit adaptive с переключением режима.
- [x] (S2) Атомарное сохранение test + sections + adaptive settings через transaction.
      _(`TestSettingsService.create()`/`save()` в `server/services/test-settings.ts` +_
      _`tests/services/test-settings.test.ts`.)_
- [ ] (S10) Старый inline wizard удалён из `TestsPage`.
- [ ] (S9) Старые тесты без регрессии: `published`, `start_page_content`,
      отсутствие adaptive settings.

---

## 3. Зависимости и блокеры

### 3.1 Блокеры между сессиями

| Чтобы стартовать | Должно быть готово |
| --- | --- |
| S1 (Wireframes) | S0 - skeleton, decisions.md (§1.1, §1.2) |
| S2 (Backend) | S0 - decisions.md §4 маппинг legacy зафиксирован |
| S3 (Frontend foundation) | S0 - типы зафиксированы как контракт; не зависит от S2 |
| S4 (Drawer + reference) | S1 согласован продактом (минимальный набор W.1 для 4A/4B); S2 завершена; S3 завершена |
| S5...S8 (Доменные секции) | S1 согласован для 5; S4 завершена (reference-секция basic) |
| S9 (Тесты) | S5-S8 завершены (production-код секций существует) |
| S10 (Удаление legacy) | S9 зелёный (regression подтвердил отсутствие регрессий) |
| S11 (Acceptance + W.3C) | S10 завершена; полный набор UI работает в браузере |

### 3.2 Параллельные потоки

- **S1 (генерация wireframes моделью) + S2 + S3** идут друг за другом, но
  согласование wireframes продактом (внешний шаг между S1 и S4) длится
  параллельно с S2/S3 - это бесплатное время.
- **S5, S6, S7** работают в одной кодовой зоне (секции редактора), но
  каждая в своей секции - можно делать в любом порядке внутри S5...S8.
- **S8 части 1 и 2** (start-pages и design) можно выполнять одновременно
  внутри одной сессии через `/model`-переключение.

### 3.3 Что разблокирует PRD-7

После завершения PRD-7 разблокированы:

- PRD-4: добавление вкладки/секции "Прохождение" и `flowMode` runtime без рефакторинга редактора.
- PRD-6: добавление блока **"Повторное прохождение"** в секцию редактора.
- PRD-8: вкладка "Структура" в режиме `router_by_topics` визуализируется по согласованным wireframes.
- PRD-2 / PRD-5: добавление вкладок "Показатели" и "Шкалы" без переписывания формы.
- PRD-3: административный реестр шаблонов получает консистентный UI выбора шаблона из секции "Оформление".
