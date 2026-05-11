# TODO: Реализация PRD-1 - шаблоны и контентные страницы

**Связанный PRD:** [PRD-1](prd-1-templates-content-pages.md)  
**Статус:** Актуализировано по коду: частичная реализация; backend/API/export/frontend частично готовы, runtime template loader и navigation flow не завершены.  
**Последняя проверка по коду:** 2026-05-09  
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
- [x] Покрыть edge cases: нет page templates, шаблон невалиден, ошибка сохранения, placeholder невалиден, HTML отклонён санитайзером.
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

- [x] Реализовать вкладку **"Оформление"** по согласованным wireframes.
- [x] Реализовать галерею шаблонов.
- [x] Реализовать форму параметров из `manifest.params`.
- [ ] Реализовать предпросмотр/сброс.
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

## 3. Проверка по коду от 2026-05-09

### 3.1 Подтверждённые зоны реализации

- Backend/API: `server/routes/templates.ts`, `server/routes/tests.ts`, `server/routes/content-pages.ts`.
- Модель данных/storage: `shared/schema.ts`, `server/storage.ts`.
- Registry встроенных шаблонов: `server/template-registry.ts`, вызов `syncBuiltinTemplates()` в `server/index.ts`.
- SCORM export: `server/scorm/builders/test-json.ts`, `server/scorm/builders/template-copy.ts`, `server/scorm/index.ts`.
- Runtime helpers/renderers: `server/scorm/template/app/templateCore.js`, `server/scorm/template/app/render/renderers.js`, `server/scorm/template/app/render/contentPage.js`.
- Frontend dialogs: `client/src/components/design-settings-dialog.tsx`, `client/src/components/content-pages-dialog.tsx`, подключение из `client/src/pages/author/tests.tsx`.

### 3.2 Главные незакрытые блокеры

- Frontend preview/diagnostics для text overflow остаётся базовым, без полноценного визуального предпросмотра всех layout-состояний.
- Полный acceptance pass по PRD-1 ещё требует ручного end-to-end просмотра экспортированного SCORM в браузере/LMS.

### 3.3 Последняя проверка команд

- `npm run check`: прошёл.
- `npx vitest run --coverage.enabled false tests/schema-prd1.test.ts tests/routes.templates.test.ts tests/routes.design-settings.test.ts tests/routes.content-pages.test.ts tests/scorm-export.test.ts tests/runtime.template-core.test.ts tests/runtime.renderers.test.ts tests/runtime.content-flow.test.ts client/src/components/design-settings-dialog.test.tsx client/src/components/content-pages-dialog.test.tsx`: прошёл, 10 файлов / 254 теста.
- Smoke генерации SCORM ZIP через `generateScormPackage()` с `default` template и content page: пакет собран, размер 491610 байт.
