# PRD-50 Э2: пороги ключей разреза, гейт темы, предупреждения публикации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Требования:** [спека PRD-50](../specs/prd-50/result-breakdowns.md), этап Э2 — FR-09, FR-10,
FR-19 - FR-23, FR-42, FR-45 - FR-47. Опорные разделы спеки: §4 (хранение), §6 (гейт по ключам),
§8.1 (поля вердикта в строке, помеченные «с Э2»), §11 (редактор и предупреждения), §13 (этапы).

**Ветка:** `prd-50-result-breakdowns` (Э1 уже влит в неё).

**Goal:** научить раздел хранить пороги своих ключей, ронять вердикт темы, когда подтема не
вытянута, показывать автору таблицу «раздел × ключ» до публикации и предупреждать о четырёх
ловушках выдачи — не меняя вердикта ни одного теста, где порогов нет.

**Architecture:** порог живёт в новой колонке `test_sections.breakdown_rules_json` — отдельно от
`draw_blueprint_json` сознательно (решение 5 спеки: квота — про выдачу, порог — про оценку). Гейт
живёт в `shared/scoring/pass-rule.ts` (нормализация правил + простановка `passed` на записях
разреза) и вызывается из `shared/scoring/aggregate.ts`, поэтому автоматически работает на обоих
хостах. Порядок в `aggregateStandardResult` переставляется по FR-16: сначала разрезы, потом
вердикт темы. Предупреждения публикации — чистый движок `shared/breakdown/publish-warnings.ts`
плюс тонкий сервис доступа к данным; они НЕ блокируют публикацию.

**Tech Stack:** TypeScript, Vitest (`npm test -- <путь>`), Drizzle (`npx drizzle-kit generate`,
миграция НЕ применяется), плоский ES5-рантайм пакета SCORM (`server/scorm/template/app/**`),
дизайн-система `@skillum/ui-kit`, DSL-шаблонизатор `shared/template/dsl.ts`.

---

## Решения этапа, которые исполнитель не пересматривает

1. **Порог сравнивается с `percentPoints`** — балльной долей, независимо от выбранной базы показа
   (решение 3 и FR-21 спеки). Переключение «доля вопросов / доля баллов» меняет длину полосы и
   подпись, но не вердикт.
2. **Ключ, не появившийся в выдаче (`items = 0`), порогом не проверяется** (FR-22). Он не роняет
   тему и получает `passed = null`; недостижимость такого порога ловится предупреждением
   публикации (FR-46), а не вердиктом.
3. **Гейта в области теста нет** (FR-23). Записи с `scope = "test"` поля `passed` не получают
   вовсе; тестовый гейт по-прежнему выразим показателем с «Управляет статусом».
4. **Тема с порогами ключей, но без собственного порога раздела, становится оцениваемой.** Обе
   половины гейта необязательны: `passed = null` только когда нет ни правила раздела, ни единого
   применившегося порога ключа. Это осознанный выбор автора («Не проверять отдельно» + порог
   подтемы), а не регрессия: без новой колонки поведение прежнее.
5. **Предупреждения публикации — предупреждения.** Публикация проходит, снимок создаётся, ответ
   роута несёт список; диалог показывается ПОСЛЕ успешной публикации.
6. **Аналитика SCORM чинится НЕ здесь** — задача перенесена в «Э1-доделку», где тот же долг
   расписан и выходит раньше; см. Task 7 этого плана и обоснование переноса в нём.

---

## Файловая карта

| Файл | Ответственность |
| --- | --- |
| `shared/breakdown/types.ts` (правка) | `BreakdownRules`/`BreakdownThreshold`, поле `passed` записи |
| `shared/schema.ts` (правка) | `breakdownRulesSchema`, колонка `breakdown_rules_json`, `passed` в сохраняемой записи |
| `drizzle/0020_prd50_breakdown_rules.sql` (создать генератором) | миграция колонки, НЕ применяется |
| `tests/it/schema.sql` (правка) | колонка в фикстуре pglite |
| `shared/scoring/pass-rule.ts` (правка) | `resolveBreakdownRules`, `breakdownThresholdFor`, `applyBreakdownGate` |
| `shared/scoring/aggregate.ts` (правка) | перестановка порядка по FR-16, вызов гейта |
| `tests/breakdown-gate.test.ts` (создать) | гейт: единица поведения этапа |
| `server/routes/tests.ts` (правка) | `breakdownRulesJson` в схеме тела секции, предупреждения при публикации |
| `server/services/test-settings.ts` (правка) | `SectionPayload` + запись колонки |
| `server/routes/attempts.ts` (правка) | подача правил в агрегат на `/finish` и `/section-result` |
| `server/scorm/builders/test-json.ts` (правка) | выпечка `breakdownRules` в секцию `TEST_DATA` |
| `server/scorm/template/app/render/resultsPage.js` (правка) | правила в агрегат и гейт на экране итогов раздела |
| `shared/template/runtime-entry.ts` (правка) | `computeBreakdowns` и `applyBreakdownGate` на поверхности `TBTemplate` |
| `shared/template/context.ts` (правка) | `passed`/`passClass`/`statusLabel` в `CtxBreakdownRow` |
| `shared/template/result-context.ts` (правка) | заполнение трёх полей вердикта строки |
| `server/scorm/templates/default/layouts/{results,report}.html` (правка) | класс вердикта и подпись строки |
| `templates/certification/layouts/{results,report}.html` (правка) | то же дословно (паритет шаблонов) |
| `server/scorm/templates/default/styles/{theme,report}.css` + копии `certification` (правка) | цвет полосы по вердикту |
| `client/src/features/tests/editor/test-editor.types.ts` (правка) | `breakdownRules` в модели и в теле запроса |
| `client/src/features/tests/editor/test-editor.mappers.ts` (правка) | чтение и запись правил |
| `client/src/features/tests/editor/sections/topics-structure-section.tsx` (правка) | таблица «раздел × ключ» |
| `shared/breakdown/publish-warnings.ts` (создать) | чистый движок четырёх предупреждений |
| `server/services/breakdown-warnings.ts` (создать) | сбор данных для движка |
| `client/src/features/content-protection/{types.ts,issue-text.ts,content-impact-dialog.tsx}` (правка) | режим `advisory` |
| `client/src/features/tests/list/tests-list.tsx` (правка) | показ предупреждений после публикации |
| `server/routes/analytics/scorm.ts` (правка) | разрезы из телеметрии для формул с `tag()` |

---

## Task 1: колонка `breakdown_rules_json` и её типы

**Files:**

- Modify: `shared/breakdown/types.ts`
- Modify: `shared/schema.ts`
- Modify: `server/routes/tests.ts`
- Modify: `server/services/test-settings.ts`
- Modify: `tests/it/schema.sql`
- Create: `drizzle/0020_prd50_breakdown_rules.sql` (генератором)
- Test: `tests/breakdown-rules-schema.test.ts`

- [ ] **Шаг 1. Написать падающий тест**

`tests/breakdown-rules-schema.test.ts`:

```ts
/**
 * @module tests/breakdown-rules-schema
 * @description PRD-50 FR-09/FR-10: пороги ключей — своя структура раздела, отдельная от
 * квот выдачи. Схема принимает форму из §4 спеки и отбивает всё остальное.
 */
import { describe, it, expect } from "vitest";
import { breakdownRulesSchema } from "../shared/schema";

describe("breakdownRulesSchema", () => {
  it("принимает форму из §4 спеки", () => {
    const parsed = breakdownRulesSchema.parse({
      axis: "tag",
      default: { type: "percent", value: 60 },
      keys: {
        "Персональные данные": { type: "percent", value: 80 },
        "Антикоррупционная политика": { type: "none" },
      },
    });
    expect(parsed.keys!["Персональные данные"]).toEqual({ type: "percent", value: 80 });
  });

  it("принимает правила без умолчания и без ключей", () => {
    expect(breakdownRulesSchema.parse({ axis: "tag" })).toEqual({ axis: "tag" });
  });

  it("не принимает другую ось: в этой редакции зарегистрирован только тег (FR-06)", () => {
    expect(breakdownRulesSchema.safeParse({ axis: "difficulty" }).success).toBe(false);
  });

  it("не принимает процент вне 0..100 и порог неизвестного вида", () => {
    expect(
      breakdownRulesSchema.safeParse({ axis: "tag", default: { type: "percent", value: 140 } }).success,
    ).toBe(false);
    expect(
      breakdownRulesSchema.safeParse({ axis: "tag", keys: { a: { type: "count", value: 2 } } }).success,
    ).toBe(false);
  });
});
```

Команда: `npm test -- tests/breakdown-rules-schema.test.ts`
Ожидание: FAIL, `breakdownRulesSchema` не экспортируется.

- [ ] **Шаг 2. Завести типы движка**

В `shared/breakdown/types.ts` дописать после `BreakdownItem`:

```ts
/**
 * One key threshold. `none` says the key is INFORMATIONAL on purpose — it is not the same
 * as an absent entry, which falls back to {@link BreakdownRules.default} (FR-20).
 */
export type BreakdownThreshold = { type: "percent"; value: number } | { type: "none" };

/**
 * PRD-50 §4 (FR-09/FR-10): the grading rules of one section's breakdown axis, stored in
 * `test_sections.breakdown_rules_json`. Kept apart from `draw_blueprint_json` on purpose
 * (решение 5): a quota is about DELIVERY, a threshold about GRADING, and either is
 * meaningful without the other. Absent structure = every key is informational.
 */
export interface BreakdownRules {
  /** Axis the rules speak about. Only `"tag"` is registered in this edition (FR-06). */
  axis: string;
  /** Threshold for every key without an own entry (FR-20). Absent = no fallback gate. */
  default?: BreakdownThreshold;
  /** Per-key thresholds; a key absent here falls back to {@link BreakdownRules.default}. */
  keys?: Record<string, BreakdownThreshold>;
}
```

и добавить поле в `BreakdownEntry`, последним:

```ts
  /**
   * PRD-50 FR-19 - FR-23: verdict of this key. `true`/`false` when a threshold applied,
   * `null`/absent when the key is informational, nothing was delivered under it (FR-22),
   * or the record is test-scoped (FR-23 — there is no gate there). Stamped by
   * `applyBreakdownGate`, never by {@link computeBreakdowns}, which knows no rules.
   */
  passed?: boolean | null;
```

- [ ] **Шаг 3. Схема и колонка**

В `shared/schema.ts` рядом с импортами добавить:

```ts
import type { BreakdownRules } from "./breakdown/types";
```

Сразу после `export type FormSet = z.infer<typeof formSetSchema>;` (перед `export const testSections`)
добавить:

```ts
/**
 * PRD-50 §4 (FR-09/FR-10): thresholds of a section's breakdown keys. GRADING only — the
 * composition of the delivery by key stays in `draw_blueprint_json` and is never duplicated
 * here. `none` is an explicit «informational» that WINS over `default`; an absent key falls
 * back to `default`; an absent structure leaves every key informational (сегодняшнее поведение).
 */
export const breakdownThresholdSchema = z.union([
  z.object({ type: z.literal("percent"), value: z.number().min(0).max(100) }),
  z.object({ type: z.literal("none") }),
]);

export const breakdownRulesSchema = z.object({
  // One registered axis in this edition (FR-06). A literal, not a free string: an unknown
  // axis would be stored, never read, and silently gate nothing.
  axis: z.literal("tag"),
  default: breakdownThresholdSchema.optional(),
  keys: z.record(z.string(), breakdownThresholdSchema).optional(),
});
```

В таблице `testSections` после `formSetJson` добавить колонку:

```ts
  /**
   * PRD-50 §4 (FR-09/FR-10): per-key pass thresholds of THIS section. Null = every key is
   * informational, i.e. exactly the behaviour of every test built before this PRD. Separate
   * from `draw_blueprint_json` by decision: quota = delivery, threshold = grading.
   */
  breakdownRulesJson: jsonb("breakdown_rules_json").$type<BreakdownRules>(),
```

В `insertTestSectionSchema` дополнить `.extend({ ... })` строкой:

```ts
    breakdownRulesJson: breakdownRulesSchema.nullish(),
```

- [ ] **Шаг 4. Прогнать тест и сгенерировать миграцию**

```bash
npm test -- tests/breakdown-rules-schema.test.ts
npx drizzle-kit generate
```

Ожидание: тест PASS; генератор создаёт файл `drizzle/0020_*.sql` с единственным
`ALTER TABLE "test_sections" ADD COLUMN "breakdown_rules_json" jsonb;`. Переименовать файл в
`drizzle/0020_prd50_breakdown_rules.sql` и поправить его имя в `drizzle/meta/_journal.json`
(соседи названы описательно — `0019_prd50_breakdown_display.sql`). Миграцию НЕ применять:
её накатывает деплой.

- [ ] **Шаг 5. Провести колонку через слой записи**

В `tests/it/schema.sql` в `CREATE TABLE "test_sections"` после строки `"form_set_json" jsonb,`
добавить строку `"breakdown_rules_json" jsonb,` — с ТАБУЛЯЦИЕЙ в начале, как у соседних строк
файла (фикстура сгенерирована drizzle-kit и держит его отступы):

```sql
CREATE TABLE "test_sections" (
    ...
    "form_set_json" jsonb,
    "breakdown_rules_json" jsonb,
    "question_order" text,
    ...
);
```

В `server/services/test-settings.ts` в `SectionPayload` после `formSetJson`:

```ts
  /** PRD-50 §4: per-key thresholds of this section; null/absent = keys are informational. */
  breakdownRulesJson?: BreakdownRules | null;
```

(и дописать `BreakdownRules` в существующий `import type { ... } from "@shared/schema";` — тип
реэкспортируется оттуда через колонку; если реэкспорта нет, импортировать из
`@shared/breakdown/types` отдельной строкой).

Там же, в `_replaceSections`, в `tx.insert(testSections).values({...})` после `formSetJson`:

```ts
        breakdownRulesJson: s.breakdownRulesJson ?? null,
```

В `server/routes/tests.ts` в `sectionBodySchema` после `formSetJson`:

```ts
    // PRD-50 §4 (FR-09): per-key thresholds. MUST be listed here for the same reason as
    // formSetJson above — Zod strips an unlisted key, and the author's thresholds would
    // vanish on save with a cheerful 200 OK.
    breakdownRulesJson: breakdownRulesSchema.nullish(),
```

и добавить `breakdownRulesSchema` в существующий импорт схем из `@shared/schema`.

- [ ] **Шаг 6. Проверить типы и закоммитить**

```bash
npm run check
git add shared/breakdown/types.ts shared/schema.ts server/routes/tests.ts \
        server/services/test-settings.ts tests/it/schema.sql drizzle \
        tests/breakdown-rules-schema.test.ts
git commit -m "feat(prd-50): пороги ключей разреза хранятся у раздела"
```

---

## Task 2: гейт темы по ключам и перестановка порядка в агрегате

**Files:**

- Modify: `shared/scoring/pass-rule.ts`
- Modify: `shared/scoring/aggregate.ts`
- Test: `tests/breakdown-gate.test.ts`

Перестановка обязательна и проверена чтением кода: сегодня в `aggregateStandardResult` вердикт темы
вычисляется ВНУТРИ `input.sections.map(...)` (строки 177 - 191: `resolveTopicRule` →
`checkPassRule` → накопление `allTopicsPassed`/`requiredTopicsPassed`), а `computeBreakdowns`
вызывается ПОСЛЕ цикла (строка 212), потому что запись области теста — отдельный проход по всем
выданным элементам (FR-04). Порог ключа нужен вердикту темы, значит вердикт обязан переехать во
второй проход. Существующие golden-тесты вердикта (`tests/scoring-aggregate.test.ts`) от этого не
сдвигаются: `allTopicsPassed` и `requiredTopicsPassed` — конъюнкции, порядок их накопления на
результат не влияет, а сами величины (`percent`, `earnedPoints`, `resolvedPassRule`) считаются в
первом проходе ровно как сейчас и во втором только читаются.

- [ ] **Шаг 1. Написать падающий тест**

`tests/breakdown-gate.test.ts`:

```ts
/**
 * @module tests/breakdown-gate
 * @description PRD-50 FR-19 - FR-23: тема пройдена, когда выполнен порог раздела И все
 * заданные пороги её ключей. Порог всегда в баллах, ключ без выдачи вердикт не роняет,
 * в области теста гейта нет.
 */
import { describe, it, expect } from "vitest";
import { aggregateStandardResult, type AggregateSection } from "../shared/scoring/aggregate";
import { applyBreakdownGate, resolveBreakdownRules } from "../shared/scoring/pass-rule";
import type { BreakdownEntry } from "../shared/breakdown/types";

/** Один вопрос: цена `points`, ответ верен при `ok`. */
const q = (ok: boolean, tags: string[] | null, points = 1) => ({
  type: "single" as const,
  correct: { correctIndex: 0 },
  scoring: null,
  points,
  answer: ok ? 0 : 1,
  ...(tags ? { axisKeys: { tag: tags } } : {}),
});

const section = (
  topicId: string,
  questions: AggregateSection["questions"],
  extra: Partial<AggregateSection> = {},
): AggregateSection => ({
  topicId,
  topicName: topicId,
  topicPassRule: null,
  questions,
  ...extra,
});

const entry = (key: string, percentPoints: number, items = 1): BreakdownEntry => ({
  scope: "section:law",
  axis: "tag",
  key,
  items,
  answered: items,
  earned: percentPoints / 100,
  possible: 1,
  unitEarned: percentPoints / 100,
  unitPossible: items,
  percentPoints,
  percentUnits: percentPoints,
});

describe("resolveBreakdownRules", () => {
  it("пустые и неопознанные правила означают отсутствие гейта", () => {
    expect(resolveBreakdownRules(null)).toBeNull();
    expect(resolveBreakdownRules({ axis: "tag" })).toBeNull();
    expect(resolveBreakdownRules("нет")).toBeNull();
  });

  it("явный «none» у ключа перебивает умолчание (FR-20)", () => {
    const rules = resolveBreakdownRules({
      axis: "tag",
      default: { type: "percent", value: 60 },
      keys: { "ПДн": { type: "none" } },
    });
    expect(rules).not.toBeNull();
    expect(rules!.byKey.get("ПДн")).toBeNull();
    expect(rules!.fallback).toBe(60);
  });
});

describe("applyBreakdownGate", () => {
  it("проставляет вердикт каждой записи и отвечает за раздел", () => {
    const rows = [entry("ПДн", 80), entry("Коррупция", 40)];
    const verdict = applyBreakdownGate(rows, { axis: "tag", default: { type: "percent", value: 60 } });
    expect(rows.map((r) => r.passed)).toEqual([true, false]);
    expect(verdict).toBe(false);
  });

  it("ключ без выданных вопросов не проверяется и вердикт не роняет (FR-22)", () => {
    const rows = [entry("ПДн", 0, 0)];
    const verdict = applyBreakdownGate(rows, { axis: "tag", default: { type: "percent", value: 60 } });
    expect(rows[0].passed).toBeNull();
    expect(verdict).toBeNull();
  });

  it("правил нет — ни одной пометки и ни одного гейта", () => {
    const rows = [entry("ПДн", 10)];
    expect(applyBreakdownGate(rows, null)).toBeNull();
    expect(rows[0].passed).toBeNull();
  });
});

describe("aggregateStandardResult + гейт по ключам", () => {
  it("порог ключа роняет тему, у которой порог раздела выполнен (FR-19)", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(true, ["ПДн"]), q(true, ["ПДн"]), q(false, ["Коррупция"]), q(true, ["Коррупция"])], {
          topicPassRule: { source: "custom", type: "percent", value: 70 },
          breakdownRules: { axis: "tag", keys: { "Коррупция": { type: "percent", value: 80 } } },
        }),
      ],
      overallPassRule: { type: "percent", value: 70 },
    });
    expect(agg.topicResults[0].percent).toBe(75);
    expect(agg.topicResults[0].passed).toBe(false);
    const rows = agg.topicResults[0].breakdown;
    expect(rows.find((r) => r.key === "ПДн")!.passed).toBeNull();
    expect(rows.find((r) => r.key === "Коррупция")!.passed).toBe(false);
  });

  it("порог сравнивается с балльной долей, а не с долей вопросов (FR-21)", () => {
    // Дешёвый вопрос верен, дорогой — нет: доля вопросов 50 %, доля баллов 25 %.
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(true, ["ПДн"], 1), q(false, ["ПДн"], 3)], {
          breakdownRules: { axis: "tag", default: { type: "percent", value: 40 } },
        }),
      ],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].breakdown[0].percentUnits).toBe(50);
    expect(agg.topicResults[0].breakdown[0].percentPoints).toBe(25);
    expect(agg.topicResults[0].passed).toBe(false);
  });

  it("тема без правила раздела становится оцениваемой по одним ключам", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(true, ["ПДн"]), q(true, ["ПДн"])], {
          breakdownRules: { axis: "tag", default: { type: "percent", value: 60 } },
        }),
      ],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].passed).toBe(true);
  });

  it("в области теста гейта нет (FR-23)", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(false, ["ПДн"])], {
          breakdownRules: { axis: "tag", default: { type: "percent", value: 60 } },
        }),
      ],
      overallPassRule: null,
    });
    expect(agg.breakdowns[0].passed ?? null).toBeNull();
  });

  it("раздел без правил ведёт себя ровно как до Э2", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(false, ["ПДн"])], { topicPassRule: { source: "none" } })],
      overallPassRule: { type: "percent", value: 70 },
    });
    expect(agg.topicResults[0].passed).toBeNull();
    expect(agg.topicResults[0].breakdown[0].passed ?? null).toBeNull();
  });
});
```

Команда: `npm test -- tests/breakdown-gate.test.ts`
Ожидание: FAIL — `applyBreakdownGate`/`resolveBreakdownRules` не экспортируются.

- [ ] **Шаг 2. Написать гейт в `pass-rule.ts`**

В `shared/scoring/pass-rule.ts` добавить импорт типов (только типы, модуль остаётся чистым):

```ts
import type { BreakdownEntry, BreakdownRules } from "../breakdown/types";
```

и в конец файла:

```ts
// ─── PRD-50: gate by breakdown keys ──────────────────────────────────────────

/**
 * Normalised, runtime-ready key thresholds of ONE section. `fallback` is the threshold every
 * key without an own entry falls back to; `byKey` holds explicit entries, where a `null`
 * VALUE means «declared informational» and therefore WINS over the fallback (FR-20).
 */
export interface ResolvedBreakdownRules {
  axis: string;
  fallback: number | null;
  byKey: Map<string, number | null>;
}

/** One stored threshold → its percent value, or `null` for «none» / anything unrecognised. */
function breakdownThresholdValue(raw: unknown): number | null {
  if (!raw || typeof raw !== "object") return null;
  const t = raw as { type?: string; value?: unknown };
  if (t.type !== "percent") return null;
  const value = Number(t.value);
  return Number.isFinite(value) ? value : null;
}

/**
 * Normalise stored `test_sections.breakdown_rules_json` (any shape — validated on write, but
 * a legacy snapshot or an old SCORM package may carry none at all). Returns `null` when
 * NOTHING is declared: no fallback and no explicit key. `null` is the pre-PRD-50 state and
 * must leave the topic verdict exactly as it was.
 */
export function resolveBreakdownRules(raw: unknown): ResolvedBreakdownRules | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<BreakdownRules>;
  const byKey = new Map<string, number | null>();
  const keys = r.keys;
  if (keys && typeof keys === "object") {
    for (const key of Object.keys(keys)) byKey.set(key, breakdownThresholdValue(keys[key]));
  }
  const fallback = breakdownThresholdValue(r.default);
  if (fallback === null && byKey.size === 0) return null;
  return { axis: typeof r.axis === "string" && r.axis ? r.axis : "tag", fallback, byKey };
}

/** The threshold that applies to one key, or `null` when the key is informational (FR-20). */
export function breakdownThresholdFor(
  rules: ResolvedBreakdownRules | null,
  axis: string,
  key: string,
): number | null {
  if (!rules || axis !== rules.axis) return null;
  const own = rules.byKey.get(key);
  // `undefined` = no entry at all → fall back; an entry holding `null` is a deliberate «none».
  return own === undefined ? rules.fallback : own;
}

/**
 * Apply the key thresholds to ONE section's breakdown records (FR-19 - FR-22).
 *
 * Stamps `passed` on every record and answers the section's key verdict: `true` when every
 * applied threshold holds, `false` when at least one is missed, `null` when NO threshold
 * applied at all — no rules, only informational keys, or nothing delivered under the keys
 * that have one (FR-22). `null` must not be read as «passed»: the caller distinguishes «the
 * keys say nothing» from «the keys say yes».
 *
 * The records are mutated on purpose. They are the very objects both hosts persist with the
 * attempt and render from, so returning copies would mean threading a second array through
 * two hosts, the stored result and the report.
 */
export function applyBreakdownGate(entries: BreakdownEntry[], rawRules: unknown): boolean | null {
  const rules = resolveBreakdownRules(rawRules);
  let verdict: boolean | null = null;
  for (const e of entries) {
    const threshold = breakdownThresholdFor(rules, e.axis, e.key);
    // FR-22: a key nothing was delivered under cannot be missed, so it is not judged.
    if (threshold === null || e.items <= 0) {
      e.passed = null;
      continue;
    }
    // FR-21: ALWAYS the points share — the display basis must not move the verdict.
    const ok = e.percentPoints >= threshold;
    e.passed = ok;
    verdict = verdict === null ? ok : verdict && ok;
  }
  return verdict;
}
```

- [ ] **Шаг 3. Переставить порядок в агрегате**

В `shared/scoring/aggregate.ts` расширить импорт из `./pass-rule`, дописав `applyBreakdownGate`.

В `AggregateSection` после `required` добавить:

```ts
  /**
   * PRD-50 §4: stored `test_sections.breakdown_rules_json` (any shape — normalised here,
   * like `topicPassRule`). Absent = the topic is gated exactly as before this PRD.
   */
  breakdownRules?: unknown;
```

Внутри `aggregateStandardResult` перед `const topicResults` объявить накопитель гейтов рядом с
`breakdownItems`:

```ts
  /**
   * Per-section inputs the SECOND pass needs, positionally aligned with `topicResults`.
   * The verdict cannot be decided in the first pass any more: FR-16 puts the breakdown
   * records BEFORE the topic verdict, and those records exist only once every section has
   * contributed its delivered items.
   */
  const gates: Array<{
    rule: ResolvedRule | null;
    scored: number;
    required: boolean;
    breakdownRules: unknown;
  }> = [];
```

В теле `map`, вместо нынешних строк с `const passed: boolean | null = ...` и блока
`if (passed === false) { ... }`, оставить:

```ts
    const resolved = resolveTopicRule(sec.topicPassRule, overall, { formId: sec.formId ?? null });
    gates.push({
      rule: resolved,
      scored,
      // FR: absent flag = required (DB default `test_sections.required = true`).
      required: sec.required !== false,
      breakdownRules: sec.breakdownRules ?? null,
    });
```

а в возвращаемом объекте заменить `passed,` на:

```ts
      // Filled by the second pass below (FR-16): the key gate needs this topic's records.
      passed: null,
```

После блока группировки записей по областям (`const bySection = ...`) заменить нынешний цикл
`for (const topic of topicResults) { topic.breakdown = ... }` на:

```ts
  // FR-16, шаги 2 и 3: сперва записи в области раздела, ПОТОМ вердикт темы, который на них
  // опирается. Накопители `allTopicsPassed`/`requiredTopicsPassed` — конъюнкции, поэтому
  // перенос их сложения в этот проход не может изменить ни один существующий вердикт.
  for (let i = 0; i < topicResults.length; i++) {
    const topic = topicResults[i];
    const gate = gates[i];
    topic.breakdown = bySection.get(sectionScope(topic.topicId)) ?? [];
    // FR-09: a section with nothing to grade has no percent to compare, so it stays UNGATED
    // (`null`) instead of failing its rule at 0%.
    const byRule =
      gate.rule && gate.scored > 0 ? checkPassRule(gate.rule, topic.percent, topic.earnedPoints) : null;
    // FR-19: … AND every declared key threshold. Either half may be absent: a section with
    // key thresholds and no rule of its own is gated by the keys alone.
    const byKeys = applyBreakdownGate(topic.breakdown, gate.breakdownRules);
    const passed = byRule === null && byKeys === null ? null : byRule !== false && byKeys !== false;
    topic.passed = passed;
    if (passed === false) {
      allTopicsPassed = false;
      if (gate.required) requiredTopicsPassed = false;
    }
  }
```

Обновить JSDoc модуля: строка про «per-topic + overall percent are points-based; the final
verdict combines…» дополняется предложением о том, что вердикт темы теперь считается вторым
проходом, после разрезов, и включает пороги ключей (FR-16/FR-19).

- [ ] **Шаг 4. Прогнать тесты**

```bash
npm test -- tests/breakdown-gate.test.ts tests/scoring-aggregate.test.ts tests/breakdown-aggregate.test.ts
npm run check
```

Ожидание: PASS всех трёх файлов. `tests/scoring-aggregate.test.ts` обязан пройти БЕЗ правок — это
и есть проверка того, что перестановка ничего не сдвинула.

- [ ] **Шаг 5. Коммит**

```bash
git add shared/scoring/pass-rule.ts shared/scoring/aggregate.ts tests/breakdown-gate.test.ts
git commit -m "feat(prd-50): вердикт темы учитывает пороги ключей разреза"
```

---

## Task 3: правила доезжают до обоих хостов

**Files:**

- Modify: `shared/schema.ts` (`topicResultSchema`)
- Modify: `server/routes/attempts.ts`
- Modify: `server/scorm/builders/test-json.ts`
- Modify: `server/scorm/template/app/render/resultsPage.js`
- Modify: `shared/template/runtime-entry.ts`
- Test: `server/scorm/__tests__/test-json-prd50.test.ts` (дополнить)

- [ ] **Шаг 1. Сохраняемая запись обязана нести вердикт ключа**

В `shared/schema.ts` в `topicResultSchema`, внутри объекта записи разреза, после `percentUnits`:

```ts
        // PRD-50 FR-19: вердикт ключа. Zod СТРИЖЁТ необъявленные поля, поэтому без этой
        // строки гейт считался бы, а до экрана и до отчёта не доезжал.
        passed: z.boolean().nullable().optional(),
```

- [ ] **Шаг 2. Дополнить тест выпечки**

В `server/scorm/__tests__/test-json-prd50.test.ts` добавить блок:

```ts
describe("buildTestJson: пороги ключей в пакете", () => {
  it("выпекает breakdownRules секции, когда автор их задал", () => {
    const json = buildTestJson(fixtureWithSectionRules({ axis: "tag", keys: { "ПДн": { type: "percent", value: 80 } } }));
    expect(json.sections[0].breakdownRules).toEqual({
      axis: "tag",
      keys: { "ПДн": { type: "percent", value: 80 } },
    });
  });

  it("не выпекает ничего, когда порогов нет — пакет остаётся байт-идентичным", () => {
    const json = buildTestJson(fixtureWithSectionRules(null));
    expect("breakdownRules" in json.sections[0]).toBe(false);
  });
});
```

Фикстуру `fixtureWithSectionRules(rules)` собрать из уже существующих в этом файле частей
(`baseTest`/`bake`), положив `breakdownRulesJson: rules` в единственную секцию. Точные имена полей
секции сверить по `server/scorm/builders/test-json.ts:280-320` — там они читаются.

Команда: `npm test -- server/scorm/__tests__/test-json-prd50.test.ts`
Ожидание: FAIL первого нового теста (`breakdownRules` отсутствует).

- [ ] **Шаг 3. Выпечь правила в пакет**

В `server/scorm/builders/test-json.ts` в маппинге секций, сразу после строки с `formSet`
(около строки 316), добавить:

```ts
        // PRD-50 §4 (FR-09): per-key thresholds of this section. Baked only when the author
        // set them, so packages of tests without thresholds stay byte-identical; the runtime
        // reads `section.breakdownRules` and an absent value means «keys are informational».
        ...(s.breakdownRulesJson ? { breakdownRules: s.breakdownRulesJson } : {}),
```

Команда: `npm test -- server/scorm/__tests__/test-json-prd50.test.ts`
Ожидание: PASS.

- [ ] **Шаг 4. Подать правила в агрегат веб-хоста**

В `server/routes/attempts.ts` в `/attempts/:attemptId/finish`, в `aggSections.push({...})` после
строки `required: section?.required ?? true,`:

```ts
        // PRD-50 FR-19: пороги ключей ЭТОГО раздела — из того же источника, из которого
        // попытка выдавалась (снимок или живой тест), поэтому закреплённая за снимком
        // попытка судится порогами, с которыми её опубликовали.
        breakdownRules: section?.breakdownRulesJson ?? null,
```

В `/attempts/:attemptId/section-result`, в объекте `aggSection` после `formId`:

```ts
      // PRD-50 FR-19: тот же гейт, что на итогах теста — иначе экран итогов раздела
      // объявил бы пройденным то, что финальный экран не пройдёт.
      breakdownRules: section?.breakdownRulesJson ?? null,
```

- [ ] **Шаг 5. Открыть гейт рантайму пакета**

В `shared/template/runtime-entry.ts` рядом со строкой
`export { resolveOverallRule, resolveTopicRule, checkPassRule } from "../scoring/pass-rule";`
заменить её на:

```ts
export {
  resolveOverallRule,
  resolveTopicRule,
  checkPassRule,
  // PRD-50 FR-19: экран итогов РАЗДЕЛА считает вердикт своей веткой (`computeSectionResult`),
  // мимо `aggregateStandardResult`, поэтому гейт по ключам нужен ему отдельной функцией.
  resolveBreakdownRules,
  applyBreakdownGate,
} from "../scoring/pass-rule";
export { computeBreakdowns, sectionScope, TEST_SCOPE } from "../breakdown/compute";
```

(если `computeBreakdowns` уже экспортируется — вторую строку не дублировать, проверить грепом
`grep -n "breakdown/compute" shared/template/runtime-entry.ts`).

В `server/scorm/template/app/render/resultsPage.js` в `calculateResults`, в объекте `byTopic[...]`
после `required: ...`:

```js
        // PRD-50 FR-19: пороги ключей этого раздела; выпечены в TEST_DATA как
        // section.breakdownRules. Отсутствие = ключи информационные, вердикт как до PRD-50.
        breakdownRules: section ? (section.breakdownRules || null) : null,
```

В том же файле в `computeSectionResult` собрать элементы разреза в существующем
`state.flatQuestions.forEach` (после `earnedPoints += qPoints * scoreRatio;`):

```js
    // PRD-50 FR-19: тот же гейт, что у итогов теста. Измерительный вопрос в разрез не
    // попадает — то же исключение, что делает `aggregateStandardResult` (FR-02).
    if (!(typeof TBQType !== 'undefined' && TBQType.isMeasurementOnly(q))) {
      breakdownItems.push({
        sectionId: topicId,
        axisKeys: q.tags && q.tags.length ? { tag: q.tags } : null,
        earned: qPoints * scoreRatio,
        possible: qPoints,
        answered: answer !== undefined && answer !== null
      });
    }
```

объявив `var breakdownItems = [];` рядом с `var fullyCorrect = 0;`, а после вычисления `passed`
добавить:

```js
  // PRD-50 FR-19/FR-22: пороги ключей раздела. `applyBreakdownGate` возвращает null, когда
  // ни один порог не применился, и тогда вердикт остаётся тем, что дал порог раздела.
  var sectionEntries = window.TBTemplate.computeBreakdowns(breakdownItems).filter(function (e) {
    return e.scope !== 'test';
  });
  var keysVerdict = window.TBTemplate.applyBreakdownGate(
    sectionEntries,
    section ? (section.breakdownRules || null) : null
  );
  if (keysVerdict !== null) passed = passed === null ? keysVerdict : passed && keysVerdict;
```

и положить записи в результат раздела рядом с `resolvedPassRule`:

```js
    breakdown: sectionEntries,
```

- [ ] **Шаг 6. Проверить на живом пакете**

```bash
npm run scorm:template
npm run scorm:player
```

Пройти пакет до экрана итогов раздела и итогов теста. В консоли проверить:

```js
window.TBTemplate.applyBreakdownGate  // функция существует
TEST_DATA.sections[0].breakdownRules  // выпеченные правила (или undefined, если их нет)
```

Ожидание: у теста без порогов `breakdownRules` отсутствует и вердикты прежние; после ручной
правки `test.json` в распакованном пакете (порог 80 % на заведомо проваленный тег) тема на обоих
экранах становится непройденной.

- [ ] **Шаг 7. Прогнать тесты и закоммитить**

```bash
npm test -- server/scorm/__tests__/test-json-prd50.test.ts tests/breakdown-gate.test.ts
npm run check
git add shared/schema.ts server/routes/attempts.ts server/scorm/builders/test-json.ts \
        server/scorm/template/app/render/resultsPage.js shared/template/runtime-entry.ts \
        server/scorm/__tests__/test-json-prd50.test.ts
git commit -m "feat(prd-50): пороги ключей доезжают до веб-хоста и пакета SCORM"
```

---

## Task 4: вердикт ключа в контексте и в раскладках

**Files:**

- Modify: `shared/template/context.ts`
- Modify: `shared/template/result-context.ts`
- Modify: `server/scorm/templates/default/layouts/results.html`, `.../layouts/report.html`
- Modify: `templates/certification/layouts/results.html`, `.../layouts/report.html`
- Modify: `server/scorm/templates/default/styles/theme.css`, `.../styles/report.css`
- Modify: `templates/certification/styles/theme.css`, `templates/certification/styles/report.css`
- Test: `shared/template/__tests__/result-context-breakdown.test.ts` (дополнить)

- [ ] **Шаг 1. Написать падающий тест**

В `shared/template/__tests__/result-context-breakdown.test.ts` добавить:

```ts
describe("вердикт ключа в строке разреза (§8.1, с Э2)", () => {
  const withVerdict = (passed: boolean | null) => ({
    ...result,
    topicResults: [{ ...topic, breakdown: [{ ...topic.breakdown[0], passed }] }],
  });

  it("порог пройден — класс и подпись как у темы", () => {
    const ctx = buildResultContext(withVerdict(true) as never, {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ passed: true, passClass: "is-pass", statusLabel: "Пройдено" });
  });

  it("порог не пройден", () => {
    const ctx = buildResultContext(withVerdict(false) as never, {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ passed: false, passClass: "is-fail", statusLabel: "Не пройдено" });
  });

  it("порога нет — строка молчит о вердикте, а не утверждает «не пройдено»", () => {
    const ctx = buildResultContext(withVerdict(null) as never, {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ passed: null, passClass: "", statusLabel: "" });
  });
});
```

Команда: `npm test -- shared/template/__tests__/result-context-breakdown.test.ts`
Ожидание: FAIL — в строке нет полей `passed`/`passClass`/`statusLabel`.

- [ ] **Шаг 2. Расширить контракт строки**

В `shared/template/context.ts` в `CtxBreakdownRow` после `valueLabel` добавить:

```ts
  /**
   * PRD-50 FR-19 (§8.1, «с Э2»): вердикт ключа. `null` = порога нет, и строка не утверждает
   * о ключе ничего: у полосы нет ни класса, ни подписи. Три поля, а не одно, по той же
   * причине, по какой их три у темы: раскладка не должна ни считать, ни переводить.
   */
  passed: boolean | null;
  /** Core-prepared class, e.g. `is-pass` / `is-fail` / `""`. */
  passClass: string;
  /** Core-prepared label, e.g. `Пройдено` / `Не пройдено` / `""`. */
  statusLabel: string;
```

- [ ] **Шаг 3. Заполнить их в построителе**

В `shared/template/result-context.ts` в `topicView` внутри `t.breakdown.map(...)` дополнить
возвращаемый объект:

```ts
      const passed = e.passed ?? null;
      return {
        key: e.key,
        barPercent: Math.round(value),
        showValue,
        valueLabel: showValue ? Math.round(value) + " %" : "",
        // Те же три поля и та же пара слов, что у темы. Свои надписи методики — Э3 (FR-34):
        // словарь PRD-49 получает ключи `topic.verdict.*` там, а не здесь.
        passed,
        passClass: passed === true ? "is-pass" : passed === false ? "is-fail" : "",
        statusLabel: passed === true ? "Пройдено" : passed === false ? "Не пройдено" : "",
      };
```

- [ ] **Шаг 4. Показать вердикт в раскладках**

В `server/scorm/templates/default/layouts/results.html` строку разреза заменить на:

```html
              <div class="tb-breakdown__row {{ passClass }}" data-item="{{ key }}">
                <div class="tb-breakdown__name">{{ key }}{{#if statusLabel}}<span class="tb-breakdown__status">{{ statusLabel }}</span>{{/if}}</div>
                <div class="tb-breakdown__bar"><span style="width: {{ barPercent }}%;"></span></div>
                {{#if showValue}}<div class="tb-breakdown__val">{{ valueLabel }}</div>{{/if}}
              </div>
```

В `server/scorm/templates/default/layouts/report.html` — то же по смыслу, своими классами:

```html
          <div class="tb-report__breakdown-row {{ passClass }}" data-item="{{ key }}">
            <div class="tb-report__breakdown-name">{{ key }}{{#if statusLabel}}<span class="tb-report__breakdown-status">{{ statusLabel }}</span>{{/if}}</div>
            <div class="tb-report__breakdown-bar"><span style="width: {{ barPercent }}%;"></span></div>
            {{#if showValue}}<div class="tb-report__breakdown-val">{{ valueLabel }}</div>{{/if}}
          </div>
```

Обе правки ДОСЛОВНО повторить в `templates/certification/layouts/results.html` и
`templates/certification/layouts/report.html`: паритет шаблонов держится вручную, и расхождение
классов сразу разъедет CSS (гард `tests/template-layout-parity.test.ts` ловит расхождение стилей,
но не разметки).

- [ ] **Шаг 5. Стили в оба шаблона**

В `server/scorm/templates/default/styles/theme.css` рядом с существующими `.tb-breakdown__*`:

```css
.tb-breakdown__status { margin-left: 6px; font: var(--ou-text-body-s); color: var(--ou-fg-muted); }
.tb-breakdown__row.is-pass .tb-breakdown__bar span { background: var(--ou-fg-success); }
.tb-breakdown__row.is-fail .tb-breakdown__bar span { background: var(--ou-fg-error); }
.tb-breakdown__row.is-pass .tb-breakdown__status { color: var(--ou-fg-success); }
.tb-breakdown__row.is-fail .tb-breakdown__status { color: var(--ou-fg-error); }
```

В `server/scorm/templates/default/styles/report.css` рядом с `.tb-report__breakdown*`:

```css
.tb-report__breakdown-status { margin-left: 6px; font-size: 7px; color: #6b7280; }
.tb-report__breakdown-row.is-pass .tb-report__breakdown-bar span { background: #15803d; }
.tb-report__breakdown-row.is-fail .tb-report__breakdown-bar span { background: #b91c1c; }
.tb-report__breakdown-row.is-pass .tb-report__breakdown-status { color: #15803d; }
.tb-report__breakdown-row.is-fail .tb-report__breakdown-status { color: #b91c1c; }
```

Те же селекторы добавить в `templates/certification/styles/theme.css` и
`templates/certification/styles/report.css` (значения — палитрой этого шаблона, но набор
селекторов обязан совпадать: именно это проверяет гард паритета). Имена токенов
`--ou-fg-success`/`--ou-fg-error` проверить по `server/scorm/templates/default/styles/base.css`
и по уже используемым правилам `.is-pass`/`.is-fail` в `theme.css` — **требует проверки на месте**,
взять те токены, которыми уже покрашен вердикт темы.

- [ ] **Шаг 6. Пересобрать предпросмотры и прогнать тесты**

```bash
npm run scorm:previews
npm test -- shared/template/__tests__ tests/template-layout-parity.test.ts
npm run check
```

Ожидание: PASS; `preview.html` обоих шаблонов пересобран генератором, руками не правится.

- [ ] **Шаг 7. Коммит**

```bash
git add shared/template/context.ts shared/template/result-context.ts \
        server/scorm/templates/default templates/certification \
        shared/template/__tests__/result-context-breakdown.test.ts
git commit -m "feat(prd-50): строка разреза несёт вердикт ключа на итогах и в отчёте"
```

---

## Task 5: таблица «раздел × ключ» в редакторе

**Files:**

- Modify: `client/src/features/tests/editor/test-editor.types.ts`
- Modify: `client/src/features/tests/editor/test-editor.mappers.ts`
- Modify: `client/src/features/tests/editor/sections/topics-structure-section.tsx`
- Test: `client/src/features/tests/editor/sections/__tests__/topics-structure-breakdown.test.tsx`

Сегодня квоты живут в подкомпоненте `QuotaEditor` внутри `TopicRow`
(`topics-structure-section.tsx:552-775`): переключатель «Квоты по подтемам (тегам)», таблица
`strata` со столбцами «Подтема» / «Сколько» / «Режим» / «Доступно», строка Σ. Таблица СХЛОПЫВАЕТСЯ,
когда включён режим вариантов (`partialDrawLocked` → `expanded === false`), — а пороги в вариантном
режиме как раз нужны (в разобранной книге все разделы вариантные). Поэтому Э2 делает таблицу
общей: строки — объединение тегов квот и тегов порогов, два независимых переключателя (квоты и
пороги), столбцы квоты гаснут там же, где гасли, а столбец порога остаётся живым.

- [ ] **Шаг 1. Написать падающий тест**

`client/src/features/tests/editor/sections/__tests__/topics-structure-breakdown.test.tsx`:

```tsx
/**
 * @module features/tests/editor/sections/__tests__/topics-structure-breakdown.test
 * @description PRD-50 FR-42: таблица «раздел x ключ» — квота, порог и попадание ключа в
 * каждый вариант в ОДНОЙ строке. Пороги доступны и в вариантном режиме, где квоты гаснут.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

const TOPICS = [{ id: "top-1", name: "Основы ИБ", questionCount: 4 }];
const QUESTIONS = [
  { id: "q1", topicId: "top-1", type: "single", prompt: "Q1", tags: ["Крипто"] },
  { id: "q2", topicId: "top-1", type: "single", prompt: "Q2", tags: ["Крипто"] },
  { id: "q3", topicId: "top-1", type: "single", prompt: "Q3", tags: ["Сети"] },
  { id: "q4", topicId: "top-1", type: "single", prompt: "Q4", tags: [] },
];

function baseModel(sections: EditorSection[]): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Sample", description: "", status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [], feedbackAssets: [], feedbackEvents: [],
      webhookUrl: "", telemetryEnabled: false,
    },
    runtime: {
      timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true,
      skipReviewWhenComplete: false, quickAdvance: false, copyProtection: true,
      protectionWatermark: false, protectionHideOnBlur: false,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections,
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [], scales: [], measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
  };
}

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1", topicName: "Основы ИБ", maxQuestions: 4, drawCount: 3,
    drawAll: false, required: false, timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [], feedbackAssets: [], feedbackEvents: [], defaultPoints: null,
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => TOPICS, text: async () => "[]" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/questions"], QUESTIONS);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function selectOption(testId: string, label: string | RegExp) {
  const wrap = screen.getByTestId(testId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("таблица «раздел x ключ»", () => {
  it("включение порогов заводит правила с осью тега", () => {
    const updateModel = vi.fn();
    const model = baseModel([buildSection()]);
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("topic-rules-toggle-top-1"));
    const next = (updateModel.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);
    expect(next.sections[0].breakdownRules).toEqual({ axis: "tag", keys: {} });
  });

  it("порог ключа сохраняется процентом", () => {
    const updateModel = vi.fn();
    const model = baseModel([
      buildSection({ breakdownRules: { axis: "tag", keys: { "Крипто": { type: "none" } } } }),
    ]);
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    selectOption("key-threshold-mode-top-1-0", /Не менее/);
    const next = (updateModel.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);
    expect(next.sections[0].breakdownRules!.keys!["Крипто"]).toEqual({ type: "percent", value: 60 });
  });

  it("в режиме вариантов квоты заперты, а пороги и попадание в варианты видны (FR-42)", () => {
    const model = baseModel([
      buildSection({
        breakdownRules: { axis: "tag", keys: { "Крипто": { type: "percent", value: 60 } } },
        formSet: {
          forms: [
            { id: "f1", label: "Вариант 1", questionIds: ["q1", "q3"] },
            { id: "f2", label: "Вариант 2", questionIds: ["q3", "q4"] },
          ],
        },
      }),
    ]);
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("key-threshold-mode-top-1-0")).toBeInTheDocument();
    // Ключ «Крипто» есть в первом варианте (q1) и отсутствует во втором.
    expect(screen.getByTestId("key-variants-top-1-0")).toHaveTextContent("Вариант 1: 1");
    expect(screen.getByTestId("key-variants-top-1-0")).toHaveTextContent("Вариант 2: 0");
  });
});
```

Команда:
`npm test -- client/src/features/tests/editor/sections/__tests__/topics-structure-breakdown.test.tsx`
Ожидание: FAIL — элементов нет.

- [ ] **Шаг 2. Модель и мапперы**

В `client/src/features/tests/editor/test-editor.types.ts`:

- в импорт типов добавить `BreakdownRules` (из `@shared/schema`, где он реэкспортируется колонкой;
  иначе из `@shared/breakdown/types`);
- в `EditorSection` после `formSet`:

```ts
  /**
   * PRD-50 §4 (FR-09): пороги ключей разреза этого раздела. `null`/absent = ключи
   * информационные, вердикт темы считается ровно как до PRD-50.
   */
  breakdownRules?: BreakdownRules | null;
```

- в `TestSectionPayload` после `formSetJson`:

```ts
  /** PRD-50 §4: пороги ключей; `null` = ключи информационные. */
  breakdownRulesJson: BreakdownRules | null;
```

В `client/src/features/tests/editor/test-editor.mappers.ts`:

- рядом с `readFormSetFromApi` добавить читателя:

```ts
/**
 * Read the per-key thresholds (PRD-50 §4) from the API jsonb. Validated with
 * `breakdownRulesSchema`; absence or any malformed shape degrades to `null` (keys are
 * informational), so a bad blob never breaks the editor.
 */
function readBreakdownRulesFromApi(raw: unknown): BreakdownRules | null {
  if (raw == null) return null;
  const parsed = breakdownRulesSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}
```

- в сборке `sections.push({...})` после `formSet`:

```ts
      // PRD-50 §4: пороги ключей (валидируем; кривое/отсутствующее = null).
      breakdownRules: readBreakdownRulesFromApi(raw.breakdownRulesJson),
```

- в `mapEditorSectionsToPayload` в возвращаемый объект после `formSetJson`:

```ts
      // PRD-50 §4: пороги ключей; пустой набор без умолчания шлём как null — пустая
      // структура и её отсутствие означают одно и то же, а null короче в базе.
      breakdownRulesJson: normalizeBreakdownRules(section.breakdownRules),
```

и рядом с функцией завести нормализатор:

```ts
/** Empty rules (no default, no keys, or only `none` keys) collapse to `null`. */
function normalizeBreakdownRules(rules: BreakdownRules | null | undefined): BreakdownRules | null {
  if (!rules) return null;
  const keys = rules.keys ?? {};
  const meaningful = Object.keys(keys).filter((k) => keys[k].type === "percent");
  if (!rules.default && meaningful.length === 0) return null;
  return rules;
}
```

- [ ] **Шаг 3. Перестроить таблицу**

В `client/src/features/tests/editor/sections/topics-structure-section.tsx`:

- расширить локальный тип строки вопроса, чтобы считать попадание в варианты:

```ts
/** Minimal shape of `/api/questions` rows the key table needs. */
type QuestionTagRow = { id?: string; topicId: string; tags?: string[] };
```

- в `CompositionSection` рядом с `tagsByTopic` собрать карту тегов по вопросу:

```ts
  // PRD-50 FR-42: «сколько вопросов с этим ключом попадает в каждый вариант» считается по
  // составу вариантов, а состав хранится идентификаторами — значит нужна карта id -> теги.
  const tagsByQuestion = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const q of allQuestions) if (q.id) map.set(q.id, Array.isArray(q.tags) ? q.tags : []);
    return map;
  }, [allQuestions]);
```

и передать её в `TopicRow` (проп `tagsByQuestion`), а оттуда — в таблицу;

- в `TopicRow` добавить проп `onChangeBreakdownRules: (rules: BreakdownRules | null) => void`
  и прокинуть его из `CompositionSection`:

```tsx
          onChangeBreakdownRules={(rules) => updateSection(section.topicId, { breakdownRules: rules })}
```

- переименовать `QuotaEditor` в `KeysTable` (оставив тот же файл и то же место вызова) и внести
  правки:

```tsx
  const rules = props.rules;
  const rulesOn = rules != null;
  // Строки таблицы — ОБЪЕДИНЕНИЕ ключей квот и ключей порогов, в порядке появления: квота и
  // порог живут в разных структурах (решение 5), но автор видит их одной строкой (FR-42).
  const rowKeys: string[] = [];
  for (const s of strata) if (!rowKeys.some((t) => tagKey(t) === tagKey(s.tag))) rowKeys.push(s.tag);
  for (const k of Object.keys(rules?.keys ?? {})) if (!rowKeys.some((t) => tagKey(t) === tagKey(k))) rowKeys.push(k);
  // Таблица раскрыта, когда есть что показывать: квоты включены и применимы ЛИБО включены
  // пороги. Прежнее условие (только квоты) прятало пороги в вариантном режиме, где они
  // как раз и нужны — вариантные разделы это весь разобранный сертификационный тест.
  const expanded = (enabled && !forcedDisabled) || rulesOn;
  const variants = props.formSet?.forms ?? null;
  const variantCounts = (key: string): number[] =>
    (variants ?? []).map(
      (f) => f.questionIds.filter((id) => (props.tagsByQuestion.get(id) ?? []).some((t) => tagKey(t) === tagKey(key))).length,
    );
```

- рядом с переключателем квот добавить переключатель порогов:

```tsx
      <label className="tb-quota-toggle">
        <Switch
          checked={rulesOn}
          disabled={noTags}
          onChange={(e) => props.onChangeRules(e.target.checked ? { axis: "tag", keys: {} } : null)}
          aria-label={`Пороги по подтемам: ${topicName}`}
          data-testid={`topic-rules-toggle-${topicId}`}
        />
        <span className="tb-section-label">
          <Layers size={14} aria-hidden="true" />
          Пороги по подтемам (тегам)
        </span>
      </label>
```

- в шапку таблицы добавить столбцы, а строки перевести на `rowKeys`:

```tsx
                <th>Порог</th>
                {variants && <th>В вариантах</th>}
```

```tsx
              {rowKeys.map((rowTag, i) => {
                const stratum = strata.find((s) => tagKey(s.tag) === tagKey(rowTag)) ?? null;
                const threshold = rules?.keys?.[rowTag] ?? { type: "none" as const };
                ...
```

- ячейка порога — два контрола дизайн-системы, второй появляется только для процента:

```tsx
                    <td>
                      <Select
                        size="s"
                        value={threshold.type}
                        options={[
                          { value: "none", label: "Не проверять" },
                          { value: "percent", label: "Не менее, %" },
                        ]}
                        disabled={!rulesOn}
                        onChange={(v) =>
                          props.onChangeRules(
                            withKeyThreshold(rules, rowTag, v === "percent" ? { type: "percent", value: 60 } : { type: "none" }),
                          )
                        }
                        aria-label={`Порог для подтемы «${rowTag}»`}
                        data-testid={`key-threshold-mode-${topicId}-${i}`}
                      />
                      {threshold.type === "percent" && (
                        <NumberInput
                          size="s"
                          value={threshold.value}
                          min={0}
                          max={100}
                          disabled={!rulesOn}
                          onChange={(n) =>
                            props.onChangeRules(withKeyThreshold(rules, rowTag, { type: "percent", value: n }))
                          }
                          aria-label={`Значение порога для подтемы «${rowTag}», проценты`}
                          data-testid={`key-threshold-value-${topicId}-${i}`}
                        />
                      )}
                    </td>
                    {variants && (
                      <td data-testid={`key-variants-${topicId}-${i}`}>
                        {variantCounts(rowTag).map((n, vi) => (
                          <span key={vi} className="tb-quota-block__avail">
                            {variants[vi].label}: {n}
                            {vi < variants.length - 1 ? " · " : ""}
                          </span>
                        ))}
                      </td>
                    )}
```

- вспомогательная функция рядом с компонентом:

```tsx
/** Replace ONE key's threshold, keeping the rest of the rules untouched. */
function withKeyThreshold(
  rules: BreakdownRules | null,
  key: string,
  threshold: BreakdownThreshold,
): BreakdownRules {
  const base = rules ?? { axis: "tag" as const, keys: {} };
  return { ...base, axis: "tag", keys: { ...(base.keys ?? {}), [key]: threshold } };
}
```

- под таблицей, когда включены пороги, дописать пояснение одной строкой (без выдуманных
  терминов, только тем словарём, что уже есть на экране):

```tsx
          {rulesOn && (
            <div className="tb-card-desc">
              Порог сравнивается с долей БАЛЛОВ по подтеме, независимо от того, что выбрано для показа.
              Подтема, не попавшая в выдачу, вердикт темы не роняет.
            </div>
          )}
```

Своих `.ou-*` классов не писать — только импортированные компоненты дизайн-системы; `tb-*` классы
берутся существующие (`tb-table`, `tb-card-desc`, `tb-quota-block__avail`, `tb-quota-toggle`).

- [ ] **Шаг 4. Прогнать тесты**

```bash
npm test -- client/src/features/tests/editor/sections/__tests__ client/src/features/tests/editor/__tests__
npm run check
```

Ожидание: PASS, включая существующие тесты квот (`quota-tag-*`, `quota-count-*`, `quota-add-*`,
Σ-строка) — идентификаторы и поведение квот не меняются.

- [ ] **Шаг 5. Приёмка в браузере**

Поднять второй экземпляр dev (`PORT=8099 npm run dev`), войти учёткой приёмки
(`acceptance@local.test` / `Acceptance!2026`) и на тесте с тегами:

1. открыть редактор теста → вкладка «Состав» → тема с тегами: включить «Пороги по подтемам
   (тегам)», задать «Не менее, %» = 80 для одного ключа, сохранить, перезагрузить страницу —
   значение на месте (проверка того, что колонка доехала до базы и обратно);
2. включить у той же темы режим вариантов: квоты гаснут, столбец «Порог» остаётся живым, в
   столбце «В вариантах» видно число вопросов с ключом по каждому варианту;
3. пройти тест так, чтобы по этому ключу набрать меньше 80 % баллов при выполненном пороге
   раздела: на экране итогов карточка темы — «Не пройдено», полоса ключа красная с подписью
   «Не пройдено», прочие ключи без подписи;
4. переключить базу показа («доля вопросов» ↔ «доля баллов»): длина полосы и число меняются,
   вердикт темы и подпись ключа — нет;
5. скачать PDF-отчёт: те же строки, тот же порядок, та же раскраска.

Снимки экрана приложить к отчёту о приёмке.

- [ ] **Шаг 6. Коммит**

```bash
git add client/src/features/tests/editor
git commit -m "feat(prd-50): таблица «раздел — ключ» с порогами и попаданием в варианты"
```

---

## Task 6: предупреждения при публикации

**Files:**

- Create: `shared/breakdown/publish-warnings.ts`
- Create: `shared/breakdown/publish-warnings.test.ts`
- Create: `server/services/breakdown-warnings.ts`
- Modify: `server/routes/tests.ts`
- Modify: `client/src/features/content-protection/types.ts`, `issue-text.ts`,
  `content-impact-dialog.tsx`
- Modify: `client/src/features/tests/list/tests-list.tsx`

- [ ] **Шаг 1. Написать падающий тест движка**

`shared/breakdown/publish-warnings.test.ts`:

```ts
/**
 * @module shared/breakdown/publish-warnings.test
 * @description PRD-50 FR-45 - FR-47: четыре ловушки выдачи, о которых автор узнаёт при
 * публикации. Предупреждения, а не запреты: публикация проходит в любом случае.
 */
import { describe, it, expect } from "vitest";
import { checkBreakdownPublish, type BreakdownPublishSection } from "./publish-warnings";

const section = (over: Partial<BreakdownPublishSection> = {}): BreakdownPublishSection => ({
  topicId: "law",
  topicName: "Право",
  drawCount: 3,
  drawAll: false,
  blueprint: null,
  variants: null,
  rules: null,
  questions: [
    { id: "q1", tags: ["ПДн"] },
    { id: "q2", tags: ["ПДн"] },
    { id: "q3", tags: ["Коррупция"] },
  ],
  ...over,
});

const codes = (sections: BreakdownPublishSection[]) => checkBreakdownPublish(sections).map((w) => w.code);

describe("checkBreakdownPublish", () => {
  it("молчит о разделе без ключей и без порогов", () => {
    expect(checkBreakdownPublish([section()])).toEqual([]);
  });

  it("сумма квот не равна выборке раздела (FR-45)", () => {
    const out = checkBreakdownPublish([
      section({ blueprint: { strata: [{ tag: "ПДн", count: 1 }] }, drawCount: 3 }),
    ]);
    expect(out[0]).toMatchObject({ code: "quota_sum_mismatch", count: 1, total: 3 });
  });

  it("есть вопросы без ключа, когда ключи в игре (FR-45)", () => {
    const out = checkBreakdownPublish([
      section({
        blueprint: { strata: [{ tag: "ПДн", count: 2 }, { tag: "Коррупция", count: 1 }] },
        questions: [
          { id: "q1", tags: ["ПДн"] },
          { id: "q2", tags: ["ПДн"] },
          { id: "q3", tags: ["Коррупция"] },
          { id: "q4", tags: [] },
        ],
      }),
    ]);
    expect(out.map((w) => w.code)).toContain("questions_without_key");
    expect(out.find((w) => w.code === "questions_without_key")!.count).toBe(1);
  });

  it("порог задан ключу, которого нет ни в одном варианте (FR-46)", () => {
    const out = checkBreakdownPublish([
      section({
        rules: { axis: "tag", keys: { "Коррупция": { type: "percent", value: 60 } } },
        variants: [
          { id: "f1", label: "Вариант 1", questionIds: ["q1"] },
          { id: "f2", label: "Вариант 2", questionIds: ["q2"] },
        ],
      }),
    ]);
    expect(out.find((w) => w.code === "threshold_key_never_delivered")!.key).toBe("Коррупция");
  });

  it("вопрос не входит ни в один вариант (FR-47)", () => {
    const out = checkBreakdownPublish([
      section({
        rules: { axis: "tag", default: { type: "percent", value: 60 } },
        variants: [{ id: "f1", label: "Вариант 1", questionIds: ["q1", "q2"] }],
      }),
    ]);
    expect(out.find((w) => w.code === "question_outside_variants")!.count).toBe(1);
  });

  it("заданы и квоты, и варианты — квоты не применяются (FR-47)", () => {
    const out = codes([
      section({
        blueprint: { strata: [{ tag: "ПДн", count: 2 }] },
        variants: [
          { id: "f1", label: "Вариант 1", questionIds: ["q1", "q2", "q3"] },
          { id: "f2", label: "Вариант 2", questionIds: ["q1", "q2", "q3"] },
        ],
      }),
    ]);
    expect(out).toContain("quotas_ignored_in_variants");
  });
});
```

Команда: `npm test -- shared/breakdown/publish-warnings.test.ts`
Ожидание: FAIL, модуля нет.

- [ ] **Шаг 2. Написать движок**

`shared/breakdown/publish-warnings.ts`:

```ts
/**
 * @module shared/breakdown/publish-warnings
 * @description PRD-50 FR-45 - FR-47: the four delivery traps an author is told about when a
 * test is published. WARNINGS, never blocks — publication proceeds and the snapshot is
 * frozen; the author decides what to do. Pure: the caller gathers the data, this only
 * judges it, so the same rules can later feed the editor without a second implementation.
 *
 * The traps come straight from the reference workbook: two questions of «Технологии» belong
 * to no variant and can never be delivered, and nothing in the service ever said so.
 */
import { tagKey } from "../tags";
import { resolveBreakdownRules, breakdownThresholdFor } from "../scoring/pass-rule";

export type BreakdownWarningCode =
  /** FR-45: Σ quotas ≠ the section's sample size — the keys do not partition it. */
  | "quota_sum_mismatch"
  /** FR-45: deliverable questions carry no key at all. */
  | "questions_without_key"
  /** FR-46: a threshold names a key that no delivery can produce — an unreachable gate. */
  | "threshold_key_never_delivered"
  /** FR-47: a question belongs to no variant and will never be delivered. */
  | "question_outside_variants"
  /** FR-47: quotas AND variants are both set; in variants mode quotas are not applied. */
  | "quotas_ignored_in_variants";

export interface BreakdownWarning {
  code: BreakdownWarningCode;
  topicId: string;
  topicName: string;
  /** The key the warning speaks about (`threshold_key_never_delivered`). */
  key?: string;
  /** The number the message quotes: Σ quotas, or how many questions are affected. */
  count?: number;
  /** What `count` is compared against (the section's sample size). */
  total?: number;
}

/** One section as the check sees it: delivery config, thresholds and the topic's pool. */
export interface BreakdownPublishSection {
  topicId: string;
  topicName: string;
  drawCount: number;
  drawAll: boolean;
  blueprint: { strata: Array<{ tag: string; count: number }> } | null;
  /** PRD-17 variants, or null when the section is not in variants mode. */
  variants: Array<{ id: string; label: string; questionIds: string[] }> | null;
  /** Stored `test_sections.breakdown_rules_json` (any shape — normalised here). */
  rules: unknown;
  questions: Array<{ id: string; tags: string[] }>;
}

/** Distinct normalised keys of one question. */
function keysOf(q: { tags: string[] }): Set<string> {
  const out = new Set<string>();
  for (const t of q.tags ?? []) {
    const k = tagKey(t);
    if (k) out.add(k);
  }
  return out;
}

export function checkBreakdownPublish(sections: readonly BreakdownPublishSection[]): BreakdownWarning[] {
  const out: BreakdownWarning[] = [];
  for (const s of sections) {
    const at = (w: Omit<BreakdownWarning, "topicId" | "topicName">) =>
      out.push({ topicId: s.topicId, topicName: s.topicName, ...w });
    const rules = resolveBreakdownRules(s.rules);
    const variants = s.variants && s.variants.length > 0 ? s.variants : null;

    // FR-47: quotas are silently inert in variants mode (PRD-17 FR-03). Saying so is the
    // whole point — the author configured two things and only one of them runs.
    if (variants && s.blueprint && !s.drawAll) at({ code: "quotas_ignored_in_variants" });

    // FR-47: a question outside every variant will never be delivered — the exact case the
    // reference workbook hides two questions in.
    if (variants) {
      const used = new Set(variants.flatMap((f) => f.questionIds));
      const orphans = s.questions.filter((q) => !used.has(q.id)).length;
      if (orphans > 0) at({ code: "question_outside_variants", count: orphans });
    }

    // The delivery pool the remaining checks judge: in variants mode only what a variant can
    // hand out, otherwise the topic's whole bank.
    const deliverable = variants
      ? s.questions.filter((q) => variants.some((f) => f.questionIds.includes(q.id)))
      : s.questions;
    const declaresKeys = s.blueprint != null || rules != null;

    // FR-45, first half: quotas that do not add up to the sample are not a partition of it.
    if (!variants && !s.drawAll && s.blueprint) {
      const sum = s.blueprint.strata.reduce((acc, st) => acc + (st.count || 0), 0);
      if (sum !== s.drawCount) at({ code: "quota_sum_mismatch", count: sum, total: s.drawCount });
    }

    // FR-45, second half: a deliverable question with no key falls outside every bar, and the
    // bars therefore do not add up to the section. Only worth saying when keys are in play.
    if (declaresKeys) {
      const withoutKey = deliverable.filter((q) => keysOf(q).size === 0).length;
      if (withoutKey > 0) at({ code: "questions_without_key", count: withoutKey });
    }

    // FR-46: a threshold nobody can ever meet or miss.
    if (rules) {
      const present = new Set<string>();
      for (const q of deliverable) for (const k of keysOf(q)) present.add(k);
      for (const key of rules.byKey.keys()) {
        if (breakdownThresholdFor(rules, rules.axis, key) === null) continue;
        if (!present.has(tagKey(key))) at({ code: "threshold_key_never_delivered", key });
      }
    }
  }
  return out;
}
```

Команда: `npm test -- shared/breakdown/publish-warnings.test.ts`
Ожидание: PASS, 6 тестов.

- [ ] **Шаг 3. Сервис доступа к данным**

`server/services/breakdown-warnings.ts`:

```ts
/**
 * @module server/services/breakdown-warnings
 * @description PRD-50 FR-45 - FR-47: gathers what {@link checkBreakdownPublish} judges —
 * sections, their delivery config, their thresholds and the topics' current pools — and
 * returns the publication warnings of one test. The mirror of `assessTestPublish`
 * (`draw-feasibility.ts`) with the opposite policy: that one BLOCKS an infeasible draw,
 * this one only speaks. Adaptive tests deliver by difficulty levels, not by sections with
 * quotas and variants, so they are out of scope and answer with an empty list.
 */
import { storage } from "../storage";
import {
  checkBreakdownPublish,
  type BreakdownPublishSection,
  type BreakdownWarning,
} from "@shared/breakdown/publish-warnings";

export async function assessBreakdownPublish(testId: string): Promise<BreakdownWarning[]> {
  const test = await storage.getTest(testId);
  if (!test || test.mode !== "standard") return [];
  const sections = await storage.getTestSections(testId);
  const input: BreakdownPublishSection[] = [];
  for (const s of sections) {
    const topic = await storage.getTopic(s.topicId);
    const questions = await storage.getQuestionsByTopic(s.topicId);
    input.push({
      topicId: s.topicId,
      topicName: topic?.name ?? "Unknown",
      drawCount: s.drawCount,
      drawAll: s.drawAll,
      blueprint: s.drawBlueprintJson ?? null,
      variants: s.formSetJson?.forms ?? null,
      rules: s.breakdownRulesJson ?? null,
      questions: questions.map((q) => ({ id: q.id, tags: q.tags ?? [] })),
    });
  }
  return checkBreakdownPublish(input);
}
```

- [ ] **Шаг 4. Отдать предупреждения роутом**

В `server/routes/tests.ts` добавить импорт `assessBreakdownPublish` и в
`PATCH /:id/status` заменить финальный `res.json(updated);` на:

```ts
    // PRD-50 FR-45 - FR-47: предупреждения, а не запреты. Считаются ПОСЛЕ успешной
    // публикации и снимка: они ни на что не влияют, кроме того, что автор о них узнаёт.
    const breakdownWarnings = status === "published" ? await assessBreakdownPublish(req.params.id) : [];
    res.json(breakdownWarnings.length > 0 ? { ...updated, breakdownWarnings } : updated);
```

- [ ] **Шаг 5. Показать их автору**

В `client/src/features/content-protection/types.ts` добавить типы (дословная копия
`BreakdownWarningCode`/`BreakdownWarning` из движка, как уже сделано для `PublishCheckFinding`).

В `client/src/features/content-protection/issue-text.ts` добавить:

```ts
/** Одно предупреждение публикации (PRD-50 FR-45 - FR-47) человеческим языком. */
export function describeBreakdownWarning(w: BreakdownWarning): string {
  switch (w.code) {
    case "quota_sum_mismatch":
      return `Тема «${w.topicName}»: сумма квот ${w.count} не равна выборке ${w.total} — подтемы не разбивают выдачу целиком.`;
    case "questions_without_key":
      return `Тема «${w.topicName}»: вопросов без подтемы — ${w.count}. Они попадут в выдачу, но не войдут ни в одну полосу.`;
    case "threshold_key_never_delivered":
      return `Тема «${w.topicName}»: порог задан для подтемы «${w.key}», которой нет ни в одной выдаче — порог недостижим.`;
    case "question_outside_variants":
      return `Тема «${w.topicName}»: вопросов вне вариантов — ${w.count}. Они не будут выданы никогда.`;
    case "quotas_ignored_in_variants":
      return `Тема «${w.topicName}»: заданы и квоты, и варианты. В режиме вариантов квоты не применяются.`;
  }
}
```

В `client/src/features/content-protection/content-impact-dialog.tsx`:

- расширить `ContentImpactMode`: `"block" | "warn" | "publish" | "advisory"`;
- добавить проп `notes?: string[]`;
- футер для `advisory` — «Понятно» плюс, если передан `onOpenStructure`, «Открыть структуру теста»;
- `iconTone` для `advisory` — `"warning"`, размер `"m"`;
- тело для `advisory`:

```tsx
      {mode === "advisory" && (
        <ul className="cp-dep-list" role="list" aria-label="Предупреждения публикации">
          {notes.map((text, i) => (
            <li className="cp-dep" role="listitem" key={i}>
              <span className="cp-dep__title">{text}</span>
            </li>
          ))}
        </ul>
      )}
```

плюс `Banner` тоном `info` с текстом «Тест опубликован. Перечисленное не мешает публикации, но
меняет то, что увидит слушатель.»

В `client/src/features/tests/list/tests-list.tsx`:

- в `statusMutation.mutationFn` вернуть разобранное тело:

```tsx
    mutationFn: async (args: { id: string; status: "draft" | "published" | "archived" }) => {
      const res = await apiRequest("PATCH", `/api/tests/${args.id}/status`, { status: args.status });
      // PRD-50: тело публикации может нести предупреждения (FR-45 - FR-47); их показывает
      // onSuccess. Разбор здесь, а не там, потому что onSuccess получает то, что вернул mutationFn.
      return (await res.json()) as { breakdownWarnings?: BreakdownWarning[] };
    },
```

- в `onSuccess` после инвалидации:

```tsx
      if (data.breakdownWarnings?.length) setPublishNotes(data.breakdownWarnings.map(describeBreakdownWarning));
```

- завести состояние `const [publishNotes, setPublishNotes] = useState<string[] | null>(null);` и
  отрисовать `ContentImpactDialog` в режиме `advisory` рядом с уже существующим `publishImpact`:

```tsx
      <ContentImpactDialog
        open={publishNotes !== null}
        mode="advisory"
        title="Тест опубликован с замечаниями"
        notes={publishNotes ?? []}
        onClose={() => setPublishNotes(null)}
      />
```

- [ ] **Шаг 6. Прогнать тесты**

```bash
npm test -- shared/breakdown/publish-warnings.test.ts client/src/features/tests/list/__tests__
npm run check
```

Ожидание: PASS. Существующие тесты списка тестов используют `apiRequest`-мок, возвращающий
`Response`; если чей-то мок не умеет `json()`, дополнить мок в ЭТОМ тесте, не меняя роут.

- [ ] **Шаг 7. Приёмка в браузере**

На dev (`PORT=8099`) собрать тест-ловушку: тема с вариантами, где один вопрос не входит ни в один
вариант, задана квота, задан порог для тега, которого в вариантах нет, и есть вопрос без тега.
Опубликовать тест из списка тестов.

Ожидание: тест публикуется (статус «Опубликован»), и сразу открывается диалог «Тест опубликован с
замечаниями» с четырьмя строками — по одной на каждое из FR-45 - FR-47. На тесте без тегов и без
порогов диалог не открывается вовсе.

- [ ] **Шаг 8. Коммит**

```bash
git add shared/breakdown/publish-warnings.ts shared/breakdown/publish-warnings.test.ts \
        server/services/breakdown-warnings.ts server/routes/tests.ts \
        client/src/features/content-protection client/src/features/tests/list
git commit -m "feat(prd-50): предупреждения публикации о ключах, порогах и вариантах"
```

---

## Task 7: аналитика SCORM — ПЕРЕНЕСЕНА в «Э1-доделку»

Задача исключена из этого этапа сознательно. Тот же долг расписан в
[плане Э1-доделки](2026-08-14-prd50-e1-fix.md), задача «аналитика SCORM видит разрезы», и
выходит раньше: это долг, порождённый Э1, источник данных (`scorm_answers`) уже определён, и
ничего в Э2 на это место не влияет.

Оба плана писались параллельно и независимо пришли к одному решению — вплоть до одинакового
имени тест-файла `tests/breakdown-analytics-scorm.test.ts`. Дубликат снят здесь, а не там,
чтобы работа не была сделана дважды и двумя разными способами.

Если к моменту Э2 «Э1-доделка» ещё не влита, задачу надо перенести сюда целиком — но тогда
из плана Э1-доделки её следует вычеркнуть тем же движением.

## Долг, оставленный этапом сознательно

- **Явное «Не проверять» у ключа не переживает сохранение.** Нормализация в мапперах редактора
  схлопывает набор из одних `{ type: "none" }` в `null` — так предписывал этот план. Пока умолчание
  раздела (`default`) в редакторе не задаётся, разницы нет. Но по спеке (FR-20) `none` у ключа —
  осознанно информационный ключ, который ПЕРЕБИВАЕТ `default`, а не то же самое, что отсутствие
  записи. Как только в редакторе появится умолчание раздела, эта нормализация начнёт молча терять
  авторский смысл: автор выключит проверку одного ключа, а после перезагрузки тот унаследует
  умолчание. Чинить вместе с вводом `default` в интерфейс.
- **Записи области ТЕСТА по-прежнему не сохраняются в `attempts.result_json`** — они собираются
  для контекста формул и живут в памяти. Гейта в области теста нет (FR-23), поэтому Э2 без них
  обходится; они нужны блоку `breakdown` из Э4 и требованию FR-39.
- **Пакет SCORM не пишет записи разреза в `suspend_data`** (`saveAttemptResult`), поэтому экран
  «Мой результат» по сохранённой попытке полос и вердиктов ключей не покажет. Это пункт 1 списка
  «решений владельца» из плана Э1 и его же долг — Э2 состояние не ухудшает: `computeSectionResult`
  теперь кладёт записи в результат раздела, но межсессионное хранение не трогает.
- **Свои надписи вердикта ключа** (`topic.verdict.passed` и соседи из FR-34) — Э3. До него строка
  печатает те же два слова, что карточка темы.
- **Валидация порога в редакторе минимальна**: диапазон держат `NumberInput` (0..100) и серверная
  схема. Отдельного правила в `test-editor.validation.ts` не заводится — блокировать сохранение
  тут нечего.

---

## Проверка этапа

- [ ] `npm run check` — чисто
- [ ] целевые прогоны — PASS:

```bash
npm test -- tests/breakdown-rules-schema.test.ts tests/breakdown-gate.test.ts
npm test -- tests/scoring-aggregate.test.ts tests/breakdown-aggregate.test.ts
npm test -- shared/breakdown shared/template/__tests__ tests/template-layout-parity.test.ts
npm test -- server/scorm/__tests__/test-json-prd50.test.ts
npm test -- tests/breakdown-analytics-scorm.test.ts   # регресс: файл приходит с «Э1-доделкой»
npm test -- client/src/features/tests/editor/sections/__tests__ client/src/features/tests/list/__tests__
```

- [ ] `npm run lint:md` — чисто
- [ ] миграция сгенерирована, переименована и НЕ применена; в базу этап не писал
- [ ] полный прогон `npm test` — ТОЛЬКО по явному разрешению владельца
- [ ] приёмка из Task 5 шаг 5 и Task 6 шаг 7 проведена в браузере, снимки приложены к отчёту
- [ ] сверка со спекой: FR-09, FR-10, FR-19 - FR-23, FR-42, FR-45 - FR-47 закрыты; §14 пункт 3
      («порог ключа роняет вердикт темы, а изменение базы показа вердикт не меняет») и пункт 6
      (четыре предупреждения на тесте-ловушке) проверены руками
