# PRD-7 S12 — Design Tab Closeout

**Статус:** Open (reopen 2026-05-28)
**Триггер:** возражение бизнеса против заглушек во вкладке «Оформление»; acceptance S11 от
2026-05-27 был выдан преждевременно — две из четырёх sub-rail секций и часть param-типов
оставлены как stub-баннеры со ссылкой «реализуются отдельным шагом PRD-7».
**Источник истины:** [docs/wireframes/approved/prd7-design-tab.html](../../wireframes/approved/prd7-design-tab.html)
(одиннадцать состояний, согласованы 2026-05-21).
**Зависит от:** PRD-7 S0-S11 (закрыты — модель, mappers, Drawer-каркас, save-flow, status-индикаторы).
**Блокирует:** PRD-1 closeout (manifest validation + acceptance), затем PRD-4.

---

## 1. Гэпы и привязка к FR

### G1 — Sub-rail группировка параметров (FR-31) — **CLOSED 2026-05-28**

**Что было.** `BrandingPane` рендерил все `manifest.params` плоским списком; sub-rail «Макет» и
«Прогресс и шапка» возвращали `StubPane` с текстом «*реализуются отдельным шагом PRD-7*».

**Что сделано.**

1. **TS-тип:** в [use-design-settings.ts](../../../client/src/features/tests/editor/use-design-settings.ts)
   добавлен enum `ParamSection = "branding" | "layout" | "progress"`; в `TemplateParam` — поле
   `section?: ParamSection`. Fallback: param без `section` считается `branding`.
2. **Zod-схема:** `templateManifestSchema` использует `.passthrough()` — изменений не потребовалось.
   Server-side валидация в [routes/tests.ts:393](../../../server/routes/tests.ts) проверяет только
   unknown keys, не shape — `section` пропускается прозрачно.
3. **Манифесты:** все 4 built-in (`default`, `corporate`, `minimal`, `rtk-storyline`) получили
   `section` per param через Node-скрипт-мутацию: default 10b/0l/2p, corporate 12b/0l/3p,
   minimal 6b/0l/2p, rtk-storyline 5b/4l/2p.
4. **UI:** в [design-section.tsx](../../../client/src/features/tests/editor/sections/design-section.tsx)
   `BrandingPane` и `StubPane` заменены на универсальный `SectionPane` + helper
   `paramsBySection(params, section)`. Три sub-rail (branding/layout/progress) рендерят свои
   params. Пустая секция — `Banner tone="info"` с уникальным заголовком/описанием.
5. **Test:** обновлён тест «shows the «следующий шаг» stub» → «renders empty-section info-banner»
   (`design-layout-pane-empty` / `design-progress-pane-empty` testid'ы).

**Verification:** `npm run check` 0 ошибок; `vitest run` 1331/1331 зелёный (11/11 design-section).

### G2 — Кнопка «Предпросмотр шаблона» (FR-30) — **CLOSED 2026-05-28**

**Что было.** Кнопка предпросмотра в TemplatePane вызывала
`window.alert("Предпросмотр шаблона будет доступен в следующем шаге.")`.

**Финальная архитектура (v2 — iframe + готовый preview.html).** Первая
итерация (commit `d1ebe31`) собирала собственный React-мок SCORM-shell на
демо-фикстурах. Бизнес отверг подход: мок был одинаковым для всех 4 шаблонов
и не позволял оценить **визуал конкретного шаблона** (sidebar-цвет
`corporate`, hero-иллюстрации `rtk-storyline`, отсутствие sidebar у
`default`/`minimal` — всё это в моке было размыто). Поэтому модалка переехала
на iframe с готовым standalone `preview.html`, который генерируется
скриптом `scripts/generate-prd1-template-previews.mjs` для каждого
built-in шаблона.

**Что сделано (v2).**

1. **Backend route** —
   `GET /api/templates/:id/preview-page` в [server/routes/templates.ts](../../../server/routes/templates.ts).
   Отдаёт `server/scorm/templates/{id}/preview.html` со встроенными tweak'ами:
   (a) `<style>` спрятавший stand-alone builder-chrome (`.pv-sidebar`,
   `.pv-main`, backdrop в `.pv-overlay`) — внутри iframe нужен только
   диалог; (b) inline `<script>` перед `</body>`, который читает query
   string и переопределяет `manifest.params[].default` ДО запуска
   bootstrap'а. Whitelist `BUILTIN_TEMPLATE_IDS` исключает path-traversal.
2. **Frontend** — [template-preview-modal.tsx](../../../client/src/features/tests/editor/sections/template-preview-modal.tsx)
   полностью переписан: ModalDialog `size="xl" className="tpl-preview-modal"`
   с `<iframe sandbox="allow-scripts allow-same-origin">` в теле, URL
   собирается из `draft.params` через `URLSearchParams`. Iframe keyed на
   `previewUrl` — любое изменение param-снапшота перерендерит iframe
   с новой query. Подход «react-mock + buildShellStyle + demo-фикстуры»
   удалён (`template-preview-fixtures.ts` удалён).
3. **CSS cleanup** — из [tb-components.css](../../../client/src/styles/tb-components.css)
   убраны `.tpl-preview-shell*`, `.tpl-preview-q__*`, `.tpl-preview-result*`,
   `.tpl-preview-group`, `.tpl-preview-stage`, `.tpl-preview-caption`. Остались:
   `.tpl-preview-modal` (sizing), `.tpl-preview-frame` (flex-container),
   `.tpl-preview-iframe` (стречит iframe), `.tpl-preview-foot`/`__info` (footer).
4. **DesignSection** — без изменений относительно v1: `previewOpen` state,
   кнопка disabled при `template === null`, модал рендерится в React Fragment
   рядом со split-контейнером.
5. **Тесты** — три теста в [design-section.test.tsx](../../../client/src/features/tests/editor/sections/__tests__/design-section.test.tsx):
   modal открывается + iframe рендерится; закрывается по «Закрыть»; iframe
   `src` указывает на `/api/templates/{id}/preview-page` и содержит
   `draft.params` как query overrides (`?companyName=Acme&primaryColor=…`).
   Тест rail-derivation из contentTemplates удалён — собственного rail у
   модалки больше нет (preview.html содержит свой rail и stage внутри
   iframe).

**Verification:** `npm run check` 0 ошибок; `vitest run` 51 файл / 1334 теста
зелёные.

**Post-implementation polish 2026-05-28 (visual closeout iframe-preview).**

1. **Brand typeface available in iframe.** До polish'а DS-шрифт `RostelecomBasis`
   объявлялся в [vendor/university-rt.css](../../../client/src/styles/vendor/university-rt.css)
   с относительными URL'ами (`../fonts/...`), которые резолвились в несуществующий
   `client/src/fonts/`. Переведены на абсолютные `/fonts/RostelecomBasis-*.{woff2,woff,otf}`;
   все 12 файлов положены в [client/public/fonts/](../../../client/public/fonts/)
   (Vite раздаёт `public/*` на корне). Iframe — отдельный document; в
   `rewritePreviewForEmbedding` инлайнятся те же 4 `@font-face` декларации в
   `<head>`, чтобы preview увидел шрифт без зависимости от родительского документа.
2. **Embed CSS overrides.** Расширены до:
   `.shell { display: block }` (стандартный flex-layout вытаскивал hidden
   chrome как пустые flex-items → whitespace справа в iframe);
   `.pv-dialog-head/foot/.pv-caption { display: none }` (дублировали ModalDialog
   title/footer и нарушали DS-fonts);
   `.pv-stage { flex-shrink: 0 }` + `.pv-stage-wrap { overflow-y: auto }`
   (flex-shrink схлопывал stage до 0 при `overflow: hidden` для скруглений);
   `.pv-nav { font-family: 'RostelecomBasis', ... }` (rail-typography приведён
   к DS-stack вместо хардкоднутого Inter).

**Известные ограничения v2.**

- preview.html у каждого шаблона на 2500-4000 строк (inlined templateCore +
  layouts + demo-data). Backend читает их с диска и инжектирует override-script
  каждый раз — приемлемо для редкого открытия модалки, для production стоит
  add cache layer (если профиль покажет потребность).
- Поддерживаются скалярные overrides (цвет HSL/hex/rgb-строка, шрифт-имя,
  boolean). Object/array params (media с `mediaId`-структурой из будущего
  G4) пропускаются — для них preview покажет манифестные defaults. Это
  не блокер для G2 (статичный визуал), но фикс понадобится в G4.
- Sandbox `allow-scripts allow-same-origin` нужен потому, что preview.html
  читает inlined `window.PRD1_PREVIEW_*` глобалы — full sandbox блокирует
  inline-скрипты. Источник — наш собственный backend, риск приемлем.

### G3 — Галерея шаблонов (FR-33)

**Что сейчас.** [design-section.tsx:8-9](../../../client/src/features/tests/editor/sections/design-section.tsx)
JSDoc: «*«Заменить шаблон» is left as a placeholder (full gallery deferred to FR-30/31)*». Кнопка не
делает ничего полезного.

**Что должно быть.** ModalDialog `--xl` (`tpl-gallery-modal`) с поиском (placeholder «Поиск по
названию или тегу»), сеткой 3-в-ряд (`gallery-grid`). Каждая карточка: миниатюра + название +
описание + теги «Встроенный» / «v1.2.0» + действия «Просмотр» / «Выбрать». Текущая карточка
отмечена `selected` + ou-tag «Текущий».

**Подтверждение замены.** При выборе шаблона с **изменёнными** params (dirty) — confirm-dialog
«*Заменить шаблон и сбросить параметры*». При выборе шаблона с **неизменёнными** params (clean) —
замена сразу.

**Состояния:**

- `wf-template-gallery` — список;
- `wf-template-gallery-search` — после ввода;
- `wf-template-gallery-empty` — поиск без результатов;
- `wf-template-gallery-confirm` — confirm-dialog поверх галереи.

### G4 — Поддержка всех param-типов (FR-31a)

**Что сейчас.** [design-section.tsx:359-369](../../../client/src/features/tests/editor/sections/design-section.tsx)
— fallback `Banner "Тип «X» поддерживается в следующем шаге (медиатека)"`. Не реализованы типы:
`image`, `asset`, `file`, `downloadLink`, `url`, `multiselect`, `number`.

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

**Зависимость от медиатеки.** Типы `image` / `asset` / `downloadLink` опираются на существующий
upload-пайплайн `uploads/media/` (multer). MVP: переиспользуем существующий endpoint загрузки;
design-section вызывает его и сохраняет `mediaId` в `params`.

### G5 — Удаление orphan `DesignSettingsDialog`

**Что было.** `client/src/components/design-settings-dialog.tsx` импортировался только своим
тестом (grep вне теста — 0 совпадений). Должен был уйти в S10 вместе с `ContentPagesDialog`.

**Статус:** **закрыто 2026-05-28** (batch parity cleanup). Файл и тест удалены (`git rm`).
Полная suite зелёная.

### G6 — Состояние `wf-template-incompatible` — **CLOSED 2026-05-28**

**Что было.** При невалидном `templateId` (404 на `/api/templates/:id`) UI падал
в обобщённый `ErrorNotice`, без отдельных recovery-действий.

**Что сделано.**

1. **Hook:** в
   [use-design-settings.ts](../../../client/src/features/tests/editor/use-design-settings.ts)
   добавлены два поля в `UseDesignSettingsResult`:
   - `templateMissing: boolean` — derived: design-query успешен AND
     template-query settled без data AND `persisted.templateId` не пуст.
     Отделяет «шаблон удалён» от других ошибок (5xx, network).
   - `applyDefaultTemplate(): void` — патчит draft на
     `{ templateId: "default", params: {} }`; Drawer footer's «Сохранить»
     подберёт изменения автоматически.
2. **UI:** в `DesignSection` приоритет `templateMissing > error`. При флаге
   активный rail форсится на `template`, остальные (branding/layout/progress)
   получают `disabled` + `aria-disabled` + `onClick={undefined}`. На
   rail-кнопке «Шаблон» — `status-dot error` с
   `aria-label="Шаблон недоступен"`.
3. **Banner:** новый компонент `TemplateIncompatibleBanner` — DS
   `Banner tone="error"` с `actions=[...]`. Заголовок «Шаблон недоступен»,
   описание содержит `<strong>{missingId}</strong>`. Две кнопки: «Выбрать
   шаблон» (alert-плейсхолдер до закрытия S12-G3) и «Применить «Стандартный»»
   → вызов `applyDefaultTemplate()`.
4. **Tests:** 3 новых теста в `design-section.test.tsx` (incompatible-баннер
   с обоими actions; status-dot + disabled rail; click по «Применить
   Стандартный» не падает).

**Status-dot на табе «Оформление»** — drawer-level плейсхолдер, отдельный
тикет: tab-level status уже есть для editor errors (`tabStatuses` в
`useTestEditor`), но `templateMissing` пока не пробрасывается в этот канал.
При следующей работе по drawer-каркасу (S13.7) — добавить.

**Verification:** `npm run check` 0 ошибок; `vitest run` 51/51 файл,
1361 тест зелёные.

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
- [ ] Component-тесты по каждому state wireframe (`wf-template`, `wf-branding`, `wf-template-empty`,
      `wf-template-incompatible`, `wf-template-preview`, `wf-template-gallery`, `wf-template-gallery-search`,
      `wf-template-gallery-empty`, `wf-template-gallery-confirm`, `wf-branding-color-picker`).
- [ ] `npm run check` без ошибок; полный `vitest run` зелёный.
- [ ] Acceptance pass S12: 1:1 с wireframe (axe/Playwright) + LMS smoke.
- [ ] Обновлены [ROADMAP.md](../../ROADMAP.md) §0 и
      [prd-7-acceptance-report.md](../../prd-7-acceptance-report.md) (S12 closeout).

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

- **Медиатека.** Типы `image` / `asset` / `downloadLink` требуют связки с upload-пайплайном
  `uploads/media/`. Если текущий endpoint не возвращает `mediaId` (а только URL) — нужен
  мини-расширитель API. Не блокер, но эстимейт +2-4 часа.
- **Preview demo-data.** Stage нуждается в фиксированном демо-наборе (1 intro + 1 question per
  type + 1 results). Можно завести в
  `client/src/features/tests/editor/sections/design-preview-fixtures.ts`.
- **Backwards compat манифестов.** Существующие `manifest.params` без `section` должны попадать
  в `branding` (см. §2.1). Это означает обновление всех 4 built-in манифестов в одном коммите
  со схемой.

---

## 6. Out of scope (явно)

- Создание новых шаблонов автором (PRD-3, post-MVP).
- Внешняя загрузка шаблонов (PRD-3, post-MVP).
- Text-overflow preview/diagnostics на content-pages (остаётся в PRD-1 §1.10).
