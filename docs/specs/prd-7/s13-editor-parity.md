# PRD-7 S13 — Editor Parity

**Статус:** Open (создан 2026-05-28)
**Триггер:** аудит 2026-05-28 после переоткрытия acceptance-отчёта S11 выявил 38
расхождений редактора с утверждёнными wireframes, помимо вкладки «Оформление»
(её закрывает [S12](./s12-design-closeout.md)). Бизнес явно отказался от заглушек
и `window.prompt`/`window.alert` в production-коде.
**Источник истины:** утверждённые wireframes в `docs/wireframes/approved/`
(согласованы 2026-05-21):

- `prd7-editor-drawer.html` — Drawer-каркас, header, footer, status-indicators,
  все вкладочные состояния (`s-default`, `s-default-adaptive`, `s-dirty`,
  `s-error`, `s-saving`, `s-changes`, `s-settings`, `s-feedback-edit`)
- `prd7-editor-settings-tab.html` — вкладка «Настройки»
- `prd7-structure-linear-flat.html`, `prd7-structure-linear-by-topics.html`,
  `prd7-structure-router.html` — вкладка «Структура» для трёх flowMode
- `prd7-variant-replace.html` — диалог «Сменить вариант» (FR-46)
- `prd7-editor-close-confirm.html` — confirm при закрытии с dirty (FR-05)
- `prd7-editor-conflict.html` — диалог 409 conflict (FR-25k)
- `prd7-tests-list.html`, `prd7-tests-delete-confirm.html` — список тестов

**Зависит от:** S0-S11 закрыты по контракту (модель, mappers, save-flow), S12
закрывает design-tab (параллельный трек). Контрактные изменения S13 — только в
UI, без миграций БД и API.
**Блокирует:** PRD-1 closeout (manifest validation + acceptance), затем PRD-4.

**Out of scope (явно):**

- `prd7-tests-archive.html` — целая страница «Архив» (12 состояний) — остаётся
  post-MVP per [ROADMAP §0.2](../../ROADMAP.md) (раздел «Архив» с восстановлением).
- States `s-preview` (side-panel выбранного теста), `s-lazy` (lazy-load
  pagination), `s-fab-restricted` (ограниченные права на FAB) — deferred per
  JSDoc `tests-list.tsx`; согласовано с ROADMAP §0.2.

Если бизнес поменяет решение по любому пункту — переводим в S13 ad-hoc.

---

## 1. Гэпы

Группировка по зоне; внутри — порядок по severity (critical → substantial → minor).
Идентификаторы (G1..G44) сохранены из аудит-отчёта 2026-05-28 для traceability.

### 1.1 Drawer-каркас (`prd7-editor-drawer.html`)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| G1 | critical | `tb-saving-overlay` со spinner-ом и `inert` на контенте при save не рисуется; есть только `Button loading` | [test-editor.tsx:494-549](../../../client/src/features/tests/editor/test-editor.tsx) (state `s-saving`) |
| G2 | substantial | `ChangesPopover` показывает только список dirty-вкладок; wireframe требует per-field diff `label / old → new` со счётчиком по полям | [test-editor.tsx:613-668](../../../client/src/features/tests/editor/test-editor.tsx) (state `s-changes`, wf 871-918) |
| G3 | ~~critical~~ **closed 2026-05-28** | В adaptive-режиме на вкладке «Состав» отсутствовал info-banner «Тест в адаптивном режиме…». Реализовано в [topics-structure-section.tsx](../../../client/src/features/tests/editor/sections/topics-structure-section.tsx) (`data-testid="composition-adaptive-banner"`) | (state `s-default-adaptive`, wf 444-449) |
| G5 | substantial | `ConflictDialog` — нет table-diff `Поле / На сервере / Ваши изменения`, только параграф | [test-editor.tsx:736-793](../../../client/src/features/tests/editor/test-editor.tsx) (state `s-conflict`) |
| G6 | ~~verify~~ **ok 2026-05-28** | `ou-drawer__body--flush` — DS-canonical модификатор, используется в 28+ approved wf-состояниях с тем же комментарием. Не gap | — |
| G44 | ~~verify~~ **ok 2026-05-28** | DS `Tabs` с `hidePanel` — корректная архитектура; разметка `tabpanel` собирается вручную с правильными a11y-атрибутами, покрыто test'ом `test-editor.test.tsx:134-147` | — |

### 1.2 Настройки (`prd7-editor-settings-tab.html`)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| **G7** | **critical** | **Целиком отсутствует секция «Общая обратная связь теста»** — rich-text body, список ссылок, PDF chip-group + кнопка «Загрузить PDF», `<hr>` + Switch «Показывать правильные ответы» | [basic-settings-section.tsx:165-268](../../../client/src/features/tests/editor/sections/basic-settings-section.tsx) (state `s-basic`, wf 710-839) |
| G8 | critical | «Показывать правильные ответы» в wireframe находится в «Основное» (нижний Switch), в коде — в «Ограничения». Без основания перенесено | [basic-settings-section.tsx:312-324](../../../client/src/features/tests/editor/sections/basic-settings-section.tsx) |
| **G9** | **critical** | **per-topic time-limit table** отсутствует: Switch «Индивидуальные лимиты для тем» → таблица тем с NumberInput + suffix «минут» + placeholder-описания «Без ограничения» / «Оставьте пустым…». В коде только два NumberInput на тест целиком | [basic-settings-section.tsx:272-328](../../../client/src/features/tests/editor/sections/basic-settings-section.tsx) (state `s-limits`, wf 3977-4151) |
| G10 | critical | State `s-limits-no-topics` (для `flow_mode = linear_flat`, без per-topic таблицы) — следствие G9 | (state `s-limits-no-topics`, wf 4167) |
| G11 | ~~minor~~ **closed 2026-05-28** | В webhook-секции добавлен `ou-formfield__desc` «Оставьте пустым, если webhook не нужен» | (state `s-integration`, wf 4482-4485) |
| G12 | verify | States `s-basic-warning` (несовместимые настройки сохранены, FR-25d/f), `s-basic-validation` — нужно сверить, что drawer-баннер покрывает по существу | (states wf 1573, 1745) |
| G13 | ~~cleanup~~ **closed 2026-05-28** | Обманчивый заголовок `// ─── Sub-panes: stubs for deferred work ───` удалён | — |
| G14 | ~~cleanup~~ **closed 2026-05-28** | JSDoc-шапка `basic-settings-section.tsx` актуализирована — «Правила прохождения» и «Адаптивный режим» больше не помечены как stub'ы | — |

### 1.3 Структура (`prd7-structure-*.html`)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| G15 | ~~critical~~ **closed 2026-05-28** | `s-mode-change` info-banner («Режим изменён…») при изменении flowMode в draft. Реализовано: `savedFlowMode` пробрасывается из `useTestEditor`, banner с `data-testid="structure-mode-change-banner"` показывается при `savedFlowMode !== model.flowMode` | (state `s-mode-change`, wf 683-716) |
| G16 | substantial | Add-page modal: нет поиска `variant-search__input`; state `s-page-preview` (modal-предпросмотр страницы) не реализован | [start-pages-section.tsx:893-903](../../../client/src/features/tests/editor/sections/start-pages-section.tsx) (states `s-add-step1`, `s-page-preview`) |
| G17 | ~~critical~~ **closed 2026-05-28** | (a) author-row row-menu: «Сменить вариант…» (когда `variants.length > 1` для kind) перед «Удалить» + «Предпросмотр» (`data-testid="structure-page-replace-${id}"`/`structure-page-preview-${id}`); переиспользует существующий `ReplaceVariantModal`. (b) system-row row-menu: дополнено пунктом «Предпросмотр» (`data-testid="${testId}-preview"`). (c) Новый backend route `GET /api/tests/:id/content-pages/:pageId/preview-page`: читает страницу из БД, грузит template's `preview.html`, инжектит override-script который вызывает `renderContentPage(page, contentTemplates)` из runtime (preview.html:1954). Override также применяет design.params поверх manifest defaults. (d) `PagePreviewModal` — iframe-обёртка симметричная `TemplatePreviewModal`. (e) Helper `server/scorm/preview-embed.ts` извлечён из templates.ts (EMBED_CSS + injectIntoPreview + encodeJsonForScript) — переиспользуется обоими preview-route'ами | (state `s-row-menu-open`, `s-page-preview`) |
| G18 | ~~critical~~ **closed 2026-05-28** | (a) `html-sanitizer.ts` расширен: `sanitizeHtmlWithDiagnostics` + `sanitizeValuesWithDiagnostics` возвращают `{value, removed: SanitizeRemoval[]}` — категоризируют что вырезано (tag/attribute/uri) и считают occurrences; on*-handlers репортятся per-name (onclick, onmouseover, ...). (b) PUT `/api/tests/:id/content-pages/:pageId` возвращает `sanitizeDiagnostics` sibling-полем при наличии удалений. (c) `useContentPages` хранит diagnostics keyed by pageId; следующий clean save (без removals) автоматически очищает запись. (d) `PageEditForm` рендерит `.validation-banner--warning` со списком «`<script>` в поле X», dismissible через X-кнопку. (e) CSS-модификатор `--warning` добавлен в tb-components.css (warning-soft фон, ico/text токены) | (state `s-sanitize`, linear-by-topics, wf 1208-1279) |
| G19 | ~~partial~~ **closed 2026-05-28** | Structure-tab read-only визуал (1-я итерация): `StructureSection` принимает `readOnly` (true при `test.status==="published"`); @dnd-kit отключён через `disabled` на page и topic-sortable; `.page-row--readonly` / `.topic-block--readonly` CSS-модификаторы; insert-rows скрыты; `PageEditForm` оборачивает inputs в `<fieldset disabled>` и заменяет «Сохранить»/«Отмена» на «Закрыть»; меню `…` скрыто на author-row, «Сменить вариант» disabled на system-row. Drawer footer (2-я итерация): при `status==="published"` рендерится единственная ghost-кнопка «Закрыть» (`data-state="readonly"`), Save / Cancel / «Показать изменения» скрыты, close-confirm не открывается при clean-state. Композиция/Настройки/Оформление пока не пробрасывают `readOnly` вниз — для них close-confirm guard сохранён против silent edit loss до отдельного тикета | (state `s-readonly`, linear-by-topics, wf 790-852) |
| G20 | ~~substantial~~ **closed 2026-05-28** | Темы router-режима теперь оборачиваются в `.tree-branches > .tree-branch`; CSS pseudo-elements рисуют └─/├─ через `--ou-border-soft`. См. [tb-components.css :.tree-branches](../../../client/src/styles/tb-components.css) и `InsideTestZone` | — |
| G21 | ~~substantial~~ **closed 2026-05-28** | При `variants.length === 0` для system-kind в активном шаблоне `SystemPageRow` рендерит `Tag tone="warning"` «Из стандартного шаблона» (`data-testid={testId}-fallback-tag`) | — |
| **G22** | **critical / deferred** | **Mapping-flow при смене шаблона** не реализован: warning-banner «Новый шаблон не поддерживает все типы страниц» + inline Select per row. Cross-tab coupling между Design draft и Structure читалкой требует архитектурного решения (где хранится pending templateChange, как Structure читает new manifest без сохранения, как mapping-выборки персистятся), не закрывается визуальной правкой. **Решение 2026-05-28: вынести в S13.5b** | (state `s-mapping`, linear-by-topics, wf 857+) |
| G23 | ~~cleanup~~ **closed 2026-05-28** | Удалён `mixed` из `FlowMode` (test-editor.types.ts), `FlowSettings.mixed` (test-editor.types.ts), `isFlowMode` guard и `buildFlowSettingsFromApi` (test-editor.mappers.ts), `FLOW_LABEL.mixed` (start-pages-section.tsx), `TestListFlowMode` + `isFlowMode` (tests-list.types.ts, tests-list.tsx). FlowChip уже не имел branch'а на `mixed`. Тестов с `"mixed"` в codebase нет | — |
| G24 | verify | Default-fallback fields в page-row-expand: wireframe рисует «Заголовок/Содержимое/Текст «Далее»» даже без variant — сверить, что манифесты их содержат | — |
| G25 | ~~substantial~~ **closed 2026-05-28** | Эвристика «kind ∈ {intro, summary} AND все placeholder values пусты»: `SystemPageRow` рендерится как `page-row--template` с inline `tpl-page-marker` «шаблон» вместо `page-row--system`. CSS уже был в `tb-components.css`. `data-from-template="true"` для регрессионных тестов | (state `s-main` linear-by-topics, wf 559-563) |
| G26 | ~~substantial~~ **closed 2026-05-28** | Empty-state router без тем теперь содержит CTA-кнопку «Перейти к Составу» (`data-testid="structure-empty-topics-cta"`) с callback'ом `onGoToComposition → setActiveTab("composition")` | (state `s-empty-topics` router, wf 696-761) |
| G27 | ~~substantial~~ **closed 2026-05-28** | `SystemPageRow` теперь раскрывается, когда у variant есть placeholders; внутри `.page-row-expand` поднимается `.validation-banner` со списком label незаполненных required-полей; row получает `page-row--error`. `hasStructureErrors` расширен на все kinds (не только info) | — |
| G45 | ~~substantial~~ **closed 2026-05-28** | Введён компонент `InsideTestZone` + CSS-классы `.inside-test`/`.inside-test__label`/`.inside-test__body`; router-row и tree-branches тем рендерятся внутри одного dashed-контейнера с label «Внутри теста» | — |
| G46 | ~~minor~~ **closed 2026-05-28** | `FLOW_LABEL.router_by_topics` → «Через страницу-маршрутизатор» + Settings select option + `prd7-editor-settings-tab.html` (все occurrences) + test expectations | — |
| G47 | ~~substantial~~ **closed 2026-05-28** | `TopicBlock` получил `.topic-grip` (виден когда `updateModel` пробрасывается); счётчик — `«${drawCount} вопросов»` без «из M»; темы перенесены в `SortableContext` (@dnd-kit). Backend: добавлен `test_sections.sort_order` (migration 007) с backfill, `getTestSections` упорядочен по `sortOrder`, `_insertSections` пишет `i` по индексу массива | — |
| G48 | ~~verify~~ **closed 2026-05-28 (backend-fix applied)** | Root cause: ни один встроенный шаблон не объявлял `kind: router`; `bindSystemVariant` → `null` → `planSingletonKind` no-op. Fix: (a) добавлен `router.menu` variant в `server/scorm/templates/default/manifest.json`; (b) `defaultTemplateManifestSchema` теперь требует все 4 system-kind через `superRefine`; (c) `GET /api/tests/:id` идемпотентно вызывает `testSettingsService.reconcileExisting()` для существующих тестов; (d) `migrations/006_prd7_g48_backfill_system_pages.sql` — одноразовый backfill для уже созданных router_by_topics тестов | [content-pages-lifecycle.ts:103-109](../../../server/services/content-pages-lifecycle.ts) |

### 1.4 Variant-replace (`prd7-variant-replace.html`)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| **G28** | **critical** | **`ReplaceVariantModal`**: нет поиска `variant-search` и нет `diff-block` warning «Текущие настройки страницы будут потеряны» с перечнем теряемых полей | [start-pages-section.tsx:1307-1383](../../../client/src/features/tests/editor/sections/start-pages-section.tsx) (state `s-replace-modal`, wf 132-213) |
| G29 | substantial | State `s-replace-no-fields` (пустая schema у нового варианта) не различается | (state `s-replace-no-fields`, wf 263-317) |

### 1.5 Close-confirm (`prd7-editor-close-confirm.html`)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| G30 | substantial | В modal-body нет `Tag` chips изменённых разделов («Состав», «Настройки» и т.д.) | [test-editor.tsx:670-734](../../../client/src/features/tests/editor/test-editor.tsx) (state `s-dirty`, wf 134-147) |
| G31 | substantial | State `s-errors`: нет inline `ou-banner--error` ВНУТРИ modal-body с «N ошибок во вкладке X» + линк «Перейти к первой ошибке» | [test-editor.tsx:684-732](../../../client/src/features/tests/editor/test-editor.tsx) (state `s-errors`, wf 184-194) |

### 1.6 Список тестов (`prd7-tests-list.html`)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| G32 | ~~critical~~ **closed 2026-05-28** | Реализован `MoveFolderPickModal` (size="s", radio-list папок + «Корень»; preselect текущей папки с Tag «Текущая»; «Переместить» disabled если selected === current). Заменяет `window.prompt`; тест-кейс blocks вызов `window.prompt` | (row-menu, wf 1089, 1181) |
| G36 | ~~cleanup~~ **closed 2026-05-28** | Sort переведён с нативного `<select>` на DS `Select<SortKey>` (size="s"); testid `tests-list-sort` сохранён | (toolbar) |

### 1.7 Delete-confirm (`prd7-tests-delete-confirm.html`)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| G38 | ~~minor~~ **closed 2026-05-28** | Название теста вынесено в отдельный `typed-confirm__name-block` блок (новый CSS-класс в `tb-tests-list.css`), под Input добавлен hint «Регистр символов учитывается» | (wf 188-194, 245) |

### 1.8 Feedback-editor (`s-feedback-edit`)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| G39 | ~~critical~~ **closed 2026-05-28** | Link-insert sub-modal внутри `FeedbackEditorModal`: ловит текущий selection range до открытия модала, поля «URL»+«Текст ссылки», submit восстанавливает selection и вызывает `createLink` (или вставляет `<a>` в курсор при collapsed range). Кнопка «Вставить» disabled пока URL пуст. Тест-кейс blocks вызов `window.prompt` | — |
| G40 | ~~critical~~ **closed 2026-05-28** | Oversize-файлы выводятся как in-modal `Banner tone="warning"` с заголовком и списком имён файлов; banner dismissible. Тест-кейс blocks вызов `window.alert` | — |

### 1.9 Общие (cleanup)

| ID | Severity | Что | Где |
| --- | --- | --- | --- |
| G41 | ~~cleanup~~ **closed 2026-05-28** | Orphan stub-файл `pass-rules-section.tsx` удалён (grep вне самого файла — 0 совпадений) | — |
| G42 | ~~cleanup~~ **closed 2026-05-28** | Orphan stub-файл `adaptive-settings-section.tsx` удалён (grep вне самого файла — 0 совпадений) | — |

---

## 2. План реализации (8 sub-фаз)

Порядок выбран по двум принципам:

1. **Quick visible wins первыми** — `window.prompt`/`window.alert` (G32/G39/G40)
   видны при первой же сессии пользователя.
2. **Большие блоки** (feedback теста, per-topic limits, read-only, archive)
   — каждый отдельной sub-фазой; меньше merge-конфликтов и проще
   review/откат.

| Sub-фаза | Содержание | ID | Зона кода | Эстимейт |
| --- | --- | --- | --- | --- |
| ~~**S13.1**~~ **closed 2026-05-28** | Замена `window.prompt`/`window.alert` на DS-компоненты: `MoveFolderPickModal` для «Переместить в папку», link-insert sub-modal в `FeedbackEditorModal` RTE, `Banner tone="warning"` для oversize-файлов. Все 3 prompt/alert вызова удалены, тестами zafiksирована регрессия | G32, G39, G40 | `tests-list.tsx`, `feedback-editor-modal.tsx` | факт: ~2ч |
| **S13.2** | Настройки → «Основное»: реализация секции «Общая обратная связь теста» (rich-text body, links list, PDF chip-group + upload, hr + Switch); перенос «Показывать правильные ответы» из Ограничений в Основное | G7, G8, G13, G14 | `basic-settings-section.tsx`, ~~`feedback-test-section.tsx`~~ (новый компонент) | 5-7ч |
| **S13.3** | Настройки → «Ограничения»: per-topic time-limit table (Switch «Индивидуальные лимиты» → таблица), state `s-limits-no-topics` для linear_flat; webhook-desc; cleanup устаревших JSDoc/комментариев | G9, G10, G11 | `basic-settings-section.tsx` + новый `per-topic-limits-table.tsx` | 4-5ч |
| **S13.4** | Структура — критичные row-actions: row-menu (Сменить вариант + Предпросмотр для author/system), sanitize-warning после save HTML, `page-row--template` маркер; cleanup `mixed` в FLOW_LABEL; **лейбл `router_by_topics` → «Через страницу-маршрутизатор»** (G46) | G17, G18, G23, G25, G46 | `start-pages-section.tsx` + новый `page-preview-modal.tsx` | 4-5ч |
| **S13.5** | **Status 2026-05-28:** G20/G21/G26/G27/G45/G46/G47/G48 закрыты; G19 закрыт частично (Structure-tab visual готов, drawer footer Save/Cancel→«Закрыть» — отдельный тикет); G22 mapping-flow отложен в **S13.5b** (cross-tab coupling design draft ↔ structure требует архитектурного решения) | G19 (partial), G20, G21, G22 (→ S13.5b), G26, G27, G45, G47, G48 | `start-pages-section.tsx` + `tb-components.css` + `manifests/default` + `test-settings.ts` + миграции 006/007 | факт: ~10ч |
| **S13.6** | Variant-replace: поиск `variant-search` + `diff-block` warning «Текущие настройки страницы будут потеряны» с перечнем теряемых полей; state `s-replace-no-fields` | G28, G29 | `start-pages-section.tsx` (ReplaceVariantModal) | 3-4ч |
| **S13.7** | Drawer-каркас + add-page modal: `tb-saving-overlay` со spinner-ом и `inert`; per-field changes-popover; adaptive info-banner на «Состав»; conflict diff-table; close-confirm chips + inline error-banner с «Перейти к первой ошибке»; mode-change info-banner на «Структуре»; search в add-page modal + state `s-page-preview` | G1, G2, G3, G5, G15, G16, G30, G31 | `test-editor.tsx`, `start-pages-section.tsx` + новые компоненты `saving-overlay.tsx`, `changes-popover-detail.tsx`, `conflict-diff-table.tsx`, `add-page-search.tsx`, `page-preview-modal.tsx` | 7-10ч |
| **S13.8** | Cleanup + visual verification + S13 acceptance: удаление orphan `pass-rules-section.tsx` / `adaptive-settings-section.tsx`; DS Select вместо native для сортировки; `wf-typed-confirm__name-block` + регистр-hint в delete-confirm; визуальная сверка G6/G12/G24/G44 в браузере + axe; полный `vitest run`; обновление ROADMAP + acceptance | G36, G38, G41, G42, G6, G12, G24, G44 | tests-list.tsx, delete-confirm, удаление файлов; визуальный pass | 3-4ч |

**Совокупный эстимейт S13:** 34-46 часов сфокусированной работы.

**Параллелизм:** S13.1 — самый быстрый и независимый, его можно запускать
параллельно с любой другой sub-фазой. S13.2-S13.3 трогают одну зону
(basic-settings-section), последовательно. S13.4-S13.6 трогают
start-pages-section, последовательно. S13.7 трогает test-editor.tsx,
независимо от Structure. S13.8 — финальный pass.

---

## 3. Контрактные изменения

S13 — UI-only. **Контрактных изменений ни в API, ни в БД нет.** Возможные
дополнения схем:

- **Per-topic time-limits (G9):** уже в `shared/schema.ts` —
  `test_sections.time_limit_minutes` есть, миграция 003 (PRD-7 S2). UI просто
  выводит существующее поле. Проверить, что mapper передаёт значения, а
  TestSettingsService персистит.
- **Feedback теста (G7):** уже в `tests.feedback_json` (миграция 003). UI должен
  читать/писать; проверить mapper и payload.
- **Sanitize warning (G18):** сервер уже возвращает diagnostics при санитизации
  (`server/services/sanitize-html.ts`), нужно поднять их в UI как warning-banner.

Если по факту окажется, что schema/API чего-то не хватает (например, sanitize
возвращает только factor без диагностики) — выделить под-task и обсудить
расширение API отдельно. По текущим знаниям такого нет.

---

## 4. Definition of Done S13

- [ ] 25 critical/substantial находки закрыты (G1, G2, G3, G5, G7, G8, G9, G10,
      G15, G16, G17, G18, G19, G20, G21, G22, G25, G26, G27, G28, G29, G30,
      G31, G32, G39, G40, G45, G47).
- [ ] 10 cleanup/minor находок закрыты (G11, G13, G14, G23, G36, G38, G41, G42, G46).
- [ ] 5 «verify» находок проверены и либо закрыты, либо явно подтверждены как
      ok / переведены в backend-sub-task (G6, G12, G24, G44, G48).
- [ ] Зод-схемы и mappers не сломаны: `npm run check` 0 ошибок; полный `vitest
      run` зелёный.
- [ ] Component-тесты добавлены для всех новых modal-компонентов и состояний:
      saving-overlay, changes-popover-detail, conflict-diff-table,
      link-insert-modal, page-preview-modal, per-topic-limits-table,
      feedback-test-section, mapping-flow.
- [ ] Acceptance S13: live-browser сверка с каждым approved wireframe-state
      (Playwright + axe; критерий — pixel-diff в разумных пределах, 0 axe
      critical).
- [ ] Обновлены [ROADMAP.md](../../ROADMAP.md), [prd-7-acceptance-report.md](../../prd-7-acceptance-report.md):
      S13 closed; PRD-7 закрыт после успеха S12 + S13.

---

## 5. Out of scope (явно)

| Что | Почему | Куда |
| --- | --- | --- |
| `prd7-tests-archive.html` (G37) — целая страница «Архив» | Уже в [ROADMAP §0.2](../../ROADMAP.md) post-MVP; backend `POST /api/tests/:id/restore` реализован | Post-MVP backlog |
| State `s-preview` (G33) — side-panel выбранного теста | Per JSDoc `tests-list.tsx`, deferred (separate ticket) | Post-MVP backlog |
| State `s-lazy` (G34) — lazy-load pagination | Per JSDoc, deferred | Post-MVP backlog |
| State `s-fab-restricted` (G35) — ограниченные права FAB | Per JSDoc, deferred | Post-MVP backlog |

Если бизнес позже захочет включить любой из этих пунктов в MVP — открываем
S14 (или расширяем S13 явным change-request).

---

## 6. Связь с S12

S12 (Design tab closeout) и S13 (Editor parity) — **независимые трeки**:

- S12 трогает `design-section.tsx` + manifest schema + 4 built-in manifests.
- S13 трогает `test-editor.tsx`, `basic-settings-section.tsx`,
  `start-pages-section.tsx`, `tests-list.tsx`, `feedback-editor-modal.tsx`.

Пересечений нет. PRD-7 закрывается **после прохождения обоих acceptance**
(сначала S12 либо S13 — не важно; гейт — оба ✓).

---

## 7. Риски

- **Per-topic time-limits (G9)** — нужно расследовать существующий backend mapper
  и подтвердить, что `time_limit_minutes` per-topic реально работает end-to-end.
  Если что-то сломано в save-flow — sub-task под backend.
- **Sanitize warning (G18)** — потребует поднять diagnostics из server-side
  санитайзера к UI; нужно убедиться, что API уже возвращает их в ответе на
  save. Если нет — расширение `routes/content-pages.ts`.
- **Mapping-flow (G22)** — самый сложный UI-flow: при смене дизайна нужно
  отметить page-rows с несовместимыми типами и предложить замену. Может
  потребовать backend-валидации совместимости (`POST /api/tests/:id/design`
  с `dryRun=true`?).
- **Read-only режим (G19)** — нужно понять источник флага «тест опубликован /
  нет прав». Если флаг ещё не пробрасывается в UI — будет coupling с
  auth/permissions.
- **Router reconcile (G48)** — если расследование покажет, что на существующих
  adaptive-тестах `kind:router` content_page не создаётся (либо `bindSystemVariant`
  фейлится на встроенных шаблонах), это **выходит за UI-only скоуп S13** и
  требует backend-fix: либо `bindSystemVariant` всегда возвращает фолбэк для
  router в default-template, либо backfill-миграция для existing-тестов с
  `flowMode=router_by_topics`. Решение по составу фикса принимается после
  prep-investigation в начале S13.5.

Все риски — UI+API мини-расследования, выделить как первый шаг
соответствующей sub-фазы.
