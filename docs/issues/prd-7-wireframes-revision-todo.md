# PRD-7 wireframes revision TODO

Status: Draft for execution
Source of truth: `docs/architecture/test-settings-parameter-structure.md` (sections 1-8)
Affected directory: `docs/wireframes/` (everything matching `prd7-*.html`)

This file lists the concrete divergences between the spec and the current
`prd7-*` wireframes, plus self-contained prompts a smaller model (Sonnet) can
execute literally to bring each wireframe back in line with the spec.

Every prompt below is intended to be copy-pasted as a single instruction.
Each one assumes the executor will re-read `docs/architecture/test-settings-parameter-structure.md`
and the file under repair before editing. Do not paraphrase the prompts; the
exact wording is what makes them executable for a smaller model.

---

## 0. Cross-cutting rules the smaller model must internalise first

Before opening any wireframe file, the executor must read
`docs/architecture/test-settings-parameter-structure.md` sections 1-8 in full and accept the
following invariants. These are NOT negotiable and override any prior wireframe
content:

1. The editor is a wide Drawer. Top-level tabs are exactly four, in this order:
   `Состав | Настройки | Оформление | Структура`.
2. The Side nav inside the `Настройки` tab has exactly seven sections in this
   order: `Основное`, `Режим и сценарий`, `Правила прохождения`, `Ограничения`,
   `Обратная связь`, `Интеграция`, `Адаптивность`.
   `Стартовые страницы` is NOT a `Настройки` section; `Адаптивные настройки` is
   NOT the name (the correct name is `Адаптивность`).
3. The `Адаптивность` section is shown in the side nav only when
   `tests.mode = adaptive`. The toggle between `standard / adaptive` lives in
   `Режим и сценарий`, never inside `Адаптивность`.
4. Mode switches (`standard <-> adaptive`, `flowMode` changes) are
   non-destructive and apply to the draft immediately. There must be NO modal
   confirmation, NO `Применить` button inside an inline warning, and NO
   `destructive change dialog`. Incompatible settings are hidden into the draft
   and re-appear when the user returns to a compatible mode.
5. The general test-level feedback (`tests.feedback`, links, downloadable
   assets) belongs to `Настройки -> Обратная связь`. It must NOT appear inside
   `Состав`. Only topic-level feedback lives in `Состав`.
6. The start page lives in the `Структура` tab as a `content_page` of type
   `intro` without `topic_id`. It must NOT appear as a `Состав` block, as a
   `Настройки` side-nav item, or as a free-standing "Стартовые страницы"
   section anywhere.
7. `Состав` is shown in BOTH `standard` and `adaptive` modes. It is the place
   where topics are chosen and where topic-level feedback / required-badge is
   displayed. In `adaptive` mode the `draw_count` input is replaced/disabled,
   but the tab is never hidden.
8. `draw_count` (number of questions per topic in a generated variant) is a
   `Состав` field. It must NOT be editable from `Структура`.
9. Inside `Структура`, the `flowMode` is read-only (it shows the current mode
   chosen in `Настройки -> Режим и сценарий`). Router-flow logic
   (`completionPolicy`, `sectionUnlockRules`) is read-only here as well; the
   editable controls live in `Настройки -> Режим и сценарий`.
10. The Router view in `Структура` is a router-page-centric layout: a single
    Router page block plus topic-section CARDS hanging off it (status, %,
    pages-before / questions / pages-after, what shows on the router after
    completion). It must NOT be a left-to-right `Start -> Router -> Sections
    -> Summary -> Result` flow-chart with editable "section labels" or
    "return conditions".
11. Topic ordering for `linear_by_topics` is expressed by drag-and-drop of the
    blocks themselves in `Структура`, not by a separate "order" field.
12. Confirmation dialogs are used only for genuinely destructive actions
    outside the editor (test deletion with name-confirm input).
13. Russian wording must match the spec verbatim where the spec quotes a
    label: e.g. `Основное` (not `Основные настройки`), `Режим и сценарий`,
    `Адаптивность`, `Обратная связь`, `Интеграция`, `Стандартный` /
    `Адаптивный` for `tests.mode`.

A wireframe that contradicts any of points 1-13 is wrong by definition, no
matter how nice it looks.

---

## 1. Issue inventory (by file)

### 1.1 `prd7-editor-drawer.html`

Divergences:

- Side-nav items inside the `Настройки` state are wrong:
  current set is `Основные`, `Правила прохождения`, `Адаптивные настройки`,
  `Стартовые страницы` (and a mobile accordion mirrors the same list).
  Spec requires `Основное`, `Режим и сценарий`, `Правила прохождения`,
  `Ограничения`, `Обратная связь`, `Интеграция`, `Адаптивность`.
- The placeholder copy still refers to `pass-rules`, `adaptive`, `start-pages`
  phases that do not exist as separate sections.
- The mobile accordion list inherits the same wrong four items.

Prompt for executor:

```
Open docs/wireframes/prd7-editor-drawer.html. Re-read sections 1, 3.1-3.8 of
docs/architecture/test-settings-parameter-structure.md.

In the s-settings shell and in both mobile-canvas blocks (the two
`<details class="settings-accordion-item">` lists and the `.settings-side-nav`
inside `.settings-pane`), replace the existing four items with EXACTLY seven
items in this order:

  1. Основное
  2. Режим и сценарий
  3. Правила прохождения
  4. Ограничения
  5. Обратная связь
  6. Интеграция
  7. Адаптивность

Mark `Основное` as the active item (.active in side nav, `open` on the first
<details>). Use these strings verbatim, including the dropped final "е" in
"Основное" (not "Основные"). Update each placeholder-desc inside the
accordion bodies so that it references the corresponding spec subsection
number (3.1 Основное, 3.2 Режим и сценарий, ..., 3.8 Адаптивность) instead of
fictional phase names.

Do not touch the Drawer chrome, the bg-page template, or the popover. Only
the seven side-nav items and their placeholder copy change. Keep all existing
aria-labels and update them to match the new label text.
```

### 1.2 `prd7-editor-settings-tab.html`

Divergences:

- The wireframe only models three side-nav sections (`Основные`,
  `Правила прохождения`, `Ограничения`). `Режим и сценарий`, `Обратная связь`,
  `Интеграция`, `Адаптивность` are missing entirely.
- The `Основные` state mixes `Telemetry & Webhook` into Основное. Per spec
  §3.7, these belong to a separate `Интеграция` section.
- Label `Основные` should be `Основное` (singular noun) to match the spec.
- The pass-rules `топик-таблица` is missing the explicit `topicPassRule.source`
  trio (`inherit_overall | custom | none`) and the `passDecisionPolicy` is
  exposed without the recommended defaults wording (§3.4 last paragraphs).
- The "Ограничения" state lacks topic-level time limit (`topicTimeLimit.source`
  with `inherit_test | custom | none`) and the dual-timer note from §3.5.

Prompt for executor:

```
Open docs/wireframes/prd7-editor-settings-tab.html. Re-read sections 3.1-3.8
of docs/architecture/test-settings-parameter-structure.md before editing.

Restructure the wireframe so it covers seven Настройки sections, one state
per section. The side-nav order is always:

  Основное | Режим и сценарий | Правила прохождения | Ограничения |
  Обратная связь | Интеграция | Адаптивность

For each state, only the matching side-nav item is `.active` (and
`aria-current="page"`); the others are inactive. The narrow-viewport
<select> at the top mirrors the same seven items.

Required content per state:

* Основное (rename from "Основные"): Название (required), Описание, Статус
  (Черновик / Опубликован / В архиве) with a hint that status transitions
  happen outside the editor. Remove Telemetry and Webhook from this state.
* Режим и сценарий: a segmented control for `tests.mode` (Стандартный /
  Адаптивный) and a select for `flowMode` with the four values
  (`linear_flat`, `linear_by_topics`, `mixed`, `router_by_topics`) labelled
  exactly as in §3.3. For `router_by_topics`, show below the select two
  read-only-feeling but editable fields: `completionPolicy` (free text or
  enum stub; see §3.3) and a placeholder list for `sectionUnlockRules`
  (`always_available`, `after_sections_completed`, `after_sections_passed`).
  Add an inline warning component slot under the mode switches stating
  "Несовместимые настройки сохраняются и появятся снова при возврате к
  совместимому режиму", but DO NOT add `Применить` or `Отмена` buttons and
  DO NOT show a modal.
* Правила прохождения: keep the existing overall pass-rule, but in the
  per-topic table replace the single "Источник" select with the trio
  `inherit_overall | custom | none` from §3.4 verbatim (UI labels: Как в
  тесте / Индивидуальное правило / Не проверять тему отдельно). Add a
  visible note under the policy select stating the default rule from §3.4
  ("если правила по темам не включены — `overall_only`, иначе
  `overall_and_required_topics`"). Keep `required` toggle per topic.
* Ограничения: add a section "Лимит времени темы" right under the global
  time-limit field, using a select with `inherit_test | custom | none`
  (Как в тесте / Индивидуальный лимит / Без отдельного лимита) and the
  per-section minutes input. Reproduce the dual-timer hint exactly:
  "Осталось в теме: 08:25  ·  Всего в тесте: 42:10" as a small read-only
  preview. Keep `max_attempts` and `show_correct_answers`.
* Обратная связь: a new state with two cards. Card 1 = test-level feedback
  (`tests.feedback` body, `test_feedback_links` list, `feedback_assets`
  scope=test PDF list). Card 2 = a hint that topic-level feedback is edited
  inside the Состав tab, with a `Перейти к Составу` link. Reuse the existing
  feedback-editor visual conventions from prd7-section-basic-feedback-editor.html.
* Интеграция: a new state with Webhook URL (single input) and a separate
  toggle for `tests.telemetry_enabled`. Make explicit that the toggle is
  independent of whether the webhook URL is set.
* Адаптивность: a new state that is shown only when `tests.mode = adaptive`
  (add a small read-only note "Доступно только в адаптивном режиме теста").
  Include the controls listed in §3.8: `tests.show_difficulty_level` toggle,
  `tests.adaptive_settings_json` placeholder (a labelled card titled
  "Общие параметры адаптации"), a per-topic table with columns Тема /
  Включено / Обратная связь при провале темы / Действия (edit levels) and
  an "Уровни темы" detail panel template that lists adaptive_levels fields
  (Порядок, Название, Мин. сложность, Макс. сложность, Кол-во вопросов,
  Порог, Тип порога, Обратная связь, Ссылки уровня, Документы уровня PDF).
  Do NOT invent IRT / SE / "критерий завершения" controls — they are not
  in the spec.

Update the acceptance block at the bottom of the file to enumerate
FR-35..FR-38 plus all seven section names.
```

### 1.3 `prd7-section-basic.html`

Divergences:

- The `Состав` standard state contains a `Обратная связь по тесту` card.
  That card belongs to `Настройки -> Обратная связь`, not `Состав` (§3.6).
- The `adaptive` state hides `Состав` entirely and shows the message
  "Состав не используется в адаптивном режиме". Spec contradicts this —
  Состав must remain available in adaptive mode (§3.8 last paragraph).
- The "Обязательная" badge is correct (`test_sections.required`) but the
  spec also requires that editing of `required` happens in
  `Настройки -> Правила прохождения`; the badge here is read-only. Add a
  hint to that effect.

Prompt for executor:

```
Open docs/wireframes/prd7-section-basic.html. Re-read sections 2 and 3.8 of
docs/architecture/test-settings-parameter-structure.md.

Delete the entire `Обратная связь по тесту` block at the bottom of the
`s-standard` state (the `.section-label` and following `.form-group .feedback-preview`).
Do not replace it; if anything is needed, add a one-line note under the
final topic card saying "Общая обратная связь теста редактируется во
вкладке Настройки -> Обратная связь.".

Replace the `s-adaptive` state. In adaptive mode, the Состав tab is still
shown and editable for topic selection, required-badge, and topic feedback.
Change the empty-block to a normal Состав layout identical to `s-standard`,
with two differences:
  (a) the `draw-count-input` is replaced with a read-only chip "Подбор
      вопросов: адаптивный" and a small link "Настроить уровни ->" pointing
      to Настройки -> Адаптивность;
  (b) above the topic list, add an info banner: "В адаптивном режиме
      количество вопросов подбирается алгоритмом. Темы и обратная связь
      по темам редактируются здесь.".
Keep all FR-36 elements (feedback preview per topic, links/files counters).

Under each "Обязательная" badge in both states, do NOT add any inline edit
control. Add `aria-readonly="true"` and a small visually-hidden hint
"редактируется во вкладке Настройки".

Update the acceptance block: drop the claim that Состав is hidden in
adaptive mode; add FR-36 coverage for the adaptive variant.
```

### 1.4 `prd7-section-adaptive.html`

Divergences:

- This wireframe is supposed to be the `Настройки -> Адаптивность` section,
  but it begins with a "Включить адаптивное тестирование" toggle. The
  on/off switch for adaptive mode is `tests.mode` and lives in
  `Настройки -> Режим и сценарий`. The toggle here is a duplicate and must
  go.
- The wireframe invents controls that are not in the spec: "Минимум /
  Максимум вопросов", "Стартовый уровень сложности", "Алгоритм адаптации
  (IRT / упрощённый)", "Критерий завершения (SE < 0.3)". Spec §3.8 lists a
  completely different set: `show_difficulty_level`,
  `adaptive_settings_json` (free-form for now), per-topic `enabled` and
  `failure_feedback`, plus per-level `level_index`, `level_name`,
  `min_difficulty`, `max_difficulty`, `questions_count`, `pass_threshold`,
  `pass_threshold_type`, `feedback`, `links`, asset documents.
- The `Адаптивный режим выключен` state shouldn't exist as a separate
  wireframe state; per spec §3.8 the Адаптивность side-nav item is simply
  absent when mode is standard.
- The destructive "min > max" example is fine in principle but uses the
  wrong fields.

Prompt for executor:

```
Open docs/wireframes/prd7-section-adaptive.html. Re-read section 3.8 of
docs/architecture/test-settings-parameter-structure.md.

Rewrite the file end-to-end so it represents Настройки -> Адаптивность with
the side-nav from prd7-editor-settings-tab.html visible to the left.

Required states (replace the existing three):
  * s-default: adaptive mode active, all spec fields present.
  * s-no-mode: small placeholder shown when tests.mode = standard, with text
    "Раздел Адаптивность доступен после переключения режима теста в
     Адаптивный (Настройки -> Режим и сценарий)." and a link to that
    section. No other controls visible.
  * s-error: same layout as s-default but one of the level rows shows
    pass_threshold > 100 (invalid value), with inline aria-invalid and an
    `role="alert"` summary at the top of the section.

Controls in s-default, in this order:
  1. Read-only chip "Режим теста: Адаптивный" with a link back to
     Настройки -> Режим и сценарий.
  2. Toggle for tests.show_difficulty_level (label "Показывать уровень
     сложности обучающемуся").
  3. Card "Общие параметры адаптации" (tests.adaptive_settings_json):
     for the first release use a placeholder labelled "JSON / advanced
     settings" with a textarea and a note "Уточняется в следующей итерации".
     Do NOT invent IRT / SE / completion-criterion fields.
  4. Card "Адаптация по темам": a table with rows for every selected topic.
     Columns: Тема, Включено (toggle for adaptive_topic_settings.enabled),
     Обратная связь при провале темы (multi-line input for failure_feedback),
     Действия (button "Уровни ->" that anchors to a per-topic detail panel).
  5. Per-topic detail panel (one rendered open as example) titled
     "Уровни темы: Основы ИБ". Inside, a table of adaptive_levels with
     columns: Порядок, Название, Мин. сложность, Макс. сложность,
     Кол-во вопросов, Порог, Тип порога (select: процент / абсолютное),
     Обратная связь (open editor button), Ссылки уровня (count), Документы
     уровня PDF (count), Действия (Up/Down/Удалить). Below the table add
     a "Добавить уровень" outlined button.
  6. A reference card "Распределение сложности в банке" with the existing
     bar chart, labelled as reference data (`role="img"` with aria-label).

Remove the standalone Включить адаптивное тестирование toggle entirely.

Update the acceptance block to reference §3.8 spec fields by name.
```

### 1.5 `prd7-section-start-pages.html`

Divergences:

- This wireframe places the start page inside the `Состав` tab. Spec §5 puts
  the start page inside `Структура` as a `content_page` of type `intro`
  without `topic_id`. It is NOT a `Состав` block and NOT a separate
  `Стартовые страницы` section in `Настройки`.
- Side controls like "Кнопка перехода к тесту -> Текст кнопки" and
  "Требовать подтверждения" are inventions not present in §5 fields.
- "Создать стартовую страницу" empty-state copy is fine, but it should live
  in `Структура`, not in `Состав`.

Prompt for executor:

```
Open docs/wireframes/prd7-section-start-pages.html. Re-read sections 5 and
5.2 of docs/architecture/test-settings-parameter-structure.md.

Move the entire wireframe under the Структура tab. In every state:
  * Set the active tab in `.tab-bar` / `.drawer-tabs` to Структура, not
    Состав. Update aria-selected accordingly.
  * Remove any reference to a Состав sub-section, breadcrumb, or hint that
    implies the start page is part of Состав.
  * The page card must be presented as a content_page record with the
    fields enumerated in the spec: type=intro, topic_id=null, mode (select:
    template / standard / html), template_key (free-text or chip),
    sort_order (read-only chip), values_json (rendered as a list of
    placeholders for the chosen mode), auto_advance toggle,
    auto_advance_delay_ms numeric input (label in seconds with a small
    "хранится в мс" hint).
  * The empty state retains the "Стартовая страница не добавлена" copy and
    the "Создать стартовую страницу" CTA, but explains the start page is a
    content_page of type intro without topic_id, replacing legacy
    tests.start_page_content (link to §5 of the spec).
  * Remove the invented "Текст кнопки перехода" and "Требовать
    подтверждения" controls.
  * The flow indicator (seq-position) is still useful but should read
    Перед тестом -> Темы / Блок вопросов / Router -> После теста ->
    Итоговый результат, depending on the active flowMode (show one
    flowMode as the default rendered state, e.g. linear_by_topics).

Update the acceptance block to drop FR-44 if FR-44 referred to a Состав
start-page concept, and to add the §5 content-page mapping notes.
```

### 1.6 `prd7-mode-switch-warning.html`

Divergences:

- The `s-confirm` state shows a modal "destructive flowMode change dialog"
  with "Переключить на Router" / "Отмена". Spec §1 forbids modal
  confirmation for any mode switch.
- The `s-flow-warn` state includes `Отменить` and `Применить mixed` buttons
  inside the inline warning. Spec says the switch applies to the draft
  immediately; there is no Apply.
- The `s-mode-warn` state correctly uses inline non-blocking warning, but
  the section is labelled "Основные настройки". Mode switch happens in
  `Режим и сценарий` per spec §3.2.

Prompt for executor:

```
Open docs/wireframes/prd7-mode-switch-warning.html. Re-read section 1
("Modal confirmation ... не показывается") and §3.2 of
docs/architecture/test-settings-parameter-structure.md.

Delete the s-confirm state entirely (its overlay, dialog, and the wf-btn
that selects it). Remove the corresponding nav button from the .wf-nav
switcher and from any script handlers.

In s-flow-warn, remove the .mode-warn-actions block (the two buttons
Отменить / Применить mixed). The inline warning must remain informational
only: it explains what changes in the draft, points out that hidden
settings remain in the draft, and never carries an Apply/Cancel pair.

In s-mode-warn, retitle the wrapping section card from "Основные
настройки" to "Режим и сценарий". The segmented control for
Стандартный / Адаптивный stays.

In s-after, the info banner copy "Раздел Состав скрыт" is wrong (Состав
remains visible in adaptive mode). Replace with: "Режим переключён на
Адаптивный. Раздел Адаптивность теперь доступен в Настройках. Несовместимые
параметры стандартного режима сохранены и будут восстановлены при
возврате.".

Update the acceptance block: remove the FR-25f line about a destructive
mode-switch dialog. Add a line stating that mode switches do not raise
modals and apply to draft immediately (FR-25d).
```

### 1.7 `prd7-structure-router.html`

Divergences:

- The wireframe renders a linear flow-chart `Старт -> Роутер -> [Секции]
  -> Итог -> Итог`. Spec §5.1 requires a Router-page-centric view: one
  router page block, plus topic-section CARDS hanging off it. No
  Start / Summary / Result chain.
- The section detail panel lets the user edit "Условие возврата к
  Роутеру", "Метка секции в Роутере". §3.3 / §5.1 put router-flow logic
  (`completionPolicy`, `sectionUnlockRules`) inside Настройки as editable
  controls, and inside Структура only as READ-ONLY indicators.
- A "Добавить секцию" button exists inside Структура. Sections come from
  Состав (topics chosen there). Структура must not add or remove sections.
- The `draw-input` (15 of 42) is editable in the section detail panel —
  draw_count belongs to Состав only.

Prompt for executor:

```
Open docs/wireframes/prd7-structure-router.html. Re-read sections 5 and 5.1
of docs/architecture/test-settings-parameter-structure.md.

Replace the canvas-and-flow-chart layout with a router-page-centric layout:

  +--------------------------------------------+
  | [ZONE: Перед тестом]                       |
  |   - chips of content pages                 |
  +--------------------------------------------+
  | [ROUTER PAGE block]                        |
  |   header & instruction (template-bound)    |
  |   read-only chips:                         |
  |     completionPolicy = <value>             |
  |     sectionUnlockRules = <summary>         |
  |     результат раздела на router-странице:  |
  |     показать / скрыть                      |
  |   состояние кнопки перехода к итогу:       |
  |     active / disabled                      |
  +-------+-------+-------+--------------------+
          |       |       |
       [Card] [Card]  [Card] ...
       per topic-section, side by side or
       stacked. Each card shows:
         - название темы
         - обязательный/необязательный (badge)
         - количество вопросов
         - проходной порог
         - страницы перед разделом (chip list)
         - блок вопросов (chip)
         - страницы после раздела / результат
         - что увидит обучающийся после
           завершения: статус, %, passed/failed
       Preview states inside the card:
         Не начат / В процессе / Завершён /
         Пройден / Не пройден / Заблокирован
  +--------------------------------------------+
  | [Итоговый результат] (disabled until
  |   completionPolicy met — show locked icon) |
  +--------------------------------------------+

The Router block's logic fields are READ-ONLY in this tab; show a link
"Изменить в Настройках -> Режим и сценарий". The section detail panel
must NOT have editable draw_count, return-condition, or section-label
controls. Replace those with read-only chips that mirror Состав / Настройки
values.

Remove the "Добавить секцию" button. Replace with a note: "Список разделов
формируется во вкладке Состав.".

The empty state retains a similar shape but with placeholder cards and a
CTA "Перейти к Составу".

Update the acceptance block: drop FR-29/FR-33 claims about editable
return-condition; replace with FR-29/FR-33 claims about read-only
indicators of completionPolicy and sectionUnlockRules.
```

### 1.8 `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`, `prd7-structure-mixed.html`

Divergences (common):

- All three render a draw-count table or a per-topic draw-input. `draw_count`
  is a Состав field and must not be editable in Структура.
- None of them render content_pages with the fields enumerated in §5
  (page mode, page type, template_key, placeholders, values_json,
  placeholderStyles, auto_advance / auto_advance_delay_ms, downloadLink).
- Mixed mode does not show the three named zones from §5.2 (`Перед тестом`,
  `Блок вопросов`, `После теста`); it instead shows draw-count rows.
- The shared "flow-mode-bar" has an "Изменить" link that suggests
  editability. flowMode is editable in `Настройки -> Режим и сценарий`,
  not here. The Структура banner must be read-only with a navigation
  link to Настройки.

Prompt for executor:

```
Open these three files in order and refactor each to make Структура a
visualisation of content_pages and zones, never a Состав-editor:

  docs/wireframes/prd7-structure-linear-flat.html
  docs/wireframes/prd7-structure-linear-by-topics.html
  docs/wireframes/prd7-structure-mixed.html

Re-read sections 5, 5.1, 5.2 of docs/architecture/test-settings-parameter-structure.md.

Common changes (apply to all three):

1. Replace the flow-mode-bar's "Изменить" button with a small text link
   "Изменить в Настройках -> Режим и сценарий". The banner is read-only.
2. Remove every draw-count input (`.draw-input`, `.draw-cell` editing).
   Replace with a read-only chip "<value> из <bank>" with a small text
   link "Изменить в Составе" beside the chip.
3. Add a sequence-style visualisation built of "structural blocks" and
   content_page chips. Each block / chip uses these labels: Перед тестом,
   Блок вопросов, Тематический блок: <name>, После темы: <name>, Router,
   Итоговый результат.
4. Add at least one open content_page editor card per file that shows the
   §5 field set: page mode (template / standard / html), page type
   (intro / info / summary / html), template_key (chip), sort_order
   (chip), placeholders list (rendered for the template mode with each
   placeholder type icon: text, textarea, richText, html, number,
   boolean, select, asset, file, url, downloadLink, resultField),
   placeholderStyles (collapsed details), auto_advance toggle,
   auto_advance_delay_ms numeric (label in seconds, with a small "хранится
   в мс" hint).

File-specific changes:

* prd7-structure-linear-flat.html: render a single `Блок вопросов` block
  with content_page slots before and after it (Перед тестом / После теста).
  No topic blocks here — topics are the source of questions only.
* prd7-structure-linear-by-topics.html: render Перед тестом ->
  тематические блоки (with drag-handle to reorder them) -> После теста ->
  Итоговый результат. Each тематический блок shows: name, count chip
  (read-only), Перед темой content_page slots, Блок вопросов, После
  темы content_page slots. Removing/adding topics happens in Состав; in
  this tab provide only reordering.
* prd7-structure-mixed.html: render exactly three named zones from §5.2:
  Перед тестом, Блок вопросов (single shuffled block), После теста, plus
  Итоговый результат. Do not show тематические блоки as structural
  blocks. Add a small note explaining that in mixed mode topic-bound
  content pages are hidden (kept in draft per §1 cross-mode rule).

Add an empty/warn state to each file where a content_page references a
template element missing from the active SCORM template; the chip shows a
warning icon and a hint "Используется fallback из шаблона default" (§5
last paragraph).

Update the acceptance block of each file accordingly. Remove claims about
editable draw_count from this tab.
```

### 1.9 `prd7-section-basic-feedback-editor.html`

Divergences:

- The wireframe is referenced as "feedback editor inside Состав / test
  feedback block". After moving test-level feedback to
  `Настройки -> Обратная связь`, the editor still applies, but its `state-ctx`
  copy "Контекст: внутри Drawer, вкладка 'Состав', блок 'Обратная связь по
  тесту'" is wrong.

Prompt for executor:

```
Open docs/wireframes/prd7-section-basic-feedback-editor.html.

Update every `.state-ctx` string so the feedback editor for the WHOLE TEST is
shown in the context "Контекст: внутри Drawer, вкладка Настройки ->
Обратная связь, карточка Общая обратная связь теста".

Add one extra state s-topic that re-uses the same editor under the context
"Контекст: внутри Drawer, вкладка Состав, карточка темы '<topic name>',
поле Обратная связь по теме". The editor markup is identical; only the
state-ctx and the feedback-panel-title differ.

Do not change the editor controls themselves. Update the acceptance block
to mention both feedback scopes (test-level в Настройках, topic-level в
Составе) and that links/PDF assets work the same way for both scopes.
```

### 1.10 `prd7-section-basic-states.html`

Divergences:

- Largely OK (skeleton / error / empty for the basic section). The empty
  state copy may need to reference Состав (since `Основное` will move to
  Настройки when prd7-editor-settings-tab is fixed). Verify there is no
  copy that ties this to a Настройки section.

Prompt for executor:

```
Open docs/wireframes/prd7-section-basic-states.html. Skim quickly to
confirm that all skeleton / error / empty states refer to the Состав tab
(темы, обратная связь по теме). If any copy refers to "Основные настройки"
or implies these are Настройки states, rename to Состав. Otherwise leave
the file unchanged.
```

### 1.11 `prd7-editor-mobile.html`

Divergences:

- The narrow-viewport `<select>` for Настройки sub-section still uses the
  old four-item list ("Основные настройки", "Правила прохождения",
  "Ограничения", "Адаптивные настройки").
- The Состав mobile sample contains a "Обратная связь по тесту" header
  (it should not, after §3.6 rework).

Prompt for executor:

```
Open docs/wireframes/prd7-editor-mobile.html.

In every Настройки mobile state, replace the four-item <select> with the
seven items from §1 in this order: Основное, Режим и сценарий, Правила
прохождения, Ограничения, Обратная связь, Интеграция, Адаптивность. Mark
the appropriate one as selected per state.

In the Состав mobile sample, delete the "Обратная связь по тесту" header
and the immediately-following block. Replace with a small hint:
"Общая обратная связь редактируется во вкладке Настройки -> Обратная
связь.". Keep the topic-level feedback block.

If the file currently shows Адаптивные настройки or Стартовые страницы as
Настройки items, remove both: Адаптивность is in Настройки only when mode
is adaptive (use the same gating logic as desktop), Стартовые страницы are
not in Настройки at all.
```

### 1.12 `prd7-editor-status-indicators.html`

Mostly fine: it's a status-indicators showcase that does not commit to
section structure. No changes required besides verifying that any sample
tab labels match the four top-level tabs `Состав | Настройки | Оформление
| Структура`.

Prompt for executor:

```
Open docs/wireframes/prd7-editor-status-indicators.html. Grep for the
strings "Адаптивные", "Стартовые страницы", "Основные настройки". If found,
rename to spec-correct labels (Адаптивность, Структура / content_page intro,
Основное respectively). Otherwise leave the file unchanged.
```

---

## 2. Files in `docs/wireframes/approved/`

These files are marked approved and have already been signed off:

* `prd7-editor-close-confirm.html`
* `prd7-editor-conflict.html`
* `prd7-tests-list.html`
* `prd7-tests-archive.html`
* `prd7-tests-delete-confirm.html`

Spot-check them only for the cross-cutting rules in §0 (especially the four
top-level tabs and the `Удалить` confirmation with title-typed match from
§1 of the spec). Do not perform structural rework here unless a concrete
contradiction is found.

Prompt for executor:

```
For each file in docs/wireframes/approved/ run a one-pass review against
sections 1 and 6 of docs/architecture/test-settings-parameter-structure.md. Only edit
when you find a direct contradiction (e.g. a label "Архивировать" instead
of "В архив", or a delete dialog missing the name-typed confirmation per
§1). Do not restructure these wireframes. Report findings as a short
checklist at the bottom of this issue file; do not silently move the
files out of `approved/`.
```

---

## 3. Execution order (recommended)

1. `prd7-editor-drawer.html` — fixes side nav so every other wireframe can
   align its tab labels and copy.
2. `prd7-editor-settings-tab.html` — establishes the seven Настройки
   sections used by 4-7.
3. `prd7-mode-switch-warning.html` — removes the destructive dialog so
   downstream wireframes don't reference it.
4. `prd7-section-basic.html` — drops test-level feedback from Состав.
5. `prd7-section-basic-feedback-editor.html` — re-labels contexts.
6. `prd7-section-adaptive.html` — full rewrite to §3.8 fields.
7. `prd7-section-start-pages.html` — move to Структура / intro content page.
8. `prd7-structure-router.html` — rewrite to router-centric.
9. `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`,
   `prd7-structure-mixed.html` — purge draw_count edits, add content_pages.
10. `prd7-editor-mobile.html`, `prd7-section-basic-states.html`,
    `prd7-editor-status-indicators.html` — sweep alignments.
11. `docs/wireframes/approved/*` — spot-check only.

After every step the executor MUST open the spec at the cited section
number and read it before editing the wireframe.

---

## 4. Verification checklist (run after the full pass)

For each file under `docs/wireframes/prd7-*.html`:

- Top-level tabs are exactly `Состав | Настройки | Оформление | Структура`.
- Inside Настройки, the seven sections appear in spec order, with
  Адаптивность gated by `tests.mode = adaptive`.
- No file contains a modal confirmation for a mode/flowMode switch.
- No file contains an "Apply" / "Применить" button inside a mode-switch
  warning.
- `draw_count` is editable only on Состав wireframes.
- The start page appears only inside Структура as a content_page of type
  intro with no topic_id.
- Test-level feedback (`tests.feedback`) appears only inside Настройки ->
  Обратная связь.
- Router visualisation is router-page-centric (cards radiating from one
  router block), not a left-to-right pipeline.
- Russian labels match the spec verbatim where the spec quotes them.

When all twelve points pass for every prd7 file, mark this TODO as Done in
the issue header.
