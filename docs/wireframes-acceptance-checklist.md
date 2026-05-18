# Wireframes Acceptance Checklist (PRD-7 Drawer)

Файлы расположены в рекомендуемом порядке приёмки: сначала основание (shared CSS,
Drawer-контейнер), затем точки входа пользователя, затем каждая вкладка Drawer,
затем диалоги и вспомогательные файлы.

---

## 1. `docs/wireframes/prd7-shared.css`

Общий CSS — фундамент для всех остальных файлов. Принимается первым.

- [x] Файл подключается во всех wireframe-файлах одной и той же `<link>`-строкой
- [x] Импортирует `ds/university-rt.css` — Drawer (`ou-drawer-root`,
  `ou-drawer__backdrop`, `ou-drawer`, `ou-drawer__head`, `ou-drawer__body`,
  `ou-drawer__foot`), кнопки (`ou-btn`, `ou-iconbtn`) и компоненты
  предоставлены DS, не дублируются в `prd7-shared.css`
- [x] Содержит wireframe-инфраструктуру: `wf-nav`, `wf-btn`, `wf-label`,
  `wf-link`, `shell`, `shell.active`, `notes-page`
- [x] Размер файла ≤ 200 строк product-CSS (блок `gate-skip-start … gate-skip-end`
  с токенами `--wf-size-*` / `--wf-space-*` / `--wf-border-w-*` в счёт не идёт —
  это вынужденный мост для значений, отсутствующих в DS)
- [x] Нет дублирования классов из `ds/university-rt.css` и других CSS-файлов проекта

---

## 2. `docs/wireframes/prd7-editor-drawer.html`

Эталон контейнера Drawer. Все вкладочные файлы должны повторять эту структуру.

- [x] Корень: `<div class="ou-drawer-root">` с `role="dialog" aria-modal="true"`
- [x] Backdrop: `<div class="ou-drawer__backdrop">`, размеры через токены DS
- [x] Drawer: `<aside class="ou-drawer ou-drawer--xl ou-drawer--right">`
- [x] Header: `<header class="ou-drawer__head">` — заголовок (`ou-drawer__title`),
  бейдж статуса `ou-tag ou-tag--*` (`Черновик / Опубликован / В архиве`),
  крестик `ou-drawer__close` с `aria-label="Закрыть"` (`ou-drawer__close` —
  самостоятельный DS-класс; рефакторинг на базе `ou-iconbtn` отложен в DS-бэклог)
- [x] Вкладки: `<div class="ou-tabs__list">` со списком `ou-tabs__tab` —
  `Состав | Настройки | Оформление | Структура`; активная вкладка имеет
  `is-active`
- [x] Footer: `<footer class="ou-drawer__foot">` — кнопки-действия прямые дочерние
  элементы (`ou-btn--primary` Сохранить, `ou-btn--secondary` Отменить,
  `ou-btn--ghost` Показать изменения); `justify-content: flex-end` из DS
  (`ou-drawer__foot-meta` / `ou-drawer__foot-actions` в DS отсутствуют —
  добавление отложено в DS-бэклог до появления реальной потребности в
  left/right-зонировании footer)
- [x] `data-template="tpl-bg-page"` присутствует в каждом `.shell`
- [x] `show(id)` и `injectBgPage()` работают без JS-ошибок
- [x] State-switcher `.wf-nav` переключает состояния корректно

---

## 3. `docs/wireframes/prd7-tests-list.html`

Точка входа пользователя — список тестов. Принимается до редактора, т.к. из него открывается Drawer.

- [ ] 12 состояний в `.wf-nav`; каждое переключается без ошибок
- [ ] Отображаются статусы тестов: `Черновик`, `Опубликован`, `В архиве`
- [ ] Кнопки действий на тесте: открыть редактор, удалить, архивировать
- [ ] Пустое состояние: заглушка "нет тестов", кнопка создания
- [ ] Состояние загрузки / ошибки присутствуют

---

## 4. `docs/wireframes/prd7-tests-delete-confirm.html`

Диалог удаления теста. Принимается вместе со списком тестов.

- [ ] Текст предупреждения содержит название теста
- [ ] Кнопки: `Удалить` (destructive) и `Отмена`
- [ ] Кнопка `Удалить` визуально выделена как опасное действие

---

## 5. `docs/wireframes/prd7-tests-archive.html`

Диалог архивации теста.

- [ ] Текст объясняет последствия архивации
- [ ] Кнопки: `Архивировать` и `Отмена`

---

## 6. `docs/wireframes/prd7-editor-settings-tab.html`

Вкладка "Настройки" Drawer.

- [ ] Drawer-контейнер соответствует эталону `prd7-editor-drawer.html` (п. 2)
- [ ] Вкладка `Настройки` активна
- [ ] Поля: название теста, описание, проходной порог, ограничение времени, число попыток
- [ ] Поле `flowMode` — select/radio с вариантами: `linear_by_topics`, `linear_flat`, `mixed`, `router_by_topics`
- [ ] Состояния: `s-main`, `s-loading`, `s-error`, `s-readonly`, `s-saved`, `s-dirty`, `s-validation`
- [ ] В `s-validation` — inline-ошибки у полей и summary вверху
- [ ] В `s-readonly` — поля задизаблены, баннер "только чтение"

---

## 7. `docs/wireframes/prd7-design-tab.html`

Вкладка "Оформление" Drawer. Референс содержания: `docs/wireframes/design-tab.html`.

- [ ] Drawer-контейнер соответствует эталону `prd7-editor-drawer.html` (п. 2)
- [ ] Вкладка `Оформление` активна

### Состояния (сверить с state-switcher в `design-tab.html`)

- [ ] `s-main` — все секции раскрыты, поля заполнены
- [ ] `s-empty` — нет шаблона, кнопка выбора
- [ ] `s-loading` — скелетон / спиннер
- [ ] `s-saving` — индикатор сохранения
- [ ] `s-dirty` — changed-chips в footer, признак несохранённых изменений
- [ ] `s-api-error` — сообщение об ошибке API
- [ ] `s-validation` — inline-ошибки + summary
- [ ] `s-readonly` — поля задизаблены, баннер
- [ ] `s-preview` — предпросмотр шаблона
- [ ] `s-saved` — тост / баннер сохранения
- [ ] `s-color-picker` — открытый color-picker
- [ ] `s-gallery` — галерея ресурсов
- [ ] `s-gallery-search` — галерея с поиском
- [ ] `s-gallery-empty` — галерея без результатов
- [ ] `s-gallery-confirm` — подтверждение выбора из галереи

### Содержание

- [ ] Секция "Шаблон": миниатюра, название, бейдж "Встроенный", версия, описание, `Предпросмотр`, `Заменить шаблон`
- [ ] Действие "Сбросить до умолчаний" — в `...`-меню секции "Шаблон", не отдельное состояние
- [ ] Поля `templateVersion` и `templateApiVersion` — read-only в "Диагностике шаблона"
- [ ] Секции `Брендирование`, `Макет`, `Прогресс и шапка` перенесены без потерь из `design-tab.html`
- [ ] В `s-main` показаны все типы параметров: `text`, `multiselect`, `url`, `asset`, `file`, `downloadLink`, `color`, `select`
- [ ] Нет кнопок `Сохранить оформление` / `Сбросить до умолчаний` в footer вкладки

---

## 8. `docs/wireframes/prd7-structure-linear-by-topics.html`

Вкладка "Структура", режим `linear_by_topics`. Референс: `docs/wireframes/pages-tab.html`.

- [ ] Drawer-контейнер соответствует эталону (п. 2); вкладка `Структура` активна
- [ ] Индикатор текущего `flowMode` read-only вверху рабочей области
- [ ] Нет ссылок на "Вопросы" — ссылка "Нет тем" ведёт на вкладку `Состав`

### Состояния из `pages-tab.html` (все должны быть перенесены)

- [ ] `s-main` — список тем с вопросами
- [ ] `s-empty-pages` — нет страниц до/после
- [ ] `s-empty-topics` — нет тем; ссылка на `Состав`
- [ ] `s-loading` / `s-error`
- [ ] `s-readonly` — баннер, кнопки задизаблены
- [ ] `s-saved` — тост
- [ ] `s-tpl-mapping` — маппинг шаблонов
- [ ] `s-add-step1-tpl` / `s-add-step1-std` — добавление шаг 1
- [ ] `s-add-step2` — добавление шаг 2
- [ ] `s-edit-intro` / `s-edit-intro-auto` / `s-edit-info` / `s-edit-standard` / `s-edit-summary` / `s-edit-html`
- [ ] `s-page-preview` / `s-page-preview-auto`
- [ ] `s-dirty-form` — несохранённые изменения формы
- [ ] `s-validation` — ошибки валидации
- [ ] `s-sanitize-html`
- [ ] `s-delete` — подтверждение удаления
- [ ] `s-dnd-pages` / `s-dnd-topics`
- [ ] `s-runtime-preview` — Runtime flow preview

### Дополнения PRD-7

- [ ] `s-mode-change` — warning-блок "Есть настройки, не применимые к текущему режиму" с раскрываемым списком
- [ ] `s-tpl-fallback` — строка с warning-пиктограммой "элемент работает через fallback"
- [ ] Кнопки-иконки: `ou-iconbtn` (или `ou-iconbtn--s`) + `aria-label`

---

## 9. `docs/wireframes/prd7-structure-linear-flat.html`

Вкладка "Структура", режим `linear_flat`.

- [ ] Drawer-контейнер соответствует эталону (п. 2); вкладка `Структура` активна
- [ ] Индикатор `flowMode` read-only вверху
- [ ] `s-main` — плоский список вопросов без разбивки по темам
- [ ] `s-empty` — нет вопросов, кнопка добавления
- [ ] Зоны `Перед тестом` и `После теста` присутствуют
- [ ] `s-loading`, `s-error`, `s-readonly`, `s-saved`, `s-dirty-form`, `s-validation`
- [ ] `s-add`, `s-edit`, `s-delete`, `s-dnd`, `s-preview`
- [ ] `s-mode-change` — warning-блок с раскрываемым списком
- [ ] `s-tpl-fallback` — fallback-строка
- [ ] Нет группировки по темам

---

## 10. `docs/wireframes/prd7-structure-mixed.html`

Вкладка "Структура", режим `mixed`.

- [ ] Drawer-контейнер соответствует эталону (п. 2); вкладка `Структура` активна
- [ ] `s-main` — три зоны: `Перед тестом` / `Блок вопросов` / `После теста`
- [ ] `.zone-block--questions` визуально выделена
- [ ] `.flow-mode-bar` с переключателем режима присутствует
- [ ] `s-empty-pages` — нет страниц; `s-empty-questions` — нет вопросов в блоке
- [ ] `s-edit-intro`, `s-edit-info`, `s-edit-summary`, `s-edit-html` — редакторы страниц
- [ ] `s-page-preview`
- [ ] `s-dnd` — `.drop-zone` и `.insert-row` видны
- [ ] `s-loading`, `s-error`, `s-readonly`, `s-saved`, `s-dirty-form`, `s-validation`
- [ ] `s-mode-change` — `.mode-change-warn`
- [ ] `s-tpl-fallback` — `.fallback-row` и `.unavail-row`
- [ ] Кнопки-иконки: `ou-iconbtn` (или `ou-iconbtn--s`) + `aria-label`

---

## 11. `docs/wireframes/prd7-structure-router.html`

Вкладка "Структура", режим `router_by_topics`.

- [ ] Drawer-контейнер соответствует эталону (п. 2); вкладка `Структура` активна
- [ ] `s-main` — `.router-block` с read-only индикаторами `completionPolicy` и `sectionUnlockRules`
- [ ] В `s-main` одновременно видны карточки со всеми 6 вариантами `.state-badge`:
  `not-started`, `in-progress`, `done-pass`, `done-fail`, `done`, `locked`
- [ ] `.final-result-block` в состоянии `locked`: SVG-иконка замка + текст с `completionPolicy`
- [ ] `.connector-wrap` между карточками разделов
- [ ] `s-section` — `.compact-router` strip + выбранная карточка + `.sdp` detail panel
- [ ] `.sdp` содержит список страниц / вопросов + превью result-states
- [ ] `.compact-chip` с `.state-badge` в compact-router strip
- [ ] `s-empty` — нет разделов, кнопка создания
- [ ] `s-loading`, `s-error`, `s-readonly`, `s-saved`
- [ ] `s-mode-change` — `.mode-change-warn`
- [ ] `s-tpl-fallback` / `s-tpl-unavail` — `.unavail-hint` с объяснением

---

## 12. `docs/wireframes/prd7-section-basic.html`

Вкладка "Состав" — базовая секция.

- [ ] Список вопросов с типами: single, multiple, matching, ranking
- [ ] Кнопка добавления вопроса с выбором типа
- [ ] Состояния: `s-main`, `s-empty`, `s-loading`, `s-error`, `s-readonly`

---

## 13. `docs/wireframes/prd7-section-basic-states.html`

Все состояния базовой секции.

- [ ] Состояния формы добавления / редактирования вопроса
- [ ] `s-dirty-form`, `s-validation`, `s-delete`
- [ ] `s-dnd` — drag-and-drop вопросов
- [ ] `s-saved`

---

## 14. `docs/wireframes/prd7-section-adaptive.html`

Адаптивный режим секции.

- [ ] Показаны специфичные для adaptive поля (пороги, ветвление)
- [ ] Визуально отличается от базовой секции

---

## 15. `docs/wireframes/prd7-section-start-pages.html`

Страницы до/после в секции.

- [ ] Редакторы intro / summary / html страниц внутри секции
- [ ] Состояние без страниц — кнопка добавления

---

## 16. `docs/wireframes/prd7-section-basic-feedback-editor.html`

Редактор обратной связи.

- [ ] Редактор feedback для correct / incorrect / partial ответов
- [ ] Предпросмотр feedback

---

## 17. `docs/wireframes/prd7-editor-close-confirm.html`

Диалог подтверждения закрытия Drawer с несохранёнными изменениями.

- [ ] Три кнопки: `Сохранить`, `Выйти без сохранения`, `Отмена`
- [ ] Кнопка `Сохранить` disabled при наличии блокирующих ошибок
- [ ] При disabled `Сохранить` — краткая причина и ссылка на первую ошибку

---

## 18. `docs/wireframes/prd7-editor-conflict.html`

Диалог конфликта версий (concurrent edit).

- [ ] Два действия: `Обновить данные` (recommended, default) и `Сохранить поверх`
- [ ] `Обновить данные` визуально выделена как рекомендуемое действие

---

## 19. `docs/wireframes/prd7-mode-switch-warning.html`

Предупреждение при смене `flowMode`.

- [ ] Список настроек, несовместимых с новым режимом
- [ ] Для каждой настройки указан режим, при котором она снова становится доступной
- [ ] Кнопки: подтвердить смену и отмена

---

## 20. `docs/wireframes/prd7-editor-status-indicators.html`

Агрегированные индикаторы вкладок Drawer.

- [ ] Индикатор `изменено` на вкладке при наличии изменений
- [ ] Индикатор `warning` на вкладке при наличии предупреждений
- [ ] Индикатор `error` на вкладке при наличии ошибок
- [ ] Кнопка `Сохранить` disabled при наличии ошибок; при наличии только warning — активна

---

## 21. `docs/wireframes/prd7-editor-mobile.html`

Мобильный fallback при ширине < 960px.

- [ ] Drawer не обрезается по горизонтали
- [ ] Fallback-контент понятен пользователю
- [ ] Проверено на ширине 375px и 768px

---

## Final Sign-off

После приёмки всех файлов:

- [ ] Нет файлов с legacy-классами (`btn`, `btn-*`, `drawer-*`, `dialog-*`,
  `sidebar`, `nav-item`, `form-group`, `form-label`, `badge`, `card-*`,
  `banner` с прямыми модификаторами и т.д.) — `npm run check:wireframes:ds`
  проходит на базовом профиле
- [ ] Нет файлов в старом формате (`ou-button`, `wf-state`, `wf-page-wrap`, `showState`)
- [ ] Нет файлов с маркером `STATES_INSERT_POINT`
- [ ] Все состояния из `design-tab.html` присутствуют в `prd7-design-tab.html`
- [ ] Все состояния из `pages-tab.html` присутствуют в `prd7-structure-linear-by-topics.html`
- [ ] Проверено на ширине 1440px и < 960px
- [ ] Дизайнер / PM подтвердил каждый файл
- [ ] Файлы перенесены в `docs/wireframes/approved/`
