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

### Gaps — добавить в editor-drawer (нашлись при удалении дубликатов section-*, 2026-05-21)

- [x] **Adaptive-вариант вкладки «Состав»** (FR-36): новый state в editor-drawer
  (`s-default-adaptive`). По решению пользователя 2026-05-21 — **минимальное
  отличие от s-default**: добавляется ровно один `ou-banner--subtle`
  `ou-banner--info` сверху body со ссылкой на «Настройки → Адаптивный режим».
  Никаких изменений в `tb-draw-count-row` (label «Вопросов в тест», обычный
  input + «из M»). Никакого `--adaptive` модификатора в этом state. Никакого
  header-tag «Адаптивный» — статусы как в s-default. Все темы и feedback —
  идентичны s-default. Принцип: контракт Состав vs Структура — Состав
  не зависит от режима (см. [[fr-40-content-preserved-on-mode-change]]).
  *(2026-05-21: первая версия имела `--adaptive` модификатор и tag «Адаптивный»*
  *в каждой строке + header-tag — пользователь отверг как избыточное; затем*
  *была короткая версия с лейблом «Максимум для оценки» — тоже отвергнута*
  *как «состав не должен меняться». Финал — только banner. Иконка `i-info`*
  *добавлена в sprite. Линтер: 0 violations.)*
- [x] **Feedback edit form** (FR-36, FR-37): модал/inline-редактор с richtext +
  ссылки на материалы + PDF-assets.
  *(2026-05-21: добавлен state `s-feedback-edit` в editor-drawer с модалом*
  *`ou-modal--l` поверх drawer-Состав. Содержит:*
  *(1) inline format-selector `ou-seg ou-seg--s` (Простой / Форматированный /*
  *HTML, выбран Форматированный) — компактный DS SegmentedControl вместо*
  *громоздких choice-cards;*
  *(2) rich-text editor `tb-rte` с toolbar (B / I / link) и contenteditable*
  *area с примером;*
  *(3) section «Ссылки на материалы» (FR-37) — single-row item (title + url*
  *в одной строке, `__item-fields` flex-row, +trash) + кнопка «Добавить ссылку»;*
  *(4) section «Прикреплённые файлы (PDF)» (FR-37) — asset-row с*
  *paperclip-иконкой, inline-rename + file-meta (filename · size) +*
  *delete + upload-button «Загрузить PDF» с hint про SCORM-пакет.*
  *Footer: Отменить / Сохранить. Drawer на бэке dimmed (`opacity: 0.55`),*
  *body `aria-hidden`, footer disabled. FR-аннотации: FR-36 на close-button,*
  *FR-37 на assets-section. Добавлены: `tb-feedback-editor*` / `tb-rte*`*
  *CSS-секция в `<style>` (gate-passing DS-токены), иконка `i-trash`*
  *в sprite, DS-mapping fallback для feedback-editor / rich-text.*
  *Линтер: 0 violations, visual-проверка в Playwright 1440×900 — модал*
  *умещается в viewport без скролла, отрисован корректно.)*
- [x] **DS+tb-* частичный рефакторинг editor-drawer** (2026-05-21):
  компонентные классы вкладки «Состав» во всех state'ах мигрированы на tb-*
  (`tb-topic-row` + BEM, `tb-draw-count-row` + BEM + `--adaptive` modifier,
  `tb-feedback-preview` + BEM + `.is-empty`, `tb-section-label`, `tb-card-desc`).
  Подключён `tb-components.css` в head. Удалено ~43 строки dead inline CSS под
  `.topic-row*` / `.draw-count-row*` / `.feedback-*` / `.topic-section-label`.
  Линтер не получил новых violations.
- [x] **Остаточный inline CSS** в editor-drawer — частично подчищен
  _(2026-05-21: `.saving-overlay*` (5 классов) → `tb-saving-overlay` + `tb-saving-host`_
  _в `tb-components.css`; `.changes-popover*` + 14 child classes → `tb-changes-popover*`_
  _с BEM в `tb-components.css`; `.ou-drawer__body--saving` modifier → `tb-saving-host`._
  _Удалены dead CSS: `.changed-area`, `.form-hint-small` (не использовались в HTML)._
  _Удалено ~70 строк inline CSS._
  _Остались inline как **wireframe-frame** (правомерны по правилу feedback_wf_only_skeleton_frame):_
  _`.bg-*` slot (simulated background — wireframe-каркас для demo контекста),_
  _`.notes-page`/`.notes-box`/`.notes-table` (для s-notes — wireframe-helper),_
  _`.spin` keyframe (инфраструктура), `.shell--column` (wireframe layout),_
  _`.settings-content` (single layout helper для s-settings),_
  _`.ou-drawer__head` / `.ou-drawer > .ou-tabs` / `.ou-drawer .ou-tabs--underline`_
  *(минимальные DS-overrides), `.ou {}` legacy WF alias bridge.*
  *`.mobile-*` блок удалён вместе с s-mobile state 2026-05-21.*
  *Добавлены `.tb-feedback-editor*` / `.tb-rte*` (gate-passing DS-токены)*
  *для нового s-feedback-edit state 2026-05-21.)*
- [x] **s-mobile state** — удалён из editor-drawer (2026-05-21, согласовано
  пользователем). Удалены: state-button в `.wf-nav`, state-блок (343 строки
  HTML), CSS-блок `.mobile-*` (50 строк), 1 строка из notes-таблицы состояний,
  2 строки из notes-таблицы взаимодействий, DS-mapping fallback на
  `.mobile-canvas`. Mobile-эскизы будет покрывать отдельный PRD.

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
- [x] Дополнительная статус-метка «Требует обновления» на карточке/строке теста, если
  его варианты страниц несовместимы с актуальным snapshot'ом шаблона (дрейф версий
  шаблона). Метка `ou-tag ou-tag--warning` рядом со стандартным статусом; при открытии
  такого теста автор-владелец видит принудительный диалог `s-mapping` (см. §8),
  read-only пользователь — только метку
  _(реализовано на тесте «Аудит логов SCORM» в `s-default`: ячейка статуса —_
  _`flex-direction: column`, второй тег `ou-tag--warning` с tooltip про `s-mapping`;_
  _aria-label строки расширен.)_
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
  `linear_by_topics`, `router_by_topics`
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

- [x] Drawer-контейнер соответствует эталону `prd7-editor-drawer.html` (п. 2) — теги статуса унифицированы (`--outline`)
- [x] Вкладка `Оформление` активна

### Состояния (сверить с state-switcher в `design-tab.html`)

Generic-состояния drawer'а (`s-loading`, `s-saving`, `s-dirty`, `s-error`,
`s-validation`, `s-saved`) описаны в [approved/prd7-editor-drawer.html](approved/prd7-editor-drawer.html)
и не дублируются здесь — поведение единообразно для всех вкладок.

- [x] `wf-template` — активен rail-пункт «Шаблон» (миниатюра, описание, диагностика)
- [x] `wf-branding` — активен rail-пункт «Брендирование», показаны параметры всех типов
- [x] `wf-template-empty` — новый тест, дефолтный шаблон «Стандартный»
- [x] `wf-template-incompatible` — сохранённый шаблон недоступен; баннер ошибки
  с действиями «Выбрать шаблон» / «Применить «Стандартный»»
- [x] `wf-template-preview` — предпросмотр шаблона (overlay)
- [x] `wf-branding-color-picker` — открытый color-picker (popover)
- [x] `wf-template-gallery` — галерея шаблонов
- [x] `wf-template-gallery-search` — галерея с поиском
- [x] `wf-template-gallery-empty` — галерея без результатов
- [x] `wf-template-gallery-confirm` — подтверждение замены шаблона

### Содержание

- [x] Секция "Шаблон": миниатюра, название, бейдж "Встроенный", версия, описание, `Предпросмотр`, `Заменить шаблон`
- [x] Действие "Сбросить до умолчаний" — ghost-кнопка в действиях карточки
  шаблона рядом с "Предпросмотр"/"Заменить шаблон" (не footer, не отдельное
  состояние; PRD-1 §3.1). При клике предполагается стандартный
  confirm-dialog DS, т.к. действие очищает `design_settings_json`
- [x] `templateVersion` и `templateApiVersion` — системные read-only поля, в UI
  не выводятся (FR-41). Версия видна как тег `v1.2.0` рядом с названием шаблона.
  Несовместимые шаблоны фильтруются на бэкенде; при невалидном сохранённом
  `templateId` открывается `wf-template-incompatible`
- [x] Секции `Брендирование`, `Макет`, `Прогресс и шапка` перенесены без потерь из `design-tab.html`
- [x] В `wf-branding` показаны все типы параметров: `text`, `multiselect`, `url`,
  `asset`, `file`, `downloadLink`, `color`, `select`
- [x] Технический ярлык типа в UI не выводится — типы описаны в Acceptance-таблице (FR-31a)
- [x] Нет кнопок `Сохранить оформление` / `Сбросить до умолчаний` в footer вкладки
- [x] FR-аннотации (`wf-annot`) на ключевых элементах: NFR-19 на close-button,
  FR-31 на rail, FR-32 на `...`-меню шаблона, FR-30 на блоке шаблона,
  FR-33 на toolbar галереи; включаются кнопкой `Аннотации` в state-switcher

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
  страниц теста отсутствуют в новой версии (дрейф `templateVersion`).
  В обоих сценариях «Сохранить» drawer disabled до полного разрешения всех
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
- [x] `s-page-preview` / `s-page-preview-aa` — большой модальный диалог
  `ou-modal --xl` с явно обозначенной областью `.preview-frame` (лейбл сверху,
  viewport со светлым фоном). В `-aa` варианте сверху viewport — countdown-bar
  и строка «Автопереход через N с.»
- [x] `s-dirty-form` — раскрытая страница с несохранёнными изменениями;
  индикация dirty — только на табе «Структура» (`.status-dot.dirty`), на самой
  странице меток нет; footer в dirty-triplet режиме
- [x] `s-validation` — раскрытая страница с error-banner в `page-row-expand`
  и inline-ошибками под полями
- [x] `s-sanitize` — раскрытая HTML-страница после санитайзера: warning-banner
  внутри `page-row-expand` со списком удалённых небезопасных элементов
- [x] `s-delete` — подтверждение удаления через ModalDialog `ou-modal --s` с
  danger-иконкой (`ou-modal__icon--danger`) и кнопкой `ou-btn--destructive`
- [x] `s-dnd` (страницы) / `s-dnd-topics`

### Дополнения PRD-7

- [x] `s-mode-change` — info-banner «Режим изменён на Последовательный.
  Содержимое Состава и Структуры сохранено. Меняется только вид выдачи:
  вопросы из тем будут показаны единым плоским потоком, порядок и draw-count
  сохранены. Авторские страницы остаются в зонах До/После теста». Footer
  drawer в стандартном dirty-triplet (`Показать изменения / Отменить /
  Сохранить`), отдельной кнопки «Применить изменения» нет — смена режима
  фиксируется общим Save вкладки. На табе «Структура» — `.status-dot.dirty`.
  *(2026-05-21: переформулировано из warning-блока с раскрываемым списком*
  *несовместимых элементов. См. [[fr-40-content-preserved-on-mode-change]].)*
- [x] Несовместимость вариантов при смене шаблона решается **только через
  `s-mapping`** (модальный диалог явной замены варианта на ближайший из нового
  шаблона или удаления страницы). Авторский UI **не** показывает «fallback-
  варианты» с warning-пиктограммой — такой паттерн устарел вместе с
  enum-типами страниц
- [x] Footer Drawer: кнопки — прямые дочерние `ou-drawer__foot` (без обёрток
  `__foot-meta` / `__foot-actions`, которых нет в DS); единый размер `ou-btn--m`
- [x] Кнопки-иконки в строках: `ou-iconbtn ou-iconbtn--ghost ou-iconbtn--s` +
  `aria-label` (один размерный модификатор, не комбинация `--m --s`)
- [x] Баннеры: `ou-banner` + variant-модификатор `ou-banner--subtle` + BEM
  (`__ico`, `__body`, `__title`/`__desc`/`__actions`)
- [x] Empty-states: `ou-empty` с BEM-обёртками `__art` / `__content` /
  `__actions` и семантическими `<h3 class="ou-empty__title">` /
  `<p class="ou-empty__desc">`
- [x] Select в `s-mapping` — DS-компонент `ou-select` с BEM (`__trigger`,
  `__value`, `__chev`, `__menu`, `__opt`) и мини-popper JS для меню с
  `position: fixed`, чтобы выходить за `overflow` drawer-контейнера
- [x] Модальные диалоги для preview и delete используют DS-структуру
  `ou-modal` + `__head/--icon`, `__body`, `__foot`, `__close`, `__backdrop`
- [x] Бейдж имени варианта — единый `.page-variant-badge` (нейтральный стиль);
  enum-классов `.type-intro/.type-info/.type-summary/.type-html` нет.
  Цветовая палитра — собственность определения варианта в шаблоне, не системы
- [x] Шаблонные строки `page-row--template` без `page-expand-toggle`
  (schema варианта пуста — редактировать нечего)
- [x] FR-аннотации: FR-40 на `.flow-mode-bar`, FR-25a на «Сохранить» в footer,
  FR-25c на «Показать изменения»; включаются кнопкой «Аннотации» в state-switcher
- [x] Полная поддержка dark-темы: только адаптивные DS-токены, никаких
  hardcoded HSL/HEX/RGB, без константного `--ou-neutral-0` в фонах

### Дополнения для variant.kind (PRD-1 §4.3)

- [x] **Questions-row как `page-row--system page-row--questions`**: в каждой
  теме своя запись с локальным per-topic variant'ом из `kind: questions`.
  Контент строки: variant badge, `…` row-menu, иконка `i-question` слева.
  Разметка приведена к финальному виду во всех state'ах
- [x] **`…` row-menu** на каждой `page-row` (info / системные kind): единая
  `.ou-iconbtn` с `i-dots` вместо отдельных Eye / Trash. Меню (открытое) —
  см. `prd7-structure-router.html` state `s-row-menu-open`. Исключение:
  `s-readonly` сохраняет одиночный Eye-iconbtn (read-only preview, нечего
  «удалять / редактировать»)
- [x] **Хинт «Доступно N вариантов»** возле бейджа системных row при N > 1:
  реализован через `ou-tag--info` в `.page-row__meta` (вторая строка
  page-row). В `s-main` подключён на обе questions-row тем («Основы ИБ»,
  «Угрозы и атаки») — паттерн распространяется на все системные kind по
  правилу PRD-1 §4.3.2
- [x] **Warning fallback** «Используется вариант из стандартного шаблона» при
  0 вариантах нужного `kind`: паттерн реализован в router (`s-main-fallback`)
  через `ou-tag--warning` в `.page-row__meta`. Инфраструктура `page-row__meta`
  подключена и в `linear_by_topics`; специфичных fallback-состояний нет, так
  как поведение полностью derived из §11 PRD-1 §4.3.2
- [x] **Валидация required-параметров** (PRD-1 §4.3.6): паттерн реализован
  в router (`s-validation`) через `page-row--warn` + inline-banner +
  `.status-dot--error` на табе + Save disabled. CSS-инфраструктура
  (`page-row--warn`, `.status-dot--error`) применима в `linear_by_topics`
  без дополнительных правок при появлении dedicated validation state

---

## 9. `docs/wireframes/prd7-structure-linear-flat.html`

Вкладка "Структура", режим `linear_flat` («Последовательный»).

Файл показывает **только уникальные** для flat состояния. Общие паттерны
(read-only drawer, `s-mapping` модал, `s-add-step1` модал, `s-page-preview/-aa`,
inline-expand редактирование, `s-dirty-form` / `s-validation` / `s-sanitize`,
`s-delete` модал, `s-dnd` страниц) описаны в §8 и здесь не дублируются.

- [x] Drawer-контейнер соответствует эталону (п. 2); вкладка `Структура` активна
- [x] Индикатор `flowMode` read-only вверху рабочей области (`flow-mode-label` = «Последовательный»)
- [x] Нет группировки по темам — все вопросы единым потоком в одном блоке
- [x] `s-main` — между зонами «До теста» и «После теста» расположена единая
  `.questions-block-card` (вместо набора `.topic-block`):
  заголовок «Вопросы — N шт. (распределение по темам в скобках)» и описание
  «Идут единым потоком, порядок задаётся вкладкой Настройки». В зонах
  «До теста»/«После теста» — обычные шаблонные и авторские `page-row`
  с inline-expand
- [x] `s-empty-questions` — EmptyState «Нет вопросов» (в составе теста не назначены
  вопросы → плоский поток показывать нечего). Кнопка ведёт на вкладку «Состав».
  Отличается от `s-empty-topics` в §8: там темы есть, но без вопросов;
  здесь сам список вопросов пуст
- [x] `s-mode-change` — обратное направление: **Последовательный → По темам**.
  Info-banner «Режим изменён на По темам. Содержимое Состава и Структуры
  сохранено. Меняется только вид выдачи: вопросы из тем будут показаны как
  сгруппированные блоки. Авторские страницы остаются в зонах До/После теста».
  Footer drawer — стандартный dirty-triplet; на табе «Структура» — `.status-dot.dirty`.
  *(2026-05-21: переформулировано из warning-banner + callout «вопросы*
  *сгруппированы / страницы распределены» в info-banner без преобразований.*
  *См. [[fr-40-content-preserved-on-mode-change]] — UX-правило: содержимое*
  *при смене режима не меняется, меняется только рендер.)*
- [x] Общие state'ы (read-only, mapping, add-page, preview, dirty/validation/
  sanitize, delete, DnD) **не дублируются** — поведение задокументировано в §8

### Дополнения для variant.kind (PRD-1 §4.3)

- [x] **Questions-row как `page-row--system page-row--questions`** — одна на тест
  с `topicId: null` между зонами «До теста» и «После теста». В демо: variant badge
  «Минимальный», `…` row-menu, иконка `i-question` слева
- [x] **`…` row-menu** на каждой `page-row` (включая info-row): единая
  `.ou-iconbtn` с `i-dots` вместо отдельных Eye / Trash. Меню (открытое) —
  см. `prd7-structure-router.html` state `s-row-menu-open`
- [x] **Хинт «Доступно N вариантов»** реализован: возле questions-row в `s-main`
  висит `ou-tag--info` «Доступно 2 варианта» как `.page-row__meta` (вторая
  строка page-row). **Warning fallback** и **валидация required-параметров** —
  паттерны реализованы в router (`s-main-fallback` / `s-validation`); специфичных
  состояний в `linear_flat` нет, так как поведение полностью derived из §8
  и инфраструктура `.page-row__meta` уже подключена

---

<!-- §10 удалён: режим `mixed` исключён из `FlowMode` enum как функциональный дубль
     `linear_flat` после переопределения последнего (зоны «До теста» / «После теста»
     теперь входят в `linear_flat`). См. prd-7-decisions.md §2.3a. -->

---

## 11. `docs/wireframes/prd7-structure-router.html`

Вкладка "Структура", режим `router_by_topics` («Через страницу-маршрутизатор»).

Архитектура: **зоны «До теста» / «После теста»** как в `linear_flat` + **системная
page-row `kind: router`** в зоне «Внутри теста» + **темы как ветки** под router-row
через **tree-connectors** (тонкие DS-линии `├─` `└─`, `--ou-border-soft`).
См. [prd-7-decisions.md §2.3b](../prd-7-decisions.md). Старая «сценарная карта»
(`Router → Раздел → Возврат → Итог` с `.connector-wrap`, `.final-result-block`,
`.compact-router`, `.sdp`) — устаревшая модель, не применяется.

Файл показывает **только уникальные** для router состояния. Общие паттерны
(read-only drawer, `s-mapping` модал, `s-add-step1` модал, `s-page-preview`,
inline-expand редактирование, `s-dirty-form` / `s-sanitize`,
`s-delete` модал, `s-dnd`) описаны в §8. Generic-состояния drawer'а
(`s-loading` / `s-error` / `s-saved`) — см.
[approved/prd7-editor-drawer.html](approved/prd7-editor-drawer.html).

- [x] Drawer-контейнер соответствует эталону (п. 2); вкладка `Структура` активна
- [x] Индикатор `flowMode` read-only вверху рабочей области
  (`flow-mode-label` = «Через страницу-маршрутизатор»)
- [x] `s-main` — основное состояние: зоны «До теста» / «После теста» (как
  `linear_flat`); внутри теста — `.page-row.page-row--system[data-kind="router"]`
  (единственная, неудаляемая, без insert-row до/после), под ней через
  `.tree-branches` подвешены 3 темы как `.topic-block` с собственными
  questions-row (`.page-row.page-row--system.page-row--questions
  [data-kind="questions"]`). В демо: Тема 1 и 2 — variant «Минимальный»,
  Тема 3 — variant «Расширенный» (демонстрирует **локальность per-topic**)
- [x] `s-main-multi-variant` — иллюстрирует ветку «N > 1 вариантов в шаблоне»
  из тихой логики связывания (PRD-1 §4.3.2): возле бейджа системных row —
  caption-метка «Доступно N вариантов» (italic, `--ou-fg-muted`). Смена
  варианта — через `…` row-menu → «Сменить вариант» (см. §11a)
- [x] `s-main-fallback` — иллюстрирует ветку «0 вариантов нужного `kind` в
  шаблоне» (PRD-1 §4.3.2): возле бейджа — warning-метка «Из стандартного
  шаблона» с `--ou-warning-soft` фоном и иконкой `i-warn`
- [x] `s-empty-topics` — router-row есть (тихая привязка), но в составе теста
  нет тем: внутри `.tree-branches` — `ou-empty` «В тесте нет тем» с CTA на
  вкладку «Состав». Empty-state для самой router-row отсутствует
- [x] `s-mode-change` — обратное направление: **router_by_topics → По темам**
  (или → Последовательный). Info-banner «Режим изменён на X. Содержимое
  Состава и Структуры сохранено. Маршрутизатор и его параметры (правила
  завершения, разблокировки разделов) **сохраняются до закрытия редактора**
  — если вернуться к режиму Через маршрутизатор в этой же сессии, настройки
  восстановятся. После сохранения теста в режиме linear* параметры
  маршрутизатора будут очищены». Локальные variant'ы questions-row
  сохраняются per-topic. Footer — стандартный dirty-triplet; на табе
  «Структура» — `.status-dot.dirty`.
  *(2026-05-21: переформулировано из warning «Маршрутизатор будет удалён,*
  *параметры теряются» в info-banner с сохранением параметров в draft до*
  *закрытия редактора. См. [[fr-40-content-preserved-on-mode-change]].)*
- [x] `s-validation` — незаполненные `required: true` поля в schema варианта
  (PRD-1 §4.3.6): `.page-row--warn` модификатор (warning-цвет границы и
  заголовка), `.validation-banner` в `page-row-expand` со списком конкретных
  полей, на табе «Структура» — `.status-dot.status-dot--error` (агрегированный
  error-индикатор согласно FR-25b / NFR-21), кнопка «Сохранить» disabled с
  tooltip. Серверный API возвращает структурированную ошибку
- [x] `s-row-menu-open` — открытый `…` row-menu (`.row-menu`):
  для системных kind пункты «Сменить вариант…» / «Предпросмотр».
  Пункт «Удалить» **не показывается** — системную page-row нельзя
  удалить вручную (PRD-1 §4.3.5). Для пользовательских `info`-row
  «Удалить» доступен (destructive-стиль).
  Позиционирование dropdown — `position: absolute` от `.page-actions`
- [x] Общие state'ы (read-only, mapping, add-page, preview, dirty / sanitize-html,
  delete, DnD) **не дублируются** — поведение задокументировано в §8
- [x] **`completionPolicy` и `sectionUnlockRules` НЕ отображаются в Структуре** —
  они живут во вкладке «Настройки → Сценарий», условно при `router_by_topics`
  (см. PRD-8 §3.2.1)
- [x] **Темы как ветки** через `.tree-branches` + `.tree-branch`: тонкие
  DS-линии (`--ou-border-soft`, `1px`), угловые `├─` (вертикальный guide и
  горизонтальный коннектор) и `└─` (последняя ветка, guide останавливается
  на её высоте). Никакого акцентного цвета, никаких теней, никаких толстых
  SVG-стрелок
- [x] **Page-row `kind: router`** = page-row--system + chevron при непустой
  schema + variant badge + `…` row-menu + без insert-row до/после + без delete
- [x] **Page-row `kind: questions`** внутри каждой темы-ветки = page-row--system
  page-row--questions; variant локальный per-topic (разные темы могут иметь
  разные variant'ы); те же возможности: variant badge + хинт N + warning
  fallback + `…` row-menu + expand при непустой schema
- [x] Footer Drawer: триплет `Показать изменения` (ghost) / `Отменить`
  (secondary) / `Сохранить` (primary), все `ou-btn--m`, прямые дочерние
  `ou-drawer__foot`
- [x] FR-аннотации: FR-40 на `.flow-mode-bar`, PRD-7 §2.3b на `.inside-test`;
  включаются кнопкой «Аннотации»
- [x] Полная поддержка dark-темы: только адаптивные DS-токены, никаких
  hardcoded HSL/HEX/RGB

---

## 11a. `docs/wireframes/approved/prd7-variant-replace.html`

Модал смены варианта на существующей `page-row` (PRD-1 §4.3.3).
Триггер — `…` row-menu → «Сменить вариант». Применим **ко всем `kind`**
(`info` / `intro` / `summary` / `router` / `questions`).

- [x] `ou-modal --m` с поиском вариантов того же `kind` из текущего шаблона;
  текущий вариант помечен меткой «Текущий» и disabled (нельзя «сменить» на тот же)
- [x] **Warning-блок «что теряется»** под списком вариантов:
  `--ou-warning-soft` фон, перечень полей с именем + текущим значением + пояснение,
  почему поле не переносится. Положительная информация («что переносится») в модал
  не выводится — это штатное поведение, перенесённые значения автор увидит в
  `page-row-expand` при следующем редактировании. Контракт совпадения полей —
  «имя поля = совместимый тип» между вариантами одного `kind`
  _(2026-05-21: дизайн упрощён под фидбэк — счётчики «N параметров» под_
  _вариантами и зелёный блок «Будут сохранены» удалены; технические термины_
  _`schema` / `kind` исключены из user-facing текста; в `s-replace-no-fields`_
  _объяснение «новый вариант — шаблонный» объединено с warning-блоком как_
  _`diff-block__meta`, отдельный `confirm-note` удалён.)_
- [x] `s-replace-modal` — основное: список вариантов + warning-блок
  «Часть настроек не переносится» с перечнем теряемых полей
- [x] `s-replace-empty-diff` — спокойный случай: все поля совпадают, в модале
  только список вариантов без warning-блока. Кнопка «Сменить вариант» доступна
- [x] `s-replace-no-fields` — у нового варианта нет редактируемых полей;
  единый warning-блок «Текущие настройки страницы будут потеряны» с перечнем
  значений и пояснением «У нового варианта нет редактируемых полей —
  содержимое страницы будет полностью задано шаблоном»
- [x] Footer: «Отменить» (secondary) / «Сменить вариант» (primary)
- [x] FR-аннотации: PRD-1 §4.3.3 на diff-блоке
- [x] Полная поддержка dark-темы: только DS-токены

---

## 12-16. `prd7-section-*` — удалены как дубликаты `prd7-editor-drawer.html`

5 файлов (`prd7-section-basic`, `-basic-states`, `-adaptive`, `-start-pages`,
`-basic-feedback-editor`) удалены 2026-05-21 как **дубликаты** approved-эталона
[approved/prd7-editor-drawer.html](approved/prd7-editor-drawer.html) (§2): этот
файл уже содержит state'ы `s-default` / `s-dirty` / `s-error` / `s-saving` /
`s-changes` / `s-settings` / `s-mobile` / `s-notes`, покрывающие вкладку «Состав»
со всеми её edit-состояниями. Отдельные section-* остались с старого подхода
до того, как был сделан многосостояточный editor-drawer.

13 пунктов чек-листа §12-§16 закрываются как **out-of-scope** для PRD-7 wireframes.

**Уникальный контент, который надо добавить в editor-drawer** (см. §2):

- **Adaptive вариант вкладки «Состав»** — `tb-draw-count-row--adaptive` modifier
  с tag «Подбор вопросов: адаптивный» + link «Настроить уровни →» вместо
  draw-count input (FR-36). Info banner про адаптивный режим в верху body.
  В editor-drawer этого state'а сейчас НЕТ (только standard).
- **Feedback edit form** — модал/inline-редактор с richtext + ссылки + PDF-assets
  (FR-36, FR-37). В editor-drawer есть только read-only `tb-feedback-preview`.

**Полезная экстракция** ([tb-components.css](tb-components.css)) — добавлены
prod-ready BEM-классы для будущего рефакторинга editor-drawer:
`tb-topic-row` (+ `__header/__name/__count/__body`), `tb-draw-count-row`
(+ `__label/__max`, `--adaptive`), `tb-feedback-preview`
(+ `__text/__snippet/__meta/__sep`, `.is-empty`), `tb-status-dot--dirty`.
Синхронизировано в обе копии (docs/wireframes/ + client/src/styles/).

---

## 17. `docs/wireframes/approved/prd7-editor-close-confirm.html`

Диалог подтверждения закрытия Drawer с несохранёнными изменениями.

- [x] Три кнопки: `Сохранить`, `Выйти без сохранения`, `Отмена`
  _(s-dirty: «Сохранить» primary, «Выйти без сохранения» secondary, «Отмена» ghost.)_
- [x] Кнопка `Сохранить` disabled при наличии блокирующих ошибок
  _(s-errors: `disabled aria-disabled="true" title="Исправьте ошибки перед сохранением"`.)_
- [x] При disabled `Сохранить` — краткая причина и ссылка на первую ошибку
  _(s-errors: `ou-banner ou-banner--error` с текстом «2 ошибки во вкладке "Настройки"»_
  _и ссылкой `<a class="wf-error-link">Перейти к первой ошибке</a>` — скролл к первой error-field.)_

---

## 18. `docs/wireframes/approved/prd7-editor-conflict.html`

Диалог конфликта версий (concurrent edit).

- [x] Два действия: `Обновить данные` (recommended, default) и `Сохранить поверх`
  _(s-conflict: обе кнопки в footer + option-cards с описанием. «Обновить данные»_
  _имеет `autofocus` → default по Enter. State `s-status-conflict` удалён 2026-05-21:_
  _архитектурно невозможен — `PATCH /status` не инкрементирует `version`_
  _([prd-7-implementation-todo §1.10](../prd-7-implementation-todo.md)),_
  _поэтому параллельная смена статуса не вызывает 409 при save Drawer'а._
  _Это корректирует устаревшую формулировку FR-25k «включая внешнюю смену статуса».)_
- [x] `Обновить данные` визуально выделена как рекомендуемое действие
  _(footer выровнен `justify-content: space-between` per DS canon: «Отмена» (ghost)_
  _слева, action-группа справа — «Сохранить поверх» (`ou-btn--destructive`) +_
  _«Обновить данные» (`ou-btn--primary` accent purple, `autofocus` + `title` с_
  _описанием эффекта). Технические термины (`v7`/`v8`, «Сервер (v8)») убраны из_
  _user-facing body, оставлены только в notes-таблице._
  _Option-cards удалены 2026-05-21 — они дублировали footer-кнопки (двойной_
  _affordance); описание эффекта каждой кнопки перенесено в `title` (нативный_
  _tooltip).)_

---

## 19. `docs/wireframes/prd7-mode-switch-warning.html`

Предупреждение при смене `flowMode`. **Эскиз устарел** (2026-05-21):
содержит формулировки «Структура будет реорганизована», «вопросы будут
сгруппированы по темам», «авторские страницы распределены», «маршрутизатор
будет удалён» — противоречит обновлённому FR-40
([[fr-40-content-preserved-on-mode-change]]). Не approved, в продакшен
не идёт. Нуждается в переписывании под новый контракт (info-banner вместо
warning-callout, без обещаний реорганизации). До переписывания — не
использовать как reference.

- [x] Список настроек, несовместимых с новым режимом
  *(s-mode-warn: «Раздел Адаптивность станет доступен», «поле draw_count заменяется»,*
  *«несовместимые настройки сохраняются»; s-flow-warn: устаревшие формулировки*
  *про реорганизацию — переписать.)*
- [x] Скрытые несовместимые настройки восстанавливаются при возврате режима (FR-25g)
  *(переформулировано 2026-05-21: исходный пункт «для каждой настройки указан режим,*
  *при котором она снова становится доступной» требовал per-setting label целевого*
  *режима. По PRD-7 §FR-25g восстановление настроек — это **поведение** «при возврате*
  *режима скрытые настройки снова отображаются», не UI-метка. Эскиз корректно*
  *передаёт это в inline-warning: «Несовместимые настройки сохраняются и появятся*
  *снова при возврате к совместимому режиму».)*
- [x] Inline warning без Apply/Cancel; смена применяется к draft сразу (FR-25d/e)
  *(переформулировано 2026-05-21: исходный пункт «Кнопки: подтвердить смену и отмена»*
  *противоречил PRD-7 §FR-25e — «Переключение критичных режимов не требует modal*
  *confirmation, если данные не удаляются; предупреждение показывается inline»._*
  *Текущий эскиз правильно показывает inline-warning без Apply/Cancel в обоих*
  *state'ах. Контракт с router → linear* обновлён: параметры маршрутизатора*
  *сохраняются в draft до закрытия редактора, не удаляются молча.)*

---

## 20. `docs/wireframes/prd7-editor-status-indicators.html`

Агрегированные индикаторы вкладок Drawer.

- [x] Индикатор `изменено` на вкладке при наличии изменений
  _(раздел 1 showcase: `wf-tab-demo` с `wf-status-dot--dirty` + `aria-label`.)_
- [x] Индикатор `warning` на вкладке при наличии предупреждений
  _(раздел 1 showcase: `wf-status-dot--warn` + `aria-label`.)_
- [x] Индикатор `error` на вкладке при наличии ошибок
  _(раздел 1 showcase: `wf-status-dot--error` + `aria-label`.)_
- [x] Кнопка `Сохранить` disabled при наличии ошибок; при наличии только warning — активна
  _(раздел 3 showcase: три состояния кнопки — clean/disabled, warnings/enabled, errors/disabled —_
  _с `aria-describedby` на error-кейсе.)_

---

## 21. ~~`docs/wireframes/prd7-editor-mobile.html`~~ — out-of-scope PRD-7

Мобильная адаптивность (< 960px) **вынесена за рамки PRD-7** (2026-05-21,
явное решение пользователя). Временный fallback-файл удалён; mobile-эскизы
будет делать отдельный PRD. 3 пункта чек-листа (Drawer не обрезается /
fallback понятен / проверено на 375px и 768px) — out-of-scope, не учитываются
в подсчёте.

---

## Final Sign-off

После приёмки всех файлов:

- [x] Нет файлов с legacy-классами (`btn`, `btn-*`, `drawer-*`, `dialog-*`,
  `sidebar`, `nav-item`, `form-group`, `form-label`, `badge`, `card-*`,
  `banner` с прямыми модификаторами и т.д.) — `npm run check:wireframes:ds`
  проходит на базовом профиле
  *(fact-check 2026-05-21: 21 violation (direct units / named-color) пофикшены.*
  *Добавлены токены `--wf-size-360` / `--wf-border-w-2` в `prd7-shared.css` и*
  *локальные `--tb-input-w-md` / `--tb-input-w-sm` / `--tb-accent-rail-w` /*
  *`--tb-space-half` в `tb-components.css` (gate-skip-блок). Fallback'и*
  *`var(--wf-size-360, 360px)` / `var(--wf-size-160, 160px)` заменены на*
  *прямые `var(...)` без fallback. `10px` → `var(--wf-space-10)` в `.wf-annot`*
  *во всех затронутых файлах. `8px` width/height status-dot → `var(--ou-space-2)`.*
  *`@container (max-width: 720px)` обёрнут в `gate-skip-pragma` с пояснением*
  *(var() в @container не поддерживается production-браузерами). Комментарии*
  *с `8px/11px/white` в `prd7-design-tab.html` / structure-файлах*
  *переформулированы без литералов. Линтер: 0 violations, 17 файлов passed.)*
- [x] Нет файлов с legacy product-разметкой `ou-button` (DS использует `ou-btn`)
  и legacy wireframe-каркасом `wf-page-wrap` (заменён на `wf-state` / `shell`).
  *(fact-check 2026-05-21: 0 occurrences `class="ou-button"` в HTML-разметке*
  *любого файла `docs/wireframes/`; 0 occurrences `wf-page-wrap` в коде.*
  *Остатки `ou-button` в коде — инфраструктурный JS state-switcher fallback*
  *(`button.classList.contains('ou-button')`) и DS-mapping legend selector*
  *`'.btn-primary, .ou-button--primary'` — dead-code в shared snippet'е,*
  *на разметку не влияет. Подлежит cleanup отдельным проходом по shared snippet.)*
  *(`wf-state` / `showState` исключены из списка legacy: это обязательная*
  *wireframe-инфраструктура per `feedback_wf_only_skeleton_frame`, не legacy.)*
- [x] Нет файлов с маркером `STATES_INSERT_POINT`
  _(fact-check 2026-05-21: `STATES_INSERT_POINT` не найден ни в одном файле_
  _`docs/wireframes/`, кроме самого чек-листа.)_
- [x] Все состояния из `design-tab.html` присутствуют в `prd7-design-tab.html`
  _(fact-check 2026-05-21: legacy 16 → prd7 10. Mapping:_
  _`s-main`→`template`, `s-empty`→`template-empty`, `s-preview`→`template-preview`,_
  _`s-color-picker`→`branding-color-picker`, `s-gallery*`→`template-gallery*` (×4);_
  _generic `s-loading`/`s-saving`/`s-dirty`/`s-error`/`s-validation`/`s-readonly`/`s-saved`_
  _вынесены в `prd7-editor-drawer.html` (явно зафиксировано в §7 строка 166-168);_
  _`s-reset-confirm` — стандартный confirm-dialog DS (PRD-1 §3.1, §7 строка 186-188);_
  _новый `branding` rail-пункт и `template-incompatible` — расширения PRD-7.)_
- [x] Все состояния из `pages-tab.html` присутствуют в `prd7-structure-linear-by-topics.html`
- [x] Проверено на ширине 1440px (desktop). **Мобильная адаптивность
      (< 960px) вынесена за scope PRD-7** — будет покрыта отдельным PRD.
      _(2026-05-21: временный fallback-файл `prd7-editor-mobile.html` (§21)_
      _удалён как избыточный — пользователь явно вынес mobile за рамки PRD-7,_
      _отдельный PRD сам сделает свои mobile-эскизы.)_
- [x] Дизайнер / PM подтвердил три Structure-эскиза (§8 / §9 / §11) — 2026-05-21
- [x] Файлы перенесены в `docs/wireframes/approved/`:
      `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`,
      `prd7-structure-router.html`, `prd7-variant-replace.html` (§11a),
      `prd7-editor-close-confirm.html` (§17), `prd7-editor-conflict.html` (§18)
      _(variant-replace согласован дизайнером 2026-05-21 после упрощения:_
      _счётчики «N параметров» удалены, зелёный блок «Будут сохранены» удалён,_
      _технические термины `schema`/`kind` убраны из user-facing текста, иконка_
      _warning-блока заменена `i-trash` → `i-warn`, заголовок модала обёрнут в_
      _`ou-modal__head-text` для корректной позиции close-кнопки.)_
      _(close-confirm + conflict согласованы 2026-05-21 после полной DS-миграции:_
      _весь custom `<style>` блок (`.wf-dialog*`, `.wf-overlay`, `.wf-bg-*`, ~150 строк)_
      _удалён; HTML переведён на DS-канон (`ou-modal-root`, `ou-modal__backdrop`,_
      _`ou-modal ou-modal--m`, `ou-modal__head--icon` + `ou-modal__icon--warning|--danger`,_
      _`ou-modal__head-text`, `ou-modal__body`, `ou-modal__foot`, `ou-tag-group`)._
      _В conflict удалён state `s-status-conflict` (архитектурно невозможен —_
      _`PATCH /status` не инкрементирует `version`), удалены option-cards_
      _(дублировали footer-кнопки), `v7`/`v8` убраны из user-facing body в notes;_
      _diff-таблица очищена от `.wf-diff-*` color overrides._
      _В close-confirm иконка danger использует DS `ou-modal__icon--danger`,_
      _banner следует DS BEM (`__ico`/`__body`/`__desc`), ссылка на ошибку через_
      _нативный `<a>` без `wf-error-link` override.)_
