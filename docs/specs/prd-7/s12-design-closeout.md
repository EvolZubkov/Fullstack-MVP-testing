# PRD-7 S12 — Design Tab Closeout

**Статус:** Open (reopen 2026-05-28)
**Триггер:** возражение бизнеса против заглушек во вкладке «Оформление»; acceptance S11 от 2026-05-27 был выдан преждевременно — две из четырёх sub-rail секций и часть param-типов оставлены как stub-баннеры со ссылкой «реализуются отдельным шагом PRD-7».
**Источник истины:** [docs/wireframes/approved/prd7-design-tab.html](../../wireframes/approved/prd7-design-tab.html) (одиннадцать состояний, согласованы 2026-05-21).
**Зависит от:** PRD-7 S0-S11 (закрыты — модель, mappers, Drawer-каркас, save-flow, status-индикаторы).
**Блокирует:** PRD-1 closeout (manifest validation + acceptance), затем PRD-4.

---

## 1. Гэпы и привязка к FR

### G1 — Sub-rail группировка параметров (FR-31)

**Что сейчас.** [design-section.tsx:244-274](../../../client/src/features/tests/editor/sections/design-section.tsx) ренедерит **все** `manifest.params` как плоский список в `BrandingPane`. Sub-rail-пункты «Макет» и «Прогресс и шапка» вернут `StubPane` с текстом «*реализуются отдельным шагом PRD-7*».

**Что должно быть.** `manifest.params` распределяются по 4 секциям рейла: `Шаблон` (информация о шаблоне), `Брендирование`, `Макет`, `Прогресс и шапка`. Привязка — через явное поле `section` в схеме `param` (новое; см. §2).

**Edge cases:**

- Если в манифесте нет ни одного param для секции — пэйн показывает баннер «У шаблона нет параметров для этой секции», как сейчас делает `BrandingPane` при пустом `params`.
- Если секция rail-пункта пуста для всех шаблонов реестра — rail-пункт остаётся видимым (порядок UI фиксированный по wireframe, скрывать нельзя).

### G2 — Кнопка «Предпросмотр шаблона» (FR-30)

**Что сейчас.** [design-section.tsx:156-158](../../../client/src/features/tests/editor/sections/design-section.tsx) на клик показывает `window.alert("Предпросмотр шаблона будет доступен в следующем шаге.")`.

**Что должно быть.** ModalDialog `--xl` (`tpl-preview-modal`) с двупанельным layout: левый rail группирует элементы шаблона (Введение / Учебный материал / Вопросы / Итог), правый stage — мини-демо SCORM-shell с применёнными `design_settings_json.params` и шрифтами/цветами шаблона. Демо-данные: фиксированный набор примеров вопросов/страниц. Прогресс не сохраняется.

**Edge cases:**

- `wf-template-incompatible` — кнопка предпросмотра disabled.
- Шаблон без `contentTemplates[]` (legacy) — показать только Вопросы.

### G3 — Галерея шаблонов (FR-33)

**Что сейчас.** [design-section.tsx:8-9](../../../client/src/features/tests/editor/sections/design-section.tsx) JSDoc: «*«Заменить шаблон» is left as a placeholder (full gallery deferred to FR-30/31)*». Кнопка не делает ничего полезного.

**Что должно быть.** ModalDialog `--xl` (`tpl-gallery-modal`) с поиском (placeholder «Поиск по названию или тегу»), сеткой 3-в-ряд (`gallery-grid`). Каждая карточка: миниатюра + название + описание + теги «Встроенный» / «v1.2.0» + действия «Просмотр» / «Выбрать». Текущая карточка отмечена `selected` + ou-tag «Текущий».

**Подтверждение замены.** При выборе шаблона с **изменёнными** params (dirty) — confirm-dialog «*Заменить шаблон и сбросить параметры*». При выборе шаблона с **неизменёнными** params (clean) — замена сразу.

**Состояния:**

- `wf-template-gallery` — список;
- `wf-template-gallery-search` — после ввода;
- `wf-template-gallery-empty` — поиск без результатов;
- `wf-template-gallery-confirm` — confirm-dialog поверх галереи.

### G4 — Поддержка всех param-типов (FR-31a)

**Что сейчас.** [design-section.tsx:359-369](../../../client/src/features/tests/editor/sections/design-section.tsx) — fallback `Banner "Тип «X» поддерживается в следующем шаге (медиатека)"`. Не реализованы типы: `image`, `asset`, `file`, `downloadLink`, `url`, `multiselect`, `number`.

**Что должно быть.** Каждый тип имеет UI по wireframe `wf-branding`:

| Тип | UI | Хранение |
| --- | --- | --- |
| `text` (есть) | DS Input | string |
| `number` | DS NumberInput | number |
| `boolean` (есть) | DS Switch | boolean |
| `select` (есть) | DS Select | string |
| `multiselect` | DS Combobox с chips | string[] |
| `color` (есть) | DS ColorPicker | "H S% L%" / hex |
| `url` | DS Input + iconbtn «Открыть» | string |
| `file` | DS Button «Загрузить файл» + file-chip | `{ name, mediaId }` или `null` |
| `image` | DS Button «Загрузить изображение» + file-chip + desc «PNG, SVG, до 512 КБ» | `{ name, mediaId, mimeType }` |
| `asset` | DS Button «Выбрать из медиатеки» + chip | `{ mediaId }` |
| `downloadLink` | DS Button «Добавить файл» + chip + desc «Файл будет доступен обучающемуся» | `{ name, mediaId, label? }` |

**Зависимость от медиатеки.** Типы `image` / `asset` / `downloadLink` опираются на существующий upload-пайплайн `uploads/media/` (multer). MVP: переиспользуем существующий endpoint загрузки; design-section вызывает его и сохраняет `mediaId` в `params`.

### G5 — Удаление orphan `DesignSettingsDialog`

**Что было.** `client/src/components/design-settings-dialog.tsx` импортировался только своим тестом (grep вне теста — 0 совпадений). Должен был уйти в S10 вместе с `ContentPagesDialog`.

**Статус:** **закрыто 2026-05-28** (batch parity cleanup). Файл и тест удалены (`git rm`). Полная suite зелёная.

### G6 — Состояние `wf-template-incompatible`

**Что сейчас.** Не реализовано. При невалидном `templateId` UI падает в loading/error без специального баннера.

**Что должно быть.** Если `template = null` при наличии `design.draft.templateId`, показать баннер `ou-banner--error` с действиями «Выбрать шаблон» (открывает галерею) / «Применить «Стандартный»» (set templateId = default + clear params). Sub-rail Брендирование/Макет/Прогресс — disabled. Status-dot error на табе «Оформление».

---

## 2. Контрактные изменения

### 2.1 Манифест шаблона — добавить `param.section`

```jsonc
// manifest.params[].section: enum
type ParamSection = "branding" | "layout" | "progress";
```

- Дефолт при отсутствии — `"branding"` (backward compat для текущих манифестов).
- zod: `paramSectionSchema = z.enum(["branding", "layout", "progress"]).default("branding")`.
- Sub-rail «Шаблон» не получает params — это блок информации о шаблоне (карточка) + кнопки действий.

### 2.2 Манифесты встроенных шаблонов

Раздать существующие params:

| Шаблон | Существующие params | Распределение |
| --- | --- | --- |
| `default` | primaryColor, backgroundColor, foregroundColor, cardColor, cardBorderColor, borderColor, mutedColor, accentColor, fontFamily, logoUrl, **progress.mode**, **showProgressBar** | branding (8 цветов + шрифт + лого), progress (2 progress.*) |
| `corporate` | (проверить) | аналогично |
| `minimal` | (проверить) | аналогично |
| `rtk-storyline` | (проверить) | аналогично |

### 2.3 Field в манифесте на `image` / `asset` / `file`

Для типов с медиа добавить `accept` (mime/расширения), `maxSizeKb` для frontend-валидации.

---

## 3. Definition of Done

- [ ] FR-31: 4 sub-rail секции, каждая рендерит свои params по `param.section`; пустые секции — info-баннер.
- [ ] FR-30: ModalDialog предпросмотра с rail элементов + stage с применёнными bran-цветами.
- [ ] FR-33: ModalDialog галереи с поиском, выбором, confirm-dialog при dirty.
- [ ] FR-31a: реализованы все 10 типов params; image/asset/downloadLink интегрированы с upload-пайплайном.
- [ ] `wf-template-incompatible`: баннер + действия + disabled rail.
- [ ] Orphan `design-settings-dialog.tsx` + тест удалены.
- [ ] Зод-схема манифеста обновлена, валидация built-in шаблонов проходит.
- [ ] Component-тесты по каждому state wireframe (`wf-template`, `wf-branding`, `wf-template-empty`, `wf-template-incompatible`, `wf-template-preview`, `wf-template-gallery`, `wf-template-gallery-search`, `wf-template-gallery-empty`, `wf-template-gallery-confirm`, `wf-branding-color-picker`).
- [ ] `npm run check` без ошибок; полный `vitest run` зелёный.
- [ ] Acceptance pass S12: 1:1 с wireframe (axe/Playwright) + LMS smoke.
- [ ] Обновлены [ROADMAP.md](../../ROADMAP.md) §0 и [prd-7-acceptance-report.md](../../prd-7-acceptance-report.md) (S12 closeout).

---

## 4. Порядок реализации (предлагаемый)

| Шаг | Зона | Зависимости | Обратимость |
| --- | --- | --- | --- |
| 1 | Контракт: `param.section` в `shared/schema.ts` + миграция манифестов built-in шаблонов (4 файла) | — | Полная (schema-only) |
| 2 | Frontend: рефактор `DesignSection` — разнести params по 4 секциям, `Pane` per section вместо `StubPane` | Шаг 1 | Полная |
| 3 | Frontend: реализация param-типов FR-31a (text/number/boolean/select есть; добавить multiselect, url, file, image, asset, downloadLink) | Шаг 1, upload-endpoint существует | Полная |
| 4 | Frontend: галерея шаблонов — ModalDialog с поиском, выбором, confirm-dialog | Шаг 2 | Полная |
| 5 | Frontend: предпросмотр шаблона — ModalDialog с rail + stage | Шаг 2, шаг 3 (для применения branding) | Полная |
| 6 | Frontend: `wf-template-incompatible` баннер + disabled rail | Шаг 4 (для «Выбрать шаблон») | Полная |
| 7 | Cleanup: удалить `design-settings-dialog.tsx` + тест | Шаги 2-6 (никакая логика не теряется) | Reversible через git |
| 8 | Component-тесты по 10+ wireframe-состояниям; полный suite | Все предыдущие | — |
| 9 | Acceptance pass S12, обновить ROADMAP + acceptance-report; снять `[x]` с пунктов PRD-1 §1.10 (галерея, предпросмотр), записать в s-history что они закрыты в S12 | Шаг 8 | — |

---

## 5. Риски

- **Медиатека.** Типы `image` / `asset` / `downloadLink` требуют связки с upload-пайплайном `uploads/media/`. Если текущий endpoint не возвращает `mediaId` (а только URL) — нужен мини-расширитель API. Не блокер, но эстимейт +2-4 часа.
- **Preview demo-data.** Stage нуждается в фиксированном демо-наборе (1 intro + 1 question per type + 1 results). Можно завести в `client/src/features/tests/editor/sections/design-preview-fixtures.ts`.
- **Backwards compat манифестов.** Существующие `manifest.params` без `section` должны попадать в `branding` (см. §2.1). Это означает обновление всех 4 built-in манифестов в одном коммите со схемой.

---

## 6. Out of scope (явно)

- Создание новых шаблонов автором (PRD-3, post-MVP).
- Внешняя загрузка шаблонов (PRD-3, post-MVP).
- Text-overflow preview/diagnostics на content-pages (остаётся в PRD-1 §1.10).
