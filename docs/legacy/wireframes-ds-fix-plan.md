# Wireframes DS Fix Plan

План устранения нарушений соответствия wireframes требованиям UniversityRT Design
System. Источник аудита: `docs/wireframes-ds-audit.md` + расширенная проверка
от 2026-05-17.

## Цель

1. Привести `docs/wireframes/prd7-*.html` и `docs/wireframes/prd7-shared.css` в
   соответствие с правилами `ENGINERING_HANDBOOK/handbook/design-system/AI-AGENT.md`:
   только классы `ou-*`, только токены `var(--ou-*)`, никакого собственного CSS
   для компонентов из DS, обязательные `aria-label` на icon-only кнопках.
2. Расширить gate-скрипт `scripts/check-wireframes-ds.mjs` так, чтобы он ловил
   все категории нарушений, а не только legacy `.drawer-footer`.
3. Развести reference-файлы (`design-tab.html`, `pages-tab.html`,
   `ds-component-mapping.html`) и продуктовые wireframes по разным папкам.

## Источники правды

- Правила DS: `ENGINERING_HANDBOOK/handbook/design-system/AI-AGENT.md`,
  `DESIGN_SYSTEM_RT.md`, `DESIGN_SYSTEM_RT_API.md`.
- Эталон wireframe: `ENGINERING_HANDBOOK/handbook/templates/WIREFRAME-EXAMPLE.html`.
- Эталон Drawer внутри проекта: `docs/wireframes/prd7-editor-drawer.html`.
- Локальная копия CSS DS: `docs/wireframes/ds/university-rt.css`.

## Правила, которые нельзя нарушать

- Все цвета через `var(--ou-*)`. Запрещены `#hex`, `rgb()`, `rgba()`, `hsl()`,
  `hsla()`, `oklch()`, `lab()`, `lch()`, `hwb()`, `white`, `black`.
- Все отступы и размеры через `var(--ou-space-*)`, `var(--ou-size-*)`.
  Хардкод `px`, `rem`, `em` запрещён внутри `<style>` и `style="..."`.
- Все шрифты через пресеты `font: var(--ou-text-*)`. Запрещён прямой
  `font-size`, `font-weight`.
- Все компоненты — BEM-классы `ou-*`. Собственные классы вне `ou-*` / `wf-*`
  запрещены в продуктовой разметке.
- `class="ou ou--light ou--normal"` обязателен на `<body>` каждого wireframe.
- Icon-only кнопки обязаны иметь `aria-label`.
- `wf-*` допустим только для wireframe-инфраструктуры: state switcher, заметки,
  DS Mapping.

## Этапы

### Этап 1 — Закрыть текущие 60 нарушений auto-gate

Объём: ~60 правок в 3 файлах. Оценка: 0.5 дня.

Действия:

1. В `docs/wireframes/prd7-structure-linear-by-topics.html` заменить все
   вхождения `class="drawer-footer"` на `class="ou-drawer__foot"`,
   `class="drawer-footer-meta"` на `class="ou-drawer__foot-meta"`,
   `class="drawer-footer-actions"` на `class="ou-drawer__foot-actions"`.
2. Повторить замены в `docs/wireframes/prd7-structure-linear-flat.html`.
3. Повторить замены в `docs/wireframes/prd7-design-tab.html`.
4. Запустить `npm run check:wireframes:ds`. Ожидание: 0 нарушений.

Acceptance:

- `npm run check:wireframes:ds` завершается с `DS check passed`.
- В трёх файлах нет ни одного вхождения `drawer-footer`, `drawer-footer-meta`,
  `drawer-footer-actions`.
- Визуально макеты не сломаны: открыть каждый файл в браузере, переключить
  все состояния через `.wf-nav`, проверить что footer Drawer виден и кнопки
  на месте.

### Этап 2 — Расширить покрытие gate-скрипта

Объём: правки в `scripts/check-wireframes-ds.mjs`. Оценка: 0.5 дня.

Действия:

1. Расширить `legacyClassTokens` следующими именами:
   `form-group`, `form-label`, `form-hint`, `form-error`,
   `sidebar`, `sidebar-header`, `sidebar-nav`, `sidebar-footer`,
   `sidebar-title`, `sidebar-nav-item`,
   `nav-item`, `nav-icon`, `nav-group-label`,
   `topbar`, `back-btn`, `test-title`, `topbar-actions`,
   `editor-tabs`, `etab`,
   `card-row`, `card-header`, `card-body`, `card-title`,
   `skel`, `skel-block`,
   `banner-warn`, `banner-error`, `banner-info`, `banner-readonly`,
   `banner-icon`, `banner-close`,
   `empty-block`, `empty-title`, `empty-desc`,
   `modal-overlay`, `modal-dialog`, `modal-title`, `modal-desc`,
   `modal-actions`, `modal-option`, `modal-option-title`,
   `modal-option-sub`, `modal-option-icon`, `modal-option-danger`,
   `modal-inset`, `modal-warn`,
   `dialog-header`, `dialog-body`, `dialog-footer`, `dialog-title`,
   `dialog-footer-split`, `dialog-lg`,
   `overlay`,
   `btn-link`, `btn-destructive`,
   `toggle`, `toggle-row`, `toggle-on`, `toggle-off`,
   `radio-row`, `radio-opt`,
   `subsection-label`, `section-label`.
2. Добавить в `rawValuePatterns` регексы:
   `oklch\(`, `lab\(`, `lch\(`, `hwb\(`,
   `\b(?:white|black)\b`.
3. Добавить регекс прямых единиц измерения только внутри `<style>` блоков:
   `\b\d+(\.\d+)?(px|rem|em)\b` (исключить `0`, `1px solid` уже не
   исключение — все размеры должны быть через токены).
4. Добавить сканирование `prd7-shared.css` на наличие селекторов с легаси-именами
   из списка `legacyClassTokens` (сейчас CSS-файлы сканируются только на raw-цвета).
5. Добавить опциональный флаг `--strict-inline` для сканирования
   `style="..."` на hex / px / rgba / hsla. По умолчанию выключен; включается
   на Этапе 4.
6. Из `ignore` убрать `design-tab.html`, `pages-tab.html`,
   `ds-component-mapping.html` после Этапа 5 (перенос в `legacy/`).
   До переноса оставить как есть.

Acceptance:

- `npm run check:wireframes:ds` падает и выводит расширенный список нарушений.
- Список нарушений становится дорожной картой Этапов 3–4.
- Скрипт работает за время < 5 секунд на текущем объёме файлов.

### Этап 3 — Миграция prd7-shared.css и разметки на BEM ou-\*

Объём: переписать `prd7-shared.css` и 20+ HTML-файлов. Оценка: 2–3 дня.

Подход: убрать из `prd7-shared.css` все имитации DS-компонентов. Оставить
только wireframe-инфраструктуру: `wf-nav`, `wf-btn`, `wf-link`, `wf-state`,
`shell`, `notes-page`, `notes-box`, `notes-table`. Разметку перевести на
BEM-классы `ou-*`. Без bridge-aliases.

Подэтапы выполнять по одному за раз; после каждого запускать
`npm run check:wireframes:ds` и фиксировать состояние коммитом.

#### 3.1 Buttons

1. Из `prd7-shared.css` удалить блок `/* ── Buttons ── */`
   (правила `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-outline`,
   `.btn-ghost`, `.btn-danger`, `.btn-sm`, `.btn-xs`, `.btn-icon`).
2. В разметке `prd7-*.html` заменить:
   - `class="btn btn-primary"` → `class="ou-btn ou-btn--primary ou-btn--m"`
   - `class="btn btn-secondary"` → `class="ou-btn ou-btn--secondary ou-btn--m"`
   - `class="btn btn-outline"` → `class="ou-btn ou-btn--secondary ou-btn--m"`
   - `class="btn btn-ghost"` → `class="ou-btn ou-btn--ghost ou-btn--m"`
   - `class="btn btn-danger"` → `class="ou-btn ou-btn--destructive ou-btn--m"`
   - `class="btn btn-link"` → `class="ou-btn ou-btn--ghost ou-btn--m"`
     (либо `ou-link` если такой класс есть в DS).
   - Суффикс размера: `btn-sm` → `ou-btn--s`, `btn-xs` → `ou-btn--xs`.
   - `class="btn btn-icon ..."` → `class="ou-iconbtn ou-iconbtn--m"` плюс
     обязательный `aria-label="..."`.
3. Проверить, что все icon-only кнопки имеют `aria-label`.

#### 3.2 Drawer

1. Из `prd7-shared.css` удалить блок `/* ── Drawer ── */` целиком
   (правила `.drawer-overlay`, `.drawer`, `.drawer-header`, `.drawer-title`,
   `.drawer-close`, `.drawer-tabs`, `.drawer-tab`, `.drawer-body`).
   `.drawer-footer*` уже удалены на Этапе 1.
2. В HTML заменить:
   - `class="drawer-overlay"` → удалить (уже есть `ou-drawer__backdrop`).
   - `class="drawer"` → удалить (уже есть `ou-drawer ou-drawer--xl ou-drawer--right`).
   - `class="drawer-header"` → `class="ou-drawer__head"`
   - `class="drawer-title"` → `class="ou-drawer__title"`
   - `class="drawer-close"` → `class="ou-iconbtn ou-drawer__close"` + `aria-label="Закрыть"`
   - `class="drawer-tabs"` → `class="ou-tabs__list"`
   - `class="drawer-tab"` → `class="ou-tabs__tab"` (для активной — `... ou-tabs__tab--active`)
   - `class="drawer-body"` → `class="ou-drawer__body"`
3. Эталон финальной структуры — `prd7-editor-drawer.html`.

#### 3.3 Form field

1. Из `prd7-shared.css` удалить блок `/* ── Forms ── */`:
   `.form-group`, `.form-label`, `.form-label .req`, `.form-hint`, `.form-error`,
   плюс прямые селекторы `input[type=text], input[type=number], ..., select, textarea`,
   плюс `.radio-row`, `.radio-opt`, `.toggle-row`, `.toggle`, `.toggle::after`.
2. В HTML заменить:
   - `class="form-group"` → `class="ou-formfield"`
   - `class="form-label"` → `class="ou-formfield__label"`
     (звёздочка required — `<span class="ou-formfield__required">*</span>`).
   - `class="form-hint"` → `class="ou-formfield__hint"`
   - `class="form-error"` → `class="ou-formfield__error"`
   - `<input ...>` → обернуть в `<div class="ou-field"><input class="ou-field__input" ...></div>`
     (или использовать утилиту из DS, см. `ds/university-rt.css`).
   - `<select ...>` → `<select class="ou-select">`
   - `<textarea ...>` → `<textarea class="ou-textarea">`
   - `class="toggle on/off"` → `<label class="ou-switch"><input type="checkbox"
     class="ou-switch__input" checked><span class="ou-switch__track"></span></label>`.
3. Если в `ds/university-rt.css` нет требуемого класса — зафиксировать gap
   как блокер в `docs/wireframes-ds-audit.md`, не добавлять самодельный CSS.

#### 3.4 AppShell + Sidebar

1. Из `prd7-shared.css` удалить блоки `/* ── Sidebar ── */` и `/* ── Main area ── */`:
   `.sidebar`, `.sidebar-header`, `.logo-box`, `.sidebar-title`, `.sidebar-nav`,
   `.nav-group-label`, `.nav-item`, `.nav-icon`, `.sidebar-footer`, `.user-row`,
   `.avatar`, `.user-name`, `.user-role`, `.main`, `.topbar`, `.back-btn`,
   `.test-title`, `.topbar-actions`.
2. В HTML заменить:
   - `class="sidebar"` → `class="ou-side"`
   - `class="sidebar-header"` → `class="ou-side__head"`
   - `class="sidebar-nav"` → `class="ou-side__nav"`
   - `class="sidebar-footer"` → `class="ou-side__foot"`
   - `class="nav-item"` → `class="ou-side__item"`
     (активный — `... ou-side__item--active`)
   - `class="topbar"` → `class="ou-shell__top"`
   - `class="main"` → `class="ou-shell__main"`
   - Обернуть `sidebar + main` в `<div class="ou-shell"> ... </div>`,
     если это не сделано.

#### 3.5 Tabs editor

1. Из `prd7-shared.css` удалить `/* ── Tabs (editor-tabs) ── */`:
   `.editor-tabs`, `.etab`, `.etab.active`.
2. В HTML заменить:
   - `class="editor-tabs"` → `class="ou-tabs ou-tabs--editor"` (если нужен модификатор).
   - `class="etab"` → `class="ou-tabs__tab"`
   - `class="etab active"` → `class="ou-tabs__tab ou-tabs__tab--active"`

#### 3.6 Tag / Badge

1. Из `prd7-shared.css` удалить блок `/* ── Badges ── */`:
   `.badge`, `.badge-outline`, `.badge-primary`, `.badge-secondary`,
   `.badge-warn`, `.badge-error`, `.badge-success`.
2. В HTML заменить:
   - `class="badge badge-success"` → `class="ou-tag ou-tag--success"`
   - `class="badge badge-warn"` → `class="ou-tag ou-tag--warning"`
   - `class="badge badge-error"` → `class="ou-tag ou-tag--error"`
   - `class="badge badge-outline"` → `class="ou-tag ou-tag--neutral"`
   - `class="badge badge-primary"` → `class="ou-tag ou-tag--accent"`
   - `class="badge badge-secondary"` → `class="ou-tag ou-tag--neutral"`

#### 3.7 Card

1. Из `prd7-shared.css` удалить блок `/* ── Cards ── */`:
   `.card`, `.card-row`.
2. В HTML заменить:
   - `class="card"` → `class="ou-card"`
   - `class="card-header"` → `class="ou-card__head"`
   - `class="card-body"` → `class="ou-card__body"`
   - `class="card-title"` → `class="ou-card__title"`
   - `class="card-row"` → удалить, заменить на utility-классы DS
     (если у DS нет аналога — зафиксировать gap).

#### 3.8 Banner

1. Из `prd7-shared.css` удалить блок `/* ── Banners ── */`:
   `.banner`, `.banner.warn`, `.banner.error`, `.banner.info`, `.banner.readonly`,
   `.banner-icon`, `.banner-close`.
2. В HTML заменить:
   - `class="banner warn"` → `class="ou-banner ou-banner--warning"`
   - `class="banner error"` → `class="ou-banner ou-banner--error"`
   - `class="banner info"` → `class="ou-banner ou-banner--info"`
   - `class="banner readonly"` → `class="ou-banner ou-banner--neutral"`
   - `class="banner-icon"` → `class="ou-banner__icon"`
   - `class="banner-close"` → `class="ou-iconbtn"` + `aria-label="Закрыть"`

#### 3.9 Empty / Skeleton / Toast / Modal / Dialog

1. Из `prd7-shared.css` удалить блоки `/* ── Empty / Separator ── */`,
   `/* ── Skeleton ── */`, `/* ── Toast / snackbar ── */`,
   `/* ── Dialog / overlay ── */`.
2. В HTML заменить:
   - `class="empty-block"` → `class="ou-empty"`
   - `class="empty-title"` → `class="ou-empty__title"`
   - `class="empty-desc"` → `class="ou-empty__desc"`
   - `class="skel"` / `class="skel-block"` → `class="ou-skel"`
   - `.ou-toast--*` уже корректны; проверить и оставить.
   - `class="overlay"` → `class="ou-modal__backdrop"`
   - `class="dialog"` → `class="ou-modal"`
   - `class="dialog-header"` → `class="ou-modal__head"`
   - `class="dialog-body"` → `class="ou-modal__body"`
   - `class="dialog-footer"` → `class="ou-modal__foot"`
   - `class="dialog-title"` → `class="ou-modal__title"`
   - `class="modal-*"` (option, title, overlay, actions) → соответствующие
     `ou-modal__*`. Если структура DS-Modal не совпадает с самопальной — переписать
     по эталону `ou-modal` из `ds/university-rt.css` и `WIREFRAME-EXAMPLE.html`.

#### 3.10 Финальная зачистка prd7-shared.css

После 3.1–3.9 в `prd7-shared.css` должны остаться:

- `@import url('./ds/university-rt.css');`
- блок alias-токенов `--bg`, `--fg`, etc. — удалить, если разметка уже
  использует только `--ou-*` напрямую.
- `wf-nav`, `wf-label`, `wf-btn`, `wf-link`
- `shell` (state container)
- layout-glue без DS-эквивалента, помеченный комментарием `WIREFRAME-ONLY`.
- `notes-page`, `notes-heading`, `notes-box`, `notes-table`

Целевой объём файла: ~100 строк.

Acceptance Этапа 3:

- `npm run check:wireframes:ds` (с расширенным списком из Этапа 2)
  возвращает 0 нарушений по классам.
- Размер `prd7-shared.css` ≤ 150 строк.
- Каждый `prd7-*.html` визуально открывается без регрессий.

### Этап 4 — Чистка inline-стилей

Объём: ~440 inline-стилей с raw-значениями. Оценка: 1 день.

Действия:

1. Включить `--strict-inline` в gate-скрипте.
2. По выводу скрипта, для каждого inline-стиля решить:
   - Заменить на utility-класс DS (`ou-mt-*`, `ou-w-*`, `ou-flex-*`) если есть.
   - Перенести в локальный `<style>` блок файла, используя только `var(--ou-*)`,
     если стиль уникален для wireframe.
   - Если это demo-цвет (color-swatch, gallery-preview) — пометить
     `data-wf-demo="true"` и расширить whitelist в gate-скрипте, чтобы такие
     стили допускались только при наличии этого атрибута.
3. Удалить inline-стили вида `style="margin-top:20px"`, `style="max-width:120px"`
   в пользу токенов или utility-классов.

Acceptance:

- `npm run check:wireframes:ds --strict-inline` падает с 0 нарушений
  (или whitelisted-нарушения помечены `data-wf-demo`).

### Этап 5 — Разделение reference-файлов

Объём: перенос трёх файлов и обновление ссылок. Оценка: 0.5 дня.

Действия:

1. Создать папку `docs/wireframes/legacy/`.
2. Переместить:
   - `docs/wireframes/design-tab.html` → `docs/wireframes/legacy/design-tab.html`
   - `docs/wireframes/pages-tab.html` → `docs/wireframes/legacy/pages-tab.html`
   - `docs/wireframes/ds-component-mapping.html` → `docs/wireframes/legacy/ds-component-mapping.html`
3. Обновить ссылки в `docs/wireframes/wf-links.js` и
   `docs/wireframes-acceptance-checklist.md`.
4. Из `scripts/check-wireframes-ds.mjs` убрать индивидуальные исключения этих
   файлов, добавить общее правило `ignore` для всей `legacy/` папки.
5. Добавить в `docs/wireframes/legacy/README.md` пометку:
   «Reference-документы. Не мигрируются на DS. Используются как источник
   содержания для prd7-* wireframes».

Acceptance:

- `npm run check:wireframes:ds` проходит для 22 продуктовых wireframes.
- Файлы в `legacy/` не сканируются.
- Все рабочие ссылки сохранены.

### Этап 6 — Обновить документацию и acceptance checklist

Объём: правки в трёх документах. Оценка: 0.5 дня.

Действия:

1. `docs/wireframes-ds-audit.md`: добавить раздел «Покрытие gate v2» с описанием
   расширенных категорий нарушений и нового списка `legacyClassTokens`.
2. `docs/wireframes-acceptance-checklist.md`: переписать пункты 1, 2, 8, 10
   так, чтобы они ссылались на `ou-drawer__*`, `ou-btn--*`, `ou-iconbtn`
   вместо `drawer-*`, `btn-*`, `btn-icon`.
3. `docs/issues/wireframes-drawer-todo.md`: пересмотреть актуальность, удалить пункты,
   закрытые Этапом 3.

Acceptance:

- Чек-лист и аудит не содержат ссылок на legacy-классы.

## Метрики

| Метрика | Сейчас | Цель |
| --- | ---: | ---: |
| Нарушений `check:wireframes:ds` базового профиля | 60 | 0 |
| Не-DS классов в `prd7-*.html` | ≥ 561 | 0 |
| Legacy селекторов в `prd7-shared.css` | ≥ 30 классов / 512 строк | 0 / ≤ 150 строк |
| Inline `style="..."` с raw-значениями | 440 | < 30 (только demo) |
| Файлов в gate | 22 из 25 | 22 из 22 (3 файла в `legacy/`) |
| Покрытие gate-скрипта по категориям | 4 категории | ≥ 7 категорий |

## Глоссарий замен (свод)

| Legacy-класс | DS-замена |
| --- | --- |
| `btn`, `btn-primary` | `ou-btn`, `ou-btn--primary` |
| `btn-secondary`, `btn-outline` | `ou-btn--secondary` |
| `btn-ghost` | `ou-btn--ghost` |
| `btn-danger`, `btn-destructive` | `ou-btn--destructive` |
| `btn-sm` | `ou-btn--s` |
| `btn-xs` | `ou-btn--xs` |
| `btn-icon` | `ou-iconbtn` + `aria-label` |
| `badge`, `badge-success` | `ou-tag`, `ou-tag--success` |
| `badge-warn` | `ou-tag--warning` |
| `badge-error` | `ou-tag--error` |
| `badge-outline`, `badge-secondary` | `ou-tag--neutral` |
| `badge-primary` | `ou-tag--accent` |
| `drawer-overlay` | `ou-drawer__backdrop` |
| `drawer` | `ou-drawer ou-drawer--xl ou-drawer--right` |
| `drawer-header` | `ou-drawer__head` |
| `drawer-title` | `ou-drawer__title` |
| `drawer-close` | `ou-iconbtn ou-drawer__close` + `aria-label` |
| `drawer-tabs` | `ou-tabs__list` |
| `drawer-tab` | `ou-tabs__tab` |
| `drawer-body` | `ou-drawer__body` |
| `drawer-footer` | `ou-drawer__foot` |
| `drawer-footer-meta` | `ou-drawer__foot-meta` |
| `drawer-footer-actions` | `ou-drawer__foot-actions` |
| `dialog`, `dialog-header/body/footer/title` | `ou-modal`, `ou-modal__head/body/foot/title` |
| `overlay` | `ou-modal__backdrop` |
| `modal-option*`, `modal-actions`, `modal-warn` | `ou-modal__*` |
| `sidebar` | `ou-side` |
| `sidebar-header/nav/footer` | `ou-side__head/nav/foot` |
| `nav-item` | `ou-side__item` |
| `topbar`, `main` | `ou-shell__top`, `ou-shell__main` |
| `editor-tabs`, `etab` | `ou-tabs`, `ou-tabs__tab` |
| `form-group` | `ou-formfield` |
| `form-label` | `ou-formfield__label` |
| `form-hint` | `ou-formfield__hint` |
| `form-error` | `ou-formfield__error` |
| `input`, `select`, `textarea` (raw) | `ou-field__input`, `ou-select`, `ou-textarea` |
| `radio-row`, `radio-opt` | `ou-radio`, `ou-radio-group` |
| `toggle`, `toggle-row` | `ou-switch` |
| `card`, `card-header/body/title` | `ou-card`, `ou-card__head/body/title` |
| `banner`, `banner-warn/error/info/readonly` | `ou-banner`, `ou-banner--warning/error/info/neutral` |
| `banner-icon` | `ou-banner__icon` |
| `banner-close` | `ou-iconbtn` + `aria-label="Закрыть"` |
| `empty-block`, `empty-title`, `empty-desc` | `ou-empty`, `ou-empty__title`, `ou-empty__desc` |
| `skel`, `skel-block` | `ou-skel` |
| `toast` | `ou-toast` |

## Контроль качества по AI-AGENT.md

После каждого подэтапа Этапа 3 прогонять самопроверку:

- Все цвета через `var(--ou-*)`.
- Все отступы через `var(--ou-space-*)`.
- Шрифты через `var(--ou-text-*)` пресеты.
- BEM-классы соблюдены: `ou-<component>__<element>--<modifier>`.
- Icon-only кнопки имеют `aria-label`.
- Работает в `ou--dark`: мысленно поменять `ou--light` на `ou--dark` — ничего
  не сломается, потому что нет хардкода цветов.
- Hit-target ≥ 24×24 (≥ 44×44 для touch).

## Порядок выполнения

1. Этап 1 — закрывает базовый gate.
2. Этап 2 — расширяет gate, получаем точный backlog для Этапа 3.
3. Этап 3 — основная работа, по одному подэтапу за коммит.
4. Этап 4 — после Этапа 3, по точному списку из расширенного gate.
5. Этап 5 — перенос reference-файлов, можно делать параллельно с Этапом 3.
6. Этап 6 — финальная синхронизация документации.
