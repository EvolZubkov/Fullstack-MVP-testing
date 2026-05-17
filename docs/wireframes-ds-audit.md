# Аудит wireframes на соответствие Design System

Источник требований: `ENGINERING_HANDBOOK/handbook/design-system/AI-AGENT.md`.

Область проверки: `docs/wireframes/*.html`, `docs/wireframes/prd7-shared.css`, `docs/wireframes/ds/wf-utils.css`.

## Краткий вывод

Текущие wireframes не полностью соответствуют правилам UniversityRT Design System. Основная проблема: многие элементы продуктового UI всё ещё собраны вручную через локальные классы (`btn`, `badge`, `card`, `drawer-*`, `form-*`, `sidebar-*`) и прямые CSS-значения. Классы `wf-*` допустимы только для служебного слоя wireframe: переключатель состояний, пояснения, DS Mapping. Продуктовые эскизы должны использовать BEM-классы DS с namespace `ou-*`.

В `prd7-shared.css` сейчас есть переходный alias-слой для Drawer, чтобы старая разметка `.drawer-*` визуально стала ближе к DS Drawer. Это не финальная миграция: итоговая разметка должна использовать настоящую структуру DS.

## Нарушения с высоким риском

| Область | Доказательство | Требуемая миграция на DS |
| --- | ---: | --- |
| Кнопки и icon-only кнопки | 1075 вхождений в 19 файлах | `ou-btn`, `ou-iconbtn` |
| Drawer | 1455 вхождений в 15 файлах | `ou-drawer-root`, `ou-drawer__backdrop`, `ou-drawer`, `ou-drawer__head`, `ou-drawer__body`, `ou-drawer__foot` |
| Badge / tag / chip | 586 вхождений в 22 файлах | `ou-tag`, `ou-chip`, `ou-tabs__badge`, `ou-side__badge` |
| Формы / поля ввода | 708 вхождений в 21 файле | `ou-formfield`, `ou-field`, `ou-field__box`, `ou-field__input`, `ou-textarea`, `ou-select` |
| Tabs / segmented controls | 657 вхождений в 17 файлах | `ou-tabs`, `ou-tabs__list`, `ou-tabs__tab`; для взаимоисключающего выбора — `ou-seg` |
| Modal / dialog / popover | 432 вхождения в 15 файлах | `ou-modal`, `ou-popover`, `ou-toast` |
| Sidebar / app shell | 961 вхождение в 22 файлах | `ou-shell`, `ou-side` |
| Cards / list items | 385 вхождений в 19 файлах | `ou-card`, `ou-tbl`, `ou-tree` или DS-паттерн списка по семантике |

## Покрытие gate v2

Расширенный gate `npm run check:wireframes:ds` (см. изменения от 2026-05-17)
проверяет четыре категории нарушений плюс одну опциональную:

1. **Legacy class tokens** в `class="..."` атрибутах. Полный список см.
   `legacyClassTokens` в `scripts/check-wireframes-ds.mjs`: drawer-*, btn-*,
   badge-*, dialog-*, modal-*, banner-*, empty-*, sidebar-*, nav-*, topbar,
   back-btn, test-title, topbar-actions, editor-tabs, etab, form-*, card-*,
   skel*, radio-*, toggle*, overlay. Классы `section-label` / `subsection-label`
   исключены: DS не предоставляет uppercase-caption label primitive (gap).
2. **Legacy CSS selectors** для тех же токенов в CSS-файлах
   (`(?<![\w-])\.<token>(?![\w-])`).
3. **Raw color literals**: `#hex`, `rgb()`, `rgba()`, `hsl()`, `hsla()`,
   `oklch()`, `lab()`, `lch()`, `hwb()`, `white`, `black`. Сканируется
   содержимое `<style>` блоков и CSS-файлов.
4. **Direct length units**: ненулевые `\d+(\.\d+)?(px|rem|em)` в
   `<style>` блоках и CSS-файлах. Допустим только токен или `0`-значения.
5. **Optional `--strict-inline`**: сканирует `style="..."` на raw color и
   direct unit. Пропуск через `data-wf-demo` на родительском теге.

Время прогона: ~2 секунды на текущем наборе.

## Нарушения по CSS-значениям

| Нарушение | Количество | Самые проблемные файлы |
| --- | ---: | --- |
| Прямые цвета и color-функции (`#`, `hsl`, `rgba`, `white`, `black`) | 1157 | `pages-tab.html`, `ds-component-mapping.html`, `design-tab.html`, `prd7-design-tab.html` |
| Прямые значения в `px` | 4816 | `pages-tab.html`, `design-tab.html`, `ds-component-mapping.html`, `prd7-tests-list.html` |
| Прямые `font-size` / `font-weight` | 1048 | `pages-tab.html`, `design-tab.html`, `prd7-structure-mixed.html` |
| Inline `style="..."` | 1458 | `pages-tab.html`, `design-tab.html`, `prd7-design-tab.html` |

Это нарушает требования: только `var(--ou-*)`, только `font: var(--ou-text-*)`, не писать собственный CSS для компонентов, которые уже есть в DS.

## Нарушение по Drawer

Эталон DS Drawer использует такую структуру:

```html
<div class="ou-drawer-root" role="dialog" aria-modal="true">
  <div class="ou-drawer__backdrop"></div>
  <aside class="ou-drawer ou-drawer--xl ou-drawer--right">
    <header class="ou-drawer__head">...</header>
    <div class="ou-drawer__body">...</div>
    <footer class="ou-drawer__foot">...</footer>
  </aside>
</div>
```

В wireframes исторически использовались самодельные `.drawer-overlay`, `.drawer`, `.drawer-header`, `.drawer-body`, `.drawer-footer`. Это нарушение DS, потому что такая разметка заново определяет размеры, surface, header, close button и footer вместо копирования классов и структуры DS.

Варианты миграции:

1. **Минимальный bridge**: оставить старые `.drawer-*` классы, но добавить DS-классы в разметку и держать alias CSS только для совместимости. Это уже частично сделано для основных drawer-файлов.
2. **Строгая миграция на DS**: заменить `.drawer-*` разметку на `ou-drawer-*` и удалить drawer-правила из `prd7-shared.css`.
3. **Композиционная миграция**: использовать `ou-drawer__body` для содержимого, а вкладки, формы и footer внутри Drawer собрать из DS-компонентов (`ou-tabs`, `ou-formfield`, `ou-btn`). Сам Drawer не стилизовать.

Рекомендация: вариант 2 для базового контейнера Drawer, вариант 3 для содержимого Drawer.

## Приоритеты по файлам

1. `prd7-editor-drawer.html`: сделать каноническим DS-compliant Drawer.
2. `prd7-design-tab.html`, `prd7-editor-settings-tab.html`: после Drawer мигрировать tabs, формы и кнопки.
3. `prd7-structure-*.html`: высокий объём самодельных кнопок, карточек и вкладок.
4. `prd7-tests-list.html`: мигрировать AppShell, Sidebar, Table, Modal, Button.
5. `design-tab.html`, `pages-tab.html`: считать legacy reference-файлами или переписать по DS previews; в них больше всего прямых цветов, `px` и собственного CSS.

## Карта миграции компонентов

| Текущий самодельный паттерн | Компонент / классы DS |
| --- | --- |
| `.btn`, `.btn-primary`, `.btn-ghost`, `.btn-outline`, `.btn-danger` | `.ou-btn`, `.ou-btn--primary`, `.ou-btn--secondary`, `.ou-btn--ghost`, `.ou-btn--destructive` |
| `.btn-icon`, `.drawer-close`, icon-only кнопки | `.ou-iconbtn` или `.ou-drawer__close`; всегда нужен `aria-label` |
| `.badge`, `.changed-chip`, `.file-chip`, `.multiselect-chip` | `.ou-tag`, `.ou-chip` |
| `.card`, `.section-card`, `.topic-row`, `.gallery-card` | `.ou-card` или DS Table / Tree / List pattern по семантике |
| `.banner`, `.drawer-banner`, `.modal-warn` | варианты `.ou-banner` |
| `.form-group`, `.form-label`, собственные стили для `input/select/textarea` | `.ou-formfield`, `.ou-field`, `.ou-field__input`, `.ou-select`, `.ou-textarea` |
| `.drawer-tabs`, `.drawer-tab`, `.editor-tabs`, `.etab` | `.ou-tabs`, `.ou-tabs__list`, `.ou-tabs__tab` |
| карточки выбора режима / взаимоисключающий выбор | `.ou-seg` или `Radio` / `RadioCard`, не Tabs |
| `.dialog`, `.modal-*`, `.overlay` | `.ou-modal` |
| `.popover`, `.context-menu`, `.changes-popover` | `.ou-popover`, `.ou-menu` |
| `.toast` | `.ou-toast` |
| `.empty-block` | `.ou-empty` |
| `.skel`, `.skeleton` | `.ou-skel` |
| `.sidebar`, `.topbar`, `.main`, `.content` | `.ou-shell`, `.ou-side` |
| самодельные таблицы / tree rows | `.ou-tbl`, `.ou-tree`, `DataGrid`, если применимо |

## План миграции

1. Зафиксировать `wf-*` как единственный допустимый не-DS namespace для meta-навигации, пояснений и DS Mapping.
2. Заменить компонентные определения в `prd7-shared.css` на использование DS-классов. Оставить только layout glue, если у него нет DS-эквивалента.
3. Сначала мигрировать один канонический файл: `prd7-editor-drawer.html`.
4. Переиспользовать каноническую разметку Drawer во всех drawer wireframes.
5. Мигрировать контролы внутри Drawer по семействам компонентов: Button / IconButton, Tabs, Form / Input, Tag / Chip, Banner, Card / Table.
6. Исключить `design-tab.html` и `pages-tab.html` из acceptance scope или переписать их по DS previews.
7. Добавить статическую проверку, которая падает, если продуктовые UI-классы не начинаются с `ou-*` или `wf-*`, а также если встречаются прямые `px`, `hsl`, `rgba`, `#`.

## Статус реализации

| Дата | Статус |
| --- | --- |
| 2026-05-17 | Добавлена проверка `npm run check:wireframes:ds`. |
| 2026-05-17 | `prd7-editor-drawer.html` переведён на канонический контейнер DS Drawer: `ou-drawer-root`, `ou-drawer__backdrop`, `ou-drawer`, `ou-drawer__head`, `ou-drawer__body`, `ou-drawer__foot`; в DOM не осталось legacy `.drawer-*`, `.btn`, `.badge`. |
| 2026-05-17 | Drawer-контейнеры в `prd7-design-tab.html` и `prd7-structure-*.html` приведены к root/backdrop parity: количество `ou-drawer-root` равно количеству `ou-drawer__backdrop`. |
| 2026-05-17 | Остаток по строгой проверке: 965 нарушений, в основном прямые цвета/`hsl()`/`rgba()` в `design-tab.html`, `pages-tab.html` и локальных preview-миниатюрах. |
| 2026-05-17 | Миграция завершена. Все 22 файла в области проверки прошли `npm run check:wireframes:ds` с 0 нарушений. Исправлены: `prd7-shared.css`, `prd7-design-tab.html`, `prd7-tests-list.html`, `prd7-tests-archive.html`, `prd7-editor-settings-tab.html`, `prd7-editor-mobile.html`, `prd7-section-basic-feedback-editor.html`, `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`, `prd7-structure-mixed.html`, `prd7-structure-router.html`. Файлы `design-tab.html`, `pages-tab.html`, `ds-component-mapping.html` исключены из области проверки как reference-документы (пункт 6 плана). |
| 2026-05-17 | Gate v2 (`check-wireframes-ds.mjs`): добавлены категории `legacy class` (расширенный список), `legacy CSS selector`, `raw named-color`, `direct unit` (px/rem/em внутри `<style>`/CSS), опциональный `--strict-inline`. Baseline после расширения: 2611 нарушений. |
| 2026-05-17 | Этап 1 — Drawer footer: `drawer-footer*` мигрирован на `ou-drawer__foot*` в `prd7-design-tab.html`, `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`. 60 → 0 (базовый профиль). |
| 2026-05-17 | Этап 3.1 — Buttons: блок `.btn / .btn-*` удалён из `prd7-shared.css` (HTML уже на `ou-btn` / `ou-iconbtn`). Gate: 2611 → 2587. |
| 2026-05-17 | Этап 3.2 — Drawer CSS: блок `.drawer-*` удалён из `prd7-shared.css`; из `ds/wf-utils.css` убраны legacy participants `.drawer-overlay / .drawer / .overlay` в `.wf-state >` селекторах. Gate: 2587 → 2558. |
| 2026-05-17 | Этап 3.3a — Form-классы (имена): `form-group`, `form-label`, `req`, `form-hint`, `form-error` → `ou-formfield`, `ou-formfield__lbl`, `ou-formfield__lbl-req`, `ou-formfield__desc`, `ou-formfield__msg ou-formfield__msg--error` в `prd7-design-tab.html`, `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`, `prd7-structure-mixed.html`. CSS .form-* правила удалены из `prd7-shared.css`. Gate: 2558 → 2377. |

## Gaps / отложено

| Дата | Подэтап | Описание | Решение |
| --- | --- | --- | --- |
| 2026-05-17 | 3.3b | `radio-row`, `radio-opt`, `toggle`, `toggle-row` → переписать на DS `ou-switch` (track + thumb + is-on) и `ou-radio` (ring + dot). Структурный refactor. | Закрыт. |
| 2026-05-17 | 3.3c | Голые `<input>`, `<select>`, `<textarea>` обёрнуты в DS BEM: `ou-field` + `ou-field__box` + `ou-field__input`; `ou-textarea` + `__box` + `__input`. Затронуто 4 form-файла + `prd7-section-basic-feedback-editor.html` + `prd7-section-basic-states.html` + `prd7-section-start-pages.html` + `prd7-tests-list.html`. CSS scaffold `input[type=...] / select / textarea` удалён из `prd7-shared.css`. | Закрыт (с gap по wf-*-input). |
| 2026-05-17 | 3.3c-blocker | `ou-select` в DS — JS-компонент (`__trigger`/`__menu`/`__opt`). В wireframe используется гибрид: нативный `<select class="ou-field__input">` внутри `ou-field__box` — статический snapshot, не DS-strict. | Решено: гибрид. |
| 2026-05-17 | 3.3c-deferred | Wireframe-стилизованные классы `wf-text-input`, `wf-textarea`, `wf-select`, `wf-mob-input`, `wf-num-input`, `wf-tbl-input-*`, `wf-failure-input`, `wf-json-textarea`, `wf-link-input`, `wf-format-select`, `wf-flow-select`, `wf-type-select`, `wf-tbl-select`, `wf-field-input`, `wf-draw-count-input`, `draw-count-input` в `prd7-editor-drawer.html`, `prd7-editor-mobile.html`, `prd7-editor-settings-tab.html`, `prd7-editor-status-indicators.html`, `prd7-mode-switch-warning.html`, `prd7-section-adaptive.html`, `prd7-section-basic-feedback-editor.html`, `prd7-section-basic.html`, `prd7-section-basic-states.html` не мигрированы. Это wireframe-only оформление, gate их не флагает, но не на DS. | Открыт. |
