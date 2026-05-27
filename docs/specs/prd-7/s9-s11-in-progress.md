# PRD-7: Активные фазы S9-S11

**Статус:** Closed 2026-05-27 (S9 + S10 + S11 закрыты). PRD-7 завершён; остаточный
ручной gate (live axe/Lighthouse + end-to-end smoke в LMS) зафиксирован в
[docs/prd-7-acceptance-report.md §4](../../prd-7-acceptance-report.md).
**Дата актуализации:** 2026-05-27
**Связанные документы:**

- [PRD-7 decisions](./decisions.md) — контракты, enum, JSON-shapes (читать ДО кода)
- [PRD-7 baseline](./baseline.md) — снимок поведения до рефакторинга
- [PRD-7 S0-S8 closed](./s0-s8-closed.md) — архив закрытых фаз (контракты, mappers,
  validation, Drawer, все секции)
- [PRD-1 §4.3](../prd-1/templates-content-pages.md) — variant.kind модель

---

## 1. Текущее состояние

**Готово (S0-S8 закрыты 2026-05-25).** См. [PRD-7 S0-S8 closed](./s0-s8-closed.md):

- Контракты в `decisions.md`, skeleton-каркас редактора.
- Wireframes 153/153 approved (DS UniversityRT `ou-*` + `tb-*`).
- Backend: миграции 003 + 004, `TestSettingsService`, endpoints
  (`PATCH /status`, `DELETE`, `POST /restore`, `replace-variant`).
- Доменная модель: `TestEditorModel`, mappers, validation, 46 unit-тестов.
- UI редактора: wide Drawer + reference-секция basic-settings + FeedbackEditorModal.
- Доменные секции: topics-structure, pass-rules, adaptive-settings, start-pages,
  design — все интегрированы в Drawer с DS UniversityRT.
- Регрессия на 2026-05-25: ~19 файлов × ~457 тестов, `npm run check` 0 ошибок.

**Статус фаз.**

- **S9 — закрыта 2026-05-27.** Component + API + regression тесты + FR-20c. Детали:
  §2.2 (component, ч.1), §2.3 (API/regression, ч.2). Полный `vitest run` — 52 файла /
  1375 тестов зелёные, `npm run check` 0 ошибок. Открытый пункт (это фича, не тест):
  раздел «Архив» с восстановлением в `tests-list` не реализован — см. чек-лист §2.2.
- **S10 — закрыта 2026-05-27.** Inline wizard удалён ещё в S5-S8 (`tests.tsx` —
  ре-экспорт `tests-list`, монтирующего `TestEditor`); orphaned `ContentPagesDialog`
  выведен из эксплуатации. Остаток закрыт: чтение `tests.start_page_content` удалено
  из SCORM-export (`test-json.ts`) и runtime (`startPage.js`), контент играется как
  intro content-page (миграция 003 §4.2); добавлен golden-guard в
  `tests/scorm-package-acceptance.test.ts`; удалён осиротевший файл-бэкап
  `startPage здесь кнопка меняется.js`. Чтение `tests.published` в `test-settings.ts`
  — намеренная обратная совместимость (§3.3), остаётся. In-app web-плеер
  (`take-test.tsx`) не затронут (рендерит legacy-текст, content-pages не использует).
- **S11 — закрыта 2026-05-27.** Acceptance pass пройден: 10/10 групп критериев §10,
  0 блокеров; suite 52 файла / 1344 зелёные, `npm run check` 0. Отчёт —
  [docs/prd-7-acceptance-report.md](../../prd-7-acceptance-report.md). Раздел «Архив»
  с восстановлением (UI) — санкционированная отсрочка post-MVP (ROADMAP §0.2),
  backend `POST /restore` готов и протестирован. Остаточный ручной gate — §4.4 ниже.

---

## 2. S9 — Component и API тесты

**Модель:** Haiku 4.5
**Длительность:** 2 сессии (S9 часть 1: component; S9 часть 2: API + regression)
**Блокирует:** S10, S11
**Зависит от:** S5-S8 (production-код секций существует) — закрыто.

### 2.1 Scope

Покрыть тестами все секции редактора и API-endpoints, добавленные в S0-S8. Доделать
FR-20c (anchor-навигация из summary ошибки к проблемному полю в Drawer).

### 2.2 S9 часть 1 — Component-тесты (Фаза 6A, Haiku)

Reference: `__tests__/sections/basic-settings-section.test.tsx` и
`__tests__/test-editor.test.tsx`.

Чек-лист (из §1.13.2 implementation-todo):

- [x] Create standard happy path в Drawer — `test-editor.test.tsx` (DOM/focus + create-mode POST).
- [x] Edit standard с existing sections — `test-editor.test.tsx` (load test-1).
- [x] Create adaptive с загрузкой difficulty distribution — `test-editor.test.tsx` (Gap 4).
- [x] Edit adaptive с сохранёнными levels/links — `test-editor.test.tsx` (Gap 4, десериализация adaptiveSettings).
- [x] Переключение standard/adaptive показывает inline warning без удаления данных —
  `basic-settings-section.test.tsx` (драйвит реальный onChange через `runUpdater`,
  проверяет сохранение title/sections и adaptive-топиков).
- [x] Переключение `flowMode` пересобирает структуру и сохраняет несовместимые
  элементы как скрытые — `basic-settings-section.test.tsx` (router flowSettings не
  очищаются при уходе с router-режима).
- [x] Возврат предыдущего режима восстанавливает скрытые настройки —
  `basic-settings-section.test.tsx` (скрытые adaptive/router-настройки удерживаются в draft).
- [x] Confirmation dialog при закрытии с несохранёнными изменениями — `test-editor.test.tsx` (FR-05).
- [x] Confirmation dialog c блокирующими ошибками: "Сохранить" disabled — `test-editor.test.tsx` (Gap 5, component-level).
- [x] API error остаётся в редакторе — `test-editor.test.tsx` (Gap 6, saveError banner на 500).
- [x] Optimistic conflict dialog "Обновить данные" / "Сохранить поверх" —
  `test-editor.test.tsx` (Gap 7, component-level 409).
- [x] Удаление теста: confirmation с вводом точного названия — `tests-list.test.tsx` (FR-30).
- [x] Архивные тесты скрыты из основного списка — `tree-builder.ts` `excludeArchived()`
  (по умолчанию).
- [ ] Раздел "Архив" показывает архивные тесты и позволяет восстановить — **НЕ реализовано**
  в `tests-list`: отдельного раздела «Архив»/восстановления нет (есть только смена статуса
  на `archived`). Вынести как отдельный пункт list-feature / S11.
- [x] Drawer открывается с данными за < 1.5 с на тесте с 20 темами (NFR-17) — smoke-тест
  `test-editor.test.tsx` (рендер без ошибки на 20 темах; реальное измерение времени — S11).
- [x] Валидация debounced 300 мс (NFR-18) — `test-editor.test.tsx` (Gap 9).
- [x] Фокус переходит на первый интерактивный элемент при открытии (NFR-19) — `test-editor.test.tsx`.
- [x] **FR-20c** — ссылки-якоря из сводки ошибок к проблемным полям по `field`-путям
  из `ValidationIssue`. Реализовано: DS `Banner` (error tone) в начале drawer-body со
  счётчиком полей и действием «Перейти к ошибкам» (по approved wireframe); навигация
  `tabForField` + `goToError` (переключение вкладки и focus/scroll по `data-field`-якорям
  на секциях). Покрыто `test-editor.test.tsx` (FR-20c describe). Единственный незакрытый
  пункт S4/4A — закрыт.

#### Промпт для исполнителя (Haiku, S9 часть 1)

```text
Расширь component-тесты для всех секций редактора PRD-7 по чек-листу §2.2
docs/specs/prd-7/s9-s11-in-progress.md (он же §1.13.2 docs/specs/prd-7/implementation-todo.md).

Reference: __tests__/sections/basic-settings-section.test.tsx и
__tests__/test-editor.test.tsx как образец стиля.

Задачи: для каждого пункта чек-листа §2.2 добавить тест-кейс. Если кейс уже
покрыт - отметить в комментарии и пропустить.

Дополнительная задача (FR-20c): реализовать anchor-навигацию из summary ошибки
секции к первому проблемному полю. Использовать поле `field` из ValidationIssue
как селектор. Покрыть тестом: при клике на ошибку в summary фокус переходит
на input.

DoD: vitest run client/src/features/tests/editor зелёный, минимум 1 тест на каждый
пункт чек-листа.
Anti-goals: НЕ менять production-код секций (кроме anchor-navigation).
НЕ менять existing test setup utilities.
Эскалация: если для какого-то теста нужен новый mock или новая утилита - сообщи.
```

### 2.3 S9 часть 2 — API и regression тесты (Фаза 6B, Haiku)

Reference: `tests/routes.tests.test.ts`, `tests/services/test-settings.test.ts`.

API-чек-лист (из §1.13.3):

- [x] `POST /api/tests` standard создаёт test + sections атомарно — service
  `create() inserts sections for each entry` + `runs inside a transaction`.
- [x] `PUT /api/tests/:id` standard атомарно обновляет sections — service
  `replaces sections when sections array provided`.
- [x] `POST /api/tests` adaptive создаёт test + adaptive settings атомарно —
  service `create() adaptive inserts topic settings + levels + links in one
  transaction` (добавлено в S9 ч.2) + route `POST adaptive — forwards
  adaptiveSettings to service.create`.
- [x] `PUT /api/tests/:id` adaptive откатывает изменения при ошибке уровня/link —
  service `save() adaptive propagates a level-insert failure so the transaction
  rolls back` (добавлено в S9 ч.2).
- [x] Validation errors возвращают field-level payload — routes `POST/PUT … Zod
  validation`.
- [x] Optimistic version check возвращает 409 Conflict при mismatch — routes
  `PATCH … 409` + `PUT … 409 on VersionConflictError`.
- [x] `PATCH /api/tests/:id/status` корректно меняет статус.
- [x] `DELETE /api/tests/:id` требует точное совпадение названия.
- [x] `POST /api/tests/:id/restore` восстанавливает из архива.
- [x] Список тестов по умолчанию не показывает `archived`.

Regression-чек-лист (из §1.13.4):

- [x] Старые тесты с `published=true/false` корректно открываются и сохраняются
  через новый редактор — service `derives status from published flag` +
  `syncs status<->published`; route `GET … legacy published test loads with
  sections` (добавлено в S9 ч.2).
- [x] Старые тесты с непустым `start_page_content` корректно мигрируются в `intro`
  content page — `tests/migration-prd7.test.ts`. Test-harness воспроизводит порядок
  деплоя: 003 (INSERT без `kind`) → 004 (backfill `kind` из `type`), а не применяет
  003 в одиночку поверх уже мигрированной dev-БД. Проверяется в т.ч. `kind = 'intro'`.
- [x] Старые тесты без `designSettingsJson` используют default template — service
  `create() without designSettingsJson falls back to the default template`
  (добавлено в S9 ч.2) + `tests/scorm-export.test.ts` default-template path.
- [x] Старые тесты без adaptive settings продолжают работать как standard —
  service `create() without adaptiveSettings inserts no adaptive rows`
  (добавлено в S9 ч.2).
- [ ] SCORM export старых тестов после миграции данных проходит golden-тест —
  частично: `tests/scorm-export.test.ts` покрывает default-template fallback и
  сериализацию contentPages/designSettings в `TEST_DATA`; полноценного
  golden-snapshot всего ZIP нет. Кандидат на S11 acceptance.

> **Статус S9 ч.2 (2026-05-27).** Добавлено 10 тест-кейсов (6 service-уровня:
> adaptive create/replace/rollback + legacy default-template/no-adaptive; 4
> route-уровня: adaptive forwarding POST/PUT + legacy GET). Дополнительно
> устранены 8 pre-existing падений в 6 файлах (migration-prd7 ×2, attempts-tests,
> assignments, test-folders ×2, users-bulk, scorm-media ×2) — все были стале-тестами
> после рефакторингов PRD-7/PRD-1, кроме одной 1-строчной правки production в
> `server/scorm/builders/media-assets.ts` (двойная обработка `mediaUrl`).
> **Полный `vitest run` зелёный: 52 файла, 1363 теста.** `npm run check` 0 ошибок.
> Замечание: глобальный порог coverage 50% (`vitest.config.ts`) сейчас не добирает
> ~0.1-0.6 пп (≈49.4-49.9%) — pre-existing gate, не связан с этими правками; вынесен
> отдельно.

#### Промпт для исполнителя (Haiku, S9 часть 2)

```text
Расширь API и regression тесты по чек-листам §2.3 docs/specs/prd-7/s9-s11-in-progress.md
(они же §1.13.3 и §1.13.4 docs/specs/prd-7/implementation-todo.md).

Reference: tests/routes.tests.test.ts существующий, tests/services/test-settings.test.ts
от Фазы 1B.

Задачи: для каждого пункта чек-листов §2.3 добавить тест-кейс.

DoD: vitest run всех тестов зелёный, все пункты чек-листов покрыты.
Anti-goals: НЕ менять production routes/storage без острой необходимости.
Эскалация: если тест требует изменения production-кода - сообщи.
```

### 2.4 Definition of Done для S9 — выполнено 2026-05-27

- [x] Все пункты чек-листов §2.2, §2.3 закрыты тестами (кроме фичи «раздел Архив» —
  вынесена, см. §2.2).
- [x] FR-20c реализован: anchor-навигация работает + покрыта тестом.
- [x] `npm run check` зелёный.
- [x] `npx vitest run` полный suite зелёный — 52 файла / 1375 тестов.
- [x] Нет регрессий (попутно устранены 8 pre-existing падений в 6 не-S9 файлах).

> Примечание: глобальный порог coverage 50% (`vitest.config.ts`) сейчас ~49.9% —
> отдельный pre-existing gate, не входит в DoD S9.

---

## 3. S10 — Удаление legacy

**Модель:** Sonnet 4.6
**Длительность:** 1 сессия
**Блокирует:** S11
**Зависит от:** S9 зелёный (regression подтвердил отсутствие регрессий).

> **Статус (2026-05-27) — закрыта.** Бо́льшая часть S10 закрыта ещё в рамках S5-S8:
> inline wizard в `client/src/pages/author/tests.tsx` удалён (файл — тонкий ре-экспорт
> `features/tests/list/tests-list.tsx`), `tests-list` монтирует `TestEditor` для
> create/edit. В Шаге 1 closeout (2026-05-27) выведен из эксплуатации orphaned
> `ContentPagesDialog`. Финальный пункт §3.2 закрыт: чтение `tests.start_page_content`
> удалено из SCORM-export (`server/scorm/builders/test-json.ts`) и runtime
> (`startPage.js`); контент играется как intro content-page (миграция 003 §4.2);
> golden-guard в `tests/scorm-package-acceptance.test.ts`; удалён осиротевший
> файл-бэкап `startPage здесь кнопка меняется.js`. Чтение `tests.published` в
> `test-settings.ts` — намеренная обратная совместимость (§3.3), остаётся.

### 3.1 Scope

Удалить старый inline wizard и dialog state из `client/src/pages/author/tests.tsx`;
удалить чтение `tests.published` и `tests.start_page_content` из runtime/SCORM-export;
оставить только обратный маппинг в storage layer для legacy clients.

### 3.2 Что удаляется

- Inline wizard create/edit из `TestsPage` — заменить на открытие `TestEditor`.
- Inline state для design dialog, content pages dialog, export SCORM dialog
  внутри `TestsPage`.
- Открытие design/content pages из карточки — навигация в соответствующие секции
  `TestEditor`. Export SCORM остаётся как действие карточки/меню.
- Все `console.log`, `debugger`, dead code.
- Чтение `tests.published` в бизнес-логике (оставить только в обратном маппере
  storage layer).
- Чтение `tests.start_page_content` из runtime/SCORM export.

### 3.3 Что остаётся (backward compatibility)

- Колонки `tests.published` и `tests.start_page_content` в БД — НЕ удаляются (отдельный
  релиз после стабилизации).
- Storage layer пишет `published = (status === 'published')` для legacy clients.
- `mapLegacyTest()` в `server/storage.ts` остаётся для read-path совместимости.
- Mappers `apiToEditorModel()` остаются с legacy fallback.

### 3.4 Промпт для исполнителя (Sonnet)

```text
Удали inline wizard и dialogs из client/src/pages/author/tests.tsx.

Контракт: §3 docs/specs/prd-7/s9-s11-in-progress.md (он же §1.12 docs/specs/prd-7/implementation-todo.md),
anti-goals из decisions.md §1.

Задачи:
1. Удалить inline wizard create/edit из TestsPage. Заменить на открытие нового TestEditor.
2. Удалить inline state для design dialog, content pages dialog, export SCORM dialog
   из TestsPage.
3. Заменить открытие design/content pages на навигацию в соответствующие секции TestEditor.
   Export SCORM остаётся как действие карточки/меню.
4. Удалить все console.log, debugger, dead code.
5. Прогрепать tests.published в production-коде - оставить только обратный маппинг
   (storage layer пишет published = status === 'published').
6. Прогрепать tests.start_page_content в production-коде - удалить чтение,
   оставить только запись (для legacy clients до удаления колонки).

DoD: npm run check, vitest run полностью зелёный (включая existing tests).
Manual: создание/редактирование теста через новый редактор работает end-to-end.
Anti-goals: НЕ удалять колонки tests.published и tests.start_page_content.
НЕ ломать backward compatibility API.
```

### 3.5 Definition of Done для S10

- Inline wizard полностью удалён из `TestsPage`; create/edit идут только через
  `TestEditor`.
- Чтение `tests.published` и `tests.start_page_content` отсутствует в runtime/SCORM.
- Storage layer корректно синхронизирует `published` из `status`.
- `npm run check` и полный vitest suite зелёные.
- Manual end-to-end: создание/редактирование работает.

---

## 4. S11 — Acceptance pass

**Модель:** Opus 4.7 (acceptance) + Sonnet 4.6 (edge-states wireframes W.3C при
необходимости)
**Длительность:** 1 сессия
**Блокирует:** релиз PRD-7
**Зависит от:** S9 + S10 закрыты.

### 4.1 Scope

Финальный acceptance pass всех ~50 criteria PRD-7 §10. Lighthouse/axe accessibility
audit. Manual end-to-end smoke по всем сценариям. Фиксация результата в
`docs/prd-7-acceptance-report.md` со списком пройденных/непройденных criteria и
issues для невыполненных.

### 4.2 Acceptance criteria (PRD-7 §10)

Полный список — в исходном PRD-7 §10 (см. [PRD-7 S0-S8 closed](./s0-s8-closed.md)
для ссылок на код). Ключевые группы:

- **Структура и контракт:** `TestsPage` без inline wizard; `TestEditor` покрывает
  create/edit standard и adaptive; `TestEditorModel` + DTO + mappers + validation в
  отдельных модулях; в компонентах нет сборки payload через `any`.
- **Single Save / Drawer:** единая кнопка "Сохранить"; вкладки с агрегированными
  статусами; секции с локальными `изменено`/`warning`/`error`; нет preview-step;
  "Показать изменения" только в dirty; нет "Сбросить всё".
- **Mode-switching:** standard/adaptive и flowMode не теряют данные; скрытые
  несовместимые настройки сохраняются в draft, не попадают в payload, живут только
  в текущей сессии (FR-25h, FR-25i).
- **Conflict detection:** FR-25k optimistic version check, 409 dialog.
- **Валидация:** комбинированная (debounced поля + блокировка по error); двухуровневая
  индикация (поле + summary секции с anchor-навигацией — FR-20c из S9).
- **PRD-1 интеграция:** оформление и content pages в Drawer; экспорт SCORM в меню
  карточки; variant.kind контракт; required-fields validation на publish.
  Примечание: полноценный редактор content-pages в «Структуре» (add/edit/reorder/
  выбор шаблона) вынесен в closeout-фазу PRD-1 — см.
  [PRD-1 implementation-todo §4](../prd-1/implementation-todo.md). До её закрытия
  секция «Структура» остаётся read-only + delete (стаб `structure-content-pages-stub`).
- **Layout:** wide Drawer `min(1120px, calc(100vw - 48px))`; двухпанельные настройки
  ≥ 960px; mobile out-of-scope PRD-7.
- **Архив:** удаление с вводом названия; archived скрыты из общего списка;
  отдельный раздел "Архив" с восстановлением.
- **Backend:** атомарное сохранение test + sections + adaptive через transaction;
  структурированная валидация ошибок.
- **Feedback:** `format: 'plain' | 'richText' | 'html'`; PDF assets в SCORM;
  legacy без `format` → `plain`.
- **Performance / a11y:** Drawer < 1.5s на 20 темах (NFR-17); валидация debounced
  300 мс (NFR-18); focus на первый интерактивный (NFR-19); aria-label на индикаторах
  (NFR-21).

### 4.3 W.3C — Edge-state wireframes (модель Sonnet)

По решению 2026-05-21 edge-states интегрированы как state'ы единого
`prd7-editor-drawer.html` (state-switcher), отдельные файлы W.3C не создаются.
Если в ходе acceptance pass обнаружится сценарий без визуального покрытия — запустить
W.3C промпт (см. ниже).

Промпт для Sonnet (если потребуется):

```text
Дополни wireframes полным набором edge-states из §W.1
docs/specs/prd-7/s0-s8-closed.md (S1 раздел).

Reference и принципы: те же, что в W.3B (см. PRD-7 S0-S8 closed §S1 артефакты).

Задачи:
1. Создать каждый файл из выявленного гэпа edge-state по образцу
   reference-wireframe prd7-editor-drawer.html.
2. Сосредоточиться на состояниях, которые сложно проверить без визуализации:
   ошибки, конфликты версий, archived/read-only, перегруженные списки.

Anti-goals и DoD: как в W.3B.
```

### 4.4 End-to-end сценарии (manual smoke)

- create standard / edit standard;
- create adaptive / edit adaptive;
- переключение standard ↔ adaptive (без потери данных);
- переключение flowMode (linear_flat ↔ linear_by_topics ↔ router_by_topics);
- удаление теста с вводом точного названия;
- архив и восстановление;
- optimistic conflict при параллельной правке статуса;
- SCORM export с feedback PDF assets;
- variant.kind smoke: смена варианта на page-row, diff потерь параметров.

### 4.5 Промпт для исполнителя (Opus, S11)

```text
Финальный acceptance pass PRD-7.

Задачи:
1. Пройти все ~50 acceptance criteria PRD-7 §10 - для каждого либо подтвердить
   реализацию ссылкой на код/тест, либо открыть issue.
2. Проверить полноту покрытия decisions.md - все ли enum/shapes используются
   как заявлено.
3. Lighthouse/axe accessibility audit Drawer (NFR-19..NFR-21).
4. Performance check: Drawer открывается за < 1.5s на тесте с 20 темами (NFR-17).
5. Manual end-to-end smoke (см. §4.4 docs/specs/prd-7/s9-s11-in-progress.md).

Выход: docs/prd-7-acceptance-report.md со списком пройденных/непройденных criteria
и issues для невыполненных.

Anti-goals: НЕ начинать новые фичи. Только проверка и фиксация результата.
```

### 4.6 Definition of Done для S11

- [x] Все группы acceptance criteria PRD-7 §10 пройдены или зафиксированы как
  deferred/issue (10/10; 0 блокеров; раздел «Архив» — отсрочка post-MVP).
- [x] `docs/prd-7-acceptance-report.md` создан и заполнен.
- [x] Полный автотест-suite зелёный (52 файла / 1344), `npm run check` 0 ошибок.
- [ ] Lighthouse / axe audit пройден для Drawer — остаточный ручной gate (§4 отчёта).
- [ ] Performance NFR-17 (< 1.5s) подтверждён вживую — остаточный ручной gate.
- [ ] Manual smoke по всем сценариям §4.4 — остаточный ручной gate.

---

## 5. Блокеры и зависимости

| Чтобы стартовать | Должно быть готово |
| --- | --- |
| S9 | S0-S8 закрыты (готово 2026-05-25) — **выполнено** |
| S10 | S9 зелёный (regression подтверждён) — **выполнено 2026-05-27, S10 разблокирована** |
| S11 | S9 + S10 закрыты; полный набор UI работает в браузере |

**Внешних блокеров нет.** S9 закрыта 2026-05-27; S10 разблокирована.

**Что разблокирует PRD-7 после закрытия:**

- PRD-4: `flowMode` runtime без рефакторинга редактора.
- PRD-6: блок "Повторное прохождение" в секцию редактора.
- PRD-8: вкладка "Структура" в режиме `router_by_topics` по согласованным wireframes.
- PRD-2 / PRD-5: вкладки "Показатели" и "Шкалы" без переписывания формы.
- PRD-3: административный реестр шаблонов с консистентным UI выбора шаблона.
