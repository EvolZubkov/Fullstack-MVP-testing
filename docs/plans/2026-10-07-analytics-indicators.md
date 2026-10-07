# Показатели в аналитике теста: план реализации

> **Для исполнителя:** задачи выполняются по порядку, каждая по TDD (падающий тест, реализация,
> зелёный тест, коммит). Шаги отмечены флажками `- [ ]`.

**Цель.** Показатели PRD-2 появляются в аналитике теста наравне со шкалами: вкладка «Шкалы и
показатели», сравнение срезов, выгрузки Excel и протокол попытки — для веба, телеметрии и импорта
выгрузок LMS.

**Контракт.** [PRD-56](../specs/prd-56/analytics-rework.md) FR-07k, FR-07l, FR-21c - FR-21h;
эскиз [analytics-indicators.html](../wireframes/analytics-indicators.html).

**Архитектура.** Значения показателей уже сохранены у каждого прохождения
(`attempts.result_json.resultVariables`, `scorm_attempts.variables_json`). Добавляется только
сторона чтения: селектор репозитория рядом с `selectScaleValuesForTest`, приведение значения по
типу показателя, сводка `summariseIndicators` рядом с `summariseScales`, поле `indicators` в
ответах ручек шкал и срезов, панель на клиенте. Пересчёта по ответам нет нигде (FR-21e).

**Стек.** Express + Drizzle (сервер), React 19 + `@skillum/ui-kit` (клиент), Vitest, pglite для
интеграционных тестов (`npm run test:it`).

**Прогоны.** Только целевые: `npm test -- <путь>`, `npm run test:it -- <путь>`. Полный прогон —
лишь по явному разрешению владельца.

---

## Карта файлов

| Файл | Что меняется |
| --- | --- |
| `server/services/analytics/indicator-values.ts` | новый: приведение сырого значения к типу показателя |
| `server/storage/analytics-repository.ts` | `selectIndicatorValuesForTest`, тип `IndicatorValuesRow` |
| `server/storage/scorm-repository.ts`, `server/storage.ts` | `getScormAttemptMeasures(ids)` для выгрузки |
| `server/services/analytics/scale-profile.ts` | вынести `bandShares` для повторного использования |
| `server/services/analytics/indicator-profile.ts` | новый: `summariseIndicators` |
| `server/routes/analytics/observation-query.ts` | `narrowsSelection` (перенос `narrows` из срезов) |
| `server/routes/analytics/scales.ts` | фильтр экрана, поле `indicators` |
| `server/routes/analytics/test-details.ts` | `hasIndicators` |
| `server/routes/analytics/answer-slices.ts` | `slices[].indicators` |
| `server/routes/analytics/scorm.ts` | показатели LMS-попытки из `variables_json`, `indicatorViews` |
| `server/routes/analytics/helpers.ts` | каталог измерений с типами и толкованием, ячейки для LMS |
| `server/routes/analytics/export.ts` | листы «Прохождения» и «Измерения» для всех источников |
| `server/services/analytics/attempt-protocol.ts` | лист «Показатели» с названием и уровнем |
| `client/src/features/analytics/test/indicator-profile.tsx` | новый: `IndicatorProfilePanel` |
| `client/src/pages/author/test-analytics.tsx` | вкладка «Шкалы и показатели», фильтр в запросе |
| `client/src/features/analytics/test/answers-compare.tsx` | блок «Показатели» |
| `client/src/features/analytics/slices/test-slices-tab.tsx` | пункт «Ответы, шкалы и показатели» |

## Задача 1. Приведение значения показателя

**Файлы:** создать `server/services/analytics/indicator-values.ts`, тест
`server/services/analytics/__tests__/indicator-values.test.ts`.

Значение из пакета и выгрузки приходит строкой (`"3.5"`, `"true"`), из веба — родным типом.
Импорт WebTutor может отдать десятичную запятую.

- [ ] Тест: `indicatorValueOf("number", "3,5") === 3.5`, `("number", 7) === 7`,
  `("number", "abc") === null`, `("boolean", "true") === true`, `("boolean", false) === false`,
  `("boolean", "maybe") === null`, `("string", "kom+vdh") === "kom+vdh"`, `("string", 3) === "3"`,
  пустая строка, `null` и `undefined` дают `null` для всех типов.
- [ ] Реализация:

```ts
export type IndicatorType = "number" | "string" | "boolean";
export type IndicatorValue = number | string | boolean;

export function indicatorValueOf(type: string, raw: unknown): IndicatorValue | null {
  if (raw === null || raw === undefined || raw === "") return null;
  if (type === "number") {
    if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
    if (typeof raw !== "string") return null;
    const n = Number(raw.trim().replace(",", "."));
    return raw.trim() !== "" && Number.isFinite(n) ? n : null;
  }
  if (type === "boolean") {
    if (typeof raw === "boolean") return raw;
    const word = String(raw).trim().toLowerCase();
    if (word === "true" || word === "1") return true;
    if (word === "false" || word === "0") return false;
    return null;
  }
  return String(raw);
}

export function indicatorValuesOf(
  variables: ReadonlyArray<{ name: string; type: string }>,
  raw: Record<string, unknown> | null | undefined,
): Record<string, IndicatorValue> { /* only names with a non-null value */ }
```

- [ ] Коммит `feat(analytics): приведение значения показателя по типу`.

## Задача 2. Селектор значений показателей

**Файлы:** `server/storage/analytics-repository.ts`, `server/storage.ts` (контракт `IStorage` и
делегат), тест `tests/it/analytics-scale-values.it.test.ts` (новый `describe`).

- [ ] IT-тест: веб-попытка с `resultJson.resultVariables = { idx: 64, style: "kom" }` и строка
  телеметрии с `variablesJson = { idx: "58" }` дают две строки с сырыми значениями; чужой тест не
  попадает; незавершённая строка LMS не попадает; старая строка телеметрии находит тест через
  пакет.
- [ ] Реализация `selectIndicatorValuesForTest(testId): Promise<IndicatorValuesRow[]>` — те же два
  запроса и те же условия, что у `selectScaleValuesForTest`; `values` — сырая запись
  (`resultVariables` либо `variablesJson`, иначе `{}`). Тип:

```ts
export interface IndicatorValuesRow {
  attemptId: string;
  source: ObservationSourceName;
  /** Raw stored record «name -> value»; normalised by the indicator type later. */
  values: Record<string, unknown>;
}
```

- [ ] `npm run test:it -- tests/it/analytics-scale-values.it.test.ts` зелёный, коммит.

## Задача 3. Сводка по показателям

**Файлы:** `server/services/analytics/scale-profile.ts` (вынести `bandShares`),
создать `server/services/analytics/indicator-profile.ts`, тест
`server/services/analytics/__tests__/indicator-profile.test.ts`.

Форма ответа:

```ts
export interface IndicatorShare {
  key: string;        // band level, outcome code or raw value
  label: string;
  count: number;
  share: number;      // percent of sampleSize
  color: string;      // ready CSS colour
  tone: LevelTone | null;
  rest?: boolean;     // the «Прочее» bucket
}
export interface IndicatorProfile {
  name: string;
  label: string;
  type: "number" | "string" | "boolean";
  kind: "bands" | "average" | "outcomes";
  sampleSize: number; // runs with a value
  missing: number;    // runs of the selection without a value
  average: number | null;
  domainMin: number | null;
  domainMax: number | null;
  shares: IndicatorShare[];
}
```

Правила (FR-21d):

- числовой с полосами: `kind = "bands"`, доли через тот же `bandShares`, что у шкалы (цвет —
  `zoneColors` по рампе и валентности, FR-21a);
- числовой без полос: `kind = "average"`, `shares = []`;
- строковый и логический: `kind = "outcomes"`. Есть исходы в толковании — счёт через
  `findOutcome`, порядок исходов авторский, исходы с нулём не выводятся, несовпавшие значения —
  `«Прочее»` последним. Исходов нет — группировка по самому значению (логическое — «Да» / «Нет»),
  не больше шести групп по убыванию, остальное — «Прочее»;
- цвет исхода: тон автора -> `var(--ou-success-default)` / `var(--ou-info-default)` /
  `var(--ou-warning-default)` / `var(--ou-error-default)` (favorable / neutral / attention /
  critical); без тона — `hsl(CATEGORICAL_HUES[i % 6])` по порядку; «Прочее» —
  `var(--ou-border-strong)`;
- `missing = rows.length - sampleSize`; среднее при `sampleSize = 0` — `null`.

- [ ] Тесты на каждое правило выше, включая строку из пакета `"64"` для числового показателя и
  `"true"` для логического.
- [ ] Вынести из `summariseScales` функцию `bandShares(values, interpretation, ramp)` без
  изменения поведения: `server/services/analytics/__tests__/scale-profile.test.ts` остаётся
  зелёным.
- [ ] Реализовать `summariseIndicators(rows, variables, { ramp })`, где `variables` — строки
  `result_variables` (`name`, `label`, `type`, `configJson`, `sortOrder`), порядок — авторский.
- [ ] Коммит.

## Задача 4. Ручка вкладки и признак `hasIndicators`

**Файлы:** `server/routes/analytics/observation-query.ts`, `server/routes/analytics/scales.ts`,
`server/routes/analytics/answer-slices.ts` (импорт `narrowsSelection`),
`server/routes/analytics/test-details.ts`; тест — новый `tests/routes.analytics-scales.test.ts`,
дополнение `tests/routes.analytics-helpers-test-details.test.ts`.

- [ ] Тест ручки: без условий в адресе берутся все строки; с `groupId=g1` — только прохождения,
  которые вернул `loadObservations`; в ответе `indicators` из `summariseIndicators`;
  `observations` — число строк выборки, у которых есть значение шкалы ИЛИ показателя.
- [ ] Перенести `narrows` из `answer-slices.ts` в `observation-query.ts` как экспорт
  `narrowsSelection(filter)`.
- [ ] Ручка `/tests/:testId/scales`: `readTestFilterQuery(req, testId, false)`, затем
  `loadObservations(filter, { all: true, ids: new Set([testId]) })` и отбор строк обоих селекторов
  по `narrowsSelection`. Ответ `{ testId, observations, scales, indicators }`.
- [ ] `test-details.ts`: `hasIndicators = (await storage.getResultVariables(testId)).length > 0`
  рядом с `hasScales`.
- [ ] Коммит.

## Задача 5. Показатели в сравнении срезов

**Файлы:** `server/routes/analytics/answer-slices.ts`, тест
`tests/routes.analytics-answer-slices.test.ts`.

- [ ] Тест: срез «Группа» получает в `indicators` сводку только по своим прохождениям, «Тест
  целиком» — по всем.
- [ ] Читать `storage.getResultVariables` и `storage.selectIndicatorValuesForTest` один раз,
  резать тем же `selects`, что строки шкал; `indicators: summariseIndicators(...)`.
- [ ] Коммит.

## Задача 6. Показатели попытки LMS — из сохранённого значения

**Файлы:** `server/routes/analytics/scorm.ts`, тест `tests/routes.analytics-scorm.coverage.test.ts`.

- [ ] Тест: у попытки с `variablesJson = { idx: "64" }` в разборе `resultVariables.idx === 64`
  и `indicatorViews[0].interpretation` — метка полосы; у попытки без `variablesJson` —
  `resultVariables = {}` (пересчёта нет), значение в `indicatorViews` — `null`.
- [ ] В `loadScormAttemptDetail` вместо `graded.resultVariables` —
  `indicatorValuesOf(rvRows, attempt.variablesJson)`; добавить
  `indicatorViews: buildIndicatorViews(rvRows, resultVariables)`. Шкалы не трогаются.
- [ ] Коммит.

## Задача 7. Выгрузка Excel

**Файлы:** `server/storage/scorm-repository.ts`, `server/storage.ts`,
`server/routes/analytics/helpers.ts`, `server/routes/analytics/export.ts`; тесты
`tests/routes.analytics-export.test.ts`, `tests/routes.analytics-measurement.test.ts`.

- [ ] `getScormAttemptMeasures(ids)` -> `{ id, scalesJson, variablesJson }[]`.
- [ ] `MeasureCatalogue`: у шкалы добавить `configJson`, у показателя — `type` и `configJson`.
- [ ] `lmsStoredResult(catalogue, measures)` в `helpers.ts` строит запись в форме веб-результата:
  `scaleResults[key] = { raw, label }` (метка — `findBand` по полосам шкалы),
  `resultVariables = indicatorValuesOf(...)`. Так `measureCells` работает без изменений.
- [ ] Тест: книга одного теста — строка телеметрии получает значения колонок шкал и показателей;
  лист «Измерения» содержит строки веба, телеметрии и импорта; колонка «Уровень» у показателя —
  метка полосы или исхода (`buildIndicatorViews`).
- [ ] Обновить комментарии, где сказано «LMS их не сообщает».
- [ ] Коммит.

## Задача 8. Протокол попытки

**Файлы:** `server/services/analytics/attempt-protocol.ts`, тест
`server/services/analytics/__tests__/attempt-protocol.test.ts`.

- [ ] Тест: при `detail.indicatorViews` лист «Показатели» — колонки «Ключ», «Название»,
  «Значение», «Уровень / исход»; логическое значение — «да» / «нет», пустое — пустая ячейка.
  Без `indicatorViews` (старый разбор) — прежний лист из `resultVariables`.
- [ ] Реализация, коммит.

## Задача 9. Клиент: вкладка «Шкалы и показатели»

**Файлы:** создать `client/src/features/analytics/test/indicator-profile.tsx` и тест
`client/src/features/analytics/test/__tests__/indicator-profile.test.tsx`; изменить
`client/src/pages/author/test-analytics.tsx`.

- [ ] Тест панели: строка каждого вида из эскиза; «среднее 64,2 из 100 · 380 прохождений · у 32
  не передано»; «у N не передано» отсутствует при `missing = 0`; показатель с `sampleSize = 0` —
  приглушённое название и «не передано ни в одном из N прохождений».
- [ ] `IndicatorProfilePanel` по разметке эскиза: `Card` «Показатели», `ProgressStacked` с
  легендой для `bands` и `outcomes`, `ProgressBar size="s" hideHeader` для `average`.
- [ ] `test-analytics.tsx`: запрос `/scales` с `filterSearch` в ключе и адресе; вкладка
  `{ id: "scales", label: "Шкалы и показатели" }` при `hasScales || hasIndicators`; внутри —
  `IndicatorProfilePanel` при `hasIndicators`, затем карточки шкал и качество шкал при
  `hasScales`.
- [ ] Коммит.

## Задача 10. Клиент: сравнение срезов

**Файлы:** `client/src/features/analytics/test/answers-compare.tsx`,
`client/src/features/analytics/slices/test-slices-tab.tsx`, тесты обоих в `__tests__`.

- [ ] Тест: блок «Показатели» над «Шкалами»: таблица средних для `bands` и `average` с
  «Разницей» при двух срезах; таблица долей на каждый показатель с `shares` (строка — уровень или
  исход, колонка — срез).
- [ ] Пункт переключателя — «Ответы, шкалы и показатели»; обновить тесты, которые ищут кнопку по
  тексту, и JSDoc трёх модулей сравнения.
- [ ] Коммит.

## Задача 11. Приёмка и документация

- [ ] `npm run check`; целевые прогоны всех тестов, затронутых задачами 1 - 10.
- [ ] Браузерная приёмка на dev-сервере этого worktree: демо-тест с показателями трёх типов,
  вкладка, фильтр по источнику, сравнение двух срезов, выгрузка Excel и протокол LMS-попытки.
  Сверка с эскизом.
- [ ] Документация: руководство автора (раздел аналитики), новая строка «Профиль по показателям»
  в `docs/reports/ANALYSIS_*.md` по правилу ROADMAP §0.0.5, эскиз — в `approved/` после приёмки.
- [ ] markdownlint по изменённым `.md`.
