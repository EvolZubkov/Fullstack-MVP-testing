# Roadmap реализации SCORM-расширений

**Версия:** 1.2
**Статус:** Утверждено
**Источник:** [BRD](./specs/brd-scorm-enhancements.md), PRD-1...PRD-9
**Последняя актуализация:** 2026-05-27

---

## 0. Текущий статус (на 2026-05-27)

| Шаг | PRD | Фаза | Статус | Блокер для старта следующей фазы |
| --- | --- | --- | --- | --- |
| 1 | PRD-7 | S0 — контракты, decisions, baseline | Закрыта | — |
| 1 | PRD-7 | S1 — wireframes 153/153 + согласование | Закрыта 2026-05-21 | — |
| 1 | PRD-7 | S2 — backend, миграции, API | Закрыта (миграции, TestSettingsService, endpoints; regression проверяется в S9) | — |
| 1 | PRD-7 | S3 — frontend mappers + validation | Закрыта (unit-тесты 46 шт.) | — |
| 1 | PRD-7 | S4-S8 — UI Drawer + секции | Закрыта (2026-05-25; FR-20c якорная навигация → S9) | — |
| 1 | PRD-7 | S9 — component + API тесты, regression | Закрыта 2026-05-27 (тесты + FR-20c; полный suite 1375 зелёных, `npm run check` 0 ошибок) | — |
| 1 | PRD-7 | S10 — удаление legacy UI | **Активна (следующая)** | — |
| 1 | PRD-7 | S11 — acceptance pass §10 | Ожидает | S10 |
| 2 | PRD-4 | Runtime `flowPolicy`, `section.*` | Не начата | Завершение PRD-7 S9-S11 |
| 3 | PRD-6 | Retake gate, eligibility plugins | Не начата | PRD-4 |
| 4 | PRD-8 | Router-flow runtime + UI «Структура» в router-режиме | Не начата | PRD-4, PRD-7 |
| 5 | PRD-2 | `result.*` показатели результата | Не начата | PRD-4 |
| 6 | PRD-5 | Шкалы и многомерные измерения | Не начата | PRD-2, PRD-4 |
| 7 | PRD-3 | Жизненный цикл шаблонов | Не начата | PRD-1 closeout (отдельный трек) |
| 8 | PRD-9 | Миграция bcryptjs → `@vvlad1973/crypto` | Не начата (backlog, low priority, tech debt) | Завершение PRD-7 S9-S11 |
| — | PRD-1 | Шаблоны и контентные страницы | In Implementation (Backend 90%, Runtime 95%, Frontend 65%) | Code-walk + closeout вне PRD-7; редактор content-pages в «Структуре» — closeout-фаза, см. [PRD-1 todo §4](./specs/prd-1/implementation-todo.md) |

Детальный прогресс по PRD-7:

- Завершённые фазы S0-S8 — см. [specs/prd-7/s0-s8-closed.md](./specs/prd-7/s0-s8-closed.md).
- Активные фазы S9-S11 — см. [specs/prd-7/s9-s11-in-progress.md](./specs/prd-7/s9-s11-in-progress.md).

Детальный прогресс по PRD-1 — см. [specs/prd-1/implementation-todo.md](./specs/prd-1/implementation-todo.md).

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
