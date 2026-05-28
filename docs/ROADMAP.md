# Roadmap реализации SCORM-расширений

**Версия:** 1.4
**Статус:** Утверждено
**Источник:** [BRD](./specs/brd-scorm-enhancements.md), PRD-1...PRD-9
**Последняя актуализация:** 2026-05-28 (PRD-7 переоткрыт как S12 — Design closeout; см. §0)

---

## 0. Текущий статус (на 2026-05-28)

| Шаг | PRD | Фаза | Статус | Блокер для старта следующей фазы |
| --- | --- | --- | --- | --- |
| 1 | PRD-7 | S0 — контракты, decisions, baseline | Закрыта | — |
| 1 | PRD-7 | S1 — wireframes 153/153 + согласование | Закрыта 2026-05-21 | — |
| 1 | PRD-7 | S2 — backend, миграции, API | Закрыта (миграции, TestSettingsService, endpoints; regression проверяется в S9) | — |
| 1 | PRD-7 | S3 — frontend mappers + validation | Закрыта (unit-тесты 46 шт.) | — |
| 1 | PRD-7 | S4-S8 — UI Drawer + секции | Закрыта (2026-05-25; FR-20c якорная навигация → S9) | — |
| 1 | PRD-7 | S9 — component + API тесты, regression | Закрыта 2026-05-27 (тесты + FR-20c; полный suite 1375 зелёных, `npm run check` 0 ошибок) | — |
| 1 | PRD-7 | S10 — удаление legacy UI | Закрыта 2026-05-27 (inline wizard удалён в S5-S8; `tests-list` монтирует `TestEditor`; `ContentPagesDialog` выведен; чтение `start_page_content` удалено из SCORM-export + runtime, контент играется как intro content-page миграции 003 §4.2; golden-guard добавлен) | — |
| 1 | PRD-7 | S11 — acceptance pass §10 | Закрыта частично 2026-05-27 — **переоткрыта 2026-05-28**: acceptance был выдан преждевременно, вкладка «Оформление» содержит заглушки (см. S12) | — |
| 1 | PRD-7 | S12 — Design tab closeout | **Open** (reopen 2026-05-28) — FR-30 предпросмотр шаблона, FR-31 группировка params по rail, FR-33 галерея, FR-31a все типы params, удаление orphan `DesignSettingsDialog`. См. [specs/prd-7/s12-design-closeout.md](./specs/prd-7/s12-design-closeout.md) | — |
| 2 | PRD-4 | Runtime `flowPolicy`, `section.*` | Не начата — **MVP** | Завершение PRD-7 S12 |
| 4 | PRD-8 | Router-flow runtime + UI «Структура» в router-режиме | Не начата — **MVP** | PRD-4, PRD-7 |
| 3 | PRD-6 | Retake gate, eligibility plugins | Не начата — post-MVP | PRD-4 |
| 5 | PRD-2 | `result.*` показатели результата | Не начата — post-MVP | PRD-4 |
| 6 | PRD-5 | Шкалы и многомерные измерения | Не начата — post-MVP | PRD-2, PRD-4 |
| 7 | PRD-3 | Жизненный цикл шаблонов | Не начата — post-MVP | PRD-1 closeout (отдельный трек) |
| 8 | PRD-9 | Миграция bcryptjs → `@vvlad1973/crypto` | Не начата — post-MVP (tech debt) | Завершение PRD-7 S10-S11 |
| — | PRD-1 | Шаблоны и контентные страницы | In Implementation (Backend 90%, Runtime 95%, Frontend ~85%) — **MVP** (closeout) | Редактор content-pages в «Структуре» реализован 2026-05-27 (add/edit/reorder/delete, см. [PRD-1 todo §4](./specs/prd-1/implementation-todo.md)); остаток closeout — manifest validation + ручной acceptance |

Детальный прогресс по PRD-7:

- Завершённые фазы S0-S8 — см. [specs/prd-7/s0-s8-closed.md](./specs/prd-7/s0-s8-closed.md).
- Фазы S9-S11 — см. [specs/prd-7/s9-s11-in-progress.md](./specs/prd-7/s9-s11-in-progress.md).
  S11 переоткрыта 2026-05-28: при формальной приёмке не были замечены заглушки
  во вкладке «Оформление».
- **Активная фаза S12 — Design closeout** — см. [specs/prd-7/s12-design-closeout.md](./specs/prd-7/s12-design-closeout.md).

Детальный прогресс по PRD-1 — см. [specs/prd-1/implementation-todo.md](./specs/prd-1/implementation-todo.md).

---

## 0.1 MVP-срез: Storyline-MVP (критический путь)

**Граница MVP зафиксирована 2026-05-27.** Цель — максимально быстро довести продукт до
shippable-состояния с главной бизнес-ценностью BRD (Storyline-подобный сценарий через
страницу-маршрутизатор), отложив тяжёлые и несрочные тректы в post-MVP (§0.2).

**В MVP входят:**

- **PRD-7** — единый редактор: закрытие S10 (удаление legacy), S11 (acceptance) и **S12
  (Design closeout, reopen 2026-05-28)** — FR-30/31/31a/33 во вкладке «Оформление».
- **PRD-1 closeout** — редактор content-pages в «Структуре» (см. [PRD-1 todo §4](./specs/prd-1/implementation-todo.md)).
- **PRD-4** — гибкий поток и разделы (`flowPolicy`, `section.*`, `sort_order`).
- **PRD-8** — сценарий через страницу-маршрутизатор (Storyline-сценарий).

**Критический путь MVP (порядок исполнения):**

| # | Шаг | Зона | Зависит от | Статус |
| --- | --- | --- | --- | --- |
| 1 | PRD-7 S10 (удаление legacy) **совмещённо с** closeout PRD-1 шаг 1 | frontend `tests.tsx` + секция «Структура» | S9 (закрыта) | **Выполнен 2026-05-27** |
| 2 | PRD-7 S11 — acceptance pass §10 | acceptance | шаг 1 | Закрыта частично 2026-05-27 — **переоткрыта 2026-05-28** под S12 |
| 2a | **PRD-7 S12 — Design closeout** (FR-30/31/31a/33, удаление orphan `DesignSettingsDialog`) | frontend `design-section.tsx` + manifest schema | S11 (формально), wireframe `prd7-design-tab.html` (согласован 2026-05-21) | **Open** — см. [specs/prd-7/s12-design-closeout.md](./specs/prd-7/s12-design-closeout.md) |
| 3 | PRD-1 closeout — остаток (manifest validation, приёмка), отметить PRD-1 closed | backend + docs | шаг 2a | Ожидает |
| 4 | PRD-4 — runtime потока + flow-настройки в редакторе («Сценарий») | backend + frontend | PRD-7 закрыт | Не начата |
| 5 | PRD-8 — router-runtime + вкладка «Структура» в router-режиме | backend + frontend | PRD-4, PRD-1 | Не начата |

После шага 5 — **Storyline-MVP shippable.**

**Ускоритель:** шаги 1 и 3 (PRD-7 S10 + closeout PRD-1) делаются в одной сессии/зоне —
экономит двойной проход по `tests.tsx` и вкладке «Структура».

## 0.2 Post-MVP backlog

Включается после Storyline-MVP, в порядке ценности/зависимостей:

| Приоритет | PRD | Что даёт | Зависит от |
| --- | --- | --- | --- |
| 1 | PRD-6 | Retake gate / cooldown (compliance для корпоративных курсов) | PRD-4 |
| 2 | PRD-2 | Показатели результата `result.*` | PRD-4 |
| 3 | PRD-5 | Шкалы и компетенции `scale.*` | PRD-2, PRD-4 |
| 4 | PRD-3 | Реестр и жизненный цикл внешних шаблонов | PRD-1 |
| — | PRD-9 | Миграция bcrypt → `@vvlad1973/crypto` (tech debt, изолирован) | — |

Отложенные точечные пункты: `showSectionResult` (промежуточные результаты по темам),
предпросмотр шаблона и text-overflow diagnostics в PRD-1, порог coverage 50%, раздел
«Архив» с восстановлением в списке тестов.

---

## 1. Контекст

Документ фиксирует порядок реализации PRD-1...PRD-8. Порядок отличается от приоритизации
этапов, перечисленной в [BRD §7](./specs/brd-scorm-enhancements.md), потому что учитывает фактические
зависимости контрактов, риск двойного рефакторинга UI и стоимость переделок при добавлении
новых настроек теста.

PRD-1 уже частично реализован (см. [specs/prd-1/implementation-todo.md](./specs/prd-1/implementation-todo.md))
и считается фундаментом для остальных PRD.

---

## 2. Порядок реализации

> Таблица ниже документирует **зависимости и обоснование** порядка PRD. Фактический
> порядок **исполнения** — MVP-first (см. §0.1): PRD-7 → closeout PRD-1 → PRD-4 → PRD-8,
> затем post-MVP PRD-6 → PRD-2 → PRD-5 → PRD-3. То есть для MVP PRD-8 поднят выше PRD-6.

| Шаг | PRD | Этап BRD | Основная причина выбранного порядка |
| --- | --- | --- | --- |
| 1 | PRD-7 Рефакторинг редактора параметров теста: [S0-S8 closed](./specs/prd-7/s0-s8-closed.md), [S9-S11 in progress](./specs/prd-7/s9-s11-in-progress.md) | Этап 9 | Контракт `TestEditorModel`, DTO, `passDecisionPolicy` и `flowMode` нужны как поверхность для всех последующих PRD. Если сначала добавлять flow/retake/scales в текущий god-component `TestsPage`, потребуется повторный переписать UI. |
| 2 | [PRD-4](./specs/prd-4/course-flow-sections.md) Гибкий поток прохождения и разделы | Этап 4 | Базовый runtime: `flowPolicy`, расчёт `section.*`, граница «внутреннего старта попытки», `sort_order` для `test_sections`. Без него PRD-6, PRD-8 и часть формул PRD-2/PRD-5 нечем питать. |
| 3 | [PRD-6](./specs/prd-6/retake-cooldown-gate.md) Ограничение повторного прохождения и retake gate | Этап 5 | Использует только границу старта попытки из PRD-4 и системную страницу из PRD-1. Лёгкая интеграция, даёт compliance-ценность для корпоративных курсов. |
| 4 | [PRD-8](./specs/prd-8/section-router-flow.md) Сценарий через страницу-маршрутизатор | Этап 4 расширение | Зависит от PRD-4 (`flowPolicy`, section results, completion policy), PRD-7 (вкладка «Структура» в новом редакторе) и PRD-1 (системная router-страница). Закрывает Storyline-сценарий полностью. |
| 5 | [PRD-2](./specs/prd-2/result-variables.md) Пользовательские показатели результата | Этап 6 часть | Депендит на runtime PRD-1, реальную пользу даёт после PRD-4: формулы могут ссылаться на `section.*`. Нужен как фундамент для PRD-5 (`result.*` использует `scale.*`). |
| 6 | [PRD-5](./specs/prd-5/scales-competency-measurements.md) Шкалы, компетенции и многомерные измерения | Этап 6 | Явно депендит на PRD-2 и PRD-4. Самая тяжёлая авторская UI (матрица вкладов на каждый вопрос); делается после стабилизации редактора и flow. |
| 7 | [PRD-3](./specs/prd-3/external-templates.md) Администрирование жизненного цикла шаблонов | Этап 7 | Не блокирует runtime-возможности. Включается, когда команда готова открывать платформу подрядчикам или партнёрам. |
| 8 | [PRD-9](./specs/prd-9/crypto-password-hashing.md) Миграция bcryptjs → `@vvlad1973/crypto` | Tech debt | Снижение количества криптографических SDK, упрощение audit security и build externals. Не блокирует runtime функциональности, может выполняться параллельно с PRD-3 после стабилизации PRD-7. |

---

## 3. Связки контрактов

### 3.1 PRD-7 и PRD-4

Доменная модель `TestEditorModel` из PRD-7 уже описывает `flowMode`, `passDecisionPolicy`,
`sections[].required` — это поверхность PRD-4. Доменные контракты обоих PRD проектируются одной
итерацией, даже если PRD-7 уходит в реализацию первым. Иначе при выкатке PRD-4 модель редактора
придётся менять повторно.

### 3.2 PRD-4 и PRD-1

PRD-4 §8.2 содержит скрытое требование к PRD-1: `test_sections.sort_order` нужно выкатить
раньше, чем UI PRD-1 для перестановки тем станет рабочим. Колонка `sort_order` входит в скоуп
PRD-4, но её добавление и заполнение должны быть выполнены до соответствующего UI PRD-1.

### 3.3 PRD-6 и PRD-4

PRD-6 опирается на `start_course_button` и отложенный SCORM `Initialize` из PRD-4 §4.1.1. До
выпуска PRD-4 retake gate можно реализовывать только в режиме flag-only без реального
gate-runtime.

### 3.4 PRD-2, PRD-4, PRD-5

PRD-2 публикует `result.*`. PRD-5 публикует `scale.*` до `result:calculated` и используется
формулами `result_variables`. PRD-4 публикует `section.*`. Все три пространства имён должны быть
согласованы до начала PRD-2, чтобы избежать миграции формул при выкатке PRD-5.

### 3.5 PRD-9 (изолирован)

PRD-9 затрагивает только authentication path (`server/storage.ts`, `script/create-admin.ts`) и
не пересекается с runtime/контрактами других PRD. БД-миграция не требуется (колонка
`passwordHash` имеет тип `text`, формат хеша вмещает оба варианта). Поддержка legacy bcrypt-хешей
обеспечивается lazy rehash при логине.

---

## 4. Возможные параллельные ветки

| Ветка | Условия |
| --- | --- |
| PRD-3 параллельно с PRD-4...PRD-6 | PRD-3 имеет собственную таблицу `templates`, собственный admin API и не пересекается с runtime потока. Может вестись отдельной парой разработчиков. |
| PRD-6 параллельно с PRD-8 | После завершения PRD-4 две ветки независимы: PRD-6 трогает bootstrap и плагин допуска, PRD-8 трогает router-layout и completion policy. Конфликт возможен только в системных страницах PRD-1. |
| PRD-9 параллельно с PRD-3...PRD-8 | PRD-9 изолирован в authentication path. Может выполняться в любое время после стабилизации PRD-7 S9. |

---

## 5. Перестановки порядка

| Сценарий | Изменение |
| --- | --- |
| Бизнес-приоритет — Storyline-router сценарий | Поменять местами PRD-6 и PRD-8 (router раньше cooldown). |
| Бизнес-приоритет — компетентностная оценка | Поменять местами PRD-6 и PRD-2 (показатели и шкалы раньше cooldown), PRD-8 уйдёт в конец. |
| Появляется внешний партнёр-разработчик шаблонов | PRD-3 поднимается в любой момент после PRD-1, минимум — на 3 шаг. |

PRD-7 как первый шаг и PRD-4 как второй шаг не двигаются, потому что от них зависит почти всё
остальное.

---

## 6. Точки контроля

Перед стартом каждого шага должны быть выполнены:

- wireframes согласованы (см. [BRD §2.6](./specs/brd-scorm-enhancements.md));
- доменные контракты соседних PRD зафиксированы;
- backward compatibility со старыми тестами проверена golden/smoke-тестами;
- регрессионный набор тестов покрывает поведение предыдущих шагов.
