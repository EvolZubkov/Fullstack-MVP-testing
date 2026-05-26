# PRD-7: Архив закрытых фаз S0-S8

**Статус:** Closed
**Дата закрытия:** 2026-05-25
**Дата актуализации:** 2026-05-26
**Связанные документы:**

- [PRD-7 baseline](prd-7-baseline.md) — снимок поведения до рефакторинга
- [PRD-7 decisions](prd-7-decisions.md) — контракты, enum, JSON-shapes
- [PRD-7 S9-S11 in-progress](prd-7-s9-s11-in-progress.md) — активные фазы (component/API
  тесты, удаление legacy, acceptance pass)
- [PRD-1 §4.3](prd-1-templates-content-pages.md) — variant.kind модель (внесена 2026-05-21)

---

## 1. Обзор

Фазы S0-S8 покрывают полный рефакторинг редактора параметров теста с inline-wizard
в `client/src/pages/author/tests.tsx` до выделенного wide Drawer-редактора в
`client/src/features/tests/editor/`. За S0-S8 зафиксированы контракты в
`decisions.md`, утверждены wireframes (153/153), реализована backend-инфраструктура
(`TestSettingsService`, миграции 003 и 004, новые endpoints), переписана доменная
модель (`TestEditorModel`, mappers, validation), реализованы все секции редактора
на DS UniversityRT (`ou-*` + `tb-*`), интегрирован `FeedbackEditorModal` с RTE и
PDF-assets. На момент закрытия 2026-05-25 регрессионный набор: ~19 файлов
× ~457 тестов, `npm run check` 0 ошибок. Единственный незакрытый пункт S4/4A —
FR-20c (якорная навигация из summary ошибки к проблемному полю) — перенесён в
S9.

---

## 2. Завершённые фазы

### S0 — Контракты и skeleton

**Что входило.** Зафиксировать enum, JSON-shapes, default-значения и legacy-маппинг
PRD-7 в `decisions.md`; создать skeleton-каркас редактора в
`client/src/features/tests/editor/` (пустые компоненты, типы с правильными сигнатурами,
mappers и validation с заглушками `throw new Error("not implemented")`).

**Definition of Done.**

- `decisions.md` создан с §1-§11 (anti-goals, enum, JSON-shapes, mappers, UI, lifecycle).
- Skeleton-каркас компилируется (`npm run check` зелёный).
- `implementation-todo.md` отражает разбиение на фазы и зависимости между сессиями.

**Ключевые коммиты.**

- `0364e45` — docs initial (PRD-7 + decisions + baseline + execution strategy + todo).

**Артефакты.**

- `docs/prd-7-decisions.md`
- `client/src/features/tests/editor/{test-editor.types.ts, test-editor.mappers.ts,
  test-editor.validation.ts, use-test-editor.ts, test-editor.tsx, sections/*.tsx}`

### S1 — Wireframes

**Что входило.** Полный набор approved wireframes на DS UniversityRT (15 файлов
плюс `prd7-shared.css`); согласование с дизайнером и PM; mobile-варианты явным решением
вынесены за scope PRD-7.

**Definition of Done.**

- Приёмочный чек-лист 153/153 закрыт (см. `wireframes-acceptance-checklist.md`).
- Все state'ы редактора реализованы как state-switcher в `prd7-editor-drawer.html`.
- Линтер DS-токенов `npm run check:wireframes:ds` зелёный.

**Ключевые коммиты.**

- Wireframes согласованы 2026-05-21 (вне основного git-графа, в подкаталоге
  `docs/wireframes/approved/`).

**Артефакты.**

- `docs/wireframes/approved/prd7-shared.css`
- `docs/wireframes/approved/prd7-editor-drawer.html` (эталон + все вкладочные
  состояния `s-default`, `s-default-adaptive`, `s-dirty`, `s-error`, `s-saving`,
  `s-changes`, `s-settings`, `s-feedback-edit`)
- `docs/wireframes/approved/prd7-tests-list.html`,
  `prd7-tests-delete-confirm.html`, `prd7-tests-archive.html`
- `docs/wireframes/approved/prd7-editor-settings-tab.html`,
  `prd7-design-tab.html`
- `docs/wireframes/approved/prd7-structure-linear-flat.html`,
  `prd7-structure-linear-by-topics.html`, `prd7-structure-router.html`
- `docs/wireframes/approved/prd7-variant-replace.html`,
  `prd7-editor-close-confirm.html`, `prd7-editor-conflict.html`,
  `prd7-mode-switch-warning.html`, `prd7-editor-status-indicators.html`

### S2 — Backend foundation

**Что входило.** SQL-миграция 003 (`tests.status`, `telemetry_enabled`, `feedback_json`,
`flow_policy_json`; `test_sections.required`, `time_limit_minutes`, `feedback_json`;
intro content_pages для legacy `start_page_content`); `TestSettingsService` с атомарным
сохранением test + sections + adaptive; endpoints `PATCH /status`, `DELETE`,
`POST /restore`; backward-compatible storage layer; read-path mapper `mapLegacyTest`.

**Definition of Done.**

- Миграция применима на копии prod, `tests/migration-prd7.test.ts` зелёный.
- `TestSettingsService.create()/save()` через `db.transaction`.
- Optimistic version check возвращает 409 Conflict при mismatch (FR-25k).
- `GET /api/tests` по умолчанию не показывает archived.
- Health-check миграции legacy-полей (`GET /api/tests/migration-health`).

**Ключевые коммиты.**

- Миграция 003 + storage + endpoints (вошли в `0364e45` initial batch).
- `f18fd1c` — feat(routes): migrate POST/PUT /api/tests to TestSettingsService.

**Артефакты.**

- `migrations/003_prd7_test_settings.sql`
- `server/services/test-settings.ts`
- `server/storage.ts` (`mapLegacyTest`, `createTest`/`updateTest` sync `published` ↔
  `status`)
- `server/routes/tests.ts` (`PATCH /:id/status`, `DELETE /:id`, `POST /:id/restore`,
  `GET /migration-health`)
- `tests/migration-prd7.test.ts`, `tests/services/test-settings.test.ts`

### S2+ — variant.kind contract и lifecycle (Block 1A-1E + route-gap)

**Что входило.** Контрактные дополнения PRD-1 §4.3 (введены 2026-05-21 параллельно
с приёмкой S1 wireframes): `VariantKind` enum + zod-схемы манифеста; silent variant
binding (1/N/0 правила); content_pages lifecycle planner; `replace-variant` endpoint
(FR-46); required-fields validation на publish-transition (PRD-1 §4.3.6);
route-gap closure для `POST/PUT /api/tests`.

**Definition of Done.**

- `VariantKind` enum + `validateManifest()` + поле `kind` в встроенных манифестах.
- Default-шаблон обязан содержать минимум один `kind: "questions"` вариант
  (`defaultTemplateManifestSchema.refine()`).
- `planSystemPages()` pure-функция; вызов из транзакции `TestSettingsService.save()`
  при изменениях `sections`/`flowPolicyJson`/`designSettingsJson`.
- `POST /api/tests/:id/content-pages/:pageId/replace-variant` возвращает diff потерь
  параметров и применяет смену.
- Required-fields validation: soft на draft, hard на `status: "published"` (422 с
  `fields: [{ pageId, templateKey, fieldName }]`).

**Ключевые коммиты.**

- `9e3606e` — feat(schema): variant.kind contract for templates and content_pages.
- `d227900` — feat(services): silent variant binding service (PRD-1 §4.3.2).
- `caeb4a9` — feat(services): system content_pages lifecycle planner.
- `efe47cb` — feat(test-settings): reconcile system content_pages on save.
- `5101d5c` — feat(api): replace-variant endpoint for content_pages (FR-46).
- `d445861` — feat(test-settings): required-fields validation on publish transition.

**Артефакты.**

- `shared/schema.ts` (`variantKindSchema`, manifest schemas, `feedbackContentSchema`,
  `feedbackLinkSchema`, `feedbackAssetSchema`)
- `server/services/variant-binding.ts`, `content-pages-lifecycle.ts`,
  `required-fields-validator.ts`
- `server/routes/content-pages.ts`, `server/template-registry.ts`
- `migrations/004_variant_kind.sql`
- `tests/manifest-variant-kind.test.ts`, `tests/schema-prd7-feedback.test.ts`

### S3 — Mappers и validation

**Что входило.** Полная реализация `apiToEditorModel()` (basic, runtime, passRules,
sections, adaptive, flowSettings) с legacy-маппингом по `decisions.md` §4;
`editorModelToPayload()` с правилом FR-45 (`required` из `sections[]`) и FR-25h
(скрытые draft-настройки не попадают в payload); `validateTestEditor()` —
plain-TypeScript функция, возвращающая `{ errors, warnings }` с `severity`/`field`.

**Definition of Done.**

- 46 unit-тестов: 16 mappers + 30 validation.
- Покрыты все FR-11..FR-20 и FR-25h/FR-45.
- Legacy fallback: `published` → `status`, feedback без `format` → `format='plain'`,
  `start_page_content` — баннер UI (mapper не падает).

**Ключевые коммиты.**

- Mappers + validation вошли в `0364e45` initial batch (фазы 2A/2B и 3A/3B
  через `/model`-переключение в S3).

**Артефакты.**

- `client/src/features/tests/editor/test-editor.types.ts`
- `client/src/features/tests/editor/test-editor.mappers.ts`
- `client/src/features/tests/editor/test-editor.validation.ts`
- `client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts`
- `client/src/features/tests/editor/__tests__/test-editor.validation.test.ts`

### S4 — Drawer-каркас и reference-секция basic-settings (фазы 4A + 4B)

**Что входило.** Wide Drawer контейнер (`ou-drawer--xl ou-drawer--right`) с табами
"Состав/Настройки/Оформление/Структура", единой кнопкой "Сохранить", агрегированными
индикаторами dirty/warning/error; `useTestEditor()` hook с draft-state в memory
(FR-25j: no localStorage), debounced validation 300ms (NFR-18), version-tracking
(FR-25k); `CloseConfirmDialog`, `ConflictDialog`, `ChangesPopover`; reference-секция
basic-settings + FeedbackEditorModal с tb-rte (toolbar B/I/link + contenteditable)
и PDF-assets.

**Definition of Done.**

- Drawer открывается из tests-list explorer; focus на первый интерактивный
  элемент (NFR-19); Tab/Shift-Tab не выходит за пределы (NFR-20).
- `StatusBadge` с `aria-label` (NFR-21).
- Confirmation dialog при закрытии с dirty (FR-05); "Сохранить" disabled при errors
  (FR-05a); нет "Сбросить всё" (FR-05b).
- FeedbackEditorModal: 20 unit-тестов, формат `plain/richText/html` через
  SegmentedControl, PDF-assets с inline-rename.
- Незакрытый пункт: FR-20c (anchor-навигация к полю) — перенесён в S9.

**Ключевые коммиты.**

- `afc5fe5` — feat(prd-7): test editor Drawer + tests-list explorer.
- `0850a64` — refactor(prd-7): migrate editor + tests-list to @universityrt/ui-kit.
- `57d77c1` — feat(prd-7): FeedbackEditorModal — real RTE with B/I/link toolbar.
- `f3837b0` — test(prd-7): FeedbackEditorModal unit tests.

**Артефакты.**

- `client/src/features/tests/editor/test-editor.tsx`
- `client/src/features/tests/editor/use-test-editor.ts`
- `client/src/features/tests/editor/sections/basic-settings-section.tsx`
- `client/src/features/tests/editor/components/feedback-editor-modal.tsx`
- `client/src/features/tests/editor/__tests__/test-editor.test.tsx`,
  `feedback-editor-modal.test.tsx`
- `client/src/pages/author/tests.tsx` (tests-list explorer)
- `client/src/styles/tb-components.css` (`tb-rte`, `tb-saving-overlay`,
  `tb-changes-popover`, `status-dot` и др.)

### S5 — Секция topics-structure

**Что входило.** Вкладка "Состав": список выбранных тем с drawCount input
(1..maxQuestions), required toggle, timeLimit selector (inherit_test/custom/none),
кнопка "Добавить тему" с диалогом, FeedbackPreview + TopicRow integration.

**Definition of Done.**

- Все изменения через `useTestEditor().setSections()`.
- Component-тесты по образцу basic-settings: happy/sad path для drawCount, required,
  timeLimit.

**Ключевые коммиты.**

- `afc5fe5`, `0850a64` (вошли в общую серию редактора).

**Артефакты.**

- `client/src/features/tests/editor/sections/topics-structure-section.tsx`
- `client/src/features/tests/editor/__tests__/sections/topics-structure-section.test.tsx`

### S6 — Секция pass-rules

**Что входило.** `decisionPolicy` selector (4 значения), overall pass rule
(percent/absolute/none + value), byTopic rules (source: inherit_overall/custom/none),
inline warning при invalid combinations (FR-15g); раздел runtime (`timeLimitMinutes`,
`maxAttempts`, `showCorrectAnswers`); селектор `flowMode` с пересборкой
default-структуры; скрытие несовместимых настроек как warning-блок (FR-25f/25g);
переключатель standard/adaptive с inline warning без modal (FR-25d/25e).

**Definition of Done.**

- Все 4 значения decisionPolicy покрыты тестами + sad path для FR-15g.
- Side nav второго уровня на вкладке "Настройки" с подвкладками
  "Основное/Правила прохождения/Ограничения/Интеграция/Адаптивный режим" (FR-47).

**Ключевые коммиты.**

- `afc5fe5`, `0850a64`.

**Артефакты.**

- `client/src/features/tests/editor/sections/pass-rules-section.tsx`
- Side-nav в `test-editor.tsx`

### S7 — Секция adaptive-settings

**Что входило.** AdaptiveLevelCard per wireframe с полями minDifficulty, maxDifficulty,
questionsCount, passThreshold, passThresholdType; управление links уровня (title +
URL); hide-in-standard (`mode !== 'adaptive'` → null, FR-38);
`showDifficultyLevel` toggle (FR-32) только в adaptive-секции.

**Definition of Done.**

- AdaptiveLevelCard визуально соответствует эскизу.
- Accordion fixes для корректной анимации.

**Ключевые коммиты.**

- `9331adf` — fix(prd-7): AdaptiveLevelCard per wireframe.
- `d5f3699` — hide «Адаптивный режим» rail item when test mode is standard.
- `2a77fd6`, `b68b0d3` — accordion fixes.

**Артефакты.**

- `client/src/features/tests/editor/sections/adaptive-settings-section.tsx`
- `client/src/features/tests/editor/components/adaptive-level-card.tsx`

### S8 — start-pages + design

**Что входило.** Вкладка "Структура" для всех `flowMode`: linear_flat (зоны "До
теста"/"Блок вопросов"/"После теста"), linear_by_topics (темы со страницами до/после),
router_by_topics (зоны + системная router-row + темы как ветки иерархии через
tree-connectors); вкладка "Оформление" как inline-секция (не отдельный dialog),
read-only `templateVersion`/`templateApiVersion`, поддержка типов params
`multiselect`/`url`/`file`/`downloadLink`, ColorPicker для branding.

**Definition of Done.**

- Structure tab markup 1:1 с approved wireframes для всех трёх режимов.
- Design pane интегрирован в footer Drawer (единая кнопка "Сохранить").
- Existing `design-settings-dialog.tsx` не сломан.

**Ключевые коммиты.**

- `88d3435` — fix(prd-7): Design Template pane per wireframe.
- `86ab7f0` — fix(prd-7): ColorPicker для branding.
- `07d293b` — align Structure tab markup with wireframe.
- `6ddd2bf` — unify Design save into drawer footer.
- `979d224` — wireframe-correspondence pass (footer / required toggle / limits).

**Артефакты.**

- `client/src/features/tests/editor/sections/start-pages-section.tsx`
- `client/src/features/tests/editor/sections/design-section.tsx`
- `client/src/components/design-settings-dialog.tsx` (legacy, остаётся до S10)

---

## 3. Контракты и сущности

Источник истины: `docs/prd-7-decisions.md` (enum, JSON-shapes, default-значения,
legacy-маппинг). Реализованные артефакты:

- **TestEditorModel** — `client/src/features/tests/editor/test-editor.types.ts`
  (basic, runtime, passRules, sections, adaptive, flowSettings).
- **DTO payload** — там же: `TestSettingsPayload`, `TestSectionPayload`,
  `AdaptiveSettingsPayload`.
- **Mappers** — `client/src/features/tests/editor/test-editor.mappers.ts`
  (`apiToEditorModel`, `editorModelToPayload`, `mapEditorSectionsToPayload`,
  `mapEditorAdaptiveToPayload`).
- **Validation** — `client/src/features/tests/editor/test-editor.validation.ts`
  (`validateTestEditor`, `ValidationIssue`, severity-поле).
- **TestSettingsService** — `server/services/test-settings.ts` (`create`, `save`,
  `_reconcileSystemPages`, `_validateAllRequiredFields`).
- **Variant binding** — `server/services/variant-binding.ts`,
  `content-pages-lifecycle.ts`, `required-fields-validator.ts`.
- **Backend routes** — `server/routes/tests.ts`, `server/routes/content-pages.ts`.
- **Migration** — `migrations/003_prd7_test_settings.sql`,
  `migrations/004_variant_kind.sql`.
- **Feedback** — `feedback_json` с `format: 'plain' | 'richText' | 'html'`,
  `links[]` (title + url), `assets[]` (PDF, mimeType фиксирован).

---

## 4. Дальнейшие фазы

Активная работа продолжается в [PRD-7 S9-S11 in-progress](prd-7-s9-s11-in-progress.md):

- **S9** — Component + API + regression тесты (включая FR-20c anchor-navigation,
  единственный незакрытый пункт S4/4A).
- **S10** — Удаление legacy (inline wizard, чтение `tests.published` и
  `tests.start_page_content` из runtime).
- **S11** — Acceptance pass (~50 criteria PRD-7 §10), Lighthouse/axe audit,
  end-to-end smoke.
