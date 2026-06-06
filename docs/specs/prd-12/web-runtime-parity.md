# PRD-12: Единый шаблонный рантайм рендера (SCORM + веб)

**Версия:** 0.2 (ЧЕРНОВИК — на согласование)
**Статус:** План v0.2. Архитектурные решения закрыты (§9.1 — серверный расчёт; §9.2 —
сужение PRD-3 согласовано). Реализация НЕ начата — ожидает go на Фазу 0.
**Дата:** 2026-06-05
**Решение об охвате:** L2 — полная унификация рендера на шаблонах (все экраны, включая
вопросы и итоги, рендерятся единым DSL-рендерером; рендерер хостится и в SCORM, и в
вебе). Поглощает платформенную часть PRD-3.
**Источник:** запрос на функциональный паритет веб-прохождения со SCORM + принцип
«оба рендера ОБЯЗАНЫ рендерить из общих шаблонов; веб без шаблонов — дефект».
**Связанные документы:** [spec-template-platform.md](../spec-template-platform.md)
(нормативный контракт платформы шаблонов — источник истины),
[PRD-1](../prd-1/templates-content-pages.md),
[PRD-2](../prd-2/result-variables.md), [PRD-3](../prd-3/external-templates.md),
[PRD-4](../prd-4/course-flow-sections.md), [PRD-5](../prd-5/scales-competency-measurements.md),
[PRD-6](../prd-6/retake-cooldown-gate.md), [PRD-7](../prd-7/s13-editor-parity.md),
[PRD-10](../prd-10/graded-answer-scoring.md), [PRD-11](../prd-11/tag-draw-quotas.md),
[scoring-model.md](../scoring-model.md), [ROADMAP](../../ROADMAP.md) §0.2.

---

## 1. Обзор

### 1.1 Контекст и проблема

Логика рендеринга экранов прохождения сейчас **продублирована и захардкожена** в двух
средах:

- **SCORM-рантайм** — гибрид. Контент-страницы, router-страница и экран блокировки
  рендерятся через (частичную) шаблонную систему; **экран вопроса и экран итогов —
  хардкод** (склейка строк HTML в [app.js](../../../server/scorm/assets/app.js)
  `renderResults()` и вопросных рендерерах), которому шаблон даёт только CSS-переменные.
- **Веб-приложение** (`/learner/*`) — собственная React-вёрстка
  ([result.tsx](../../../client/src/pages/learner/result.tsx)), не использующая шаблоны
  вовсе.

Платформа шаблонов спроектирована (см. [spec-template-platform.md](../spec-template-platform.md)),
но достроена лишь частично: DSL-рендерер `templateCore` поддерживает
`data-path`/`data-placeholder`/`data-slot` и CSS-переменные, но НЕ полный DSL
(`{{#if}}`/`{{#each}}`/partials/`@root`) из §9 спеки; ядро владеет рендером не всех
экранов. Полноценная платформенная часть — нереализованный PRD-3.

### 1.2 Цель

Построить **единый шаблонный рантайм рендера**: один DSL-рендерер, питающийся единым
публичным контекстом, который рендерит ВСЕ экраны (вопросы, итоги, контент, router,
блокировки) и **хостится в обеих средах** — в SCORM-пакете (внутри LMS) и в
веб-приложении (в браузере). Это устраняет хардкод-дублирование в обеих средах,
гарантирует визуальный паритет «по построению» и делает шаблон единственным
источником дизайна.

### 1.3 Принцип разделения (из спеки, §2.3)

| Слой | Владеет | Реализация |
| --- | --- | --- |
| **Core (логика)** | состояние, навигация, скоринг, статусы, восстановление, источники данных | плагинируемый по среде |
| **Рендерер (представление)** | layout'ы, DSL, placeholders, тема | ЕДИНЫЙ для обеих сред |
| **Публичный контекст** | контракт между Core и рендерером (§10 спеки) | единый JSON-контракт |

Ключ к L2: **рендерер и контракт контекста — общие; различается только адаптер
данных под средой** (как Core добывает/считает данные).

### 1.4 Не-цели

- Не серверный рендер шаблонов. По §2.1 спеки шаблон исполняется только в браузере;
  веб-хост тоже рендерит на клиенте, сервер отдаёт ДАННЫЕ (публичный контекст), а не HTML.
- Не «flat adaptive» (`(adaptive, linear_flat)`) — отложенная пара PRD-4.
- Не enterprise-версионирование шаблонов и не расширенный движок правил (Storyline-уровень) —
  это будущие фазы спеки, вне охвата.
- Не внешние загружаемые шаблоны (полный PRD-3 lifecycle). Берём из PRD-3 только
  платформенный контракт рендера, не админ-реестр сторонних ZIP.

---

## 2. Текущее состояние (gap-анализ)

### 2.1 Рендер по экранам

| Экран | SCORM сегодня | Веб сегодня | Цель L2 |
| --- | --- | --- | --- |
| Контент-страница | Шаблон (`fillPlaceholders` + `renderPathOnlyDsl`) | Нет (нет такого экрана) | Шаблон в обоих |
| Router-страница | Шаблон ([routerFlow.js:177](../../../server/scorm/template/app/routerFlow.js#L177)) | Нет | Шаблон в обоих |
| Экран блокировки | Шаблон ([gate.js:238](../../../server/scorm/template/app/eligibility/gate.js#L238)) | Нет | Шаблон в обоих |
| **Вопрос** | **Хардкод** + CSS-vars | React-вёрстка | Шаблон в обоих |
| **Итоги** | **Хардкод** `renderResults()` | React-вёрстка | Шаблон в обоих |

### 2.2 Расчёт (данные для контекста)

| PRD | SCORM | Веб | Где логика |
| --- | --- | --- | --- |
| PRD-10 цена ответа | `ScoringEngine.scoreAnswer` | Нет — бинарный `check-answer.ts` | `@shared/scoring/engine` |
| PRD-5 шкалы | `ScaleEngine.computeScales` | Нет | `@shared/scales/engine` |
| PRD-2 показатели | `FormulaDSL.computeResultVariables` | Нет | `@shared/formula/result-variables` |
| PRD-11 квоты выдачи | Есть | Есть | `@shared/draw/blueprint` |
| PRD-6 retake | Есть (eligibility) | Нет — только `maxAttempts` | `@shared/eligibility/*` |

Расчётные движки уже существуют как канонический TS в `shared/` и импортируются
сервером напрямую (прецедент: [scales.ts](../../../server/routes/scales.ts)). Веб может
переиспользовать их без третьей копии.

### 2.3 Платформа рендерера

| Возможность спеки §9/§10 | Статус |
| --- | --- |
| `data-path` / `data-placeholder` / `data-slot` | Есть ([templateCore.js](../../../server/scorm/template/app/templateCore.js)) |
| CSS-переменные из params | Есть (`applyCssVarsToRoot`) |
| Полный DSL `{{#if}}`/`{{#each}}`/partials/`@root` | **Нет** |
| Единый публичный контекст (§10) как контракт | Частично (хардкод-экраны его не используют) |
| Renderer registry (`resultField`, §8.2.1.2) | Объявлен в спеке, не реализован |

---

## 3. Целевая архитектура

### 3.1 Единый рантайм-рендерер

Один рендерер на чистом JS (развитие `templateCore`/`templateLoader`):

- полный path-only DSL по §9 спеки (`{{ path }}`, `{{#if}}`, `{{#unless}}`,
  `{{#each}}`, `{{> partial}}`, `@root`/`@index`/`@number`/`@first`/`@last`);
- загрузка `manifest.json` + `shell.html` + layouts (есть в `templateLoader`);
- placeholders/слоты/textFit/autoAdvance (есть в `templateCore`);
- renderer registry для `resultField` (§8.2.1.2);
- вход — **публичный контекст** (§10): `test`, `page`, `sections`, `progress`, `nav`,
  `params`, `result.*`, `scale.*`, `feedback`, `answerState`.

Рендерер не знает, откуда взялись данные — он рендерит контекст.

### 3.2 Два хоста, один рендерер

```text
            ┌─────────────────────────┐
            │   ЕДИНЫЙ DSL-РЕНДЕРЕР    │  (общий JS, рендерит публичный контекст)
            └───────────▲─────────────┘
                        │ публичный контекст (единый контракт §10)
        ┌───────────────┴───────────────┐
        │                               │
┌───────┴────────┐              ┌────────┴─────────┐
│  SCORM-host    │              │   Web-host       │
│  Core: client  │              │   React-обёртка  │
│  данные: SCORM  │              │   данные: REST   │
│  API + client- │              │   (сервер считает│
│  compute (порты)│              │   @shared)       │
└────────────────┘              └──────────────────┘
```

- **SCORM-host:** как сейчас — Core считает на клиенте (plain-JS порты), источник
  состояния — SCORM API; но рендерит ВСЕ экраны через единый рендерер.
- **Web-host:** React-компонент монтирует тот же рендерер в DOM; данные приходят с
  сервера REST-ом; **расчёт результата — серверный** (`@shared`-движки), сервер отдаёт
  готовый публичный контекст. Рендерер идентичен SCORM-host.

### 3.3 Источник данных в вебе (рекомендация)

Сервер считает результат (scoring/scales/показатели через `@shared`) и собирает
публичный контекст (тот же контракт §10). Веб-клиент только рендерит. Это сохраняет
безопасный серверный скоринг и переиспользует общие движки. Альтернатива (клиентский
Core в вебе, как в SCORM) — см. открытый вопрос §9.1.

### 3.4 Шаблоны как источник дизайна

Layout'ы шаблона — единственный источник вёрстки экранов. Поэтому отдельные веб-эскизы
для портируемых экранов НЕ нужны: дизайн = layout, оба хоста рендерят его одинаково.
Эскиз нужен только для **новых** layout-блоков, которых нет ни в одном шаблоне
(например блоки «Показатели»/«Шкалы» в layout итогов) — и один раз, для обеих сред.

### 3.5 Единый расчётный модуль

Расчёт — это один канонический модуль `@shared` (`scoring`/`scales`/`formula`/`draw`/
`eligibility`), а не отдельные реализации под среду. Различается только МЕСТО исполнения:

- **server/web** — импорт `@shared` напрямую (прецедент: `scales.ts`, `drawSection` в `attempts.ts`);
- **SCORM** — тот же модуль внутри пакета.

Сегодня SCORM использует РУЧНЫЕ JS-порты движков (`app/scoring/engine.js` и т.д.),
синхронность держат port-parity golden-тесты — то есть «один модуль» пока на уровне
семантики, физически — вторая копия с риском дрейфа. Рекомендация L2: на экспорте
**компилировать `@shared` в пакет** (esbuild → IIFE с глобалами `ScoringEngine`/
`ScaleEngine`/`FormulaDSL`) и вывести рукописные порты — тогда модуль буквально один
везде. Условие: движки `@shared` остаются browser-pure (без Node/DOM), что уже так.
Это compute-аналог «единого рендерера» (§3.1).

---

## 4. Требования (FR)

- **FR-1.** Единый DSL-рендерер реализует полный набор §9 спеки и проходит её smoke-контракт.
- **FR-2.** Экраны вопроса и итогов в SCORM рендерятся из layout'ов шаблона (хардкод
  `renderResults`/вопросных рендереров удалён), через layout-контракты §8.
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
- **FR-8.** default-шаблон расширен до полного layout-контракта (вопросы/итоги/контент/
  router/system) и параметров/темы.
- **FR-9.** Обратная совместимость: уже выгруженные SCORM-пакеты и сохранённые
  `resultJson` не ломаются; рендер-рефактор не меняет числовые результаты.

---

## 5. Рабочие потоки и фазы

Порядок построен так, чтобы сперва улучшить SCORM (убрать хардкод — ценность сразу),
затем построить слой данных, и тогда веб-паритет «выпадает» из общего рендерера.

| Фаза | Рабочий поток | Зона | Вес | Зависит от |
| --- | --- | --- | --- | --- |
| **0. Фундамент рендерера** | WS1 полный DSL + registry; WS6a layout-контракты вопросов/итогов в default | SCORM-сторона (plain-JS) + шаблон | XL | spec §9/§10 |
| **1. SCORM на шаблонах** | WS2 перевод вопросов/итогов SCORM с хардкода на шаблоны | SCORM-рантайм | L | Фаза 0 |
| **2. Данные для веба** | WS3 серверное оценочное ядро (@shared) + сборка публичного контекста (REST) | backend | L | — (параллельно 0/1) |
| **3. Веб-хост** | WS4 React-обёртка рендерера + REST-адаптер + навигация; WS5 retake-гейт | frontend + backend | XL | Фазы 0, 2 |
| **4. Приёмка** | WS7 паритет-тесты (контекст → идентичный DOM в обоих хостах) + визуальная сверка | tests/acceptance | L | Фазы 1, 3 |

Промежуточная ценность по фазам: после Фазы 1 — SCORM полностью на шаблонах, хардкод
убран; после Фазы 2 — веб считает корректные результаты (даже до нового рендера);
после Фазы 3 — веб визуально идентичен SCORM.

---

## 6. Нарезка задач

Веса: S/M/L. «Эскиз» — только для новых layout-блоков (см. §3.4), не для портируемых экранов.

### Фаза 0 — Фундамент рендерера

Веса уточнены по [инвентаризации](./phase0-renderer-inventory.md) (2026-06-05): реестр
рендереров оказался готов (0-2 → S), DSL-движок и публичный контекст — greenfield.

| ID | Задача | Зона | Вес |
| --- | --- | --- | --- |
| 0-1 | Реализовать полный path-only DSL (`if/unless/each/partial/@root/@index/...`) по §9; unit-тесты без DOM. КРИТИЧЕСКИЙ ПУТЬ | renderer | L/XL |
| 0-2 | Подключить готовый renderer registry ([renderers.js](../../../server/scorm/template/app/render/renderers.js)) к экранам вопроса/итогов (сейчас только контент); тесты | renderer | S |
| 0-3 | Единый билдер публичного контекста (§10): `test/page/sections/progress/nav/answerState/feedback/params`; нет сегодня | renderer/core | M/L |
| 0-4 | Выверить layout вопроса под финальный движок; единый словарь слотов (`question-prompt`) §8.1 | шаблон | S/M |
| 0-5 | Выверить layout итогов + добавить блоки «Показатели»/«Шкалы» §8.3 (1 эскиз) | шаблон + эскиз | M |
| 0-6 | Подключить `shell.html` как DOM-оболочку (сейчас загружается, но не используется) §7 | renderer | S |

**Прогресс (2026-06-05).**

- **0-1 ВЫПОЛНЕНО** — [shared/template/dsl.ts](../../../shared/template/dsl.ts) (чистый
  мустач-движок §9: `compileTemplate`/`renderTemplate`, без DOM/Node) +
  [dsl.test.ts](../../../shared/template/dsl.test.ts) (30 тестов). Весь контракт §9:
  интерполяция+экранирование, if/unless/each с `@index/@number/@first/@last`/`@root`,
  partials + гард рекурсии, parse-ошибки для fallback хоста.
- **0-3 ВЫПОЛНЕНО** — [shared/template/context.ts](../../../shared/template/context.ts):
  типизированный контракт публичного контекста §10 (`test/page/sections/progress/nav/
  result/scale/sectionResult/retake`), единый для обоих хостов.
- **Валидация движка на реальных layout'ах** —
  [tests/template-dsl-layouts.test.ts](../../../tests/template-dsl-layouts.test.ts)
  (8 тестов): движок рендерит реальные `results.html`/`start.html`/… дефолтного шаблона;
  снят риск инвентаризации «вёрстка опережает движок».
- Итого: 38 тестов зелёные, `npm run check` (tsc) чисто.
- **Единый рендерер собран и проверен (jsdom)** —
  [shared/template/render-screen.ts](../../../shared/template/render-screen.ts)
  `renderScreenInto` композирует DSL + DOM-пассы (`data-path` текст-биндинг, `data-slot`
  HTML-регионы); [tests/render-screen.test.ts](../../../tests/render-screen.test.ts)
  (5 тестов, jsdom) рендерит реальный `results.html` + публичный контекст → корректный DOM
  (if/unless/each, `{{ }}` в атрибутах, биндинг путей, заполнение слота). Линчпин
  рендер-слоя; de-risk Фаз 1/3 headless, без браузера.
- **Рендерер покрывает контент-страницы** —
  [shared/template/renderers.ts](../../../shared/template/renderers.ts) (TS-порт 5 core
  `resultField`-рендереров — textMetric/badge/progressBar/ringChart/segmentedProgress, HTML
  идентичен SCORM-твину) + `renderScreenInto` заполняет `data-placeholder` (по типу:
  text/richText/image/number/boolean; `resultField` через реестр с резолвом пути из
  контекста и enforce `allowedPaths`/`allowedRenderers`).
  [tests/render-screen-content.test.ts](../../../tests/render-screen-content.test.ts)
  (5, jsdom). **Рендерер покрывает ВСЕ виды экранов** (вопрос/итоги/контент/summary) —
  весь headless-проверяемый фундамент рендера готов.
- **Уточнение порядка:** чтобы SCORM-пакет потреблял shared-движок (TS), нужен
  bundle-путь (задача 2-7) — он становится **пререквизитом Фазы 1** (рантайм-конвертация
  экранов на layouts). Веб-хост (Фаза 3) импортирует движок напрямую через Vite, bundle
  ему не нужен.

### Фаза 1 — SCORM на шаблонах

| ID | Задача | Зона | Вес |
| --- | --- | --- | --- |
| 1-1 | Перевести рендер вопроса с хардкода на layout `question` + стандартные интерактивы в слот | SCORM | L |
| 1-2 | Перевести `renderResults()` на layout `results` + публичный контекст | SCORM | L |
| 1-3 | Удалить мёртвый хардкод-рендер из `app.js`/adaptiveRender после перевода | SCORM | S |
| 1-4 | Golden рендера: те же данные → стабильный DOM (snapshot) в scorm-player | tests | M |

### Фаза 2 — Данные для веба

| ID | Задача | Зона | Вес |
| --- | --- | --- | --- |
| 2-1 | Перевести `server/utils/check-answer.ts` на `@shared/scoring.scoreAnswer` (легаси 0/1 без `scoring`) | backend | M |
| 2-2 | Сбор конфигурации шкал/показателей в расчётный контекст (общий сервис с экспортом `test-json.ts`) | backend | M |
| 2-3 | Оркестрация в `finish`: scoreAnswer → computeScales → computeResultVariables | `attempts.ts` | L |
| 2-4 | Эндпоинт публичного контекста прохождения/итогов (§10) для веб-хоста | backend | L |
| 2-5 | Расширить `attemptResultSchema` опциональными `scaleResults`/`resultVariables`/`status` | `shared/schema.ts` | S |
| 2-6 | Golden computation: серверный результат = эталон SCORM (mbi/rtk) | tests | M |
| 2-7 | (рекоменд.) Компиляция `@shared` в SCORM-пакет (esbuild IIFE), вывод рукописных JS-портов и port-дублей; гард browser-purity движков | build + SCORM | M |

**Прогресс (2026-06-05).**

- **2-1 ВЫПОЛНЕНО** — [server/utils/check-answer.ts](../../../server/utils/check-answer.ts)
  переведён на `@shared/scoring.scoreAnswer`; **PRD-10 (градуированная цена ответа) работает
  в вебе** (баллы текут через `qPoints*scoreRatio` в `finish`); серверный дубль проверки
  удалён (§3.5). Поведенческое выравнивание: вырожденный пустой `correct` → 1 (паритет со
  SCORM-движком), 2 устаревших серверных ожидания обновлены.
- **2-5 ВЫПОЛНЕНО** — `attemptResultSchema` расширен опц. `scaleResults`/`resultVariables`/
  `status` (back-compat: отсутствие = прежняя форма).
- **2-2 ВЫПОЛНЕНО** — [server/services/scoring-config.ts](../../../server/services/scoring-config.ts)
  `loadScoringConfig` (DB→spec, зеркалит test-json.ts).
- **2-3 ВЫПОЛНЕНО** — [server/services/result-compute.ts](../../../server/services/result-compute.ts)
  (чистая `computeAttemptResult`, порядок как в SCORM: scales→result vars) + проводка в
  `finish`; `controls_status="success"` переопределяет `overallPassed` (паритет со SCORM).
  **PRD-5 шкалы + PRD-2 показатели теперь считаются в веб-результате.**
- **2-6 ВЫПОЛНЕНО** — golden-паритет веб↔SCORM: MBI-фикстура вынесена в
  [tests/fixtures/mbi.ts](../../../tests/fixtures/mbi.ts) (DRY), серверный
  `computeAttemptResult` прогнан по всем 27 комбинациям уровней + рабочему примеру
  ([result-compute-mbi-parity.test.ts](../../../tests/result-compute-mbi-parity.test.ts),
  28/28) и даёт те же уровни шкал и категорию, что независимый эталон; существующий
  golden ([mbi-golden.test.ts](../../../tests/mbi-golden.test.ts), 43/43) переведён на
  общую фикстуру без изменения проверок.
- Тесты: result-compute 3/3, mbi-golden 43/43, parity 28/28, регрессия 117/117, `tsc` чисто.

**Итог Фазы 2 (слой данных).** Серверный расчёт веб-версии ПОЛНЫЙ и доказан паритетом:
PRD-10 (цена ответа) + PRD-5 (шкалы) + PRD-2 (показатели) считаются и совпадают со SCORM;
PRD-11 (квоты) работал ранее. Осталось 2-4 (эндпоинт публичного контекста) — вместе с
веб-хостом Фазы 3 (рендер). Дальнейшее (рендер-унификация: bundle-путь 2-7, конвертация
экранов, веб-хост) требует браузерной/сборочной проверки (scorm-player), которую из CLI
нельзя выполнить полноценно.

**Мост расчёт→рендер (2-4, builder) готов и проверен e2e (2026-06-06).**
[server/services/result-context.ts](../../../server/services/result-context.ts)
`buildResultContext(result, testTitle)` строит контекст экрана итогов (Core-поля:
`passClass`/`statusLabel`/`ringDashoffset`/`topicResults`) из `AttemptResult`;
[tests/result-context.test.ts](../../../tests/result-context.test.ts) (5, jsdom) проверяет
цепочку `AttemptResult → buildResultContext → renderScreenInto → реальный results.html →
DOM`. **Вся цепочка данные→рендер для экрана итогов доказана headless.** Вскрыто: layouts
используют namespace `course.*`/`result.*`, а не §10 `test.*`/`page.*` — конвергенция
вынесена в §9.5. Осталось: смонтировать рендерер в `result.tsx` (МЕНЯЕТ вид страницы →
визуальная сверка) + HTTP-отдача контекста + SCORM-сторона (браузер/сборка).

### Фаза 3 — Веб-хост

| ID | Задача | Зона | Вес |
| --- | --- | --- | --- |
| 3-1 | React-обёртка, монтирующая единый рендерер в DOM (loader шаблона из веб-ассетов) | frontend | L |
| 3-2 | REST-адаптер данных: публичный контекст с сервера → рендерер | frontend | M |
| 3-3 | Навигация потока в веб-хосте (linear_by_topics / router / зоны / контент-страницы) | frontend + backend | L |
| 3-4 | Заменить `result.tsx`/`take-test.tsx` на веб-хост рендерера (снять React-дубль) | frontend | L |
| 3-5 | Retake-гейт: серверный eligibility-плагин (дата из `attempts.finishedAt`) + блок-экран из layout | backend + frontend | M |

**Прогресс (2026-06-06).** Серверная часть 3-5 ВЫПОЛНЕНА —
[server/services/retake-gate.ts](../../../server/services/retake-gate.ts) (`decideRetake`,
переиспользует `@shared/eligibility.cooldownDecision`; дата из `attempts.finishedAt`, без
LMS-плагина) подключён в оба start-роута ([attempts.ts](../../../server/routes/attempts.ts):
`start` + `start-adaptive`); блокировка → 403 `{code:"RETAKE_COOLDOWN", reason,
cooldownPeriodDays, lastAttemptDate, availableDate}`. Гейт инертен при `enabled!==true`
(легаси не затронуто). Тесты: retake-gate 8/8 (включая граничный день), регрессия 54/54,
`tsc` чисто. Остаётся БЛОК-ЭКРАН (рендер из layout) — это уже рендер-слой (браузерная
проверка), идёт с Фазой 3.

**Прогресс веб-хоста (3-1/3-2/3-4, 2026-06-06).** Страница итогов веб-версии теперь
рендерится через шаблон:
[server/services/template-render.ts](../../../server/services/template-render.ts)
`readResultsRenderPayload` отдаёт `{layout, css, context}` (сервер владеет шаблонами);
GET `/attempts/:id/result` добавляет поле `render` (только standard-режим, иначе null —
fallback на React-вёрстку);
[client/src/components/template-screen.tsx](../../../client/src/components/template-screen.tsx)
`<TemplateScreen>` монтирует единый рендерер в **Shadow DOM** (CSS-изоляция) + делегирует
`data-action`-клики; [result.tsx](../../../client/src/pages/learner/result.tsx) standard-режим
рендерит `<TemplateResultPage>` (рендерер + back-link; restart через `onAction`). Проверяемое
зелено: TemplateScreen 3/3 jsdom (рендер+CSS+делегирование), GET-результат 32/32, `tsc` чисто.
**Визуальная приёмка — за пользователем** (запустить приложение, открыть итог; вид меняется
на template). Follow-ups (браузер): фиделити CSS/шрифтов/param-vars, адаптив пока на legacy,
SCORM-сторона (bundle 2-7 + конвертация) — браузер/сборка.

**Фиделити-доводка + проверка Playwright (2026-06-06).** На РЕАЛЬНЫХ данных (попытка из
тест-БД, «Базовые технологии», 60%, 8 тем) страница итогов рендерится из шаблона
корректно: тёмная тема, кольцо 60%, цветные бейджи/полосы тем (зелёный/красный). Исправлено:
(1) в [TemplateScreen](../../../client/src/components/template-screen.tsx) инжект CSS мапит
`:root`/`body`→`:host` — переменные темы (theme.css) работают в shadow; (2)
[results.html](../../../server/scorm/templates/default/layouts/results.html) сделан
самодостаточным БЕЗ JS — `--ring-offset` и ширина полосы темы через `{{ }}` из контекста
(кольцо/полосы рисуются на чистом CSS, без `template.js`). Остаётся косметика: шов
«светлый app-shell ↔ тёмный шаблон» (страница в light-режиме).

**#1 шов убран (2026-06-06).** `TemplateResultPage` сделан full-bleed: тёмная поверхность
шаблона на всю ширину/высоту контента, футер «К списку тестов» внутри на том же фоне; белых
полей нет. Цвета поверхности (`--background`/`--foreground`) берутся из `render.css` на
клиенте (`cssVar`), поэтому работает без рестарта сервера (сервер также отдаёт `theme` как
forward-compat). Остался только светлый топбар app-shell — это штатная nav-chrome, не шов.
Проверено Playwright: [.playwright-mcp/prd12-result-seamless.png].

**#2 адаптивные итоги через шаблон (2026-06-06).** Новый layout
[results.adaptive.html](../../../server/scorm/templates/default/layouts/results.adaptive.html)
(переиспользует results-классы + новые `is-info`/`topic-feedback`/`topic-link` в base.css);
`buildAdaptiveResultContext` (уровни/feedback/ссылки, без процентов);
`readResultsRenderPayload` выбирает layout по `mode`; `attempts.ts` отдаёт `render` и для
адаптива; `result.tsx` адаптивная ветка → `TemplateResultPage` при наличии `render`, иначе
legacy. Проверка headless: [tests/result-context.test.ts](../../../tests/result-context.test.ts)
e2e (контекст → реальный `results.adaptive.html`: пилюли уровней, feedback, вложенные
`{{#each}}` ссылки) + layouts-тест парсит адаптивный layout; всего 17/17, регрессия маршрута
32/32, `tsc` чисто. Браузер-визуал адаптива ПОДТВЕРЖДЁН (2026-06-06):
[.playwright-mcp/prd12-result-adaptive.png] — тёмная тема, синяя иконка, 4 темы с пилюлями
уровней + feedback, full-bleed. Верифицировано на втором dev-сервере (8082) через
`127.0.0.1` (изоляция cookie; коллизия была из-за общего `localhost`-cookie, не HMR).

**#3 старт-экран (интро) через шаблон (2026-06-06).** Standard-режим `take-test` рендерит
старт из [start.html](../../../server/scorm/templates/default/layouts/start.html) (полностью,
кнопки внутри шаблона через `onAction`: start-test/resume/back; состояния `canStart`/
`canResume`/`exhausted` + динамическая метка через контекст). Новый эндпоинт
`GET /api/tests/:id/screen-template/:screen` (`readScreenTemplate` — layout+css+theme, контекст
строит клиент); adaptive/ошибка → legacy React (fallback). Попутно исправлен баг шаблона:
start-секция base.css использовала `hsl(var(--x))` поверх готовых hsl-цветов (двойной hsl →
невалидно); заменено на `var(--x)`. Проверка: headless 13/13
([tests/start-screen-template.test.ts](../../../tests/start-screen-template.test.ts): инфо +
3 состояния кнопок + кастомный контент) + браузер
[.playwright-mcp/prd12-start-template.png]; регрессия итогов 40/40, `tsc` чисто.
Осталось в #3: контент-страницы, блок-экран retake, экран вопросов (последний — крупный
интерактив).

**#3 блок-экран retake через шаблон (2026-06-06).** Поток `403 RETAKE_COOLDOWN → блок-экран`:
`startStandardAttempt` бросает типизированную ошибку на код RETAKE_COOLDOWN; `handleStartTest`
грузит `blocked`-шаблон и показывает фазу `blocked`; рендер из
[system.blocked.html](../../../server/scorm/templates/default/layouts/system.blocked.html) —
ветка cooldown раскрывается инъекцией CSS (`data-retake-branch`+`hidden`; `{{#if}}` НЕ
добавлял, чтобы не сломать SCORM-gate.js, который рулит ветками своим JS), данные через
data-path (`retake.cooldownPeriodDays`/`availableDateHuman`). Эндпоинт `screen-template`
расширен на `blocked`. Проверка: headless 2/2
([tests/block-screen-template.test.ts](../../../tests/block-screen-template.test.ts)) +
браузер [.playwright-mcp/prd12-block-template.png] (403→блок, «не чаще раз в 30 дн.»,
«доступен с 5 июля 2026»); `tsc` чисто. Осталось в #3: контент-страницы, экран вопросов.

**#4 / 2-7 bundle-путь ВЫПОЛНЕН (2026-06-06).** SCORM-пакет теперь несёт общий рендерер из
`@shared` (а не рукописный порт): [shared/template/runtime-entry.ts](../../../shared/template/runtime-entry.ts)
(re-export dsl+renderers+render-screen) → esbuild-бандл (IIFE, глобал `TBTemplate`) через
[server/scorm/builders/shared-runtime.ts](../../../server/scorm/builders/shared-runtime.ts);
`generateScormPackage` префиксует бандл в `app.js`. Резолв: prod — prebuilt-ассет (генерит
[script/build.ts](../../../script/build.ts) в `dist/scorm/assets/shared-runtime.js`); dev —
esbuild из исходников (кэш per-process); vitest — пропуск (esbuild ломается в jsdom; бандл
покрыт отдельным node-тестом). Проверка: [tests/scorm-shared-bundle.test.ts](../../../tests/scorm-shared-bundle.test.ts)
(node: IIFE→`TBTemplate.renderTemplate` рабочий) + регрессия экспорта 28/28 + builders 74/74;
sample-пакет реально содержит `var TBTemplate`. **Это разблокирует конвертацию экранов SCORM
на `TBTemplate.renderScreenInto`** (Фаза 1, требует браузер/scorm-player).

**#3 экран вопросов — инкремент 1 (single-choice) ВЫПОЛНЕН+browser (2026-06-06).** Подход:
shadow-шаблон `question.html` даёт хром (header/прогресс/карточка/тема), интерактив —
HTML в слот `question-interaction`, стилизуется CSS шаблона (`.option` в base.css), клики
делегируются назад в React через `data-action="select:N"`; React держит состояние ответа,
навигация — на поверхности снизу. Новый компонент
[template-question-screen.tsx](../../../client/src/pages/learner/template-question-screen.tsx);
эндпоинт `screen-template` расширен на `question`; в `take-test` условный возврат (standard +
single + без feedback-режима + есть questionTpl), иначе legacy React. Проверка Playwright:
[.playwright-mcp/prd12-question-template.png] (рендер) + [.playwright-mcp/prd12-question-selected.png]
(выбор подсвечен через `.option.selected`); `tsc` чисто.

**#3 экран вопросов — инкремент 2 (multiple-choice) ВЫПОЛНЕН+browser (2026-06-06).**
`TemplateQuestionScreen` обобщён: single→radio, multiple→checkbox (та же `.option`-разметка);
`onSelect`→`onAnswer` (компонент строит ответ по типу: single=индекс, multiple=toggle в
массиве); гейт в `take-test` включает `multiple`. Проверка Playwright:
[.playwright-mcp/prd12-question-multiple.png] («2»+«4» отмечены, мультивыбор через
делегирование). Также подтвердились состояния старт-экрана (Продолжить+Начать заново при
незавершённой попытке).

**#3 экран вопросов — ranking + matching через настоящий HTML5-DnD ВЫПОЛНЕНО+browser
(2026-06-06).** ВАЖНО/исправление: в первой попытке я ошибочно подменил DnD (ranking→кнопки
↑/↓, matching→выпадашки) — это деградация без разрешения; по требованию пользователя
восстановлен НАСТОЯЩИЙ drag-and-drop (см. [[feedback_no_silent_capability_downgrade]]).
Реализация (финальная — pointer-based, по просьбе пользователя «видеть призрак»):
`TemplateScreen` делегирует **pointer-события** (`pointerdown/move/up`) на shadow-root
(элементы `[data-drag]`, зоны `[data-drop]`; `elementFromPoint` определяет цель → action
`drop:<dropId>:<dragId>`); разметка/классы те же, что в SCORM (`.rank-item.rank-draggable`,
`.match-chip`/`.match-drop-left`/`.match-drop-right`, пул деривируется). Ranking: drag-reorder
(moveInArray). Matching: левые фишки → правые слоты, `pairs={left:right}` с вытеснением;
возврат в пул через `.match-drop-left`. Фиксация дропа — по **перекрытию площади** карточки
с целью (≥10% площади карточки; макс. перекрытие, исключая исходный слот и сам призрак), а не
по точке курсора — прощающий дроп (проверено: ~11% перекрытия при курсоре в 230px от центра →
match; гоча — призрак-клон нёс `data-drop`/`data-drag` и считался своей же зоной, снял атрибуты).
Доработки: тонкий **волнистый шов** по центру слитой
пары (`.is-joined .matching-gap`, вертикальная SVG-волна); **явный drag — кастомный
полупрозрачный DOM-призрак карточки** (клон `.match-tile`/`.rank-item`, следует за курсором;
виден и проверяем — в отличие от нативного `setDragImage`); тач-поддержка (`touch-action:none`);
**маркер перетаскивания** на перетаскиваемых элементах (как ui-kit `.ou-match__icon`; у
целей-слотов маркера нет → видно, что тянуть) — РАЗНЫЕ глифы: ranking — бургер (≡), matching —
точки (⠿, как ui-kit `dots`), [.playwright-mcp/prd12-matching-dots-marker.png].
Почему pointer, а не HTML5-drag: нативный drag-image рисуется браузером вне DOM и не
захватывается Playwright; pointer + DOM-призрак — захватывается. Проверка Playwright
(`page.mouse` + скрин мид-драг): призрак-карточка пойман
[.playwright-mcp/prd12-matching-ghost-clean.png], обе пары слиты с волнистым швом
[.playwright-mcp/prd12-matching-both-paired.png]; ranking [.playwright-mcp/prd12-ranking-dnd.png];
`tsc` чисто. **Экран вопросов покрывает все 4 типа через шаблон**
(single/multiple/ranking/matching). Осталось: feedback-режим (Принять/Далее при
`showCorrectAnswers`), таймер (`#timer-display`).

### Фаза 4 — Приёмка

| ID | Задача | Зона | Вес |
| --- | --- | --- | --- |
| 4-1 | Паритет-тест: один публичный контекст → идентичный DOM в SCORM-host и web-host | tests | L |
| 4-2 | Визуальная сверка learner-экранов веб↔SCORM (скриншот-дисциплина) | acceptance | M |
| 4-3 | Регрессия: легаси-пакеты/результаты не сломаны; числа неизменны | tests | M |

---

## 7. Зависимости и порядок

- Фаза 0 — корневая (рендерер + контракты layout'ов); без неё ничего.
- Фаза 1 зависит от 0; внутрисредовый рефактор SCORM, проверяется существующими
  scorm-тестами/плеером — низкий риск регресса наружу.
- Фаза 2 независима (слой данных), может идти параллельно 0/1.
- Фаза 3 зависит от 0 (рендерер) и 2 (данные).
- Фаза 4 — после 1 и 3.

---

## 8. Тестирование и приёмка

- **DSL-контракт:** smoke по §9 спеки (все конструкции, экранирование, partial-fallback).
- **Golden рендера:** фикстура контекста → стабильный DOM-snapshot; один и тот же снапшот
  в обоих хостах (главный гейт L2).
- **Golden computation:** серверный `finish` = эталон SCORM на mbi/rtk.
- **Поток:** все валидные пары `mode×flowMode` (как PRD-4 golden).
- **Регрессия:** числа результатов и легаси-пакеты неизменны.
- **Визуальная приёмка:** сверка экранов веб↔SCORM на одинаковых данных.

---

## 9. Открытые вопросы и риски

### 9.1 Расчёт в вебе: сервер vs клиент — РЕШЕНО (2026-06-05): сервер

Расчёт в вебе — **серверный** (`@shared` + публичный контекст по REST). Причина —
граница доверия: в вебе клиент недоверенный, клиентский скоринг делает результат
подделываемым и раскрывает ключ ответов (ср.
[attempts.ts:112-114](../../../server/routes/attempts.ts#L112-L114), где `correctJson`
намеренно не уходит на клиент). Унификация «один Core» достигается на уровне рендерера
(§3.1) и единого расчётного модуля (§3.5), а НЕ места расчёта. Опция гибрида (клиент
считает для мгновенной обратной связи, сервер — авторитетный итог) оставлена на будущее,
вне охвата.

### 9.2 Объём L2 и поглощение PRD-3 — РЕШЕНО (2026-06-05): сужение PRD-3 согласовано

L2 достраивает платформенную часть PRD-3 (DSL, registry, layout-контракты), и эта часть
**переносится в PRD-12**. PRD-3 **сужен** до админ-реестра и жизненного цикла ВНЕШНИХ
шаблонных ZIP. Остаточный риск — недооценка объёма Фазы 0; перед стартом обязательна
инвентаризация «что из §9/§10 спеки уже есть vs нужно» (см. §10 п.2).

### 9.3 Безопасность DSL-рендерера

Полный DSL и renderer-плагины расширяют поверхность. Соблюсти §8.2.1.3 спеки (без
`eval`/`Function`, только публичный контекст, fallback при ошибке рендерера).

### 9.4 Производительность веб-хоста

Монтирование plain-JS рендерера внутри React/Vite требует аккуратной границы (порталы,
очистка, отсутствие гонок с React-реконсиляцией). Нужен изолирующий контейнер.

### 9.5 Контракт публичного контекста

§10 спеки — черновик. До Фазы 2/3 зафиксировать контракт контекста как версионированный
тип, общий для серверной сборки (веб) и клиентской сборки (SCORM), чтобы хосты не разошлись.

---

## 10. Следующие шаги

1. Закрыто 2026-06-05: §9.1 — расчёт серверный; §9.2 — сужение PRD-3 согласовано.
2. Инвентаризация платформы рендерера: §9/§10 спеки — что реально есть vs нужно
   (уточняет вес Фазы 0). Это первый шаг Фазы 0, read-only.
3. PRD-12 зарегистрирован в [ROADMAP](../../ROADMAP.md) §0.2 (с пометкой о поглощении
   платформенной части PRD-3). Старт кода Фазы 0 — после явного go владельца.
