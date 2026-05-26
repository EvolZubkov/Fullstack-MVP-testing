# TODO: Реализация PRD-7 — активные tasks S9-S11

**Связанный PRD:** [PRD-7 S0-S8 closed](prd-7-s0-s8-closed.md) (архив) +
[PRD-7 S9-S11 in-progress](prd-7-s9-s11-in-progress.md) (активные фазы)
**Контракты и решения:** [decisions.md](prd-7-decisions.md) — читать ДО написания кода
**Baseline текущего поведения:** [prd-7-baseline.md](prd-7-baseline.md)
**Стратегия и промпты:** [execution-strategy.md](prd-7-execution-strategy.md)
**Roadmap:** [ROADMAP.md](ROADMAP.md) шаг 1
**Статус:** S0-S8 закрыты 2026-05-25; S9 active (component + API тесты, FR-20c);
S10-S11 не начаты.
**Последняя актуализация:** 2026-05-26
**Правило UI:** UI-разработка начинается только после подготовки и явного
согласования wireframes ([BRD §2.6](brd-scorm-enhancements.md), NFR-14,
NFR-19...NFR-21).

---

## 0. Перед началом любой задачи

### 0.1 Definition of Done (применяется к каждому пункту)

Чекбокс отмечается завершённым только если:

1. Код написан в указанном файле (см. §11 [decisions.md](prd-7-decisions.md)).
2. `npm run check` проходит без ошибок.
3. Затронутые тесты `vitest run <соответствующий файл>` зелёные.
4. Нет `console.log`, `debugger`, `TODO` в коммитуемом коде.
5. Все enum, JSON-shapes и default-значения соответствуют
   [decisions.md](prd-7-decisions.md).
6. Маппинг legacy-полей выполнен по §4 [decisions.md](prd-7-decisions.md).
7. **Для UI-задач: полное соответствие утверждённому эскизу** (см. §0.1a).

### 0.1a Wireframes-first для UI (HARD RULE)

**Запрещено реализовать UI без сверки с утверждённым эскизом.** Эскизы в
`docs/wireframes/approved/` — единственный источник истины для визуальных
решений (компоновка, DS-токены, состояния, meta-теги, severity-rail, row-menu
композиция, padding, gap, interactions).

PRD-1 / PRD-7 / PRD-8 фиксируют **бизнес-контракты и поведенческие правила**,
эскизы — **визуальные детали**. Реализация UI = код = контракт PRD И визуал
эскиза. Расхождение с любым из двух — блокирующий дефект.

**Definition of Done для UI-задач:**

| Критерий | Проверка |
| --- | --- |
| Все state'ы эскиза реализованы | пройдено по state-switcher'у в approved-эскизе, нет «забытых» states |
| Структура DOM соответствует эскизу | сравнение dev-tools render'а с эскизом |
| DS-токены применены 1:1 | нет hardcoded HEX/HSL/RGB; цвета только через `--ou-*` |
| Severity-rail работает по §4.3.7 PRD-1 | error > warning > info, нет border в норме |
| Row-menu по §4.3.3 PRD-1 | состав пунктов для info-row vs системных |
| Скриншот PR совпадает с эскизом | визуальное сравнение (Playwright + side-by-side) |

При выявленной необходимости отступить от эскиза — НЕ доделывать «на свой вкус»,
откатить локальные правки, доработать эскиз, пройти повторное согласование,
перенести в `docs/wireframes/approved/`, и только после этого продолжить.

### 0.2 Anti-goals

См. §1 [decisions.md](prd-7-decisions.md). Категорически:

- НЕ менять SCORM runtime, модель вопросов, аналитику, authentication.
- НЕ удалять `tests.published` и `tests.start_page_content` колонки.
- НЕ добавлять auto-save в `localStorage`.
- НЕ создавать modal confirmation для переключения режимов без удаления данных.

### 0.3 Если задача неясна

1. Перечитать соответствующий FR в исходном PRD-7 (источники через
   [prd-7-s0-s8-closed.md](prd-7-s0-s8-closed.md) §3).
2. Проверить контракт в [decisions.md](prd-7-decisions.md).
3. Если решение требует нового enum/shape — НЕ изобретать, а эскалировать на
   Opus с описанием гэпа в decisions.md.

---

## 1. Статус по сессиям

**S0-S8 закрыты 2026-05-25.** Полный архив с коммитами, артефактами и DoD —
см. [prd-7-s0-s8-closed.md](prd-7-s0-s8-closed.md).

| Сессия | Фаза | Состояние |
| --- | --- | --- |
| S0 | Контракты + skeleton | Закрыта |
| S1 | Wireframes 153/153 | Закрыта 2026-05-21 |
| S2 | Backend foundation + миграция 003 + service | Закрыта |
| S2+ | variant.kind contract + lifecycle + replace-variant | Закрыта 2026-05-22 |
| S3 | Mappers + validation (46 unit-тестов) | Закрыта |
| S4 | Drawer-каркас + reference-секция basic-settings | Закрыта 2026-05-25 (FR-20c → S9) |
| S5 | Секция topics-structure | Закрыта 2026-05-25 |
| S6 | Секция pass-rules | Закрыта 2026-05-25 |
| S7 | Секция adaptive-settings | Закрыта 2026-05-25 |
| S8 | Секции start-pages + design | Закрыта 2026-05-25 |
| S9 | Component + API тесты + FR-20c | **Active (следующая)** |
| S10 | Удаление legacy | Не начата |
| S11 | Acceptance pass | Не начата |

Регрессия на 2026-05-25: ~19 файлов × ~457 тестов, `npm run check` 0 ошибок.

---

## 2. Активные tasks

### 2.1 S9 — Component, API, regression тесты

Распределение по подсессиям:

- component-тесты + FR-20c — **S9 часть 1 / Фаза 6A (Haiku)**;
- API-тесты — **S9 часть 2 / Фаза 6B (Haiku)**;
- регрессия и совместимость — **S9 часть 2 / Фаза 6B (Haiku)**.

Reference: `__tests__/sections/basic-settings-section.test.tsx`,
`__tests__/test-editor.test.tsx`, `tests/routes.tests.test.ts`,
`tests/services/test-settings.test.ts`.

#### 2.1.1 Component (S9 часть 1 / Фаза 6A, Haiku)

- [ ] Create standard happy path в Drawer.
- [ ] Edit standard с existing sections.
- [ ] Create adaptive с загрузкой difficulty distribution.
- [ ] Edit adaptive с сохранёнными levels/links.
- [ ] Переключение standard/adaptive показывает inline warning без удаления данных.
- [ ] Переключение `flowMode` пересобирает структуру и сохраняет несовместимые
  элементы как скрытые.
- [ ] Возврат предыдущего режима восстанавливает скрытые настройки.
- [ ] Confirmation dialog при закрытии с несохранёнными изменениями.
- [ ] Confirmation dialog c блокирующими ошибками: "Сохранить" disabled.
- [ ] API error остаётся в редакторе.
- [ ] Optimistic conflict dialog "Обновить данные" / "Сохранить поверх".
- [ ] Удаление теста: confirmation с вводом точного названия.
- [ ] Архивные тесты скрыты из основного списка.
- [ ] Раздел "Архив" показывает архивные тесты и позволяет восстановить.
- [ ] Drawer открывается с данными за < 1.5 с на тесте с 20 темами (NFR-17).
- [ ] Валидация debounced 300 мс (NFR-18).
- [ ] Фокус переходит на первый интерактивный элемент при открытии (NFR-19).
- [ ] **FR-20c** — реализовать ссылки-якоря из сводки секции к проблемным полям,
  используя `field`-пути из `ValidationIssue` (единственный незакрытый пункт
  S4/4A; переносится в S9).

#### 2.1.2 API (S9 часть 2 / Фаза 6B, Haiku)

- [ ] `POST /api/tests` standard создаёт test + sections атомарно.
- [ ] `PUT /api/tests/:id` standard атомарно обновляет sections.
- [ ] `POST /api/tests` adaptive создаёт test + adaptive settings атомарно.
- [ ] `PUT /api/tests/:id` adaptive откатывает изменения при ошибке уровня/link.
- [ ] Validation errors возвращают field-level payload.
- [ ] Optimistic version check возвращает 409 Conflict при mismatch.
- [ ] `PATCH /api/tests/:id/status` корректно меняет статус.
- [ ] `DELETE /api/tests/:id` требует точное совпадение названия.
- [ ] `POST /api/tests/:id/restore` восстанавливает из архива.
- [ ] Список тестов по умолчанию не показывает `archived`.

#### 2.1.3 Регрессия и совместимость (S9 часть 2 / Фаза 6B, Haiku)

- [ ] Старые тесты с `published=true/false` корректно открываются и сохраняются
  через новый редактор.
- [ ] Старые тесты с непустым `start_page_content` корректно мигрируются в
  `intro` content page.
- [ ] Старые тесты без `designSettingsJson` используют default template.
- [ ] Старые тесты без adaptive settings продолжают работать как standard.
- [ ] SCORM export старых тестов после миграции данных проходит golden-тест.

### 2.2 S10 — Удаление legacy (Sonnet)

После стабилизации редактора и подтверждения, что все клиенты используют `status`:

- [ ] Удалить чтение `tests.published` из бизнес-логики (оставить только в
  обратном маппере).
- [ ] Удалить чтение `tests.start_page_content` из runtime/SCORM export.
- [ ] Удалить старый wizard и связанные dialogs из
  `client/src/pages/author/tests.tsx`.
- [ ] Удалить отдельные dialog state для design/content pages внутри `TestsPage`.
- [ ] Удалить debug `console.log` из старого wizard.
- [ ] Запланировать SQL-миграцию для удаления `tests.published` и
  `tests.start_page_content` (отдельный релиз).

### 2.3 S11 — Acceptance pass (Opus)

- [ ] Пройти все acceptance criteria PRD-7 §10 (всего ~50 пунктов; см.
  `prd-7-s0-s8-closed.md` для ссылок на код и тесты).
- [ ] Manual end-to-end: create/edit standard, create/edit adaptive, переключение
  режимов, удаление, архив, восстановление.
- [ ] Manual end-to-end: optimistic conflict при параллельной правке статуса.
- [ ] Manual end-to-end: SCORM export с feedback PDF assets.
- [ ] Lighthouse/axe accessibility audit Drawer.
- [ ] Зафиксировать результат в `docs/prd-7-acceptance-report.md`.

---

## 3. MVP-срез

Минимальный срез для end-to-end-проверки PRD-7. Закрытые пункты S0-S8 — см.
[prd-7-s0-s8-closed.md](prd-7-s0-s8-closed.md). Остались:

- [ ] (S10) Старый inline wizard удалён из `TestsPage`.
- [ ] (S9) Старые тесты без регрессии: `published`, `start_page_content`,
  отсутствие adaptive settings.

---

## 4. Зависимости и блокеры

### 4.1 Блокеры между оставшимися сессиями

| Чтобы стартовать | Должно быть готово |
| --- | --- |
| S9 (Тесты) | S5-S8 завершены — закрыто 2026-05-25 |
| S10 (Удаление legacy) | S9 зелёный (regression подтвердил отсутствие регрессий) |
| S11 (Acceptance + W.3C) | S10 завершена; полный набор UI работает в браузере |

### 4.2 Параллельные потоки

- **S9 часть 1 (component) + S9 часть 2 (API)** могут идти последовательно через
  `/model`-переключение в одной сессии (рекомендовано — амортизация
  cache-warming).
- **S11 + W.3C** при необходимости в одной сессии через `/model sonnet`.

### 4.3 Что разблокирует PRD-7

После завершения PRD-7 разблокированы:

- PRD-4: добавление вкладки/секции "Прохождение" и `flowMode` runtime без
  рефакторинга редактора.
- PRD-6: добавление блока "Повторное прохождение" в секцию редактора.
- PRD-8: вкладка "Структура" в режиме `router_by_topics` визуализируется по
  согласованным wireframes.
- PRD-2 / PRD-5: добавление вкладок "Показатели" и "Шкалы" без переписывания
  формы.
- PRD-3: административный реестр шаблонов получает консистентный UI выбора
  шаблона из секции "Оформление".
