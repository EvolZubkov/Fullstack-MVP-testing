# Roadmap реализации SCORM-расширений

**Версия:** 1.6
**Статус:** Утверждено
**Источник:** [BRD](./specs/brd-scorm-enhancements.md), PRD-1...PRD-12
**Последняя актуализация:** 2026-06-08 (Трек PRD-13 «Ролевая модель доступа» — отдельный BRD
[brd-access-control.md](./specs/brd-access-control.md) — ЗАКРЫТ ПОЛНОСТЬЮ: 5 ролей,
мультироль (объединение прав), владелец и гранты тестов, конфиг-суперадмин из `SUPERADMIN_EMAILS`.
Фазы 0-5 готовы: `shared/access`, БД + миграция 016, серверное ядро (`requirePermission` + scope),
клиент (мультироль-редактор, панель «Общий доступ», колонка «Владелец» + гейтинг действий),
приёмка [acceptance-matrix.md](./specs/access-control/acceptance-matrix.md), выкладка
[RUNBOOK_prd13_rbac.md](./RUNBOOK_prd13_rbac.md). Финальный T-10 выполнен 2026-06-08: миграция
`017` удалила столбец `users.role`, снят legacy-fallback, удалены мёртвые `requireAuthor`/
`requireLearner`; роли — только из `user_roles` + конфиг-суперадмин. Ранее 2026-06-07: PRD-3
«Жизненный цикл шаблонов» ЗАКРЫТ — админ-реестр
внешних ZIP реализован тремя фазами: backend+схема+валидатор+admin API, браузерный движок
проверки работоспособности + серверный гейт, видимый UI `/author/templates`. Ранее
2026-06-06: PRD-12 «Единый шаблонный рантайм рендера» — рендер-
унификация всех ученических экранов (старт/контент/вопрос станд.+адапт./итоги станд.+адапт./
блок/post-results/transition) на общих layouts через `renderScreenInto` + CSS-унификация
(один компонентный источник `theme.css`+`base.css` на оба хоста) ЗАКРЫТЫ; серверный расчёт
`@shared` (PRD-10/5/2) + retake-гейт (PRD-6) закрыты ранее; открыт только опц. ренейм namespace
`test/page` (Вариант 2 — не делаем). Ранее: 2026-06-04 PRD-10 «Цена ответа» + PRD-11 «Квоты
выдачи по тегам» ЗАКРЫТЫ — оба RTK-трека реализованы end-to-end и запушены; 2026-05-29 post-MVP
переприоритизирован, PRD-2 + PRD-5 подняты в верх §0.2 как парный трек по бизнес-запросу
«шкалы + LMS-передача без постобработки», PRD-4 + PRD-8 закрыты — Storyline-MVP shippable;
2026-06-03 PRD-2 + PRD-5 закрыты, открыт трек PRD-10 + PRD-11; 2026-06-05 заведён план
PRD-12 «Единый шаблонный рантайм рендера» (охват L2) — поглощает платформенную часть
PRD-3, который сужен до админ-реестра внешних ZIP)

---

## 0. Текущий статус (на 2026-06-06)

| Шаг | PRD | Фаза | Статус | Блокер для старта следующей фазы |
| --- | --- | --- | --- | --- |
| 1 | PRD-7 | S0 — контракты, decisions, baseline | Закрыта | — |
| 1 | PRD-7 | S1 — wireframes 153/153 + согласование | Закрыта 2026-05-21 | — |
| 1 | PRD-7 | S2 — backend, миграции, API | Закрыта (миграции, TestSettingsService, endpoints; regression проверяется в S9) | — |
| 1 | PRD-7 | S3 — frontend mappers + validation | Закрыта (unit-тесты 46 шт.) | — |
| 1 | PRD-7 | S4-S8 — UI Drawer + секции | Закрыта (2026-05-25; FR-20c якорная навигация → S9) | — |
| 1 | PRD-7 | S9 — component + API тесты, regression | Закрыта 2026-05-27 (тесты + FR-20c; полный suite 1375 зелёных, `npm run check` 0 ошибок) | — |
| 1 | PRD-7 | S10 — удаление legacy UI | Закрыта 2026-05-27 (inline wizard удалён в S5-S8; `tests-list` монтирует `TestEditor`; `ContentPagesDialog` выведен; чтение `start_page_content` удалено из SCORM-export + runtime, контент играется как intro content-page миграции 003 §4.2; golden-guard добавлен) | — |
| 1 | PRD-7 | S11 — acceptance pass §10 | **Закрыта 2026-05-28** — финальный acceptance выполнен после закрытия S12 + S13; кодовый closeout подтверждён: `npm run check` 0 ошибок, `vitest run` 1373/1373 зелёные. Live-browser acceptance (Playwright + axe) выполняется отдельно от кодового closeout. | — |
| 1 | PRD-7 | S12 — Design tab closeout | **Закрыта 2026-05-28** — G1 sub-rail params + G2 iframe preview + G3 gallery + G4 все param-типы (image/asset/file/downloadLink/url/multiselect/number) + G5 orphan dialog + G6 incompatible-banner. Контракты — [test-editor-contracts.md](./architecture/test-editor-contracts.md) | — |
| 1 | PRD-7 | S13 — Editor parity | **Закрыта 2026-05-28** — все 8 sub-фаз закрыты (S13.1 quick wins / S13.2 feedback / S13.3 per-topic limits / S13.4 row-actions / S13.5 router-mode / S13.6 variant-replace / S13.7 drawer chrome / S13.8 cleanup+acceptance). Deferred: S13.5b (G22 mapping-flow cross-tab coupling) + S13.8b (G12 wf-basic-warning UX notification). | — |
| 2 | PRD-4 | Runtime `flowPolicy`, `section.*` | **Закрыта 2026-05-29** — все 6 фаз (1: validation L2/L3, 2: mapper L4, 3: UI L1, 4a: export, 4b: section results, 4c: router runtime + completionPolicy + unlockRules, 4d: adaptive integration linear+router, 4e: per-section timers, 4f: recovery, 5: golden tests). Все 5 валидных `(mode×flowMode)` комбинаций имеют runtime support; `(adaptive, linear_flat)` blocked в Phase 1, deferred в будущий PRD «Flat adaptive». См. [PRD-4 spec v1.1](./specs/prd-4/course-flow-sections.md). | — |
| 4 | PRD-8 | Router-flow runtime + UI «Структура» в router-режиме | **Закрыта 2026-05-29** — реализована cross-PRD: UI (Структура + Настройки→Сценарий) в PRD-7 G45/router-by-topics; runtime (router state machine, completionPolicy, sectionUnlockRules, recovery) в PRD-4 phases 4c/4f; PRD-8-specific delta — FR-18 router lifecycle events. См. [PRD-8 spec](./specs/prd-8/section-router-flow.md). | — |
| 5 | PRD-2 | `result.*` показатели результата | **Закрыта 2026-06-03** — Этапы A-C (DSL+`controls_status`, CRUD+вкладка «Показатели», рантайм `result.*`, golden MBI). См. [PRD-2 spec](./specs/prd-2/result-variables.md). | PRD-4 |
| 6 | PRD-5 | Шкалы и многомерные измерения | **Закрыта 2026-06-03** — Этапы A-C (схема+движок+API, рантайм `scale.*`+экспорт, вкладка «Шкалы»+матрица «Вклады», golden MBI). Отложено: гард опций, композитные шкалы, глобальная библиотека шкал (будущий PRD). См. [PRD-5 spec](./specs/prd-5/scales-competency-measurements.md). | PRD-2 (DSL), PRD-4 |
| 3 | PRD-6 | Retake gate, eligibility plugins | **Phase 1 закрыта 2026-06-04** — ядро (схема `retakePolicy`, eligibility-движок/плагины/реестр с TS↔JS-парити), рантайм-гейт до SCORM `Initialize` (NFR-01/02), блок-экран из системной страницы шаблона `system.blocked`, боевой источник `webtutor_cooldown` через ClientBridge `get_metadata` (вскрыт на живом портале RT), авторский пейн «Повторное прохождение». Отложено в Phase 2: администрируемый реестр конфигов, UI-выбор конфигурации, диагностика плагина. См. [PRD-6 spec](./specs/prd-6/retake-cooldown-gate.md). | PRD-4 |
| 7 | PRD-3 | Жизненный цикл шаблонов (СУЖЕН 2026-06-05: только админ-реестр внешних ZIP; платформенная часть → PRD-12) | **Закрыта 2026-06-07** — Фаза 1 (схема +6 колонок + миграция 011, ZIP-сервис с zip-slip guard, структурный валидатор, admin API `/api/admin/templates`, реестр), Фаза 2 (браузерный движок проверки работоспособности `shared/template/smoke-runner` поверх общего рендерера PRD-12 + серверный гейт активации NFR-01, эндпоинты `smoke-bundle`/`preview-image`), Фаза 3 (UI `/author/templates`: список, загрузка, предпросмотр+проверка, жизненный цикл). tsc 0, vitest 2093, Playwright-сверка с эскизом. См. [PRD-3 spec v2.1](./specs/prd-3/external-templates.md). | PRD-1 closeout; PRD-12 |
| 9 | PRD-12 | Единый шаблонный рантайм рендера (L2): один DSL-рендерер + публичный контекст для SCORM и веб; серверный расчёт `@shared`; поглощает платформу PRD-3 | **Закрыта 2026-06-06** — Фаза 0 (DSL-движок + публичный контекст + `renderScreenInto`), Фаза 2 (серверный расчёт `@shared`: PRD-10/5/2 + retake-гейт PRD-6), Фаза 1 (все ученические экраны SCORM на общих layouts) и веб-хост (React-обёртка + Shadow DOM) закрыты; единый DnD-движок (`shared/template/dnd`) + CSS-унификация (один компонентный источник на оба хоста). Открыт только опц. буквальный ренейм namespace `test/page` (Вариант 2 — не делаем). См. [PRD-12 spec](./specs/prd-12/web-runtime-parity.md). | PRD-2/4/5/6/10/11; spec-template-platform |
| 8 | PRD-9 | Миграция bcryptjs → `@vvlad1973/crypto` | Не начата — post-MVP (tech debt) | Завершение PRD-7 S10-S11 |
| — | PRD-1 | Шаблоны и контентные страницы | **Закрыта 2026-05-28** — Backend 100% / Runtime 100% / Frontend 100% (MVP-scope). Закрытие PRD-1 произошло одновременно с PRD-7: остаточные task'и (предпросмотр, галерея, all-param-types, manifest validation, `kind` во встроенных шаблонах) переехали в PRD-7 S12 G2/G3/G4/G6/G48. См. [PRD-1 spec](./specs/prd-1/templates-content-pages.md). | Deferred post-MVP: text-overflow preview/diagnostics в content-pages (§1.10) — substantial, не блокирует MVP. |

**PRD-7 полностью закрыт 2026-05-28**: единый редактор тестов (фазы S0-S13).
Текущая модель и контракты редактора — в
[architecture/test-settings-parameter-structure.md](./architecture/test-settings-parameter-structure.md)
и [architecture/test-editor-contracts.md](./architecture/test-editor-contracts.md).
История реализации фаз — в git. Deferred (не блокируют MVP): S13.5b (G22
mapping-flow при смене design template) и S13.8b (G12 wf-basic-warning UX-notification).

---

## 0.1 MVP-срез: Storyline-MVP (критический путь)

**Граница MVP зафиксирована 2026-05-27.** Цель — максимально быстро довести продукт до
shippable-состояния с главной бизнес-ценностью BRD (Storyline-подобный сценарий через
страницу-маршрутизатор), отложив тяжёлые и несрочные тректы в post-MVP (§0.2).

**В MVP входят:**

- **PRD-7** — единый редактор: закрытие S10 (удаление legacy), S11 (acceptance) и
  две новые фазы **S12 (Design closeout)** + **S13 (Editor parity)** — открыты 2026-05-28
  по результатам аудита соответствия wireframes.
- **PRD-1 closeout** — редактор content-pages в «Структуре» (см. [PRD-1 spec](./specs/prd-1/templates-content-pages.md)).
- **PRD-4** — гибкий поток и разделы (`flowPolicy`, `section.*`, `sort_order`).
- **PRD-8** — сценарий через страницу-маршрутизатор (Storyline-сценарий).

**Критический путь MVP (порядок исполнения):**

| # | Шаг | Зона | Зависит от | Статус |
| --- | --- | --- | --- | --- |
| 1 | PRD-7 S10 (удаление legacy) **совмещённо с** closeout PRD-1 шаг 1 | frontend `tests.tsx` + секция «Структура» | S9 (закрыта) | **Выполнен 2026-05-27** |
| 2 | PRD-7 S11 — acceptance pass §10 | acceptance | шаг 1 | **Закрыта 2026-05-28** после успешного closeout S12 + S13 |
| 2a | **PRD-7 S12 — Design closeout** (FR-30/31/31a/33, удаление orphan `DesignSettingsDialog`) | frontend `design-section.tsx` + manifest schema | S11 (формально), wireframe `prd7-design-tab.html` (согласован 2026-05-21) | **Закрыта 2026-05-28** |
| 2b | **PRD-7 S13 — Editor parity** (8 sub-фаз: quick wins, feedback, per-topic limits, row-actions, router-mode, variant-replace, drawer chrome, cleanup) | frontend test-editor.tsx, basic-settings-section.tsx, start-pages-section.tsx, tests-list.tsx, feedback-editor-modal.tsx | wireframes согласованы 2026-05-21 | **Закрыта 2026-05-28** |
| 3 | PRD-1 closeout — остаток (manifest validation, приёмка), отметить PRD-1 closed | backend + docs | шаги 2a + 2b | Ожидает |
| 4 | PRD-4 — runtime потока + flow-настройки в редакторе («Сценарий») | backend + frontend | PRD-7 закрыт (S12 + S13) | **Закрыта 2026-05-29** — см. [PRD-4 spec v1.1](./specs/prd-4/course-flow-sections.md) |
| 5 | PRD-8 — router-runtime + вкладка «Структура» в router-режиме | backend + frontend | PRD-4, PRD-1 | **Закрыта 2026-05-29** — cross-PRD реализация |

После шага 5 — **Storyline-MVP shippable.**

**STORYLINE-MVP SHIPPABLE 2026-05-29** — все 5 шагов критического пути
закрыты. Сводка коммитов — в git-истории. Live-browser acceptance
(Playwright + axe + LMS smoke) — отдельный gate, не блокирует кодовый closeout.

**Ускоритель:** шаги 1 и 3 (PRD-7 S10 + closeout PRD-1) делались в одной
сессии/зоне — экономил двойной проход по `tests.tsx` и вкладке «Структура».

## 0.2 Post-MVP backlog

**Переприоритизирован 2026-05-29:** по бизнес-запросу пользователя пара PRD-2 +
PRD-5 поднята в верх — целевой сценарий «шкалы и итоговая категория передаются в
LMS без ручной постобработки Excel-выгрузки» (см. внешний `report_build`
postprocessor, который должен быть заменён SCORM-пакетом). PRD-2 и PRD-5 ведутся
**парным треком**, потому что DSL `result_variables` (PRD-2) обязан содержать
источники `scaleById(...)` и `countScales(...)` до момента сдачи PRD-5; иначе
формулы итоговых категорий невозможно реализовать без выкатки миграции (см. §3.4
и [example-mbi.md](./specs/prd-5/example-mbi.md)).

Включается после Storyline-MVP, в порядке ценности/зависимостей:

| Приоритет | PRD | Что даёт | Зависит от |
| --- | --- | --- | --- |
| 1 | **PRD-2 + PRD-5 (парный трек)** — ЗАКРЫТ 2026-06-03 | `result.*` показатели + `scale.*` шкалы + передача итогов в LMS через pseudo-interactions; закрывает бизнес-запрос «без постобработки» | PRD-4 |
| 2 | **[PRD-10 (Цена ответа)](./specs/prd-10/graded-answer-scoring.md)** — ЗАКРЫТ 2026-06-04 | Градуированный балл: веса опций (`single`) + ступенчатая таблица «условие→балл» (`multiple`/`matching`/`ranking`); `Σ s` на теме/тесте, порог на `Σ s`, сертификация. Интернализует 2-й внешний постпроцессор (РТК), golden против `key_NEW`. Стадии 0-6. Отложено (не-ядро): preview-модалка балла, `scoreRatio`/«Частично правильно» в CMI (FR-12), градуированный серверный `check-answer.ts` | BR-09; перед релизом РТК |
| 3 | **[PRD-11 (Квоты выдачи по тегам)](./specs/prd-11/tag-draw-quotas.md)** — ЗАКРЫТ 2026-06-04 | Опц. квота выдачи `[тег→N×режим]` на тему (стратификация по подтемам, режим `exact`/`min` на тег); тегирование вопросов (chip-инпут) как пререквизит; верифицировано в рантайм-плеере. Доставка, ортогональна скорингу | BR-10; перед релизом РТК |
| 4 | PRD-6 | Retake gate / cooldown (compliance для корпоративных курсов) | PRD-4 |
| — | **[PRD-12 (Единый шаблонный рантайм рендера)](./specs/prd-12/web-runtime-parity.md)** — ЗАКРЫТ 2026-06-06, охват L2 | Один DSL-рендерер + публичный контекст для SCORM и веб; серверный расчёт `@shared`; убрал хардкод-рендер в обеих средах + единый DnD-движок + единый CSS-источник; поглощает платформенную часть PRD-3 | PRD-2/4/5/6/10/11; spec-template-platform |
| 5 | PRD-3 (сужен) | ТОЛЬКО админ-реестр и жизненный цикл ВНЕШНИХ шаблонных ZIP; платформа (DSL, registry, layout-контракты) перенесена в PRD-12 | PRD-1, PRD-12 |
| 6 | **PRD-N (Flat adaptive)** | Адаптивная выдача из общего pool без секционных границ — комбинация `(mode=adaptive, flowMode=linear_flat)`, отложена из PRD-4 v1.1 | PRD-4 |
| — | PRD-9 | Миграция bcrypt → `@vvlad1973/crypto` (tech debt, изолирован) | — |

Нормативная сквозная модель расчёта — [scoring-model.md](./specs/scoring-model.md).

Парный трек PRD-2 + PRD-5 — внутренний порядок:

| Этап | Состав | Обоснование |
| --- | --- | --- |
| Этап A | Расширение DSL PRD-2: `scaleById(...)`, `countScales(...)`, поле `controls_status`; миграция `result_variables` | DSL должен знать `scale.*` до того, как Core начнёт публиковать значения шкал |
| Этап B | Реализация PRD-5: таблицы `scales` + `question_measurements`, runtime расчёта, авторская UI «Шкалы» и блок «Измерения» в карточке вопроса | Опирается на готовый DSL этапа A |
| Этап C | E2E acceptance по [example-mbi.md](./specs/prd-5/example-mbi.md); golden-тест замены `process_burnout_export.py` | Подтверждает закрытие бизнес-запроса |

**Все три этапа выполнены 2026-06-03** (коммиты `a6e3e32`…`ce7467e` A, `29282ab`…`a9bbc9a` B,
golden `tests/mbi-golden.test.ts` C). Шкалы test-scoped; **глобальная библиотека шкал** —
будущий PRD. Композитные шкалы (источник «Другие шкалы») и гард переупорядочивания опций
с измерениями — отложенные точечные пункты.

**Трек «Цена ответа» (PRD-10) + «Квоты выдачи» (PRD-11) — ЗАКРЫТ 2026-06-04.** Нормативная модель —
[scoring-model.md](./specs/scoring-model.md) §11 (v1.9: «Цена ответа» — веса опций / ступенчатая таблица);
спеки — [PRD-10](./specs/prd-10/graded-answer-scoring.md) (балл за ответ, Стадии 0-6) и
[PRD-11](./specs/prd-11/tag-draw-quotas.md) (квоты выдачи + тегирование вопросов). Драйвер — РТК-сертификация.
**PRD-10:** градуированный балл реализован end-to-end (UI редактора «Цены ответа» → экспорт `scoring` →
рантайм `Σ s` → порог раздела на `Σ s` → сертификация), подтверждено golden против эталона РТК
(`key_NEW_15-08-25.xlsx` + pandas, 63/63 балла, 0 расхождений). **PRD-11:** стратифицированная выдача
(модель `strata:[{tag,count,mode}]`, режим на тег) + тегирование вопросов (chip-инпут с правилами
именования) + UI квот в строке темы; рантайм-фикс экспорта `q.tags` в `TEST_DATA` + верификация в
scorm-player (100/100 выдач соблюдают квоты).

Отложенные точечные пункты: `showSectionResult` (промежуточные результаты по темам),
text-overflow diagnostics в PRD-1, порог coverage 50%, раздел «Архив» с восстановлением
в списке тестов, **flat adaptive mode** (`(adaptive, linear_flat)` пара — требует
общей шкалы сложности на тест без topicId-привязки; см. PRD-4 §3.1.2).

---

## 1. Контекст

Документ фиксирует порядок реализации PRD-1...PRD-8. Порядок отличается от приоритизации
этапов, перечисленной в [BRD §7](./specs/brd-scorm-enhancements.md), потому что учитывает фактические
зависимости контрактов, риск двойного рефакторинга UI и стоимость переделок при добавлении
новых настроек теста.

PRD-1 закрыт 2026-05-28 (см. [specs/prd-1/templates-content-pages.md](./specs/prd-1/templates-content-pages.md))
и считается фундаментом для остальных PRD.

---

## 2. Порядок реализации

> Таблица ниже документирует **зависимости и обоснование** порядка PRD. Фактический
> порядок **исполнения** — MVP-first (см. §0.1): PRD-7 → closeout PRD-1 → PRD-4 → PRD-8,
> затем post-MVP по §0.2: **PRD-2 + PRD-5 (парный трек)** → PRD-6 → PRD-3. То есть для
> MVP PRD-8 поднят выше PRD-6, а в post-MVP пара PRD-2+PRD-5 поднята выше PRD-6 по
> бизнес-запросу 2026-05-29 (шкалы + LMS-передача без постобработки).

| Шаг | PRD | Этап BRD | Основная причина выбранного порядка |
| --- | --- | --- | --- |
| 1 | PRD-7 Рефакторинг редактора параметров теста ([контракты](./architecture/test-editor-contracts.md)) | Этап 9 | Контракт `TestEditorModel`, DTO, `passDecisionPolicy` и `flowMode` нужны как поверхность для всех последующих PRD. Если сначала добавлять flow/retake/scales в текущий god-component `TestsPage`, потребуется повторный переписать UI. |
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

**PRD-2 + PRD-5 идут парным треком (см. §0.2).** Расширение DSL PRD-2 источниками
`scaleById(...).{raw,normalized,percent,level,label,hasValue}` и helper'ом
`countScales([...], level)` — обязательное условие старта PRD-5: без них формулы
итоговых категорий по шкалам (типовой кейс — burnout category в [MBI](./specs/prd-5/example-mbi.md))
неразрешимы. Также PRD-2 v2.1 добавляет поле `controls_status` для управления
`cmi.success_status` / `cmi.completion_status` boolean-показателем, что нужно для
сценариев, где «pass» определяется категорией шкал, а не `passing_score`.

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
