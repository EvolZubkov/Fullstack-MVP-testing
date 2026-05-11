# Issues: PRD-1 - шаблоны и контентные страницы

**Связанные документы:** [PRD-1](../prd-1-templates-content-pages.md), [TODO](../prd-1-implementation-todo.md)  
**Формат:** переносимые issue-карточки для трекера  
**Общее правило:** issues с UI не берутся в frontend-разработку до согласования wireframes.

---

## PRD1-001: Зафиксировать baseline старого SCORM runtime

**Тип:** Engineering / QA  
**Приоритет:** P0  
**Зависимости:** нет

**Описание:**  
Зафиксировать текущее поведение SCORM export/runtime для тестов без `design_settings_json`, чтобы
последующие изменения шаблонной платформы не ломали старые тесты.

**Acceptance criteria:**

- [ ] Есть smoke/golden-проверка экспорта старого теста.
- [ ] Проверка покрывает запуск, вопрос, ответ, результат.
- [ ] Зафиксировано поведение для тестов без `design_settings_json`: используется шаблон `default`.
- [ ] Известны текущие точки сборки ZIP и генерации `TEST_DATA`.

---

## PRD1-002: Подготовить и согласовать wireframes UI PRD-1

**Тип:** Product / UX  
**Приоритет:** P0  
**Зависимости:** нет  
**Артефакт:** [docs/wireframes-prd1-design-pages.md](../wireframes-prd1-design-pages.md)

**Описание:**  
Подготовить wireframes вкладок **"Оформление"** и **"Структура"** до frontend-разработки.

**Acceptance criteria:**

- [x] Wireframes покрывают вкладку **"Оформление"**: галерея, выбранный шаблон, параметры, preview, reset.
- [x] Wireframes покрывают вкладку **"Структура"**: список тем, создание, редактирование, сортировка, удаление.
- [x] Покрыты empty, loading, saving, API error, validation error, read-only состояния.
- [x] Покрыты ошибки валидации placeholders и санитизации HTML/richText.
- [x] Wireframes явно согласованы.

---

## PRD1-003: Реализовать модель данных design settings и content pages

**Тип:** Backend / DB  
**Приоритет:** P0  
**Зависимости:** PRD1-001

**Описание:**  
Подготовить хранение выбранного шаблона, параметров шаблона и авторского содержимого контентных
страниц.

**Acceptance criteria:**

- [ ] `tests.design_settings_json` хранит `templateId`, `templateVersion`, `templateApiVersion`, `params`.
- [ ] `content_pages` хранит страницы теста независимо от шаблона.
- [ ] Поддержаны типы `intro`, `info`, `summary`, `html`.
- [ ] Поддержаны режимы `template`, `standard`, `html`.
- [ ] Поддержаны `template_key`, `values_json.values` и `values_json.placeholderStyles`.
- [ ] Ручной `placeholderStyles.*.fontSize` сохраняется только для placeholders с `allowAuthorFontSize = true`.
- [ ] Смена шаблона не удаляет и не перезаписывает `content_pages`.
- [ ] Есть миграции/валидация схемы.

---

## PRD1-004: Реализовать API шаблонов и design settings

**Тип:** Backend API  
**Приоритет:** P0  
**Зависимости:** PRD1-003

**Описание:**  
Дать UI возможность получить список активных шаблонов и сохранить настройки оформления теста.

**Acceptance criteria:**

- [ ] `GET /api/templates` возвращает активные шаблоны.
- [ ] `GET /api/templates/:id` возвращает manifest и metadata.
- [ ] `GET /api/tests/:id/design` возвращает текущие design settings или fallback.
- [ ] `PUT /api/tests/:id/design` валидирует template id, API version и params.
- [ ] Ошибки валидации возвращаются в форме, пригодной для UI.

---

## PRD1-005: Реализовать API content pages

**Тип:** Backend API  
**Приоритет:** P0  
**Зависимости:** PRD1-003

**Описание:**  
Реализовать CRUD и сортировку контентных страниц теста.

**Acceptance criteria:**

- [ ] `GET /api/tests/:id/content-pages` возвращает страницы теста.
- [ ] `POST /api/tests/:id/content-pages` создаёт страницу.
- [ ] `PUT /api/tests/:id/content-pages/:pageId` обновляет страницу.
- [ ] `DELETE /api/tests/:id/content-pages/:pageId` удаляет страницу.
- [ ] `PUT /api/tests/:id/content-pages/reorder` меняет порядок внутри разрешённой области.
- [ ] API возвращает значения placeholders, не HTML выбранного шаблона.

---

## PRD1-006: Реализовать валидацию placeholders, санитизацию и media assets

**Тип:** Backend / Security  
**Приоритет:** P0  
**Зависимости:** PRD1-005

**Описание:**  
Обеспечить безопасное хранение и экспорт значений placeholders, richText/HTML и media assets.

**Acceptance criteria:**

- [ ] `values_json` валидируется по placeholders выбранного `contentTemplate`.
- [ ] Сохранение блокируется только при незаполненных `required: true` placeholders;
  незаполненные `required: false` не блокируют сохранение.
- [ ] `placeholderStyles.*.fontSize` валидируется по `textFit` и `allowAuthorFontSize`.
- [ ] `resultField.path` валидируется по `allowedPaths`.
- [ ] `resultField.renderer` валидируется по `allowedRenderers` и registry renderer plugins.
- [ ] `resultField.rendererOptions` валидируется по `optionsSchema` выбранного renderer.
- [ ] RichText/HTML placeholders санитизируются на сервере при создании/обновлении.
- [ ] RichText/HTML повторно санитизируются перед экспортом.
- [ ] Запрещены scripts, inline handlers, iframe, unsafe SVG/URL, внешние ресурсы.
- [ ] Медиа контентных страниц упаковываются в SCORM ZIP как локальные ресурсы.
- [ ] Ошибки валидации placeholders и санитизации доступны UI.

---

## PRD1-007: Подготовить встроенные шаблоны MVP

**Тип:** Template / Frontend  
**Приоритет:** P1  
**Зависимости:** PRD1-002

**Описание:**  
Подготовить встроенные шаблоны `default`, `corporate`, `minimal` по единому контракту.

**Acceptance criteria:**

- [ ] Есть `default` template.
- [ ] Есть `corporate` template.
- [ ] Есть `minimal` template.
- [ ] Каждый шаблон содержит `manifest.json`, `shell.html`, layouts, styles, preview.
- [ ] Каждый шаблон объявляет `manifest.contentTemplates[]` для контентных страниц.
- [ ] Content templates содержат placeholders с типами и правилами валидации.
- [ ] Текстовые placeholders содержат `textFit.mode = fixed/autoFitFont/growBox`.
- [ ] Текстовые placeholders явно задают `allowAuthorFontSize`.
- [ ] `resultField` placeholders содержат `allowedPaths`, `allowedRenderers`, `defaultRenderer`.
- [ ] Шаблоны объявляют `manifest.rendererPlugins[]`, если используют не только встроенные `core.*` renderers.
- [ ] Поддержаны обязательные слоты `page`, `question-prompt`, `question-interaction`.
- [ ] Есть layout/fallback для `system.blocked`.

---

## PRD1-008: Обновить SCORM export под выбранный шаблон и content pages

**Тип:** Backend / SCORM  
**Приоритет:** P0  
**Зависимости:** PRD1-003, PRD1-006, PRD1-007

**Описание:**  
Экспортировать выбранный шаблон, настройки дизайна и контентные страницы в SCORM ZIP.

**Acceptance criteria:**

- [ ] Новый тест экспортируется с шаблоном `default` (применяется автоматически).
- [ ] В ZIP попадает только выбранный шаблон в `template/`.
- [ ] `TEST_DATA` содержит design params.
- [ ] `TEST_DATA` содержит `contentPages`.
- [ ] Локальные assets контентных страниц попадают в ZIP.
- [ ] Сервер не исполняет HTML/JS шаблона.

---

## PRD1-009: Реализовать runtime template loader

**Тип:** Frontend Runtime  
**Приоритет:** P0  
**Зависимости:** PRD1-007, PRD1-008

**Описание:**  
Runtime должен загружать шаблон из SCORM ZIP и рендерить страницы через контролируемый renderer.

**Acceptance criteria:**

- [ ] Runtime загружает `template/manifest.json`.
- [ ] Runtime загружает `shell.html`.
- [ ] Runtime выбирает layout текущей страницы.
- [ ] Runtime применяет design params и CSS variables.
- [ ] Runtime поддерживает path-only DSL.
- [ ] Runtime заполняет контролируемые слоты.
- [ ] Runtime заполняет `data-placeholder` согласно типу placeholder.
- [ ] Runtime реализует renderer registry для `resultField`.
- [ ] Runtime загружает renderer plugins из `manifest.rendererPlugins[]`.
- [ ] Runtime валидирует `path`, `renderer`, `rendererOptions` перед вызовом renderer.
- [ ] Runtime применяет fallback `core.textMetric` при ошибке/отсутствии renderer plugin.
- [ ] Runtime применяет `textFit.mode = fixed/autoFitFont/growBox`.
- [ ] Runtime применяет `placeholderStyles.*.fontSize` только для placeholders с `allowAuthorFontSize = true`.
- [ ] Runtime-ошибка шаблона показывает Core error page.

---

## PRD1-010: Реализовать runtime content/system pages

**Тип:** Frontend Runtime  
**Приоритет:** P0  
**Зависимости:** PRD1-008, PRD1-009

**Описание:**  
Runtime должен показывать контентные и системные страницы в общем page flow.

**Acceptance criteria:**

- [ ] Поддержан `start`.
- [ ] Поддержан `content.intro`.
- [ ] Поддержан `content.info`.
- [ ] Поддержан `content.summary`.
- [ ] Поддержан `content.html`.
- [ ] Поддержан `results`.
- [ ] Поддержан `system.blocked` без запуска question flow.
- [ ] Placeholder типа `richText` получает только санитизированное содержимое.
- [ ] `summary` использует результат Core, а не статический шаблонный текст.

---

## PRD1-011: Реализовать runtime navigation, progress и actions

**Тип:** Frontend Runtime  
**Приоритет:** P1  
**Зависимости:** PRD1-010

**Описание:**  
Поддержать навигацию и прогресс в новом шаблонном runtime.

**Acceptance criteria:**

- [ ] Поддержан `data-nav="next"`.
- [ ] Поддержан `data-action="answer-submit"`.
- [ ] Поддержан `data-action="test-finish"`.
- [ ] Page progress считается отдельно от question progress.
- [ ] Поддержан `progress.mode = questions/pages/hidden`.
- [ ] AutoAdvance выполняется через Core.
- [ ] AutoAdvance не обходит финальные защиты и `navigationPolicy`.

---

## PRD1-012: Реализовать UI вкладки "Оформление"

**Тип:** Frontend UI  
**Приоритет:** P1  
**Зависимости:** PRD1-002, PRD1-004, PRD1-007

**Описание:**  
Реализовать авторский UI выбора и настройки шаблона строго по согласованным wireframes.

**Acceptance criteria:**

- [ ] UI соответствует согласованным wireframes.
- [ ] Галерея показывает `default`, `corporate`, `minimal`.
- [ ] Выбор шаблона сохраняет design settings.
- [ ] Форма параметров строится из `manifest.params`.
- [ ] Поддержан reset к умолчаниям.
- [ ] Показаны loading/saving/error/validation states.

---

## PRD1-013: Реализовать UI вкладки "Структура"

**Тип:** Frontend UI  
**Приоритет:** P1  
**Зависимости:** PRD1-002, PRD1-005, PRD1-006

**Описание:**  
Реализовать авторский UI управления контентными страницами строго по согласованным wireframes.

**Acceptance criteria:**

- [ ] UI соответствует согласованным wireframes.
- [ ] Автор видит структуру теста по темам.
- [ ] Автор создаёт страницы в режимах `template`, `standard`, `html`.
- [ ] Автор выбирает page template из `manifest.contentTemplates[]`.
- [ ] Автор заполняет values по placeholders, а не редактирует HTML шаблона.
- [ ] Для `resultField` автор выбирает runtime path из `allowedPaths`.
- [ ] Для `resultField` автор выбирает renderer из доступных `allowedRenderers`.
- [ ] UI строит форму `rendererOptions` по `optionsSchema` выбранного renderer.
- [ ] UI показывает настройку размера шрифта только для placeholders с `allowAuthorFontSize = true`.
- [ ] UI показывает preview/diagnostics переполнения текста для `fixed`, `autoFitFont`, `growBox`.
- [ ] Автор сортирует страницы внутри разрешённой области.
- [ ] Автор изменяет порядок тем через DnD (grip-ручка на заголовке темы).
- [ ] Клавиатурная альтернатива DnD тем: Tab на ручку, ↑↓ для перемещения, Enter для фиксации.
- [ ] UI показывает ошибки санитизации и API.
- [ ] Смена шаблона не меняет содержимое страниц.

---

## PRD1-014: Реализовать тесты и end-to-end acceptance PRD-1

**Тип:** QA / Automation  
**Приоритет:** P0  
**Зависимости:** PRD1-001...PRD1-013

**Описание:**  
Покрыть PRD-1 unit/integration/runtime smoke проверками и пройти acceptance criteria.

**Acceptance criteria:**

- [ ] Unit: design settings validation.
- [ ] Unit: manifest params validation.
- [ ] Unit: HTML sanitization.
- [ ] Unit: `resultField` renderer validation.
- [ ] Unit: contentPages normalization.
- [ ] Integration: ZIP содержит только выбранный шаблон.
- [ ] Integration: ZIP содержит `contentPages` и локальные assets.
- [ ] Integration: ZIP содержит используемые renderer plugins.
- [ ] Runtime smoke: `intro`, `info`, `summary`, `html`, `question`, `results`, `system.blocked`.
- [ ] Regression: старый тест без дизайна работает через `default`.
- [ ] Все acceptance criteria PRD-1 закрыты.
