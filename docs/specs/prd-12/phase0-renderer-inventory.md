# PRD-12 · Фаза 0: инвентаризация платформы рендерера

**Дата:** 2026-06-05
**Тип:** read-only анализ (первый шаг Фазы 0; см. [PRD-12](./web-runtime-parity.md) §10 п.2)
**Сверка:** [spec-template-platform.md](../spec-template-platform.md) §7/§8/§9/§10 против
фактической реализации в `server/scorm/template/app/`.

## Главный вывод

Из всех экранов **только экран блокировки** (`gate.js`) реально рендерится из
загруженного layout-файла шаблона. Загруженные `templateLayouts` читаются **только**
в [gate.js:167](../../../server/scorm/template/app/eligibility/gate.js#L167); ни
вопрос, ни итоги, ни контент-страницы их не используют. Эти экраны строятся
**хардкодом в JS**, а шаблонный слой лишь накладывает на готовый DOM CSS-переменные и
заполняет `data-path`/`data-placeholder`/`data-slot`.

Полноценного DSL-движка §9 (`{{ }}`, `{{#if}}`, `{{#each}}`, partials) **нет**. Единого
публичного контекста §10 как контракта **нет**. При этом layout-файлы `results.html` и
`question.html` уже написаны в ЦЕЛЕВОМ DSL (`{{#each}}`/`{{#if}}`) — то есть вёрстка
опережает движок и сейчас не рендерится.

Итог по объёму Фазы 0: вес определяется двумя по сути greenfield-кусками — **DSL-движок**
и **сборка публичного контекста**. Частично компенсируется тем, что **реестр рендереров
уже готов**, а часть layout'ов уже написана.

## §9 — DSL-рендерер

| Возможность | Статус | Доказательство |
| --- | --- | --- |
| `{{ path }}` (экранированная интерполяция) | Нет | в рантайме нет парсера `{{ }}`; есть только `data-path`→`textContent` ([templateCore.js:230](../../../server/scorm/template/app/templateCore.js#L230)) |
| `{{#if}}` / `{{#unless}}` | Нет | общего движка нет; в `gate.js` своя точечная `applyBlockBranches` |
| `{{#each}}` (смена контекста) | Нет | — |
| `{{> partial}}` | Нет | — |
| `@root`/`@index`/`@number`/`@first`/`@last` | Нет | — |
| `data-path` (текст-биндинг) | Есть | `renderPathOnlyDsl` ([templateCore.js:230](../../../server/scorm/template/app/templateCore.js#L230)) |
| `data-placeholder` (заполнение) | Есть | `fillPlaceholders` ([templateCore.js:210](../../../server/scorm/template/app/templateCore.js#L210)) |
| `data-slot` (контролируемые слоты) | Есть | `fillControlledSlots` ([templateCore.js:240](../../../server/scorm/template/app/templateCore.js#L240)) |
| Экранирование вывода | Частично | `data-path` через `textContent`; placeholders экранируются по типу |

Вывод: реализован **атрибутный субсет** (`data-*`), а декларативный мустач §9 — нет.

## §10 — Публичный контекст

| Пространство | Статус | Примечание |
| --- | --- | --- |
| Единый билдер контекста | Нет | единственный `buildContext` — в [gate.js:30](../../../server/scorm/template/app/eligibility/gate.js#L30), только под блок-экран |
| `test.*` | Ad-hoc | данные берутся из `TEST_DATA`, не из контракта §10 |
| `page.*` (+ `answerState`, `feedback`) | Ad-hoc | собирается в хардкод-рендерах; контракта нет |
| `sections[]` (`isActive`/`isPassed`/`className`) | Ad-hoc | классы состояния считаются по месту |
| `progress.*` (active/question/page) | Ad-hoc | прогресс есть в UI, но не как объект контекста |
| `nav.*` (`canNext`/labels/classNames) | Нет | кнопки навигации хардкодятся, не из контекста |
| `params.*` | Есть | `TEST_DATA.designSettings.params` → CSS-переменные |
| §10.1 раскрытие правильных ответов | Частично | модуль `feedback` есть, но не как поле публичного контекста |

Вывод: §10 как **единый типизированный контракт отсутствует**; данные собираются
по месту в каждом экране.

## §7 / §8 — Shell и layout-контракты

| Элемент | Статус | Примечание |
| --- | --- | --- |
| `shell.html` (§7) | Загружается, НЕ используется | пишется в `state.templateShell` ([templateLoader.js:63](../../../server/scorm/template/app/templateLoader.js#L63)), потребителя нет; DOM-оболочка приходит из `index.html` |
| layout вопроса (§8.1) | Файл есть, не рендерится | `layouts/question.html` (`data-slot` стиль; именование `question-text` vs спека `question-prompt`) |
| layout итогов (§8.3) | Файл есть, не рендерится | `layouts/results.html` написан в мустаче `{{#each}}`/`{{#if}}` — опережает движок |
| layout контента (§8.2) | Файл есть, не инжектится | контент строится в JS (`contentPage.js`) + `fillPlaceholders`; `content.html` не используется |
| layout блокировки | **Рендерится** | `system.blocked.html` через `gate.js` (единственный реально работающий layout) |

## §8.2.1.2 — Реестр рендереров

| Возможность | Статус | Доказательство |
| --- | --- | --- |
| Реестр + `register()` + dispatcher + fallback | Есть | [renderers.js:287-306](../../../server/scorm/template/app/render/renderers.js#L287-L306) |
| Core-рендереры | 5 из «полного» набора | `core.textMetric`, `core.badge`, `core.progressBar`, `core.ringChart`, `core.segmentedProgress` |
| Проверка `allowedRenderers` + fallback на `textMetric` | Есть | `renderResultField` |
| Использование | Только контент-страницы | `fillResultFieldPlaceholder` ([contentPage.js:165](../../../server/scorm/template/app/render/contentPage.js#L165)) |
| Отсутствуют (опц.) | `questionTiles`/`sectionList`/`scaleBars` | в спеке как рекомендации/плагины, не обязательны для MVP |

Вывод: реестр (§8.2.1.2) для MVP по сути **готов**; не хватает только подключения к
экранам вопроса/итогов (сейчас он работает лишь для контент-страниц).

## Что уже готово (снижает объём Фазы 0)

- Загрузчик: `manifest.json` + `shell.html` + layouts + renderer-plugins ([templateLoader.js](../../../server/scorm/template/app/templateLoader.js)).
- CSS-переменные из params, `textFit`, autoAdvance, событийный эмиттер, `TestBuilder`-стаб ([templateCore.js](../../../server/scorm/template/app/templateCore.js)).
- Реестр рендереров с fallback ([renderers.js](../../../server/scorm/template/app/render/renderers.js)).
- Заполнители `data-placeholder`/`data-slot`/`data-path`.
- Layout'ы `results.html`/`question.html`/`content.html`/`start.html` уже написаны (часть — в целевом DSL).
- Сквозной прецедент «load layout → render → inject» работает на блок-экране (`gate.js`).

## Что отсутствует (ядро Фазы 0)

1. **DSL-движок §9** — `{{ }}`/`{{#if}}`/`{{#unless}}`/`{{#each}}`/`{{> partial}}`/`@root|@index|...`
   с экранированием. Главный greenfield-кусок и критический путь.
2. **Единый публичный контекст §10** — типизированный билдер
   (`test/page/sections/progress/nav/answerState/feedback/params`), общий для обоих хостов.
3. **Переключение главного render-пайплайна на layouts** — сейчас вопрос/итоги/контент
   рендерятся в обход layout'ов; их надо прогонять через `templateLayouts` + DSL + слоты
   (частично уходит в Фазу 1).
4. **Подключение shell.html** (§7) как DOM-оболочки.

## Уточнение оценок задач Фазы 0

| Задача (PRD-12 §6) | Было | Уточнение |
| --- | --- | --- |
| 0-1 DSL-движок | L | **L/XL — критический путь**; greenfield, но юнит-тестируем по §9 |
| 0-2 Реестр рендереров | M | **→ S**: реестр готов; остаётся подключить к вопросу/итогам + тесты |
| 0-3 Публичный контекст §10 | M | **M/L**: единого билдера нет, собрать с нуля как контракт |
| 0-4 layout вопроса | M | **→ S/M**: файл есть; выверить под финальный движок + слоты (`question-prompt`) |
| 0-5 layout итогов | M | **M**: файл есть в мустаче; выверить + добавить блоки «Показатели»/«Шкалы» (нужен 1 эскиз) |
| (новое) 0-6 подключение shell.html | — | **S**: оболочка из шаблона вместо `index.html` |

## Риски и нюансы

- **Вёрстка опережает движок:** `results.html`/`question.html` написаны в мустаче,
  которого нет; при включении движка их надо проверять на соответствие финальному DSL
  (риск скрытых расхождений синтаксиса).
- **Дрейф именования слотов:** `question-text` в layout vs `question-prompt` в спеке §8.1 —
  зафиксировать единый словарь слотов до Фазы 1.
- **shell не подключён:** переход на `shell.html` затронет загрузку и точку монтирования —
  аккуратно с веб-хостом (Фаза 3), где монтирование внутри React.
- **§9.2 (недооценка объёма):** подтверждено частично — самый тяжёлый неизвестный (DSL)
  теперь сведён к «реализовать мустач-субсет §9», что ограничено и тестируемо; реестр
  оказался готов, что компенсирует.
