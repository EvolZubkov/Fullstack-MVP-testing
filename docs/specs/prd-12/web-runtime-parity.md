# PRD-12: Единый шаблонный рантайм рендера (SCORM + веб)

**Статус:** реализовано/закрыто 2026-06-06.

**Дата актуализации:** 2026-06-06.

**Решение об охвате:** L2 — полная унификация рендера на шаблонах (все экраны, включая
вопросы и итоги, рендерятся единым DSL-рендерером; рендерер хостится и в SCORM, и в
вебе). Поглощает платформенную часть PRD-3.

**Источник:** запрос на функциональный паритет веб-прохождения со SCORM + принцип
«оба рендера ОБЯЗАНЫ рендерить из общих шаблонов; веб без шаблонов — дефект».

**Связанные документы:**

- [spec-template-platform.md](../spec-template-platform.md) — нормативный контракт
  платформы шаблонов (источник истины)
- [PRD-1](../prd-1/templates-content-pages.md)
- [PRD-2](../prd-2/result-variables.md)
- [PRD-3](../prd-3/external-templates.md)
- [PRD-4](../prd-4/course-flow-sections.md)
- [PRD-5](../prd-5/scales-competency-measurements.md)
- [PRD-6](../prd-6/retake-cooldown-gate.md)
- [PRD-10](../prd-10/graded-answer-scoring.md)
- [PRD-11](../prd-11/tag-draw-quotas.md)
- [scoring-model.md](../scoring-model.md)
- [test-settings-parameter-structure.md](../../architecture/test-settings-parameter-structure.md)
- [ROADMAP](../../ROADMAP.md) §0.2

---

## 1. Обзор

### 1.1 Цель

Единый шаблонный рантайм рендера: один DSL-рендерер, питающийся единым публичным
контекстом, который рендерит ВСЕ экраны (вопросы, итоги, контент, router, блокировки)
и хостится в обеих средах — в SCORM-пакете (внутри LMS) и в веб-приложении (в браузере).
Это устраняет хардкод-дублирование в обеих средах, гарантирует визуальный паритет «по
построению» и делает шаблон единственным источником дизайна.

### 1.2 Принцип разделения (из спеки, §2.3)

| Слой | Владеет | Реализация |
| --- | --- | --- |
| **Core (логика)** | состояние, навигация, скоринг, статусы, восстановление, источники данных | плагинируемый по среде |
| **Рендерер (представление)** | layout'ы, DSL, placeholders, тема | ЕДИНЫЙ для обеих сред |
| **Публичный контекст** | контракт между Core и рендерером (§10 спеки) | единый JSON-контракт |

Ключ к L2: рендерер и контракт контекста — общие; различается только адаптер данных
под средой (как Core добывает/считает данные).

### 1.3 Не-цели

- Не серверный рендер шаблонов. По §2.1 спеки шаблон исполняется только в браузере;
  веб-хост тоже рендерит на клиенте, сервер отдаёт ДАННЫЕ (публичный контекст), а не HTML.
- Не «flat adaptive» (`(adaptive, linear_flat)`) — отложенная пара PRD-4.
- Не enterprise-версионирование шаблонов и не расширенный движок правил (Storyline-уровень) —
  это будущие фазы спеки, вне охвата.
- Не внешние загружаемые шаблоны (полный PRD-3 lifecycle). Берётся из PRD-3 только
  платформенный контракт рендера, не админ-реестр сторонних ZIP.

---

## 2. Целевая архитектура

### 2.1 Единый рантайм-рендерер

Один рендерер на framework-free TS (`shared/template/`):

- полный path-only DSL по §9 спеки (`{{ path }}`, `{{#if}}`, `{{#unless}}`,
  `{{#each}}`, `{{> partial}}`, `@root`/`@index`/`@number`/`@first`/`@last`),
  реализован в [dsl.ts](../../../shared/template/dsl.ts)
  (`compileTemplate`/`renderTemplate`, без DOM/Node);
- загрузка `manifest.json` + `shell.html` + layouts;
- placeholders/слоты/textFit/autoAdvance;
- renderer registry для `resultField` (§8.2.1.2) —
  [renderers.ts](../../../shared/template/renderers.ts)
  (textMetric/badge/progressBar/ringChart/segmentedProgress);
- композиция DSL + DOM-пассов (`data-path` текст-биндинг, `data-slot` HTML-регионы,
  `data-placeholder` по типу) — [render-screen.ts](../../../shared/template/render-screen.ts)
  (`renderScreenInto`);
- вход — публичный контекст (§10): `test`, `page`, `sections`, `progress`, `nav`,
  `params`, `result.*`, `scale.*`, `feedback`, `answerState` —
  типизированный контракт в [context.ts](../../../shared/template/context.ts).

Рендерер не знает, откуда взялись данные — он рендерит контекст.

### 2.2 Два хоста, один рендерер

```text
            ┌─────────────────────────┐
            │   ЕДИНЫЙ DSL-РЕНДЕРЕР    │  (общий TS, рендерит публичный контекст)
            └───────────▲─────────────┘
                        │ публичный контекст (единый контракт §10)
        ┌───────────────┴───────────────┐
        │                               │
┌───────┴────────┐              ┌────────┴─────────┐
│  SCORM-host    │              │   Web-host       │
│  Core: client  │              │   React-обёртка  │
│  данные: SCORM  │              │   данные: REST   │
│  API + client- │              │   (сервер считает│
│  compute        │              │   @shared)       │
└────────────────┘              └──────────────────┘
```

- **SCORM-host:** Core считает на клиенте, источник состояния — SCORM API; рендерит ВСЕ
  экраны через единый рендерер. Пакет несёт общий рендерер из `@shared` через
  esbuild-бандл (IIFE, глобал `TBTemplate`):
  [runtime-entry.ts](../../../shared/template/runtime-entry.ts) →
  [server/scorm/builders/shared-runtime.ts](../../../server/scorm/builders/shared-runtime.ts).
- **Web-host:** React-компонент монтирует тот же рендерер в Shadow DOM (CSS-изоляция);
  данные приходят с сервера REST-ом; расчёт результата — серверный (`@shared`-движки),
  сервер отдаёт готовый публичный контекст. Рендерер идентичен SCORM-host
  ([client/src/components/template-screen.tsx](../../../client/src/components/template-screen.tsx)).

### 2.3 Источник данных в вебе

Сервер считает результат (scoring/scales/показатели через `@shared`) и собирает
публичный контекст (тот же контракт §10). Веб-клиент только рендерит. Это сохраняет
безопасный серверный скоринг и переиспользует общие движки.

### 2.4 Шаблоны как источник дизайна

Layout'ы шаблона — единственный источник вёрстки экранов. Поэтому отдельные веб-эскизы
для портируемых экранов не нужны: дизайн = layout, оба хоста рендерят его одинаково.
Эскиз нужен только для новых layout-блоков, которых нет ни в одном шаблоне (например
блоки «Показатели»/«Шкалы» в layout итогов) — и один раз, для обеих сред.

### 2.5 Единый расчётный модуль

Расчёт — один канонический модуль `@shared`
(`scoring`/`scales`/`formula`/`draw`/`eligibility`), а не отдельные реализации под среду.
Различается только МЕСТО исполнения:

- **server/web** — импорт `@shared` напрямую (прецедент: `scales.ts`, `drawSection` в `attempts.ts`);
- **SCORM** — тот же модуль внутри пакета (esbuild-бандл `@shared` → IIFE-глобалы), без
  рукописных JS-портов.

Условие: движки `@shared` остаются browser-pure (без Node/DOM). Это compute-аналог
«единого рендерера» (§2.1).

### 2.6 CSS-унификация

Оба хоста используют ОДИН компонентный CSS-источник (`theme.css` + `base.css` дизайн-шаблона
в `server/scorm/templates/<id>/styles/`). В вебе CSS инжектируется в Shadow DOM с мапингом
`:root`/`body` → `:host`, поэтому переменные темы работают в изоляции; в SCORM-пакете
`styles.css` генерируется из того же источника на сборке. Кольцо результата и полосы тем
рисуются на чистом CSS (`--ring-offset` и ширина полосы через `{{ }}` из контекста), без
зависимости от JS-постобработки.

---

## 3. Требования (FR)

- **FR-1.** Единый DSL-рендерер реализует полный набор §9 спеки и проходит её smoke-контракт.
- **FR-2.** Экраны вопроса и итогов в SCORM рендерятся из layout'ов шаблона (без хардкода
  `renderResults`/вопросных рендереров), через layout-контракты §8.
- **FR-3.** Публичный контекст (§10) — единственный вход рендерера во всех экранах и
  обеих средах; прямого доступа к `TEST_DATA` у layout'ов нет (§10.1).
- **FR-4.** Сервер считает результат через `@shared/scoring|scales|formula` и собирает
  публичный контекст; числовой паритет с SCORM подтверждён golden (mbi/rtk).
- **FR-5.** Веб-хост монтирует единый рендерер и рендерит контекст с сервера; визуально
  идентичен SCORM на тех же данных.
- **FR-6.** Навигация потока (linear_by_topics / router_by_topics / зоны / контент-страницы)
  работает в веб-хосте через Core-адаптер.
- **FR-7.** Retake-гейт в вебе считается на сервере (eligibility, дата из
  `attempts.finishedAt`) и рендерит блок-экран из того же layout'а.
- **FR-8.** default-шаблон покрывает полный layout-контракт (вопросы/итоги/контент/
  router/system) и параметры/тему.
- **FR-9.** Обратная совместимость: уже выгруженные SCORM-пакеты и сохранённые
  `resultJson` не ломаются; рендер-рефактор не меняет числовые результаты.

---

## 4. Архитектурные слои

Архитектура разбита на слои, каждый из которых независимо тестируется headless и проверяется
браузером/scorm-player для визуальной части.

### 4.1 Фундамент рендерера

Полный path-only DSL по §9 (`if`/`unless`/`each`/`partial`/`@root`/`@index`/...) с
unit-тестами без DOM; renderer registry, подключённый к экранам вопроса/итогов/контента;
единый билдер публичного контекста (§10): `test`/`page`/`sections`/`progress`/`nav`/
`answerState`/`feedback`/`params`; `shell.html` как DOM-оболочка. Layout вопроса и итогов
выверены под движок; в layout итогов добавлены блоки «Показатели»/«Шкалы» (§8.3).

### 4.2 SCORM на шаблонах

Рендер вопроса и итогов переведён с хардкода на layout'ы `question`/`results` + публичный
контекст; мёртвый хардкод-рендер из рантайма удалён. Стандартные интерактивы вопросов
монтируются в слот `question-interaction`. Golden рендера фиксирует стабильный DOM на
одинаковых данных.

### 4.3 Данные для веба

Серверное оценочное ядро на `@shared` и сборка публичного контекста по REST:

- `server/utils/check-answer.ts` использует `@shared/scoring.scoreAnswer` (PRD-10 цена
  ответа, без серверного дубля);
- [server/services/scoring-config.ts](../../../server/services/scoring-config.ts)
  (`loadScoringConfig`, DB → spec, зеркалит `test-json.ts`);
- [server/services/result-compute.ts](../../../server/services/result-compute.ts)
  (`computeAttemptResult`: scores → scales → result vars, порядок как в SCORM) с проводкой
  в `finish`;
- [server/services/result-context.ts](../../../server/services/result-context.ts)
  (`buildResultContext`: `AttemptResult` → контекст экрана итогов);
- `attemptResultSchema` расширен опциональными `scaleResults`/`resultVariables`/`status`
  (отсутствие = прежняя форма).

Серверный расчёт веб-версии доказан паритетом со SCORM golden (mbi/rtk): PRD-10 (цена
ответа) + PRD-5 (шкалы) + PRD-2 (показатели) совпадают; PRD-11 (квоты) работал ранее.

### 4.4 Веб-хост

React-обёртка [TemplateScreen](../../../client/src/components/template-screen.tsx) монтирует
единый рендерер в Shadow DOM, инжектирует CSS шаблона и делегирует `data-action`-клики
обратно в React:

- [server/services/template-render.ts](../../../server/services/template-render.ts)
  (`readResultsRenderPayload`/`readScreenTemplate` отдают `{layout, css, context}` —
  сервер владеет шаблонами; выбор layout по `mode`, включая `results.adaptive.html`);
- GET `/attempts/:id/result` добавляет поле `render`; эндпоинт
  `GET /api/tests/:id/screen-template/:screen` отдаёт layout+css+theme для экранов
  `start`/`question`/`blocked`;
- [result.tsx](../../../client/src/pages/learner/result.tsx) рендерит `TemplateResultPage`
  (full-bleed: тёмная поверхность шаблона на всю ширину/высоту контента), включая
  адаптивную ветку;
- старт-экран `take-test` рендерит из `start.html` (состояния `canStart`/`canResume`/
  `exhausted`, кнопки через `onAction`);
- экран вопросов
  [template-question-screen.tsx](../../../client/src/pages/learner/template-question-screen.tsx)
  покрывает все 4 типа (single/multiple/ranking/matching): хром даёт шаблон,
  интерактив — HTML в слот, состояние держит React; ranking/matching используют настоящий
  pointer-based drag-and-drop с DOM-призраком (фиксация дропа по перекрытию площади), разметка
  и классы те же, что в SCORM;
- блок-экран retake рендерится из `system.blocked.html` (ветка cooldown через
  data-path: `retake.cooldownPeriodDays`/`availableDateHuman`).

Серверный retake-гейт [server/services/retake-gate.ts](../../../server/services/retake-gate.ts)
(`decideRetake`, переиспользует `@shared/eligibility.cooldownDecision`; дата из
`attempts.finishedAt`) подключён в оба start-роута; блокировка → 403
`{code:"RETAKE_COOLDOWN", reason, cooldownPeriodDays, lastAttemptDate, availableDate}`;
инертен при `enabled !== true`.

### 4.5 Приёмка

- Паритет-тест: один публичный контекст → идентичный DOM в SCORM-host и web-host.
- Визуальная сверка learner-экранов веб ↔ SCORM на одинаковых данных.
- Регрессия: легаси-пакеты/результаты не сломаны, числа неизменны.

---

## 5. Тестирование и приёмка

- **DSL-контракт:** smoke по §9 спеки (все конструкции, экранирование, partial-fallback).
- **Golden рендера:** фикстура контекста → стабильный DOM-snapshot; один и тот же снапшот
  в обоих хостах (главный гейт L2).
- **Golden computation:** серверный `finish` = эталон SCORM на mbi/rtk.
- **Поток:** все валидные пары `mode×flowMode` (как PRD-4 golden).
- **Регрессия:** числа результатов и легаси-пакеты неизменны.
- **Визуальная приёмка:** сверка экранов веб ↔ SCORM на одинаковых данных.

---

## 6. Принятые решения и риски

### 6.1 Расчёт в вебе: сервер

Расчёт в вебе — серверный (`@shared` + публичный контекст по REST). Причина — граница
доверия: в вебе клиент недоверенный, клиентский скоринг делает результат подделываемым и
раскрывает ключ ответов (ср.
[attempts.ts:112-114](../../../server/routes/attempts.ts#L112-L114), где `correctJson`
намеренно не уходит на клиент). Унификация «один Core» достигается на уровне рендерера
(§2.1) и единого расчётного модуля (§2.5), а НЕ места расчёта.

### 6.2 Объём L2 и поглощение PRD-3

L2 достраивает платформенную часть PRD-3 (DSL, registry, layout-контракты), и эта часть
перенесена в PRD-12. PRD-3 сужен до админ-реестра и жизненного цикла ВНЕШНИХ шаблонных ZIP.

### 6.3 Безопасность DSL-рендерера

Полный DSL и renderer-плагины расширяют поверхность. Соблюдается §8.2.1.3 спеки (без
`eval`/`Function`, только публичный контекст, fallback при ошибке рендерера).

### 6.4 Производительность веб-хоста

Монтирование framework-free рендерера внутри React/Vite требует аккуратной границы
(порталы, очистка, отсутствие гонок с React-реконсиляцией). Изоляция обеспечивается
Shadow-контейнером.

### 6.5 Контракт публичного контекста

Контракт контекста зафиксирован как версионированный тип
([context.ts](../../../shared/template/context.ts)), общий для серверной сборки (веб) и
клиентской сборки (SCORM), чтобы хосты не разошлись. Layout'ы используют namespace
`course.*`/`result.*`.
