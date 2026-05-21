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

- [x] 16 состояний в `.wf-nav`; каждое переключается без ошибок: `default`, `collapsed`,
  `search`, `menu-open`, `menu-open-pub`, `folder-menu`, `folder-delete-a`,
  `folder-delete-b`, `preview`, `lazy`, `loading`, `empty`, `error`,
  `fab-folder-pick`, `fab-restricted`, `fab-open`
- [x] Отображаются статусы тестов: `Черновик`, `Опубликован`. Архивные тесты вынесены
  на отдельную страницу `prd7-tests-archive.html`; доступ — sub-ссылка «Архив»
  в сайдбаре под пунктом «Тесты»
- [ ] Дополнительная статус-метка «Требует обновления» на карточке/строке теста, если
  его варианты страниц несовместимы с актуальным snapshot'ом шаблона (дрейф версий
  шаблона). Метка `ou-tag ou-tag--warning` рядом со стандартным статусом; при открытии
  такого теста автор-владелец видит принудительный диалог `s-mapping` (см. §8),
  read-only пользователь — только метку
- [x] Кнопки действий на тесте: открыть редактор (`action-btn` на строке),
  удалить / архивировать (`dropdown-item` в row-меню)
- [x] Пустое состояние: заглушка «Тестов пока нет» + кнопки `Создать папку` и `Новый тест`
- [x] Состояние загрузки: `s-loading` (skeleton), `s-lazy` (спиннер пагинации).
  Состояние ошибки загрузки списка: `s-error` (state-level banner: alert-иконка,
  заголовок «Не удалось загрузить тесты», описание + retry-кнопка `Повторить`).
  Action errors (delete/archive/publish failed) — toast'ом, не state-level

---

## 4. `docs/wireframes/prd7-tests-delete-confirm.html`

Диалог удаления теста. Принимается вместе со списком тестов.

- [x] Текст предупреждения содержит название теста inline в тексте
  (`Тест «Основы информационной безопасности» будет удалён…`)
- [x] Кнопки: `Удалить навсегда` (DS-класс `ou-btn--destructive`) и `Отмена`
  (`ou-btn--secondary`)
- [x] Кнопка `Удалить` визуально выделена как опасное действие — красный
  `--ou-error-default` через `ou-btn--destructive`. Дополнительно FR-30:
  активна только при точном совпадении введённого названия (3 состояния:
  `s-empty`, `s-mismatch`, `s-match`)

---

## 5. `docs/wireframes/prd7-tests-archive.html`

Страница «Архив тестов» — список архивированных тестов с действиями восстановить /
удалить навсегда (FR-31). Архивация инициируется из `prd7-tests-list.html` через
dropdown «Архивировать» в row-меню и не имеет отдельной confirmation-модалки
(action reversible через эту страницу).

- [x] 6 состояний в `.wf-nav`: `s-list`, `s-preview`, `s-restore`,
  `s-restore-orphan`, `s-delete`, `s-empty`; каждое переключается без ошибок
- [x] DS-shell: `ou-shell` + `ou-shell__side` + `ou-shell__header` +
  `ou-shell__main`; модалки через `ou-modal-root` + `ou-modal--m`
- [x] Sidebar: «Архив» как `ou-side__item--sub is-active` под пунктом «Тесты»;
  header содержит back-link `← Тесты` + page-title «Архив тестов»
- [x] Таблица: колонки `Название / Статус / Режим / Сценарий / Тем / Вопросов /
  Архивирован / Назначений / [preview-toggle]`. Preview-toggle в последней
  колонке заголовка таблицы (как в `prd7-tests-list.html`), не в shell-header
- [x] Row-actions: `Восстановить` (`ou-iconbtn` с DS-токенами accent на hover)
  и `Удалить навсегда` (`ou-iconbtn` с error-токенами на hover)
- [x] `s-preview` — preview-panel справа с DS-типографикой (12px body-s для row,
  не caption); кнопки «Восстановить» / «Удалить навсегда» в панели убраны —
  действия только через row-iconbtn
- [x] `s-restore` / `s-restore-orphan` — модалка подтверждения восстановления;
  orphan дополнительно показывает warning-callout «папка удалена»
  (`ou-warning-soft` фон + `ou-warning-default` border, body-s текст)
- [x] `s-delete` — модалка с warning «Тест будет удалён безвозвратно»,
  кнопка `Удалить навсегда` с DS-классом `ou-btn--destructive`
- [x] `s-empty` — empty-state «Архив пуст», без баннеров и кнопок (архив
  пополняется только через архивирование из основного списка)

---

## 6. `docs/wireframes/prd7-editor-settings-tab.html`

Вкладка "Настройки" Drawer.

- [x] Drawer-контейнер соответствует эталону `prd7-editor-drawer.html` (п. 2):
  `ou-drawer-root` + `ou-drawer__backdrop` + `ou-drawer ou-drawer--xl ou-drawer--right`,
  `ou-drawer__head` (+ `__head-text` + `__title` + `__close`), `ou-tabs ou-tabs--underline`,
  `ou-drawer__body` (`tabindex="0"`), `ou-drawer__split` + `ou-drawer__rail` для
  sidenav, `ou-drawer__foot`. Кнопки `ou-btn` (а не legacy `ou-button`)
- [x] Вкладка `Настройки` активна (`ou-tabs__tab is-active aria-selected="true"`
  и `wf-status-dot--dirty` индикатор где применимо)
- [x] Поля: `f-title` (Название*, required), `f-desc` (Описание), `f-status`,
  `f-flow-mode`, `f-pass-val` (Порог), `f-time` (Лимит времени), `f-attempts`
  (Максимум попыток) — DS `ou-field`/`ou-textarea`
- [x] Поле `flowMode` — select с вариантами `linear_flat` (selected),
  `linear_by_topics`, `mixed`, `router_by_topics`
- [x] **Section-states** (контентная декомпозиция): `s-basic`, `s-mode`,
  `s-pass-rules`, `s-limits`, `s-feedback`, `s-integration`, `s-adaptive`
  (по подразделам sidenav). **Editor-states** (sample на `s-basic`):
  `s-basic-loading` (skeleton), `s-basic-error` (centered alert + retry),
  `s-basic-readonly` (info banner + disabled fields), `s-basic-saved` (success
  banner + clean state), `s-basic-dirty` (chip + dot, baseline `s-basic`),
  `s-basic-validation` (error summary + field-level errors)
- [x] В `s-basic-validation` — error-banner с summary (`wf-state-banner--error`,
  список «Исправьте N ошибок» со ссылками на поля), inline `wf-field-error`
  под полем, `ou-field--error` border, Save disabled
- [x] В `s-basic-readonly` — info-banner с `i-lock` ("Тест опубликован, доступно
  только для просмотра"), все `input`/`textarea`/`select` с атрибутом `disabled`,
  кнопка Save заменена на «Закрыть»

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

Вкладка "Структура", режим `linear_by_topics`. Референс: `docs/legacy/pages-tab.html`.

- [x] Drawer-контейнер соответствует эталону (п. 2); вкладка `Структура` активна
- [x] Индикатор текущего `flowMode` read-only вверху рабочей области
- [x] Нет ссылок на "Вопросы" — ссылка "Нет тем" ведёт на вкладку `Состав`

### Состояния из `pages-tab.html` (все должны быть перенесены)

ID состояний сохранены из исходного `legacy/pages-tab.html` без переименования.

Generic-состояния drawer'а (`s-loading`, `s-error`, `s-saved`) описаны
в [approved/prd7-editor-drawer.html](approved/prd7-editor-drawer.html) и
не дублируются здесь — поведение единообразно для всех вкладок.

- [x] `s-main` — список тем с вопросами
- [x] `s-empty-pages` — нет страниц до/после
- [x] `s-empty-topics` — нет тем; ссылка на `Состав`
- [x] `s-readonly` — баннер, кнопки задизаблены
- [x] `s-mapping` — модальный диалог замены варианта. Триггеры запуска:
  (1) ручная смена шаблона во вкладке «Оформление»;
  (2) автозапуск при загрузке теста, если шаблон был обновлён и какие-то варианты
  страниц теста отсутствуют в новой версии (дрейф `templateVersion`);
  (3) импорт SCORM-пакета в существующий тест с несовместимыми вариантами.
  Во всех сценариях «Сохранить» drawer disabled до полного разрешения всех
  несовместимостей. Read-only пользователь диалог не видит — для него тест
  отображается со статус-меткой «Требует обновления» (см. §3)
- [x] `s-add-step1` — модальный диалог `ou-modal --m` с поиском и компактным списком
  вариантов из текущего шаблона. Имя варианта — контракт; имена и состав приходят
  из определения шаблона, а не enum'а системы. Поиск нужен для масштабирования
  на большие наборы вариантов в кастомных шаблонах
- [x] Отдельного шага «ввод названия / позиции» **нет**: после выбора варианта
  страница добавляется в позицию, из которой был открыт диалог (нажатый
  `insert-row`), и автоматически разворачивается. Название и остальные поля
  автор заполняет inline в `page-row-expand`
- [x] Редактирование содержимого страницы — **inline-expand самой строки**:
  у каждой `page-row` слева `page-expand-toggle` (chevron), при раскрытии
  под строкой появляется блок `page-row-expand` с полями формы по schema
  варианта шаблона. Если schema варианта пуста (контент задан шаблоном) —
  chevron не отрисовывается, строка не разворачивается. Отдельного state
  редактора нет — это не модальный экран, а аккордеон-разворот внутри списка
- [x] `s-page-preview` / `s-page-preview-aa` (отсчёт автоперехода)
- [x] `s-dirty-form` — раскрытая страница с несохранёнными изменениями;
  на toggle — dirty-индикатор, footer в dirty-triplet режиме
- [x] `s-validation` — раскрытая страница с error-banner в `page-row-expand`
  и inline-ошибками под полями
- [x] `s-sanitize` — раскрытая HTML-страница после санитайзера: warning-banner
  внутри `page-row-expand` со списком удалённых небезопасных элементов
- [x] `s-delete` — подтверждение удаления через ModalDialog с danger-иконкой
- [x] `s-dnd` (страницы) / `s-dnd-topics`

### Дополнения PRD-7

- [x] `s-mode-change` — warning-блок "Есть настройки, не применимые к текущему режиму"
  с раскрываемым списком
- [x] Несовместимость вариантов при смене шаблона решается **только через `s-mapping`**
  (модальный диалог явной замены варианта на ближайший из нового шаблона или удаления
  страницы). Авторский UI **не** показывает "fallback-варианты" с warning-пиктограммой —
  такой паттерн устарел вместе с enum-типами страниц.
- [x] Footer Drawer: кнопки — прямые дочерние `ou-drawer__foot` (без обёрток
  `__foot-meta` / `__foot-actions`, которых нет в DS); единый размер `ou-btn--m`
- [x] Кнопки-иконки: `ou-iconbtn ou-iconbtn--s` + `aria-label` (один размерный
  модификатор, не комбинация `--m --s`)
- [x] Баннеры: `ou-banner` + variant-модификатор `ou-banner--subtle` + BEM
  (`__ico`, `__body`, `__title`/`__desc`/`__actions`)
- [x] Empty-states: `ou-empty` с BEM-обёртками `__art` / `__content` / `__actions`
  и семантическими `<h3 class="ou-empty__title">` / `<p class="ou-empty__desc">`

---

## 9. `docs/wireframes/prd7-structure-linear-flat.html`

Вкладка "Структура", режим `linear_flat`.

- [ ] Drawer-контейнер соответствует эталону (п. 2); вкладка `Структура` активна
- [ ] Индикатор `flowMode` read-only вверху
- [ ] `s-main` — последовательный список вопросов без разбивки по темам
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
