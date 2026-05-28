# TODO: Реализация PRD-1 - шаблоны и контентные страницы

**Связанный PRD:** [PRD-1](./templates-content-pages.md)  
**Статус:** Актуализировано по коду: основная MVP-функциональность готова (модель данных,
API, SCORM export, runtime loader, navigation, frontend dialogs). Незакрыто: предпросмотр
шаблона в Drawer «Оформление», text-overflow preview/diagnostics в content-pages, ручной
acceptance pass. Контрактные дополнения PRD-1 §4.3 (variant.kind model, row-menu,
severity-rail, required-params validation), внесённые 2026-05-21: variant.kind schema,
тихая привязка, replace-variant endpoint и required-fields validation (server) — закрыты
2026-05-25; остальные — в коде не реализованы, см. §1.12 ниже. Интеграция редактора
content-pages в новую вкладку «Структура» PRD-7 вынесена в closeout-фазу — см. §4.  
**Последняя проверка по коду:** 2026-05-25  
**Правило UI:** UI-разработка начинается только после подготовки и явного согласования wireframes.

---

## 1. Порядок выполнения

### 1.1 Подготовка и baseline

- [x] Зафиксировать текущее поведение SCORM export/runtime для тестов без `design_settings_json`.
- [x] Добавить smoke/golden-проверку старого сценария: export -> запуск -> вопрос -> результат.
- [x] Проверить текущие точки сборки SCORM ZIP, `TEST_DATA` и runtime entrypoint.
- [x] Зафиксировать текущие ограничения `content_pages`, `topics`, `test_sections`, если таблицы уже есть.

### 1.2 Wireframes и согласование UI

Wireframes подготовлены: [docs/wireframes-prd1-design-pages.md](wireframes-prd1-design-pages.md)

- [x] Подготовить wireframes вкладки **"Оформление"**.
- [x] Подготовить wireframes вкладки **"Структура"**.
- [x] Покрыть основные, пустые, loading/saving, ошибочные и read-only состояния.
- [x] Покрыть edge cases: нет page templates, шаблон невалиден, ошибка сохранения,
      placeholder невалиден, HTML отклонён санитайзером.
- [x] Явно согласовать wireframes до frontend-разработки.
- [x] Зафиксировать, что изменение сценария или состава полей требует повторного согласования.

### 1.3 Модель данных

- [x] Проверить/добавить `tests.design_settings_json`.
- [x] Проверить/добавить `content_pages`.
- [x] Поддержать `topic_id`, `position`, `mode`, `type`, `template_key`, `sort_order`, `values_json`, `auto_advance`.
- [x] Поддержать в `values_json.values` значения placeholders выбранного `contentTemplate`.
- [x] Поддержать `values_json.placeholderStyles` для разрешённых style overrides.
- [x] Поддержать сохранение ручного `placeholderStyles.*.fontSize` только для placeholders с `allowAuthorFontSize = true`.
- [x] Гарантировать, что смена шаблона не удаляет и не перезаписывает `content_pages`.
- [x] Добавить миграции и seed для встроенных шаблонов, если выбран DB registry.

### 1.4 API

- [x] Реализовать `GET /api/templates`.
- [x] Реализовать `GET /api/templates/:id`.
- [x] Реализовать `GET /api/tests/:id/design`.
- [x] Реализовать `PUT /api/tests/:id/design`.
- [x] Реализовать CRUD `content-pages`.
- [x] Реализовать reorder для страниц внутри темы/позиции.
- [x] Добавить серверную валидацию `templateApiVersion`, `manifest.params`, типов страниц и позиций.

### 1.5 Санитизация и assets

- [x] Добавить серверную санитизацию для placeholders типа `richText` и режима `html`.
- [x] Запретить scripts, inline handlers, iframe, небезопасные SVG/URL и внешние ресурсы.
- [x] Добавить обработку изображений/медиа контентных страниц.
- [x] Упаковывать медиа контентных страниц в SCORM ZIP как локальные ресурсы.

### 1.6 Встроенные шаблоны MVP

- [x] Подготовить `default`.
- [x] Подготовить `corporate`.
- [x] Подготовить `minimal`.
- [x] Для каждого шаблона добавить `manifest.json`, `shell.html`, layouts, styles, preview.
- [x] Проверить обязательные слоты: `page`, `question-prompt`, `question-interaction`.
- [x] Добавить `manifest.contentTemplates[]` с placeholders для контентных страниц.
- [x] Для текстовых placeholders добавить `textFit.mode = fixed/autoFitFont/growBox`.
- [x] Для текстовых placeholders явно задать `allowAuthorFontSize`.
- [x] Для `resultField` placeholders добавить `allowedPaths`, `allowedRenderers`, `defaultRenderer`.
- [x] Добавить `manifest.rendererPlugins[]` для встроенных и шаблонных renderer plugins.
- [x] Добавить `system.blocked` layout или fallback через общий `system`/`content` layout.

### 1.7 SCORM export

- [x] При экспорте выбирать `design_settings_json.templateId` или fallback `default`.
- [x] Копировать только выбранный шаблон в `template/`.
- [x] Добавлять design params в runtime data.
- [x] Добавлять `contentPages` в `TEST_DATA`.
- [x] Добавлять локальные assets контентных страниц.
- [x] Копировать выбранные renderer plugins и их assets в SCORM ZIP.
- [x] Не выполнять шаблон на сервере.

### 1.8 Runtime template loader

- [x] Загружать `template/manifest.json`.
- [x] Загружать `shell.html`.
- [x] Загружать layout текущей страницы.
- [x] Применять параметры и CSS variables.
- [x] Рендерить path-only DSL.
- [x] Заполнять контролируемые слоты.
- [x] Заполнять `data-placeholder` согласно типу placeholder.
- [x] Реализовать renderer registry для `resultField`.
- [x] Реализовать встроенные renderers: `core.textMetric`, `core.badge`, `core.progressBar`, `core.ringChart`, `core.segmentedProgress`.
- [x] Загружать renderer plugins из `manifest.rendererPlugins[]`.
- [x] Валидировать `path`, `renderer`, `rendererOptions` перед вызовом renderer.
- [x] Реализовать runtime-поведение `textFit`: fixed, autoFitFont, growBox.
- [x] Применять `placeholderStyles.*.fontSize` только после проверки `allowAuthorFontSize`.
- [x] Реализовать fallback `core.textMetric` и диагностику при ошибке renderer plugin.
- [x] Показывать Core error page при runtime-ошибке шаблона.

### 1.9 Runtime pages и navigation

- [x] Поддержать `start`.
- [x] Поддержать `content.intro`.
- [x] Поддержать `content.info`.
- [x] Поддержать `content.summary`.
- [x] Поддержать `content.html`.
- [x] Поддержать `question.*`.
- [x] Поддержать `results`.
- [x] Поддержать `system.blocked` без запуска question flow.
- [x] Разделить page progress и question progress.
- [x] Поддержать `progress.mode = questions/pages/hidden`.
- [x] Поддержать `data-nav="next"`, `data-action="answer-submit"`, `data-action="test-finish"`.
- [x] Выполнять autoAdvance через Core и финальные защиты.

### 1.10 Frontend UI

- [~] Реализовать вкладку **"Оформление"** по согласованным wireframes.
      _(2026-05-28: галочка снята — частично соответствует wireframe `prd7-design-tab.html`.
      Полная реализация перенесена в [PRD-7 S12](../prd-7/s12-design-closeout.md), §1 G1-G6.)_
- [~] Реализовать галерею шаблонов.
      _(2026-05-28: пометка `[x]` относилась к legacy `DesignSettingsDialog`, выведенному
      из эксплуатации. В новом редакторе галерея отсутствует — закрывается в PRD-7 S12 G3.)_
- [x] Реализовать форму параметров из `manifest.params`.
- [x] Реализовать сброс параметров шаблона до умолчаний.
      _(reset mutation + кнопка «Сбросить до умолчаний» в design-settings-dialog.tsx:356-361.)_
- [ ] Реализовать предпросмотр выбранного шаблона.
      _(2026-05-28: задача перенесена в PRD-7 S12 G2 — `tpl-preview-modal`. Acceptance-отчёт PRD-7
      §2.6 ошибочно отдал её сюда; на деле это требование самого PRD-7 wireframe FR-30.)_
- [x] Реализовать вкладку **"Структура"** по согласованным wireframes.
- [x] Реализовать создание/редактирование/удаление `intro`, `info`, `summary`, `html`.
- [x] Реализовать выбор режима страницы: `template`, `standard`, `html`.
- [x] Реализовать выбор page template из `manifest.contentTemplates[]`.
- [x] Реализовать форму values по placeholders выбранного page template.
- [x] Для `resultField` реализовать выбор runtime path из `allowedPaths`.
- [x] Для `resultField` реализовать выбор renderer из доступных `allowedRenderers`.
- [x] Для выбранного renderer строить форму `rendererOptions` по `optionsSchema`.
- [x] Показывать настройку размера шрифта только при `allowAuthorFontSize = true`.
- [ ] Показывать preview/diagnostics для переполнения при `fixed`, `autoFitFont`, `growBox`.
- [x] Реализовать сортировку страниц внутри разрешённой области.
- [x] Показать ошибки API, санитизации и несохранённые изменения.

### 1.11 Тестирование и acceptance

- [x] Unit: валидация design settings.
- [x] Unit: валидация `manifest.params`.
- [x] Unit: валидация placeholders и `values_json`.
- [x] Unit: валидация `textFit` и ручного `fontSize`.
- [x] Unit: валидация `resultField`, `allowedRenderers` и `rendererOptions`.
- [x] Unit: санитизация `richText`/HTML placeholders.
- [x] Unit: нормализация `contentPages`.
- [x] Integration: export ZIP содержит только выбранный шаблон.
- [x] Integration: export содержит `contentPages` и локальные assets.
- [x] Integration: export содержит нужные renderer plugins.
- [x] Runtime smoke: `intro`, `info`, `summary`, `html`, `question`, `results`, `system.blocked`.
- [x] Regression: старый тест без дизайна работает через `default`.
- [ ] Проверить все acceptance criteria из PRD-1.

### 1.12 Контрактные дополнения PRD-1 §4.3 (внесены 2026-05-21)

После последнего code-walk PRD-1 спецификация получила раздел §4.3 «Типы вариантов
(`variant.kind`)» с новой моделью variant'ов и сопутствующими UI-правилами. На
2026-05-22 в коде это **не реализовано**: `VariantKind`/`kind: "questions"` отсутствует
в zod-схемах, манифестах встроенных шаблонов и runtime. Часть пунктов будет закрыта
в рамках PRD-7 §1.4 (тихая привязка, серверная пересборка `kind: questions` при
смене `flowMode`), но контракт обязан жить в PRD-1.

- [x] Добавить enum `VariantKind = "questions" | "router" | "summary" | "intro" | "info"`
      в zod-схему манифеста шаблона.
      _(9e3606e: variant.kind contract for templates and content_pages.)_
- [ ] Валидация манифеста: каждый `variant` обязан иметь `kind`; default-шаблон
      обязан содержать минимум один `variant` с `kind: questions`.
- [ ] Добавить `kind` поле в `manifest.json` встроенных шаблонов (`default`,
      `corporate`, `minimal`).
- [x] Реализовать «тихую привязку» системных вариантов (типы 1-4) при сохранении/
      смене `flowMode` или `templateId`: 1 → молча, N → default + dirty flag,
      0 → fallback на стандартный шаблон + warning (PRD-1 §4.3.2 / PRD-7 §1.4).
      _(d227900: silent variant binding service; caeb4a9 + efe47cb: lifecycle planner + reconcile.)_
- [x] Реализовать unified row-menu композицию (PRD-1 §4.3.3): состав пунктов
      зависит от `variant.kind` — системные `intro`/`summary`/`questions`/`router`
      получают «Сменить вариант» (FR-46, disabled при единственном варианте),
      авторские `info` — «Удалить». _(2026-05-27, start-pages-section.tsx.)_
- [x] Реализовать визуальную индикацию состояния `page-row` (PRD-1 §4.3.7,
      severity-rail): `page-row--warn` для незаполненных required / недоступного
      шаблона; severity error > warning > info в `tb-components.css`.
      _(2026-05-27.)_
- [x] Реализовать серверную валидацию обязательных параметров варианта
      (PRD-1 §4.3.6): при незаполненных `required: true` полях — структурированная
      ошибка с `pageId` + именами полей; Save не выполняется.
      _(d445861: required-fields validation on publish transition.)_
- [x] Frontend: для каждой `content_pages` записи сравнивать `values_json.values`
      с `variant.placeholders` (только `required: true`); незаполненные поля →
      `page-row--warn` + meta-тег + агрегат warning-dot на табе «Структура».
      Draft-save не блокируется (publish-gate enforced на сервере). _(2026-05-27.)_
- [x] API endpoint `POST /api/tests/:id/pages/:pageId/replace-variant`:
      смена варианта существующей страницы с возвратом diff потерь параметров.
      _(5101d5c: replace-variant endpoint for content_pages, FR-46.)_
- [x] Auto-create записи `kind: questions` при добавлении темы в `test_sections`
      (режимы `linear_by_topics` / `router_by_topics`); каскадное удаление при
      удалении темы.
      _(efe47cb: reconcile system content_pages on create/save.)_

---

## 2. MVP-срез

Минимальный срез, после которого PRD-1 можно проверять end-to-end:

- [x] wireframes согласованы;
- [x] `default` template работает через новый loader;
- [x] шаблоны объявляют `contentTemplates[]`;
- [x] `design_settings_json` сохраняется;
- [x] `content_pages` создаются и экспортируются;
- [x] `TEST_DATA.contentPages` доступен runtime;
- [x] runtime показывает `content.intro`, `content.info`, `content.summary`, `content.html`;
- [x] `system.blocked` может быть отрендерен без question flow;
- [x] старый тест без настроек проходит без регрессии.

---

## 3. Проверка по коду от 2026-05-22

После предыдущего code-walk (2026-05-09) PRD-1 зоны кода затронули 5 коммитов
2026-05-11 (большой merge: schema, storage, API, SCORM, client). После 2026-05-11
коммитов в PRD-1 зоны нет. Спецификация PRD-1 получила раздел §4.3 (variant.kind,
row-menu, severity-rail) 2026-05-21 — в коде не реализовано (см. §1.12).

### 3.1 Подтверждённые зоны реализации

Все 14 файлов на месте (sanity-check).

- Backend/API: `server/routes/templates.ts`, `server/routes/tests.ts`,
  `server/routes/content-pages.ts`.
- Модель данных/storage: `shared/schema.ts`, `server/storage.ts`.
- Registry встроенных шаблонов: `server/template-registry.ts`, вызов
  `syncBuiltinTemplates()` в `server/index.ts`.
- SCORM export: `server/scorm/builders/test-json.ts`,
  `server/scorm/builders/template-copy.ts`, `server/scorm/index.ts`.
- Runtime helpers/renderers: `server/scorm/template/app/templateCore.js`,
  `server/scorm/template/app/render/renderers.js`,
  `server/scorm/template/app/render/contentPage.js`.
- Frontend dialogs: `client/src/components/design-settings-dialog.tsx`,
  `client/src/components/content-pages-dialog.tsx`, подключение из
  `client/src/pages/author/tests.tsx`.

### 3.2 Главные незакрытые блокеры

- **Контрактные дополнения PRD-1 §4.3 не реализованы** (см. §1.12):
  `variant.kind` enum, row-menu композиция, severity-rail, required-params
  валидация. В коде поиск по `VariantKind`/`variant.kind`/`kind: "questions"`
  даёт 0 совпадений вне `docs/`.
- Предпросмотр выбранного шаблона в Drawer «Оформление» не реализован
  (есть только сброс параметров).
- Frontend preview/diagnostics для text overflow остаётся базовым, без
  полноценного визуального предпросмотра всех layout-состояний.
- Полный acceptance pass по PRD-1 ещё требует ручного end-to-end просмотра
  экспортированного SCORM в браузере/LMS.
- ~~Редактор content-pages не интегрирован в новую вкладку «Структура» PRD-7~~ —
  **закрыто 2026-05-27** (см. §4): полноценный CRUD авторских `info`-страниц в секции
  «Структура», заглушка убрана, `ContentPagesDialog` выведен из эксплуатации.

### 3.3 Последняя проверка команд (2026-05-22)

- `npm run check`: прошёл (0 errors).
- `npx vitest run --coverage.enabled false` по 10 файлам §3.3
  (`tests/schema-prd1.test.ts`, `tests/routes.templates.test.ts`,
  `tests/routes.design-settings.test.ts`, `tests/routes.content-pages.test.ts`,
  `tests/scorm-export.test.ts`, `tests/runtime.template-core.test.ts`,
  `tests/runtime.renderers.test.ts`, `tests/runtime.content-flow.test.ts`,
  `client/src/components/design-settings-dialog.test.tsx`,
  `client/src/components/content-pages-dialog.test.tsx`): прошёл,
  10 файлов / 254 теста.
- Smoke-генерация SCORM ZIP с 2026-05-09 не повторялась; ранее зафиксирован
  размер пакета 491 610 байт.

### 3.4 Коммиты в PRD-1 зонах после 2026-05-09

- `be8fad9` 2026-05-11 — schema: PRD-7 test settings + PRD-1 content pages schema.
- `0b269fd` 2026-05-11 — storage layer для PRD-7 settings, content pages, registry.
- `7191d0f` 2026-05-11 — API endpoints PRD-7 + content pages + template registry.
- `f573f93` 2026-05-11 — SCORM content pages, design settings, external templates.
- `20e6bcb` 2026-05-11 — client: PRD-7 test settings editor (затронул PRD-1 dialogs).

После 2026-05-11 — коммитов в PRD-1 зонах нет.

---

## 4. Closeout PRD-1: редактор content-pages во вкладке «Структура» PRD-7

**Статус:** Реализовано 2026-05-27 (Шаг 1 критического пути Storyline-MVP, см.
[ROADMAP §0.1](../../ROADMAP.md)). Редактор content-pages в «Структуре»:
add/edit/reorder/delete + warnings во всех трёх `flowMode`. `npm run check` чист,
полный `vitest run` зелёный (51 файл / 1336 тестов). Осталось вне этого шага:
ручной acceptance-проход (S11) и удаление чтения `start_page_content` из runtime/
SCORM (отдельный S10-шаг с golden-проверкой — см. §4.5).
**Модель:** Sonnet 4.6 (UI) + Opus 4.7 (acceptance-сверка)
**Зависит от:** PRD-7 S5-S8 (секции редактора закрыты); API `content-pages` (готов,
`server/routes/content-pages.ts`); variant.kind (PRD-1 §4.3, серверная часть закрыта
2026-05-25).
**Связано:** PRD-7 §1.4 (тихая привязка system-страниц);
[PRD-7 S9-S11](../prd-7/s9-s11-in-progress.md) — фаза должна быть закрыта до acceptance-
критериев «оформление и content pages в Drawer» (PRD-7 §10).

### 4.1 Контекст

Вкладка «Структура» редактора
(`client/src/features/tests/editor/sections/start-pages-section.tsx`) теперь
полноценный редактор авторских страниц: зональный просмотр `content_pages`
(system-строки `intro`/`summary`/`questions`/`router` — read-only + авторские
`info` — CRUD). Заглушка `NextStepBanner` удалена. Legacy-компонент
`ContentPagesDialog` (`client/src/components/content-pages-dialog.tsx` + тест) был
orphaned после рефакторинга PRD-7 и выведен из эксплуатации (удалён) 2026-05-27.

### 4.2 Scope — выполнено 2026-05-27

Только авторские страницы `kind: info`. System-строки (`intro`/`summary`/`questions`/
`router`) управляются сервисом тихо (PRD-7 §1.4) и как сущности не редактируются.

- [x] Добавление страницы `kind: info` в разрешённую зону по `flowMode`:
  - `linear_flat` — зоны «До теста» (`position: before`) / «После теста» (`position: after`);
  - `linear_by_topics` — до/после каждой темы (`before_topic`/`after_topic`);
  - `router_by_topics` — те же зоны (router-row — system).
  _(insert-row + variant-picker модал; backend расширен — см. §4.6.)_
- [x] Редактирование страницы: вариант выбирается при добавлении (`contentTemplates[]`
  с `kind: info`), inline-форма `values` по placeholders варианта; режимы `template`/`html`.
  _(режим `standard` отдельной формы не требует; вынесен как не нужный для info-страниц.)_
- [x] Rich-text для `richText`/`html` placeholders — `Textarea`, санитизация на сервере (как в legacy).
- [x] Drag-reorder страниц внутри зоны (`sort_order`) — HTML5 DnD + `PUT /reorder`.
- [x] Удаление страницы — поведение сохранено (dots-menu → подтверждение).
- [x] Required-fields варианта подсвечиваются (`page-row--warn` + meta-тег + warning-dot
  на вкладке «Структура»); publish-gate enforced на сервере (commit d445861).
- [x] Заглушка `NextStepBanner` / `structure-content-pages-stub` удалена.
- [x] `ContentPagesDialog` выведен из эксплуатации (удалён вместе с тестом).

### 4.3 DoD — выполнено

- [x] Автор создаёт/редактирует/переносит/удаляет `info`-страницы во всех трёх `flowMode`.
- [x] Заглушка `structure-content-pages-stub` удалена; рабочий UI.
- [x] System-строки остаются read-only под логикой PRD-7 §1.4.
- [x] Component-тесты (add/edit/reorder/delete/warnings — 13) + route-тесты; `npm run check`
  и полный `vitest run` (51 файл / 1336 тестов) зелёные.
- [ ] Manual smoke в браузере/LMS — вынесено в S11 acceptance.

### 4.4 Anti-goals — соблюдено

- НЕ редактировали system-страницы как пользовательские сущности (управляются сервисом).
- Контракт API `content-pages` расширен по необходимости (тест-scope `before`/`after`,
  см. §4.6) — это требовалось §4.2 для зон «До/После теста» linear_flat.
- НЕ трогали runtime-рендер content-pages (PRD-1 §1.8/§1.9).

### 4.5 Остаток S10 (отдельный шаг)

Удаление чтения `tests.start_page_content` из SCORM-export
(`server/scorm/builders/test-json.ts:58`) и runtime (`server/scorm/template/app/render/
startPage.js`) НЕ выполнено в этом шаге: затрагивает runtime-рендер и требует golden-
проверки SCORM-пакета (intro-страница из миграции 003 должна заменить `startPageContent`
без регрессии). Чтение `tests.published` в `test-settings.ts` — намеренная обратная
совместимость (S10 §3.3), НЕ удаляется.

### 4.6 Расширение модели данных (2026-05-27)

Для тест-scope зон «До/После теста» (`topic_id = NULL`) добавлена позиция:

- `shared/schema.ts`: `content_pages.position` enum → `before | after | before_topic | after_topic`.
- `migrations/005_prd1_content_pages_after_position.sql`: расширен CHECK-constraint.
- `server/routes/content-pages.ts`: POST принимает `before`/`after` (тест-scope, `topicId`
  не обязателен); `before_topic`/`after_topic` по-прежнему требуют валидный `topicId`.

### 4.7 Runtime content-flow реализован (2026-05-27)

Экспортируемый runtime теперь играет полный поток content-pages (раньше `contentFlow.js`
собирал только topic-scoped `before_topic`/`after_topic`):

- `server/scorm/template/app/contentFlow.js` `rebuildPageSequence`: тест-scope `before`
  (intro/info «До теста») в начало; тест-scope `after` info до summary — в поток перед
  результатами; первая `summary`-страница = граница (встроенный экран результатов = «Итоги
  с результатами»); страницы после summary → `state.postResultsPages`.
- Post-results: новая фаза `postResults` (`enterPostResults`/`nextPostResults`/
  `renderPostResults` в `contentFlow.js`, ветка в `render/mainRender.js`, кнопка «Далее» в
  `renderResults` `assets/app.js`) — рендер страниц «после результатов», финал → `finishAndClose`.
- Обратная совместимость: без тест-scope страниц поток идентичен прежнему (всё additive).
- Проверено end-to-end в SCORM-плеере (см. [[reference-scorm-acceptance-tooling]]): полный
  поток (intro → info → before_topic → 10 вопросов → after_topic → pre-results info →
  результаты → post-results) рендерится без ошибок; SCORM 2004 cmi корректен. Guard в
  `tests/scorm-package-acceptance.test.ts` (бандл содержит `rebuildPageSequence`/
  `postResultsPages`).
- Остаток (минор): стартовый экран всё ещё берёт текст из legacy `startPageContent` (это
  отдельный экран-обзор перед intro-content-page, не замена); content-page `summary`
  отображается встроенным экраном результатов, а не отдельным summary-layout.
