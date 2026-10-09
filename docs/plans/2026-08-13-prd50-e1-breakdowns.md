# PRD-50 Э1: разрезы результата — движок, контекст, полосы в карточке темы

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Требования:** [спека PRD-50](../specs/prd-50/result-breakdowns.md), этап Э1 — FR-01 - FR-08,
FR-13 - FR-18, FR-28 (только вложенная проекция), FR-31 - FR-33, FR-35 - FR-37, FR-40.

**Ветка:** `prd-50-result-breakdowns` (спека уже в ней).

**Goal:** научить сервис считать подытоги по ключам разреза в области раздела и теста, отдавать
их обоим хостам, формулам и раскладкам, и печатать полосы в карточке темы — не меняя ни одного
теста, где автор этого не включил.

**Architecture:** новый чистый модуль `shared/breakdown/` считает записи разреза по выданным
элементам; `aggregateStandardResult` вызывает его один раз и раскладывает результат по темам и
по тесту; веб-хост и рантайм SCORM подают в агрегат одно и то же поле `axisKeys`; контекст
формул и контекст рендера читают готовые записи. Модуль едет в общий бандл `shared-runtime`,
поэтому JS-двойника нет.

**Tech Stack:** TypeScript, Vitest (`npm test -- <путь>`), Drizzle (`drizzle-kit generate`),
плоский ES5-рантайм пакета SCORM (`server/scorm/template/app/**`), DSL-шаблонизатор
`shared/template/dsl.ts`.

---

## Файловая карта

| Файл | Ответственность |
| --- | --- |
| `shared/breakdown/types.ts` (создать) | формы входа и записи разреза |
| `shared/breakdown/compute.ts` (создать) | единственный алгоритм подсчёта разрезов |
| `shared/breakdown/compute.test.ts` (создать) | модульные тесты алгоритма |
| `shared/scoring/aggregate.ts` (правка) | приём `axisKeys`, вызов модуля, раскладка по областям |
| `tests/breakdown-aggregate.test.ts` (создать) | golden-тесты интеграции с агрегатом |
| `shared/schema.ts` (правка) | `breakdown` в `topicResultSchema`, `breakdownDisplay` в настройках теста |
| `server/routes/attempts.ts` (правка) | подача `axisKeys`, сохранение разрезов в результат |
| `server/scorm/template/app/render/resultsPage.js` (правка) | подача `axisKeys`, живые `tags`/`sections` |
| `server/scorm/builders/test-json.ts` (правка) | выпечка тегов для адаптивных разделов |
| `server/services/result-compute.ts` (правка) | живые `ctx.tags` и `ctx.sections` |
| `shared/formula/validate.ts` (правка) | составные ключи `раздел::ключ` в проверке |
| `shared/template/context.ts` (правка) | `breakdown` в `CtxTopicResultView` |
| `shared/template/result-context.ts` (правка) | сборка вида полос, гашение по видимости |
| `client/src/features/tests/editor/sections/basic-settings-section.tsx` (правка) | переключатель показа |
| `server/services/test-settings.ts` (правка) | белый список сохраняемых настроек |
| `server/scorm/templates/default/layouts/results.html`, `report.html` (правка) | вёрстка полос |
| `server/scorm/templates/default/styles/theme.css` (правка) | стили полос, один источник на оба хоста |

---

## Task 1: модуль `shared/breakdown/`

**Files:**

- Create: `shared/breakdown/types.ts`
- Create: `shared/breakdown/compute.ts`
- Test: `shared/breakdown/compute.test.ts`

- [ ] **Шаг 1. Написать типы**

`shared/breakdown/types.ts`:

```ts
/**
 * @module shared/breakdown/types
 * @description Input and output shapes of the PRD-50 result breakdown — the aggregate of
 * DELIVERED items grouped by an axis key within a scope. Kept apart from the compute so
 * both hosts and the render context can depend on the shapes without pulling the algorithm.
 */

/** One delivered, already-graded question as the breakdown sees it. */
export interface BreakdownItem {
  /** Section the question was DELIVERED in (PRD-50 решение 2) — not the owning topic. */
  sectionId: string;
  /** Keys per axis, e.g. `{ tag: ["Персональные данные"] }`. Absent = the item groups nowhere. */
  axisKeys?: Record<string, string[]> | null;
  /** Points earned for this question. */
  earned: number;
  /** Points the question could bring. Zero = measurement-only, excluded (FR-02). */
  possible: number;
  /** Whether the learner answered it at all. */
  answered: boolean;
}

/** One computed breakdown record. */
export interface BreakdownEntry {
  /** `"test"` or `"section:<sectionId>"`. */
  scope: string;
  axis: string;
  key: string;
  items: number;
  answered: number;
  earned: number;
  possible: number;
  /** Σ of per-question ratios — every question weighs 1 (FR-02). */
  unitEarned: number;
  /** = items. */
  unitPossible: number;
  /** `earned / possible`, 0…100. The verdict currency (FR-21). */
  percentPoints: number;
  /** `unitEarned / unitPossible`, 0…100. The display default (решение 4). */
  percentUnits: number;
}
```

- [ ] **Шаг 2. Написать падающий тест**

`shared/breakdown/compute.test.ts`:

```ts
/**
 * @module shared/breakdown/compute.test
 * @description PRD-50 FR-01 - FR-05: the single breakdown algorithm both hosts call.
 */
import { describe, it, expect } from "vitest";
import { computeBreakdowns, TEST_SCOPE, sectionScope } from "./compute";
import type { BreakdownItem } from "./types";

const item = (sectionId: string, tags: string[] | null, earned: number, possible: number): BreakdownItem => ({
  sectionId,
  axisKeys: tags ? { tag: tags } : null,
  earned,
  possible,
  answered: true,
});

describe("computeBreakdowns", () => {
  it("даёт запись в области раздела и в области теста", () => {
    const out = computeBreakdowns([item("law", ["ПДн"], 1, 2)]);
    expect(out).toEqual([
      { scope: sectionScope("law"), axis: "tag", key: "ПДн", items: 1, answered: 1,
        earned: 1, possible: 2, unitEarned: 0.5, unitPossible: 1,
        percentPoints: 50, percentUnits: 50 },
      { scope: TEST_SCOPE, axis: "tag", key: "ПДн", items: 1, answered: 1,
        earned: 1, possible: 2, unitEarned: 0.5, unitPossible: 1,
        percentPoints: 50, percentUnits: 50 },
    ]);
  });

  it("не берёт вопрос без возможных баллов (FR-02)", () => {
    expect(computeBreakdowns([item("law", ["ПДн"], 0, 0)])).toEqual([]);
  });

  it("не берёт вопрос без ключей", () => {
    expect(computeBreakdowns([item("law", null, 1, 1)])).toEqual([]);
  });

  it("тег в двух разделах даёт три записи (FR-04)", () => {
    const out = computeBreakdowns([item("law", ["ПДн"], 1, 1), item("sec", ["ПДн"], 0, 1)]);
    expect(out.map((e) => e.scope)).toEqual([sectionScope("law"), TEST_SCOPE, sectionScope("sec")]);
    const test = out.find((e) => e.scope === TEST_SCOPE)!;
    expect(test).toMatchObject({ items: 2, earned: 1, possible: 2, unitEarned: 1, percentUnits: 50 });
  });

  it("повторённый ключ одного вопроса считается один раз", () => {
    const out = computeBreakdowns([item("law", ["ПДн", "ПДн"], 1, 1)]);
    expect(out[0].items).toBe(1);
  });

  it("балльная и нормированная базы расходятся при разной цене вопросов", () => {
    const out = computeBreakdowns([item("law", ["ПДн"], 3, 3), item("law", ["ПДн"], 0, 1)]);
    const sec = out[0];
    expect(sec.percentPoints).toBe(75);
    expect(sec.percentUnits).toBe(50);
  });
});
```

- [ ] **Шаг 3. Убедиться, что тест падает**

Команда: `npm test -- shared/breakdown/compute.test.ts`
Ожидание: FAIL, `Failed to resolve import "./compute"`.

- [ ] **Шаг 4. Написать реализацию**

`shared/breakdown/compute.ts`:

```ts
/**
 * @module shared/breakdown/compute
 * @description THE single PRD-50 breakdown algorithm, called by `aggregateStandardResult`
 * and therefore by BOTH hosts (the web grader and the SCORM runtime, which reaches it
 * through the `TBTemplate` bundle). Pure: no host types, no I/O, deterministic order.
 *
 * Two scopes per key — the delivering section and the whole test (FR-04). The test scope
 * is a separate pass over the items, not a sum of section records: a question delivered in
 * two sections counts twice, which is a property of the delivery, not an error.
 */
import type { BreakdownEntry, BreakdownItem } from "./types";

export const TEST_SCOPE = "test";

/** Scope string of a section. The section is the DELIVERING one (решение 2). */
export function sectionScope(sectionId: string): string {
  return "section:" + sectionId;
}

interface Acc {
  scope: string;
  axis: string;
  key: string;
  items: number;
  answered: number;
  earned: number;
  possible: number;
  unitEarned: number;
}

function percent(part: number, whole: number): number {
  return whole > 0 ? (part / whole) * 100 : 0;
}

/**
 * Compute every breakdown record of one attempt.
 *
 * Order is deterministic and follows first appearance: an item's section record is
 * emitted before its test record, so a host that renders the array as-is gets a stable
 * layout and a package rebuilt from unchanged data stays byte-identical.
 */
export function computeBreakdowns(items: readonly BreakdownItem[]): BreakdownEntry[] {
  const order: string[] = [];
  const acc = new Map<string, Acc>();

  const bump = (scope: string, axis: string, key: string, item: BreakdownItem): void => {
    const id = scope + " " + axis + " " + key;
    let row = acc.get(id);
    if (!row) {
      row = { scope, axis, key, items: 0, answered: 0, earned: 0, possible: 0, unitEarned: 0 };
      acc.set(id, row);
      order.push(id);
    }
    row.items += 1;
    if (item.answered) row.answered += 1;
    row.earned += item.earned;
    row.possible += item.possible;
    // FR-02: the question's own share, so every question weighs exactly 1.
    row.unitEarned += item.possible > 0 ? item.earned / item.possible : 0;
  };

  for (const item of items) {
    // FR-02: nothing to grade — nothing to show. A measurement-only question would
    // otherwise drag a bar to zero on a scale it never belonged to.
    if (!(item.possible > 0)) continue;
    const keys = item.axisKeys;
    if (!keys) continue;
    for (const axis of Object.keys(keys)) {
      const seen = new Set<string>();
      for (const key of keys[axis] || []) {
        // A question repeating a key does not count twice.
        if (!key || seen.has(key)) continue;
        seen.add(key);
        bump(sectionScope(item.sectionId), axis, key, item);
        bump(TEST_SCOPE, axis, key, item);
      }
    }
  }

  return order.map((id) => {
    const row = acc.get(id)!;
    return {
      scope: row.scope,
      axis: row.axis,
      key: row.key,
      items: row.items,
      answered: row.answered,
      earned: row.earned,
      possible: row.possible,
      unitEarned: row.unitEarned,
      unitPossible: row.items,
      percentPoints: percent(row.earned, row.possible),
      percentUnits: percent(row.unitEarned, row.items),
    };
  });
}
```

- [ ] **Шаг 5. Прогнать тест**

Команда: `npm test -- shared/breakdown/compute.test.ts`
Ожидание: PASS, 6 тестов.

- [ ] **Шаг 6. Коммит**

```bash
git add shared/breakdown
git commit -m "feat(prd-50): движок разрезов результата"
```

---

## Task 2: разрезы в агрегате

**Files:**

- Modify: `shared/scoring/aggregate.ts`
- Test: `tests/breakdown-aggregate.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

`tests/breakdown-aggregate.test.ts`:

```ts
/**
 * @module tests/breakdown-aggregate
 * @description PRD-50 FR-14 - FR-18: `aggregateStandardResult` раскладывает записи разреза
 * по темам и по тесту. Golden-тест: тем же кодом считает рантайм пакета SCORM.
 */
import { describe, it, expect } from "vitest";
import { aggregateStandardResult, type AggregateSection } from "../shared/scoring/aggregate";
import { TEST_SCOPE, sectionScope } from "../shared/breakdown/compute";

const q = (correctIndex: number, answer: number | null, tags: string[] | null, points = 1) => ({
  type: "single" as const,
  correct: { correctIndex },
  scoring: null,
  points,
  answer,
  ...(tags ? { axisKeys: { tag: tags } } : {}),
});

const section = (topicId: string, qs: AggregateSection["questions"]): AggregateSection => ({
  topicId,
  topicName: topicId,
  topicPassRule: null,
  questions: qs,
});

describe("aggregateStandardResult + разрезы", () => {
  it("кладёт записи раздела в тему, записи теста — в результат", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(0, 0, ["ПДн"]), q(0, 1, ["ПДн"])])],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].breakdown).toEqual([
      expect.objectContaining({ scope: sectionScope("law"), key: "ПДн", items: 2, percentUnits: 50 }),
    ]);
    expect(agg.breakdowns).toEqual([
      expect.objectContaining({ scope: TEST_SCOPE, key: "ПДн", items: 2, percentUnits: 50 }),
    ]);
  });

  it("тест без axisKeys даёт пустые списки и прежний вердикт (FR-18)", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(0, 0, null)])],
      overallPassRule: { type: "percent", value: 70 },
    });
    expect(agg.breakdowns).toEqual([]);
    expect(agg.topicResults[0].breakdown).toEqual([]);
    expect(agg.passed).toBe(true);
  });

  it("один тег в двух разделах не смешивается в записях разделов", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(0, 0, ["ПДн"])]), section("sec", [q(0, 1, ["ПДн"])])],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].breakdown[0]).toMatchObject({ percentUnits: 100 });
    expect(agg.topicResults[1].breakdown[0]).toMatchObject({ percentUnits: 0 });
    expect(agg.breakdowns[0]).toMatchObject({ items: 2, percentUnits: 50 });
  });
});
```

- [ ] **Шаг 2. Убедиться, что тест падает**

Команда: `npm test -- tests/breakdown-aggregate.test.ts`
Ожидание: FAIL — `Property 'breakdown' does not exist`, `agg.breakdowns` не определено.

- [ ] **Шаг 3. Расширить типы агрегата**

В `shared/scoring/aggregate.ts` добавить импорт и три поля:

```ts
import { computeBreakdowns, sectionScope, TEST_SCOPE } from "../breakdown/compute";
import type { BreakdownEntry, BreakdownItem } from "../breakdown/types";
```

В `AggregateQuestion`:

```ts
  /**
   * PRD-50 FR-15: keys of this question per breakdown axis, e.g. `{ tag: [...] }`.
   * Absent = the question groups into no breakdown; the verdict is unaffected.
   */
  axisKeys?: Record<string, string[]> | null;
```

В `AggregateTopicResult`:

```ts
  /** PRD-50: breakdown records in THIS section's scope (empty when nothing is keyed). */
  breakdown: BreakdownEntry[];
```

В `AggregateResult`:

```ts
  /** PRD-50: breakdown records in the TEST scope (empty when nothing is keyed). */
  breakdowns: BreakdownEntry[];
```

- [ ] **Шаг 4. Собрать элементы и вызвать движок**

В `aggregateStandardResult` перед `const topicResults = ...` объявить накопитель:

```ts
  const breakdownItems: BreakdownItem[] = [];
```

Внутри цикла по вопросам, сразу после вычисления `ratio` и до `if (ratio === 1) correct++;`:

```ts
      breakdownItems.push({
        sectionId: sec.topicId,
        axisKeys: q.axisKeys ?? null,
        earned: q.points * ratio,
        possible: q.points,
        answered: q.answer !== undefined && q.answer !== null,
      });
```

После `input.sections.map(...)` — один вызов и раскладка по областям:

```ts
  // ONE pass over the delivered items, then split by scope: the test-scope records are
  // NOT a sum of the section ones (FR-04).
  const entries = computeBreakdowns(breakdownItems);
  for (const topic of topicResults) {
    const scope = sectionScope(topic.topicId);
    topic.breakdown = entries.filter((e) => e.scope === scope);
  }
```

В объекте, который возвращает `map`, добавить `breakdown: []` (заполняется выше), а в
итоговый `return` — `breakdowns: entries.filter((e) => e.scope === TEST_SCOPE),`.

- [ ] **Шаг 5. Прогнать тесты**

Команда: `npm test -- tests/breakdown-aggregate.test.ts tests/scoring-aggregate.test.ts`
Ожидание: PASS обоих файлов — старые golden-тесты вердикта не должны сдвинуться.

- [ ] **Шаг 6. Проверить типы и закоммитить**

```bash
npm run check
git add shared/scoring/aggregate.ts tests/breakdown-aggregate.test.ts
git commit -m "feat(prd-50): агрегат считает разрезы по разделам и по тесту"
```

---

## Task 3: веб-хост подаёт ключи и сохраняет разрезы

**Files:**

- Modify: `shared/schema.ts` (`topicResultSchema`)
- Modify: `server/routes/attempts.ts:1341-1355`, `server/routes/attempts.ts:1445-1455`, `:1483-1495`
- Test: `tests/breakdown-web-host.test.ts`

- [ ] **Шаг 1. Расширить схему сохраняемого результата**

В `shared/schema.ts`, в `topicResultSchema`, после `feedbackTexts`:

```ts
  // PRD-50: breakdown records of THIS section's scope, stored WITH the attempt like the
  // recommendations above — the results screen renders from the saved result, and
  // recomputing from live content would hand a past attempt today's tags.
  // `.default([])` keeps attempts graded before PRD-50 valid.
  breakdown: z
    .array(
      z.object({
        scope: z.string(),
        axis: z.string(),
        key: z.string(),
        items: z.number(),
        answered: z.number(),
        earned: z.number(),
        possible: z.number(),
        unitEarned: z.number(),
        unitPossible: z.number(),
        percentPoints: z.number(),
        percentUnits: z.number(),
      }),
    )
    .default([]),
```

- [ ] **Шаг 2. Написать падающий тест**

`tests/breakdown-web-host.test.ts`:

```ts
/**
 * @module tests/breakdown-web-host
 * @description PRD-50 FR-15: сохраняемый результат попытки несёт разрезы, а старый
 * результат без них остаётся валидным.
 */
import { describe, it, expect } from "vitest";
import { topicResultSchema } from "../shared/schema";

describe("topicResultSchema.breakdown", () => {
  it("принимает записи разреза", () => {
    const parsed = topicResultSchema.parse({
      topicId: "law", topicName: "Право", correct: 1, total: 2, percent: 50,
      earnedPoints: 1, possiblePoints: 2, passed: false, passRule: null,
      breakdown: [{ scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2,
        earned: 1, possible: 2, unitEarned: 1, unitPossible: 2,
        percentPoints: 50, percentUnits: 50 }],
    });
    expect(parsed.breakdown).toHaveLength(1);
  });

  it("результат, сохранённый до PRD-50, остаётся валидным", () => {
    const parsed = topicResultSchema.parse({
      topicId: "law", topicName: "Право", correct: 1, total: 2, percent: 50,
      earnedPoints: 1, possiblePoints: 2, passed: false, passRule: null,
    });
    expect(parsed.breakdown).toEqual([]);
  });
});
```

Команда: `npm test -- tests/breakdown-web-host.test.ts`
Ожидание: первый тест FAIL (`Unrecognized key`) до шага 1, PASS после него.

- [ ] **Шаг 3. Подать `axisKeys` в агрегат**

В `server/routes/attempts.ts` в ОБОИХ местах, где собирается `questions: questions.map((q) => {`
(около строк 1341 и 1445), добавить в возвращаемый объект последним полем:

```ts
            // PRD-50 FR-15: ключи разреза этого вопроса. Пустой список не кладём,
            // чтобы результат теста без тегов не менялся ни на байт.
            ...(Array.isArray(q.tags) && q.tags.length ? { axisKeys: { tag: q.tags } } : {}),
```

- [ ] **Шаг 4. Сохранить разрезы в результат**

В `server/routes/attempts.ts` в маппинге `const topicResults: TopicResult[] = agg.topicResults.map((t) => ({`
добавить:

```ts
      breakdown: t.breakdown,
```

- [ ] **Шаг 5. Прогнать тесты и типы**

```bash
npm test -- tests/breakdown-web-host.test.ts
npm run check
```

Ожидание: PASS, типы чистые.

- [ ] **Шаг 6. Коммит**

```bash
git add shared/schema.ts server/routes/attempts.ts tests/breakdown-web-host.test.ts
git commit -m "feat(prd-50): веб-хост подаёт ключи разреза и сохраняет записи с попыткой"
```

---

## Task 4: рантайм SCORM подаёт ключи

**Files:**

- Modify: `server/scorm/template/app/render/resultsPage.js:550-558`
- Modify: `server/scorm/builders/test-json.ts:464-485` (адаптивные разделы)
- Test: `server/scorm/__tests__/test-json-prd50.test.ts`

- [ ] **Шаг 1. Написать падающий тест выпечки**

`server/scorm/__tests__/test-json-prd50.test.ts`:

```ts
/**
 * @module server/scorm/__tests__/test-json-prd50
 * @description PRD-50 FR-15/FR-17: теги вопроса доезжают до пакета и для адаптивных
 * разделов — без них разрез в адаптивном режиме посчитать нечем.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../builders/test-json";

describe("buildTestJson: теги адаптивных разделов", () => {
  it("выпекает tags у вопроса адаптивного раздела", () => {
    const json = buildTestJson(adaptiveFixtureWithTaggedQuestion());
    expect(json.adaptiveTopics[0].questions[0].tags).toEqual(["ПДн"]);
  });
});
```

Фикстуру собрать из готовых частей соседнего файла `server/scorm/__tests__/test-json-prd29.test.ts`:
скопировать оттуда константу `baseTest` и функцию `bake(data)`, добавить адаптивную тему с одним
вопросом, у которого `tags: ["ПДн"]`:

```ts
function adaptiveFixtureWithTaggedQuestion() {
  return {
    test: { ...baseTest, isAdaptive: true },
    sections: [],
    questions: [],
    adaptiveTopics: [
      {
        topic: { id: "t1", name: "Право" },
        questions: [
          { id: "q1", type: "single", prompt: "?", dataJson: {}, correctJson: { correctIndex: 0 },
            points: 1, difficulty: 50, tags: ["ПДн"] },
        ],
      },
    ],
  } as never;
}
```

Точные имена полей адаптивной темы свериться с `buildTestJson` в
`server/scorm/builders/test-json.ts:440-486` — там они читаются.

Команда: `npm test -- server/scorm/__tests__/test-json-prd50.test.ts`
Ожидание: FAIL, `tags` в выпеченном вопросе отсутствует.

- [ ] **Шаг 2. Выпечь теги для адаптивных разделов**

В `server/scorm/builders/test-json.ts` в маппинге вопросов адаптивного раздела (около строки 481)
добавить рядом с `...(baked.scoring ? { scoring: baked.scoring } : {}),`:

```ts
            // PRD-50 FR-17: ключи разреза нужны и в адаптивном режиме. Включаем только
            // непустой список, чтобы пакеты без тегов остались байт-идентичными (FR-02).
            ...(Array.isArray(q.tags) && q.tags.length ? { tags: q.tags } : {}),
```

- [ ] **Шаг 3. Прогнать тест**

Команда: `npm test -- server/scorm/__tests__/test-json-prd50.test.ts`
Ожидание: PASS.

- [ ] **Шаг 4. Подать ключи в агрегат рантайма**

В `server/scorm/template/app/render/resultsPage.js`, в `byTopic[fq.topicId].questions.push({...})`
(около строки 550), добавить последним полем:

```js
      // PRD-50 FR-15: ключи разреза этого вопроса; выпечены в TEST_DATA как q.tags.
      axisKeys: q.tags && q.tags.length ? { tag: q.tags } : null
```

- [ ] **Шаг 5. Проверить на живом пакете**

```bash
npm run scorm:template
npm run scorm:player
```

Пройти пакет до экрана итогов, в консоли проверить, что записи считаются:

```js
window.TBTemplate.aggregateStandardResult // существует
// после прохождения: результат содержит непустой breakdowns у теста с тегами
```

Ожидание: у теста с тегами массив непустой, у теста без тегов — пустой.

- [ ] **Шаг 6. Коммит**

```bash
git add server/scorm/template/app/render/resultsPage.js server/scorm/builders/test-json.ts \
        server/scorm/__tests__/test-json-prd50.test.ts
git commit -m "feat(prd-50): пакет SCORM подаёт ключи разреза и выпекает теги адаптивных разделов"
```

---

## Task 5: живые `tags` и `sections` в формулах

**Files:**

- Modify: `server/services/result-compute.ts:63-110`
- Modify: `server/scorm/template/app/render/resultsPage.js:85-120`
- Modify: `shared/formula/validate.ts` (ссылки валидатора)
- Test: `tests/breakdown-formula-context.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

`tests/breakdown-formula-context.test.ts`:

```ts
/**
 * @module tests/breakdown-formula-context
 * @description PRD-50 FR-35/FR-36: `tag()` и `sectionById()` перестают быть мёртвыми.
 * До этой работы обе карты подавались пустыми, и формула молча возвращала нули.
 */
import { describe, it, expect } from "vitest";
import { computeAttemptResult } from "../server/services/result-compute";

const base = {
  percent: 50,
  topicResults: [
    { topicId: "law-id", code: "law", topicName: "Право", percent: 50, passed: false, earnedPoints: 1 },
  ],
  breakdowns: [
    { scope: "test", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
      unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50 },
    { scope: "section:law-id", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 2, possible: 2,
      unitEarned: 2, unitPossible: 2, percentPoints: 100, percentUnits: 100 },
  ],
};

const config = (formula: string) => ({
  scales: [],
  measurements: [],
  resultVariables: [{ name: "v", type: "number" as const, formula, sortOrder: 0 }],
});

describe("контекст формул", () => {
  it("tag() читает область теста", () => {
    const out = computeAttemptResult(config('tag("ПДн").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(50);
  });

  it("tag() с составным ключом читает область раздела (FR-36)", () => {
    const out = computeAttemptResult(config('tag("law::ПДн").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(100);
  });

  it("sectionById() возвращает результат темы, а не нули", () => {
    const out = computeAttemptResult(config('sectionById("law").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(50);
  });
});
```

Команда: `npm test -- tests/breakdown-formula-context.test.ts`
Ожидание: FAIL — все три возвращают 0.

- [ ] **Шаг 2. Заполнить контекст на веб-хосте**

В `server/services/result-compute.ts` расширить `AttemptResultBase` полем

```ts
  /** PRD-50: записи разреза этой попытки (области теста и разделов). */
  breakdowns?: BreakdownEntry[];
```

и заменить `tags: {}` и `sections: {}` на построенные карты:

```ts
  // PRD-50 FR-35/FR-36: `tag()` читает область теста по простому ключу и область раздела
  // по составному «<код или id раздела>::<ключ>». Составной ключ — тот же приём, каким
  // `topicById()` уже принимает и UUID, и авторский код: одна карта, два ключа.
  const tags: EvalContext["tags"] = {};
  const sectionCode = new Map<string, string[]>();
  for (const tr of base.topicResults) {
    sectionCode.set(tr.topicId, tr.code ? [tr.topicId, tr.code] : [tr.topicId]);
  }
  for (const e of base.breakdowns ?? []) {
    const value = { percent: e.percentPoints, score: e.earned, maxScore: e.possible, count: e.items };
    if (e.scope === "test") {
      tags[e.key] = value;
      continue;
    }
    const sectionId = e.scope.slice("section:".length);
    for (const alias of sectionCode.get(sectionId) ?? [sectionId]) {
      tags[alias + "::" + e.key] = value;
    }
  }

  const sections: EvalContext["sections"] = {};
  for (const tr of base.topicResults) {
    const value = { percent: tr.percent || 0, passed: tr.passed === true, completed: true };
    sections[tr.topicId] = value;
    if (tr.code) sections[tr.code] = value;
  }
```

и подставить `tags` / `sections` в `evalBase` вместо пустых объектов. Обновить JSDoc модуля:
строка про «`tags`/`sections` resolve to neutral defaults» больше не верна.

- [ ] **Шаг 3. Передать разрезы в вызов**

В `server/routes/attempts.ts` в обоих вызовах `computeAttemptResult(...)` добавить в
объект базы `breakdowns: agg.breakdowns,`.

- [ ] **Шаг 4. Повторить на рантайме пакета**

В `server/scorm/template/app/render/resultsPage.js` в `buildResultVarContext` (около строки 113)
заменить `tags: {}` и `sections: {}` на те же две карты, построенные из `agg.breakdowns`
и `agg.topicResults`. Код тот же по смыслу, в стиле ES5 файла (`var`, без `Map`).

- [ ] **Шаг 5. Научить валидатор составным ключам**

В `shared/formula/validate.ts` в блоке `walk(ast, (n) => {` (рядом с проверками `topicById`
и `sectionById`, строки 109 - 127) добавить ветку для `tag`:

```ts
      if (n.fn === "tag" && n.arg.includes("::")) {
        // PRD-50 FR-36: составной ключ «<раздел>::<ключ>». Раздел проверяем строго — опечатка
        // в нём даёт вечный ноль; сам ключ только предупреждением, он мог появиться позже.
        const [scopeKey, tagKey] = n.arg.split("::");
        if (refs.sectionKeys && !refs.sectionKeys.has(scopeKey)) {
          errors.push({ code: "unknown-section", message: `Неизвестная секция «${scopeKey}»` });
        }
        if (refs.tagKeys && refs.tagKeys.size > 0 && !refs.tagKeys.has(tagKey)) {
          warnings.push({ code: "tag-unresolved", message: `Ключ «${tagKey}» не найден в вопросах теста` });
        }
      }
```

и завести само множество в `ValidationRefs` (`shared/formula/types.ts`):

```ts
  /** PRD-50: все ключи разреза теста (сейчас — теги его вопросов). Пустое = проверка выключена. */
  tagKeys?: Set<string>;
```

- [ ] **Шаг 6. Прогнать тесты**

```bash
npm test -- tests/breakdown-formula-context.test.ts shared/formula/formula.test.ts
npm run check
```

Ожидание: PASS; существующий тест `tag("scale:EE").count` не должен сломаться.

- [ ] **Шаг 7. Коммит**

```bash
git add server/services/result-compute.ts server/routes/attempts.ts \
        server/scorm/template/app/render/resultsPage.js shared/formula/validate.ts \
        tests/breakdown-formula-context.test.ts
git commit -m "feat(prd-50): tag() и sectionById() читают настоящие данные"
```

---

## Task 6: разрез в контексте рендера и настройка показа

**Files:**

- Modify: `shared/schema.ts` (настройка показа в настройках теста)
- Modify: `shared/template/context.ts` (`CtxTopicResultView`)
- Modify: `shared/template/result-context.ts` (`TopicInput`, `topicView`)
- Modify: `server/services/result-context.ts` (адаптер веб-хоста)
- Test: `shared/template/__tests__/result-context-breakdown.test.ts`

- [ ] **Шаг 1. Завести настройку показа**

В `shared/schema.ts` рядом с прочими настройками теста добавить колонку:

```ts
  /**
   * PRD-50 FR-13: показ разрезов. `hidden` (умолчание) = тест ведёт себя как до PRD-50.
   * `basis` выбирает ЧИСЛО на экране, но не валюту вердикта — порог всегда в баллах.
   */
  breakdownDisplayJson: jsonb("breakdown_display_json").$type<{
    visibility: "hidden" | "bar" | "bar_and_value";
    basis: "units" | "points";
  }>(),
```

Сгенерировать миграцию:

```bash
npx drizzle-kit generate
```

Ожидание: новый файл `drizzle/0019_*.sql` с одним `ADD COLUMN`.

- [ ] **Шаг 2. Написать падающий тест**

`shared/template/__tests__/result-context-breakdown.test.ts`:

```ts
/**
 * @module shared/template/__tests__/result-context-breakdown
 * @description PRD-50 FR-31 - FR-33: полосы разреза в карточке темы, гашение по видимости.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";

const topic = {
  topicName: "Право", correct: 1, total: 2, percent: 50, earnedPoints: 1, possiblePoints: 2,
  passed: false,
  breakdown: [
    { scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
      unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 40 },
  ],
};
const result = { passed: false, percent: 50, totalQuestions: 2, correct: 1,
  earnedPoints: 1, possiblePoints: 2, topicResults: [topic] };

describe("разрез в карточке темы", () => {
  it("при hidden полос нет", () => {
    const ctx = buildResultContext(result as never, { breakdownDisplay: { visibility: "hidden", basis: "units" } } as never);
    expect((ctx.topicResults![0] as never as { breakdown?: unknown[] }).breakdown).toBeUndefined();
  });

  it("при bar печатает полосу по нормированной базе и без числа", () => {
    const ctx = buildResultContext(result as never, { breakdownDisplay: { visibility: "bar", basis: "units" } } as never);
    const rows = (ctx.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ key: "ПДн", barPercent: 40, showValue: false });
  });

  it("при bar_and_value и базе points печатает балльный процент", () => {
    const ctx = buildResultContext(result as never, { breakdownDisplay: { visibility: "bar_and_value", basis: "points" } } as never);
    const rows = (ctx.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ barPercent: 50, showValue: true, valueLabel: "50 %" });
  });
});
```

Команда: `npm test -- shared/template/__tests__/result-context-breakdown.test.ts`
Ожидание: FAIL — `breakdown` в виде темы отсутствует.

- [ ] **Шаг 3. Расширить контракт вида**

В `shared/template/context.ts` в `CtxTopicResultView` добавить:

```ts
  /**
   * PRD-50: строки разреза этой темы. Отсутствуют, когда автор их не включил или в теме
   * нет ни одного ключа — пустой массив в DSL ложен, поэтому блок в раскладке исчезает
   * целиком вместе с заголовком.
   */
  breakdown?: CtxBreakdownRow[];
```

и рядом объявить строку:

```ts
/** Одна строка разреза, подготовленная ядром: шаблон только печатает. */
export interface CtxBreakdownRow {
  key: string;
  /** Ширина полосы в процентах, округлена. */
  barPercent: number;
  /** Печатать ли число рядом с полосой. */
  showValue: boolean;
  /** Готовая подпись значения, например «50 %». Пусто при showValue = false. */
  valueLabel: string;
}
```

- [ ] **Шаг 4. Собрать вид**

В `shared/template/result-context.ts` расширить `TopicInput`:

```ts
  /** PRD-50: записи разреза этой темы, как их сохранил хост. */
  breakdown?: BreakdownEntry[] | null;
```

и в `topicView` перед `return view;`:

```ts
  // PRD-50 FR-31 - FR-33: полосы показываем только когда автор их включил и в теме есть
  // хотя бы один ключ. Список ключей, а не разложение темы на части: ключи не обязаны
  // разбивать выборку (FR-05).
  const display = opts.breakdownDisplay;
  if (display && display.visibility !== "hidden" && t.breakdown?.length) {
    const showValue = display.visibility === "bar_and_value";
    view.breakdown = t.breakdown.map((e) => {
      const value = display.basis === "points" ? e.percentPoints : e.percentUnits;
      return {
        key: e.key,
        barPercent: Math.round(value),
        showValue,
        valueLabel: showValue ? Math.round(value) + " %" : "",
      };
    });
  }
```

`breakdownDisplay` добавить во второй аргумент `buildResultContext`
(`shared/template/result-context.ts:725`) и протянуть в `topicView` тем же вторым параметром,
каким туда уже приходит `withTopicPoints`.

- [ ] **Шаг 5. Отдать настройку с веб-хоста**

В `server/services/result-context.ts` передать `breakdownDisplay: test.breakdownDisplayJson ?? null`
в опции сборки контекста.

- [ ] **Шаг 6. Прогнать тесты**

```bash
npm test -- shared/template/__tests__/result-context-breakdown.test.ts shared/template/__tests__
npm run check
```

Ожидание: PASS, соседние тесты контекста не сдвинулись.

- [ ] **Шаг 7. Коммит**

```bash
git add shared/schema.ts drizzle shared/template/context.ts shared/template/result-context.ts \
        server/services/result-context.ts shared/template/__tests__/result-context-breakdown.test.ts
git commit -m "feat(prd-50): строки разреза в контексте рендера и настройка показа"
```

---

## Task 7: переключатель показа в редакторе теста

**Files:**

- Modify: `client/src/features/tests/editor/sections/basic-settings-section.tsx:1128-1145`
- Modify: маппер настроек теста в `client/src/features/tests/editor/` (тот, что собирает
  `model.runtime` из ответа API и обратно в тело запроса)
- Modify: `server/services/test-settings.ts` (белый список сохраняемых настроек)
- Test: `client/src/features/tests/editor/sections/__tests__/basic-settings-breakdown.test.tsx`

- [ ] **Шаг 1. Написать падающий тест**

Тест рендерит секцию настроек и проверяет три вещи: селектор показа разреза есть, умолчание —
«Не показывать», выбор «Полоса» отдаёт наверх `{ visibility: "bar", basis: "units" }`.
Опереться на соседний тест той же папки — там уже настроены обёртки провайдеров.

Команда: `npm test -- client/src/features/tests/editor/sections/__tests__/basic-settings-breakdown.test.tsx`
Ожидание: FAIL, элемента нет.

- [ ] **Шаг 2. Добавить контроль**

Рядом с блоком `showSectionResultsApplicable` (строка 1128) добавить блок «Подытоги по ключам»
из компонентов дизайн-системы: `Select` с тремя значениями видимости и, когда видимость не
`hidden`, второй `Select` базы показа («доля вопросов» / «доля баллов»). Своих `.ou-*` классов
не писать — только импортированные компоненты ui-kit.

- [ ] **Шаг 3. Провести значение через маппер и белый список**

Настройка едет тем же путём, что `showSectionResults`: в модель редактора, в тело `PUT /api/tests/:id`,
и в белый список колонок `server/services/test-settings.ts`. Без последнего сохранение молча
потеряет поле — это защита от массового присваивания, а не ошибка.

- [ ] **Шаг 4. Прогнать тесты**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__
npm run check
```

- [ ] **Шаг 5. Коммит**

```bash
git add client/src/features/tests/editor server/services/test-settings.ts
git commit -m "feat(prd-50): переключатель показа подытогов в настройках теста"
```

---

## Task 8: полосы в раскладках и предпросмотры

**Files:**

- Modify: `server/scorm/templates/default/layouts/results.html`
- Modify: `server/scorm/templates/default/layouts/report.html`
- Modify: `server/scorm/templates/default/styles/theme.css`
- Modify: `server/scorm/templates/default/preview.html` (пересборка)

- [ ] **Шаг 1. Добавить блок в карточку темы на итогах**

В `results.html` внутри `{{#each result.topicResults}}`, после строки со счётчиками:

```html
{{#if breakdown}}
<div class="tb-topic__breakdown">
  {{#each breakdown}}
  <div class="tb-breakdown__row" data-item="{{ key }}">
    <div class="tb-breakdown__name">{{ key }}</div>
    <div class="tb-breakdown__bar"><span style="width: {{ barPercent }}%;"></span></div>
    {{#if showValue}}<div class="tb-breakdown__val">{{ valueLabel }}</div>{{/if}}
  </div>
  {{/each}}
</div>
{{/if}}
```

- [ ] **Шаг 2. Повторить в отчёте**

В `report.html` внутри `{{#each result.topicResults}}` после `tb-report__topic-bar` добавить тот же
блок с классами `tb-report__breakdown`, `tb-report__breakdown-row`, `tb-report__breakdown-bar`.
Разметку не сокращать и не менять на «похожую»: два хоста печатают одни и те же данные, и
расхождение классов сразу разъедет CSS.

- [ ] **Шаг 3. Стили в один источник**

Правила `.tb-breakdown__*` и `.tb-report__breakdown*` добавить в
`server/scorm/templates/default/styles/theme.css` — оттуда собирается и `styles.css` пакета, и
CSS веб-хоста. Ширину полосы задаёт инлайн-стиль из шага 1; в CSS остаются только дорожка,
цвет заливки и типографика.

- [ ] **Шаг 4. Пересобрать предпросмотр шаблона**

```bash
npm run scorm:previews
```

`preview.html` шаблона обязан пересобираться генератором
(`scripts/docs/generate-prd1-template-previews.mjs`), а не редактироваться руками.

- [ ] **Шаг 5. Приёмка в браузере**

Поднять dev (`PORT=8099 npm run dev`), войти учёткой приёмки, включить показ разреза у теста с
тегами, пройти его и проверить своими глазами:

1. на экране итогов в карточке темы появились полосы, по одной на ключ;
2. числа нет при `bar` и есть при `bar_and_value`;
3. в PDF-отчёте полосы те же и в том же порядке;
4. у теста без тегов и у теста с `hidden` экран и отчёт не изменились.

- [ ] **Шаг 6. Коммит**

```bash
git add server/scorm/templates/default
git commit -m "feat(prd-50): полосы разреза в карточке темы на итогах и в отчёте"
```

---

## Решения владельца, без которых этап не закрыт

Найдено итоговым ревью этапа 2026-08-14. Каждый пункт виден автору или ученику, поэтому
закрывать Э1 до ответа нельзя.

1. **Пакет теряет полосы у сохранённой попытки.** `saveAttemptResult`
   (`server/scorm/template/app/utils/scorm/suspendAttempts.js`) не пишет записи разреза в
   `suspend_data`, поэтому экран «Мой результат» внутри пакета и скачанный оттуда PDF полос не
   покажут, хотя экран сразу после завершения покажет, и веб на той же попытке покажет тоже.
   Либо сохранять записи (бюджет 64 КБ уже несёт `answers` и `flatQuestions` целиком), либо
   зафиксировать расхождение решением и снять пункт 5 приёмки спеки.
2. **FR-17 (адаптивный режим) не выполнен, а данные под него уже выпекаются.**
   `adaptiveResultAsStandard` разрезов не считает, `computeAttemptResult` в адаптивной ветке
   вызывается без них — при этом теги адаптивных вопросов теперь едут в каждый пакет.
   Либо доделать, либо снять выпечку как мёртвый груз и перенести FR-17 явным решением.
3. **Шаблон «Сертификация» не обновлён**: ни разметки полос, ни стилей. Автор, выбравший этот
   дизайн, включит показ и не увидит ничего, без диагностики. Либо довести обе раскладки и оба
   файла стилей, либо зафиксировать, что полосы поддерживает только «Стандартный».
4. **Оживление `tag()`/`sectionById()` меняет значения показателей на живых тестах.** Это и есть
   FR-35, но до выката нужен список тестов, где такие формулы уже используются: показатель с
   «Управляет статусом» переписывает вердикт, то есть у части попыток он может перевернуться.
5. **Контракт строки уже, чем объявляет спека §8.1.** `CtxBreakdownRow` несёт только
   `key`/`barPercent`/`showValue`/`valueLabel`; счётчиков и баллов у стороннего шаблона нет, а
   выбор базы меняет длину полосы. Либо расширить контракт, либо поправить §8.1.

## Долг, найденный по ходу Э1

- **Пересчёт показателей в аналитике SCORM не видит разрезов.** `server/routes/analytics/scorm.ts:183`
  ВСЕГДА пересчитывает показатели для телеметрийных попыток и записей разреза не подаёт, поэтому
  формула с `tag()` даст там ноль при том, что пакет посчитал настоящее значение. В телеметрии
  разрезов нет вовсе, так что честный ответ — показывать сохранённое пакетом, а не пересчитывать.
  Вне объёма Э1: чинить вместе с гейтом Э2, когда решится, откуда аналитика берёт разрезы.
- **Соседний шов:** `server/routes/analytics/attempts.ts:348` пересчитывает результат только как
  фолбэк для старых попыток, у которых значения не сохранены. Там `tag()` тоже нулевой, но путь не
  срабатывает для новых попыток, поэтому расхождения экрана и аналитики не возникает.
- **Записи области ТЕСТА нигде не сохраняются** — они собираются только для контекста формул.
  Блоку `breakdown` из Э4 и требованию FR-39 (аналитика без пересчёта) их придётся класть в
  `result_json`.
- **Предупреждение о незнакомом ключе мертво:** `tagKeys` не подаёт никто, собрать теги в
  `scales-variables-repository` без лишних запросов нельзя. Либо подать из вызывающего слоя, либо
  снять требование.
- **Миграция названа автогенератором** (`drizzle/0019_typical_bloodstorm.sql`), соседи —
  описательные. Переименовать до вливания; файл не применён, это дёшево.
- **`tests/it/schema.sql` не получил новую колонку** — DAL-набор не покроет её. Фикстура и без
  того протухла на стволе (нет `pass_decision_policy`, 22 падения в
  `tests/storage/scales-variables-repository.test.ts`).
- **Подсказка в редакторе обещает больше, чем есть:** упоминает итоги раздела, а экран итогов
  раздела полос не печатает, хотя сервер их для него считает и выбрасывает.

## Проверка этапа

- [ ] `npm run check` — чисто
- [ ] целевые прогоны — PASS:

```bash
npm test -- shared/breakdown tests/breakdown-aggregate.test.ts
npm test -- tests/breakdown-web-host.test.ts tests/breakdown-formula-context.test.ts
npm test -- shared/template/__tests__ server/scorm/__tests__/test-json-prd50.test.ts
```

- [ ] `npm run lint:md` — чисто
- [ ] полный прогон `npm test` — ТОЛЬКО по явному разрешению владельца
- [ ] приёмка из Task 7 шаг 5 проведена в браузере, снимки приложены к отчёту о приёмке
