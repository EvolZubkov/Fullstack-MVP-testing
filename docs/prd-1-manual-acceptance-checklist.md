# PRD-1 ручная acceptance-проверка

**Область:** шаблоны оформления, content pages, SCORM export/runtime.  
**Перед проверкой:** применить миграции, запустить приложение, открыть авторский раздел тестов.

---

## 1. Подготовка

- [ ] `npm run check` проходит без ошибок.
- [ ] PRD-1 test slice проходит: `npx vitest run --coverage.enabled false tests/schema-prd1.test.ts tests/routes.templates.test.ts tests/routes.design-settings.test.ts tests/routes.content-pages.test.ts tests/scorm-export.test.ts tests/runtime.template-core.test.ts tests/runtime.renderers.test.ts tests/runtime.content-flow.test.ts client/src/components/design-settings-dialog.test.tsx client/src/components/content-pages-dialog.test.tsx`.
- [ ] В БД есть таблицы/поля `tests.design_settings_json`, `templates`, `content_pages`.
- [ ] Built-in templates синхронизированы: `default`, `corporate`, `minimal`.
- [ ] Открываются static previews:
  - [ ] `server/scorm/templates/default/preview.html`
  - [ ] `server/scorm/templates/corporate/preview.html`
  - [ ] `server/scorm/templates/minimal/preview.html`
- [ ] Static previews визуально соответствуют согласованным wireframes:
  - [ ] `docs/wireframes/design-tab.html`
  - [ ] `docs/wireframes/pages-tab.html`
- [ ] В static previews вкладка **Предпросмотр страницы** рендерит content page через PRD-1 `renderContentPage(...)`.
- [ ] В static previews вкладка **Runtime flow** строит sequence через PRD-1 `rebuildPageSequence()`.

## 2. Оформление

- [ ] В карточке теста открывается действие **Оформление**.
- [ ] Галерея показывает `default`, `corporate`, `minimal`.
- [ ] Смена шаблона показывает параметры из `manifest.params`.
- [ ] Сохранение пишет `design_settings_json`.
- [ ] Сброс возвращает `{ templateId: "default" }`.
- [ ] Ошибка API показывается пользователю.
- [ ] При закрытии с несохранёнными изменениями показывается защита от потери данных.

## 3. Структура

- [ ] В карточке теста открывается действие **Страницы**.
- [ ] Для каждой темы есть зоны **До темы** и **После темы**.
- [ ] Создаётся страница `intro`.
- [ ] Создаётся страница `info`.
- [ ] Создаётся страница `summary`.
- [ ] Создаётся страница `html`.
- [ ] Режимы `template`, `standard`, `html` доступны и сохраняются.
- [ ] Page template выбирается из `manifest.contentTemplates[]` активного шаблона.
- [ ] Значения placeholders сохраняются в `values_json.values`.
- [ ] `placeholderStyles.*.fontSize` сохраняется только для placeholders с `allowAuthorFontSize = true`.
- [ ] `resultField.path` выбирается только из `allowedPaths`.
- [ ] `resultField.renderer` выбирается только из `allowedRenderers`.
- [ ] Reorder внутри одной темы/позиции сохраняет порядок.
- [ ] При смене дизайн-шаблона существующие `content_pages` не удаляются.
- [ ] Страницы с отсутствующим `templateKey` получают warning/remap state.

## 4. Санитизация и assets

- [ ] `richText` удаляет `<script>`.
- [ ] `richText` удаляет inline handlers вроде `onerror`.
- [ ] `html` удаляет `iframe`, небезопасный SVG и `javascript:` URL.
- [ ] Внешние `http/https` ресурсы не проходят в HTML placeholders.
- [ ] `data:*;base64` media из content pages попадает в SCORM ZIP как локальный `assets/media/*`.
- [ ] `/uploads/*` media из content pages попадает в SCORM ZIP как локальный `assets/*`.

## 5. SCORM export

- [ ] Тест без `design_settings_json` экспортируется с fallback `default`.
- [ ] ZIP содержит только выбранный шаблон в `template/`.
- [ ] `imsmanifest.xml` перечисляет `template/manifest.json`, `template/shell.html`, layouts и локальные assets.
- [ ] `TEST_DATA.designSettings` содержит выбранный `templateId` и params.
- [ ] `TEST_DATA.contentPages` содержит созданные страницы.
- [ ] Сервер не выполняет шаблонный JS/HTML при export.

## 6. Runtime

- [ ] Runtime загружает `template/manifest.json`.
- [ ] Runtime загружает `template/shell.html`.
- [ ] Runtime загружает layouts текущей страницы.
- [ ] CSS variables применяются из `designSettings.params`.
- [ ] `start` открывается до question flow.
- [ ] `content.intro` показывается перед вопросами выбранной темы.
- [ ] `content.info` показывается в разрешённой позиции.
- [ ] `content.summary` показывается после вопросов выбранной темы.
- [ ] `content.html` показывает sanitized HTML.
- [ ] `question.*` работает после content pages.
- [ ] `results` открывается после последнего вопроса/content page.
- [ ] `system.blocked` может быть показан без запуска question flow.
- [ ] `progress.mode = questions` показывает прогресс по вопросам.
- [ ] `progress.mode = pages` показывает прогресс по общей последовательности страниц.
- [ ] `progress.mode = hidden` скрывает progress bar.
- [ ] `data-nav="next"` ведёт на следующую страницу flow.
- [ ] `data-action="answer-submit"` принимает ответ.
- [ ] `data-action="test-finish"` завершает тест.
- [ ] `autoAdvance` срабатывает через Core и не обходит финальные защиты.
- [ ] `resultField` рендерится через `core.textMetric`.
- [ ] `resultField` рендерится через `core.progressBar`.
- [ ] `resultField` рендерится через `core.ringChart`.
- [ ] Ошибка renderer plugin даёт fallback и диагностику.
- [ ] Runtime error template показывает Core error page.

## 7. Финальная приемка

- [ ] Пройти export -> открыть ZIP/runtime -> start -> content intro -> question -> content summary -> results.
- [ ] Повторить на `default`.
- [ ] Повторить на `corporate`.
- [ ] Повторить на `minimal`.
- [ ] Проверить старый тест без настроек дизайна.
- [ ] Проверить тест с несколькими темами и страницами до/после каждой темы.
- [ ] Проверить responsive layout preview/runtime на узком экране.
- [ ] Зафиксировать найденные дефекты в `docs/issues/prd-1-issues.md`.
