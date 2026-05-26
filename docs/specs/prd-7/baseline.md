# PRD-7: Baseline текущего поведения (S0)

**Статус:** Archived snapshot (зафиксирован 2026-05-10)
**Дата фиксации:** 2026-05-10
**Назначение:** snapshot фактического поведения и usage до старта изменений PRD-7.
Используется для regression-проверок в S2-S10 и финальной приёмки в S11.
**Связанные документы:** [PRD-7 S0-S8 closed](./s0-s8-closed.md),
[PRD-7 S9-S11 in progress](./s9-s11-in-progress.md),
[decisions.md](./decisions.md), [implementation-todo.md](./implementation-todo.md)

---

## 1. API endpoints для тестов

### 1.1 `POST /api/tests` (server/routes/tests.ts:72-159)

**Auth:** `requireAuthor`.

**Принимаемые поля payload:**

```text
title              required
description
overallPassRuleJson
webhookUrl
sections[]         required для standard mode
showCorrectAnswers
timeLimitMinutes
maxAttempts
startPageContent   legacy, мигрирует в content_pages
feedback           legacy string, мигрирует в feedback_json
mode               default "standard"
showDifficultyLevel default true
adaptiveSettings[] для adaptive mode
```

**Поведение:**

- Возврат 400 если нет `title`.
- Возврат 400 если `mode != "adaptive"` и `sections` пустой.
- Создаёт `tests` с `published: false` (всегда false при create).
- Для adaptive: создаёт `adaptive_topic_settings`, `adaptive_levels`,
  `adaptive_level_links` через отдельные вызовы (без transaction).
- Возврат 201 с созданным test.
- Возврат 500 при любой ошибке.

**Известные проблемы:**

- Нет request validation схемы (поля проходят как `any`).
- Нет transaction: при ошибке в adaptive levels test уже создан.
- Нет `status` поля - всегда пишется `published: false`.

### 1.2 `PUT /api/tests/:id` (server/routes/tests.ts:285-371)

**Auth:** `requireAuthor`.

**Принимаемые поля:** те же, что в POST (без `published`).

**Поведение:**

- Обновляет test через `storage.updateTest(...)`.
- Для standard mode: передаёт `sections` в `updateTest` для обновления секций.
- Для adaptive mode и переданных `adaptiveSettings`:
  - удаляет `adaptive_level_links` -> `adaptive_levels` -> `adaptive_topic_settings`;
  - создаёт всё заново.
- Возврат 404 если test не найден.
- Возврат 500 при любой ошибке.

**Известные проблемы:**

- Нет request validation схемы.
- Нет transaction: между удалением старых adaptive settings и созданием новых
  возможно частичное состояние при сбое.
- Нет optimistic version check: параллельные правки молча перезаписывают друг друга.
- Нет логики смены `status` (поле пока отсутствует в схеме).

### 1.3 `DELETE /api/tests/:id` (server/routes/tests.ts:374-390)

- Удаляет adaptive settings (links/levels/topic-settings) сериями.
- Удаляет test.
- НЕ требует подтверждения названия.
- НЕ имеет архивного статуса - тест физически удаляется.

### 1.4 `GET /api/tests` (server/routes/tests.ts:15-69)

- Возвращает все тесты со всеми секциями и adaptive settings.
- НЕ фильтрует по статусу (поле отсутствует).
- НЕ имеет pagination.
- N+1 запросы: для каждого теста - вызовы getTestSections, getQuestionsByTopic,
  для adaptive - getAdaptiveTopicSettingsByTest, getAdaptiveLevelsByTest, getAdaptiveLevelLinks.

### 1.5 `GET /api/tests/:id/adaptive-settings` (server/routes/tests.ts:162-192)

- Возвращает adaptive settings отдельным запросом.
- Используется при открытии редактирования adaptive теста.

### 1.6 `GET /api/tests/:id/design` (server/routes/tests.ts:195-209)

- Возвращает `designSettingsJson` или `{ templateId: "default" }` если пусто.

### 1.7 `PUT /api/tests/:id/design` (server/routes/tests.ts:212-282)

- Валидирует `templateId`, `templateApiVersion`, `params` против manifest.
- Запрещает unknown params.
- Сохраняет в `tests.designSettingsJson`.

### 1.8 `GET /api/tests/:id/export/scorm` (server/routes/tests.ts:393-513)

- Опциональный query `?telemetry=true` создаёт `scorm_packages` запись.
- Загружает test, sections, contentPages, adaptiveSettings, designSettings.
- Вызывает `generateScormPackage(...)`.
- Возвращает ZIP буфер.

---

## 2. Dialogs текущей реализации

### 2.1 DesignSettingsDialog (client/src/components/design-settings-dialog.tsx)

- API: `GET /api/templates`, `GET /api/tests/:id/design`, `PUT /api/tests/:id/design`.
- Открывается из карточки теста по кнопке "Оформление".
- Будет переиспользован в S8 / Фаза 5E как inline-секция.

### 2.2 ContentPagesDialog (client/src/components/content-pages-dialog.tsx)

- API: CRUD `content-pages` + `GET /api/templates` + `GET /api/tests/:id/design`.
- Поддерживает drag-and-drop reorder.
- Открывается из карточки теста по кнопке "Страницы".
- Будет переиспользован в S8 / Фаза 5D через секцию "Структура".

### 2.3 Export SCORM dialog (inline в TestsPage)

- Локальное состояние `exportTestId`, `enableTelemetry`.
- Вызывает `GET /api/tests/:id/export/scorm?telemetry=...`.
- Скачивает ZIP с правильным filename из Content-Disposition.
- Останется как действие карточки/меню (FR-28). НЕ переезжает в Drawer.

---

## 3. Usage `tests.published`

Найдено 5 файлов (grep по `tests\.published|test\.published|published:`):

| Файл | Использование |
| --- | --- |
| `shared/schema.ts:139` | Определение колонки `published: boolean("published").default(false)` |
| `server/storage.ts` | Read/write через Drizzle (`tests.published` в select/update) |
| `server/routes/tests.ts:105` | POST: `published: false` при create |
| `tests/scorm-export.test.ts` | Тестовые данные с `published: true/false` |
| `tests/routes.design-settings.test.ts` | Тестовые данные |

**Вывод:** usage минимальный. Storage layer и POST `/api/tests` - единственные
места записи. Никакая бизнес-логика не зависит от `published` для отображения
или фильтрации. Безопасно мигрировать в `status` в S2 без поиска новых usages.

---

## 4. Usage `tests.start_page_content` / `startPageContent`

Найдено 14 файлов. Критичные usage:

| Файл | Тип | Действие в S2/S10 |
| --- | --- | --- |
| `shared/schema.ts:145` | Колонка `startPageContent: text("start_page_content")` | Пометить deprecated в S2 |
| `server/storage.ts` | Read/write | Сохранить read для backward compat в S2, удалить в S10 |
| `server/routes/tests.ts:83, 109, 296, 314` | POST/PUT принимает `startPageContent` | Сохранить в S2, удалить в S10 |
| `server/scorm/builders/test-json.ts` | Подмешивает в TEST_DATA | Заменить на content_pages в S2 |
| `server/scorm/template/app/render/startPage.js` | SCORM runtime | НЕ трогать (anti-goal: SCORM runtime) |
| `client/src/pages/author/tests.tsx` | Wizard поле | Удалить в S10 |
| `client/src/pages/learner/take-test.tsx` | Отображение | Заменить на content_pages в S2 (или оставить fallback) |
| `client/src/lib/i18n.ts` | Перевод поля | Удалить в S10 |
| `tests/storage.test.ts`, `tests/scorm-export.test.ts`, `tests/scorm-builders.test.ts`, `tests/routes.attempts-tests.test.ts` | Тестовые данные | Сохранить как regression до S10 |
| `client/src/features/tests/editor/sections/start-pages-section.tsx` | Skeleton (S0) | Реализовать в S8 |

**Вывод:** usage значительный (включая SCORM builder и learner UI).
SQL-миграция (S2) создаёт `content_pages` записи, write-path сохраняется на
переходный период. Полное удаление - только в S10 после regression S9.

---

## 5. TestsPage usages

Грep `import.*TestsPage|/tests\b` показал, что TestsPage импортируется только
в одном месте:

```text
client/src/App.tsx:16   import TestsPage from "@/pages/author/tests";
client/src/App.tsx:99   <Route path="/author/tests">
```

Дополнительный route для аналитики:

```text
client/src/App.tsx:115  <Route path="/author/tests/:testId/analytics">
```

**Вывод:** TestsPage интегрирован только через единственный route. В S4 при
подключении нового Drawer редактора достаточно изменить TestsPage без правок
других страниц или роутинга. Удаление inline wizard в S10 - локальная задача.

---

## 6. Инвентаризация `console.log` и debug-кода в `tests.tsx`

Найдено 16 строк `console.*` в `client/src/pages/author/tests.tsx`:

| Строка | Тип | Контекст |
| --- | --- | --- |
| 390-393 | log | "ОТКРЫТИЕ ТЕСТА ДЛЯ РЕДАКТИРОВАНИЯ" - debug edit mode |
| 423-424 | log | "sections загружены" - debug загрузки sections |
| 488-492 | log | Export SCORM debug (статус, тело ошибки) |
| 571 | error | "Failed to load difficulty distribution" - реальная ошибка |
| 745-748 | log | "ОТПРАВКА ТЕСТА" - debug submit payload |
| 1326 | error | "Failed to load adaptive settings" - реальная ошибка |
| 1871-1872 | log | "ОШИБКИ ВАЛИДАЦИИ" - debug validation errors |

**Категории:**

- **debug-логи (12 строк, удаляются в S10):** строки 390-393, 423-424, 488-492,
  745-748, 1871-1872.
- **error-логи (3 строки, могут остаться или замениться на logger):** 571, 1326.

---

## 7. Existing test coverage

### 7.1 Тесты, покрывающие POST/PUT `/api/tests`

| Файл | Что покрывает |
| --- | --- |
| `tests/routes.attempts-tests.test.ts` (38 тестов) | Создание попыток на тестах, частично покрывает создание тестов как fixture |
| `tests/scorm-export.test.ts` (18 тестов) | SCORM export после create test fixture |
| `tests/routes.design-settings.test.ts` | PUT design |
| `tests/routes.content-pages.test.ts` | content-pages CRUD на тестах |

### 7.2 Что НЕ покрыто regression-тестами

- POST `/api/tests` standard happy/sad path как отдельный test suite.
- PUT `/api/tests/:id` standard transaction (sections recreate).
- POST `/api/tests` adaptive с levels и links.
- PUT `/api/tests/:id` adaptive replace pattern (delete-recreate).
- DELETE `/api/tests/:id` cascade adaptive settings.
- Backward compat при отсутствующих полях.

**Регрессионные тесты для wizard написаны не будут до S2** (где появятся
storage/service abstractions). До тех пор regression-проверкой служит manual
end-to-end на golden сценариях из §8.

---

## 8. Manual regression scenarios (golden path до S10)

После каждой сессии S2-S9 разработчик прогоняет вручную:

1. **Standard create:** новый тест, 2 темы, drawCount=5 каждая, percent pass 70.
   Сохранить -> открыть -> поля совпадают -> SCORM export -> ZIP открывается.
2. **Standard edit:** изменить drawCount на 10, изменить overall pass на 80.
   Сохранить -> открыть -> поля совпадают -> SCORM export -> ZIP корректный.
3. **Adaptive create:** новый adaptive тест, 1 тема, 3 уровня сложности,
   passThreshold percent 60. Сохранить -> открыть -> уровни совпадают.
4. **Adaptive edit:** изменить minDifficulty одного уровня, добавить link.
   Сохранить -> открыть -> link присутствует.
5. **Switch standard <-> adaptive:** создать standard, переключить на adaptive,
   сохранить, переключить обратно.
6. **Delete:** удалить adaptive тест, проверить что adaptive_levels/links
   удалены.
7. **Design dialog:** открыть design, выбрать template, сохранить параметры.
8. **Content pages:** добавить intro page для темы, сохранить.
9. **Export SCORM:** для теста с design+content pages - ZIP содержит
   соответствующие assets.
10. **Legacy test:** открыть тест с `published=true` и `start_page_content != null`,
    убедиться что отображается без ошибок.

После S10: эти же сценарии должны проходить через новый Drawer редактора.

---

## 9. Скриншоты текущего UI

Не делались. Если потребуется - снять перед стартом S10 (последняя возможность
зафиксировать визуальное состояние до удаления wizard).

---

## 10. Closing checklist S0

- [x] decisions.md создан и зафиксирован.
- [x] Skeleton-каркас создан в `client/src/features/tests/editor/`.
- [x] Контракты с PRD-4 согласованы и зафиксированы (§1.2 todo).
- [x] Текущее поведение `POST/PUT /api/tests` зафиксировано (§1.1, §1.2 этого документа).
- [x] Текущее поведение dialogs зафиксировано (§2 этого документа).
- [x] Usages `tests.published` зафиксированы (§3 этого документа).
- [x] Usages `tests.start_page_content` зафиксированы (§4 этого документа).
- [x] Usages `TestsPage` зафиксированы (§5 этого документа).
- [x] Инвентаризация `console.log` в `tests.tsx` сделана (§6 этого документа).
- [x] Existing test coverage оценён (§7 этого документа).
- [x] Manual regression scenarios зафиксированы (§8 этого документа).

**S0 закрыта.** Можно стартовать S1 (Wireframes) или S2 (Backend).
