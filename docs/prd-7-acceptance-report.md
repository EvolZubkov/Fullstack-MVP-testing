# PRD-7 Acceptance Report (S11)

**PRD:** PRD-7 — Рефакторинг редактора параметров теста
**Фаза:** S11 — Acceptance pass
**Дата:** 2026-05-27
**Аудитор:** Opus 4.7
**Источники критериев:** PRD-7 §10 (группы критериев — см.
[s9-s11-in-progress.md §4.2](./specs/prd-7/s9-s11-in-progress.md)), FR/NFR-коды,
[decisions.md](./specs/prd-7/decisions.md), [s0-s8-closed.md](./specs/prd-7/s0-s8-closed.md).

## 1. Сводка

| Показатель | Результат |
| --- | --- |
| `npm run check` (tsc) | 0 ошибок |
| Полный `vitest run` | 52 файла / 1344 теста зелёные |
| Golden SCORM (`scorm-package-acceptance`) | 7/7 (включая новый S10-guard) |
| Группы критериев §10 | 10/10 пройдены |
| Блокирующих дефектов | 0 |
| Отложено (санкционировано ROADMAP §0.2) | 1 — раздел «Архив» с восстановлением (UI) |
| Остаточный ручной gate | Live axe/Lighthouse audit + end-to-end smoke в LMS |

Вывод: **PRD-7 готов к закрытию.** Все поведенческие и контрактные критерии
подтверждены кодом и автотестами. Единственный невыполненный пункт §10
(отдельный раздел «Архив» с восстановлением в списке тестов) ранее явно вынесен
в post-MVP backlog ([ROADMAP §0.2](./ROADMAP.md)) и не является блокером; backend
для него (`POST /api/tests/:id/restore`) реализован и протестирован. Остаётся один
ручной gate — полный браузерный/LMS audit (axe/Lighthouse + end-to-end smoke), не
покрываемый vitest.

## 2. Критерии по группам (PRD-7 §10)

### 2.1 Структура и контракт — PASS

- `TestsPage` без inline wizard: `client/src/pages/author/tests.tsx` — тонкий
  ре-экспорт `features/tests/list/tests-list.tsx`, монтирующего `TestEditor`.
- `TestEditor` покрывает create/edit standard и adaptive:
  `client/src/features/tests/editor/test-editor.tsx` +
  `__tests__/test-editor.test.tsx` (create/edit standard, create/edit adaptive).
- `TestEditorModel` + DTO + mappers + validation в отдельных модулях:
  `test-editor.types.ts`, `test-editor.mappers.ts`, `test-editor.validation.ts`.
- В компонентах нет сборки payload через `any`: payload строится
  `editorModelToPayload()` (типизированный mapper).

Evidence: `__tests__/test-editor.mappers.test.ts`, `test-editor.validation.test.ts`
(46 unit-тестов S3).

### 2.2 Single Save / Drawer — PASS

- Единая кнопка «Сохранить»; вкладки «Состав/Настройки/Оформление/Структура» с
  агрегированными статусами (dirty/warning/error).
- Нет preview-step; «Показать изменения» доступно только в dirty (диалог diff);
  нет «Сбросить всё» (FR-05b).
- Confirmation dialog при закрытии с несохранёнными изменениями (FR-05); «Сохранить»
  disabled при блокирующих ошибках (FR-05a).
- Draft хранится только в памяти React (FR-25j): `use-test-editor.ts` и
  `test-editor.tsx` явно документируют отсутствие `localStorage`/`sessionStorage`
  (grep — 0 совпадений по persistence).

Evidence: `__tests__/test-editor.test.tsx` (FR-05, Gap 5/6/9), JSDoc
`use-test-editor.ts:9`, `test-editor.tsx:20`.

### 2.3 Mode-switching — PASS

- standard/adaptive и `flowMode` не теряют данные; скрытые несовместимые настройки
  удерживаются в draft (FR-25h/25i), не попадают в payload, живут только в текущей
  сессии.
- Переключение — inline warning, без modal confirmation (FR-25d/25e).

Evidence: `__tests__/sections/basic-settings-section.test.tsx` (router flowSettings
не очищаются; скрытые adaptive/router-настройки удерживаются),
`test-editor.mappers.test.ts` (FR-25h — скрытое не в payload).

### 2.4 Conflict detection (FR-25k) — PASS

- Optimistic version check: `PUT /api/tests/:id` с `expectedVersion`; 409 →
  структурированный `ConflictInfo`; диалог «Обновить данные» / «Сохранить поверх».
- Серверная сторона: `VersionConflictError` → 409.

Evidence: `use-test-editor.ts:60-132,404-519` (conflict state + resolve reload/
overwrite), `tests/routes.tests.test.ts` (PATCH/PUT 409), `test-editor.test.tsx`
(Gap 7 component-level 409).

### 2.5 Валидация — PASS

- Комбинированная: debounced поля (300 мс, NFR-18) + блокировка сохранения по error.
- Двухуровневая индикация: поле + summary секции с anchor-навигацией (FR-20c) —
  Banner (error tone) со счётчиком полей и действием «Перейти к ошибкам»;
  `tabForField`/`goToError` переключают вкладку и фокусируют `data-field`-якорь.

Evidence: `test-editor.validation.test.ts`, `test-editor.test.tsx` (Gap 9 debounce;
FR-20c describe).

### 2.6 PRD-1 интеграция — PASS

- «Оформление» и content-pages в Drawer; экспорт SCORM в меню карточки списка.
- variant.kind контракт: enum + zod-схемы манифеста, тихая привязка, replace-variant
  endpoint (FR-46), required-fields validation на publish.
- Редактор авторских content-pages в «Структуре» (closeout PRD-1, 2026-05-27):
  add/edit/reorder/delete во всех трёх `flowMode`.

Примечание: предпросмотр шаблона в «Оформлении» и text-overflow diagnostics —
отложены в PRD-1 (см. [prd-1/implementation-todo.md §3.2](./specs/prd-1/implementation-todo.md)),
не входят в scope PRD-7.

Evidence: `tests/manifest-variant-kind.test.ts`, `tests/routes.content-pages.test.ts`,
`start-pages-section.tsx` + соответствующие component-тесты.

### 2.7 Layout — PASS (markup)

- Wide Drawer `ou-drawer--xl ou-drawer--right`; двухпанельные настройки; mobile
  out-of-scope PRD-7 (явное решение S1).
- Разметка вкладок 1:1 с approved wireframes (S8 DoD, wireframe-correspondence pass
  `979d224`).

Остаток: пиксельная сверка рендера в браузере — входит в остаточный ручной gate (§4).

### 2.8 Архив — PASS (частично) / DEFERRED

- Удаление с вводом точного названия (FR-30): PASS.
- Archived скрыты из общего списка (FR-31): PASS (`excludeArchived`).
- Меню «Архивировать» (смена статуса) + бейдж «Архив»: PASS.
- Отдельный раздел «Архив» с восстановлением: **DEFERRED** — UI не реализован
  (`/restore` на клиенте не вызывается, archive-route отсутствует). Вынесен в
  post-MVP backlog ([ROADMAP §0.2](./ROADMAP.md)). Backend готов и протестирован
  (`POST /api/tests/:id/restore`, `tests/routes.tests.test.ts`).

Evidence: `tests-list.test.tsx` (menu-archive, delete confirm),
`tree-builder.test.ts` (excludeArchived FR-31), `routes.tests.test.ts` (restore).

### 2.9 Backend — PASS

- Атомарное сохранение test + sections + adaptive через `db.transaction`
  (`TestSettingsService.create()/save()`); rollback при ошибке уровня/link.
- Структурированная валидация ошибок (field-level payload; required-fields 422 на
  publish).

Evidence: `tests/services/test-settings.test.ts` (transaction, adaptive rollback,
legacy fallbacks), `tests/routes.tests.test.ts` (Zod field-level).

### 2.10 Feedback — PASS

- `format: 'plain' | 'richText' | 'html'`; PDF-assets в SCORM; legacy без `format`
  → `plain`.

Evidence: `feedback-editor-modal.test.tsx`, `tests/schema-prd7-feedback.test.ts`,
mappers legacy fallback.

## 3. NFR / a11y

| NFR | Критерий | Статус | Evidence |
| --- | --- | --- | --- |
| NFR-17 | Drawer < 1.5 с на 20 темах | PASS (smoke) | `test-editor.test.tsx` — рендер без ошибок на 20 темах; реальный тайминг — ручной gate §4 |
| NFR-18 | Валидация debounced 300 мс | PASS | `test-editor.test.tsx` Gap 9 |
| NFR-19 | Фокус на первый интерактивный элемент при открытии | PASS | `test-editor.test.tsx` |
| NFR-20 | Tab/Shift-Tab не выходит за пределы Drawer | PASS (реализация) | S4 DoD; полный keyboard-trap — ручной gate §4 |
| NFR-21 | aria-label на индикаторах статуса | PASS | `StatusBadge` aria-label; `tests-list.tsx:1047` |

## 4. Остаточный ручной gate (не покрывается vitest)

Эти пункты требуют запущенного приложения в браузере/LMS и не закрываются
автотестами. Они не блокируют контрактное закрытие PRD-7, но должны быть пройдены
до релиза:

1. Полный axe / Lighthouse accessibility audit Drawer (контраст, роли, фокус-trap
   вживую).
2. Реальное измерение NFR-17 (< 1.5 с открытия на тесте с 20 темами).
3. End-to-end smoke: create/edit standard и adaptive; переключение режимов без
   потери данных; удаление с вводом названия; optimistic conflict при параллельной
   правке; SCORM export с feedback PDF; variant.kind smoke (смена варианта + diff
   потерь параметров).
4. Запуск экспортированного SCORM-пакета в LMS (или `npm run scorm:player`).

## 5. Изменения, внесённые в ходе S10/S11

- S10 (остаток): удалено чтение `start_page_content` из SCORM-export
  (`server/scorm/builders/test-json.ts`) и runtime
  (`server/scorm/template/app/render/startPage.js`); контент теперь играется как
  intro content-page (миграция 003 §4.2). Колонка БД и write-path сохранены для
  legacy-клиентов (decisions §1, S10 §3.3). In-app web-плеер (`take-test.tsx`) не
  затронут (рендерит legacy-текст, content-pages не использует).
- Удалён осиротевший файл-бэкап
  `server/scorm/template/app/render/startPage здесь кнопка меняется.js` (не входил
  в SCORM-бандл).
- Добавлен golden-guard S10 в `tests/scorm-package-acceptance.test.ts`:
  `startPageContent` отсутствует в TEST_DATA, intro-страница присутствует.

## 6. Definition of Done S11

- [x] Все группы критериев §10 пройдены или зафиксированы как deferred/issue.
- [x] `docs/prd-7-acceptance-report.md` создан и заполнен.
- [x] Полный автотест-suite зелёный (52 файла / 1344), `npm run check` 0 ошибок.
- [ ] Live axe/Lighthouse audit + end-to-end smoke в браузере/LMS (остаточный
      ручной gate §4).
