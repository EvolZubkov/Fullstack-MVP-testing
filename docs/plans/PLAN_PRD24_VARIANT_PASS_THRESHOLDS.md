# PRD-24 Variant Pass Thresholds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Дать правилу прохождения темы четвёртый источник «по вариантам» — порог
(Процент/Сумма баллов) на каждый вариант PRD-17, применяемый к выданному варианту, —
единообразно в веб-хосте и SCORM-пакете, с обменом через Excel.

**Architecture:** Вся новая логика заперта в `resolveTopicRule`, который оба хоста уже
используют как единый движок (PRD-18). Хранение — в существующем
`test_sections.topic_pass_rule_json` (jsonb, миграции нет). Точки-потребители лишь
пробрасывают в движок контекст выдачи — стабильный `formId` выпавшего варианта
(веб — из `attempts.variant_json`; SCORM — из состояния рантайма, которое начинает
пиннить `formId`). Excel получает лист «Пороги вариантов» по образцу листа «Квоты».

**Tech Stack:** TypeScript (Node/Express, Drizzle, Zod), React 19, Vitest (`npm test`),
plain-JS SCORM runtime (`server/scorm/**`), ExcelJS. Спецификация:
[docs/specs/prd-24/variant-pass-thresholds.md](../specs/prd-24/variant-pass-thresholds.md).
Эскиз: `docs/wireframes/approved/prd7-editor-settings-tab.html` (состояние
`s-pass-by-variant`).

---

## Roadmap (этапы спецификации → задачи плана)

| Этап | Задачи |
| --- | --- |
| Э1 — контракт и движок | Task 1 (схема+резолвер), Task 2 (aggregate) |
| Э2 — веб-оценка | Task 3 |
| Э3 — SCORM-рантайм | Task 4 |
| Э4 — сборка/манифест | Task 5 |
| Э5 — редактор | Task 6 |
| Э6 — Excel | Task 7 |
| Э7 — отладчик | Task 8 |
| Э8 — приёмка | Task 9 |

Task 1 — обязательный пререквизит. Task 2, 3, 6, 7 после него независимы; Task 4 → Task 5
(SCORM бэйк) идут после Task 3; Task 8 после Task 4.

**Naming contract (единые имена во всех задачах):**

- `ByVariantThreshold = { type: "percent" | "absolute"; value: number }` — порог одного
  варианта (stored shape и editor shape совпадают).
- Правило `by_variant`: `{ source: "by_variant"; byForm: Record<string, ByVariantThreshold> }`,
  ключ — стабильный `formId` варианта.
- `resolveTopicRule(raw, overall, ctx?)`, `ctx?: { formId?: string | null }`.
- `AggregateSection.formId?: string | null`.
- Резолвер возвращает прежний `ResolvedRule | null` (`{ type: "percent" | "count"; value }`).

---

## Task 1: Схема `by_variant` + контекст выдачи в резолвере

**Files:**

- Modify: `shared/schema.ts` (рядом с `passRuleSchema`, ~строка 701)
- Modify: `shared/scoring/pass-rule.ts`
- Test: `tests/scoring-aggregate.test.ts` (там живут тесты `resolveTopicRule`;
  `tests/scoring-pass-rule.test.ts` — про легаси `checkPassRuleWithPartial` из `resultsPage.js`)

- [ ] **Step 1: Добавить схему и типы в `shared/schema.ts`**

Найти блок `passRuleSchema` (около строки 701) и сразу ПОСЛЕ него добавить:

```ts
/**
 * PRD-24: per-variant pass threshold. Stored under a topic rule's `byForm`,
 * keyed by the stable PRD-17 `formId`. `percent` compares the points-based
 * percent; `absolute` compares Σ earned points of the delivered variant.
 */
export const byVariantThresholdSchema = z.object({
  type: z.enum(["percent", "absolute"]),
  value: z.number(),
});
export type ByVariantThreshold = z.infer<typeof byVariantThresholdSchema>;

/**
 * PRD-24: the full topic pass-rule union as stored in
 * `test_sections.topic_pass_rule_json`. The `by_variant` source carries a
 * per-formId threshold map; the other three are the PRD-7 sources. Kept lenient
 * at rest — `resolveTopicRule` is the runtime authority and tolerates legacy shapes.
 */
export const topicPassRuleSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("inherit_overall") }),
  z.object({ source: z.literal("none") }),
  z.object({ source: z.literal("custom"), type: z.enum(["percent", "absolute"]), value: z.number() }),
  z.object({ source: z.literal("by_variant"), byForm: z.record(z.string(), byVariantThresholdSchema) }),
]);
export type TopicPassRuleJson = z.infer<typeof topicPassRuleSchema>;
```

- [ ] **Step 2: Написать падающие тесты резолвера**

В `tests/scoring-aggregate.test.ts` добавить блок рядом с существующим
`describe("resolveTopicRule")` (импорт резолвера там уже есть):

```ts
describe("resolveTopicRule — by_variant (PRD-24)", () => {
  const overall = { type: "percent" as const, value: 70 };

  it("resolves the delivered variant's percent threshold", () => {
    const rule = { source: "by_variant", byForm: { f1: { type: "percent", value: 65 }, f2: { type: "absolute", value: 7 } } };
    expect(resolveTopicRule(rule, overall, { formId: "f1" })).toEqual({ type: "percent", value: 65 });
  });

  it("resolves the delivered variant's absolute threshold as a count rule", () => {
    const rule = { source: "by_variant", byForm: { f1: { type: "percent", value: 65 }, f2: { type: "absolute", value: 7 } } };
    expect(resolveTopicRule(rule, overall, { formId: "f2" })).toEqual({ type: "count", value: 7 });
  });

  it("degrades to the overall rule when the delivered formId is unknown", () => {
    const rule = { source: "by_variant", byForm: { f1: { type: "percent", value: 65 } } };
    expect(resolveTopicRule(rule, overall, { formId: "gone" })).toEqual(overall);
    expect(resolveTopicRule(rule, overall, { formId: null })).toEqual(overall);
    expect(resolveTopicRule(rule, overall, undefined)).toEqual(overall);
  });

  it("degrades to null when overall is «none» and the variant is unresolved", () => {
    const rule = { source: "by_variant", byForm: { f1: { type: "percent", value: 65 } } };
    expect(resolveTopicRule(rule, null, { formId: "gone" })).toBeNull();
  });
});
```

- [ ] **Step 3: Запустить тесты — убедиться, что падают**

Run: `npx vitest run tests/scoring-aggregate.test.ts -t "by_variant"`
Expected: FAIL (ветка `by_variant` ещё не обрабатывается — резолвер вернёт `null`).

- [ ] **Step 4: Реализовать ветку и контекст в `shared/scoring/pass-rule.ts`**

Заменить сигнатуру и тело `resolveTopicRule`:

```ts
/** Delivery context for topic-rule resolution (PRD-24). */
export interface TopicRuleContext {
  /** Stable formId of the variant delivered for this topic in this attempt. */
  formId?: string | null;
}

export function resolveTopicRule(
  raw: unknown,
  overall: ResolvedRule | null,
  ctx?: TopicRuleContext,
): ResolvedRule | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { source?: string; type?: string; value?: number; byForm?: Record<string, { type?: string; value?: number }> };
  if (r.source === "inherit_overall") return overall;
  if (r.source === "none") return null;
  if (r.source === "by_variant") {
    // PRD-24: apply the threshold of the variant actually delivered. Unknown/absent
    // formId (legacy attempt, removed variant) degrades to the overall rule (FR-09).
    const entry = ctx && ctx.formId ? r.byForm?.[ctx.formId] : undefined;
    if (!entry) return overall;
    return entry.type === "percent"
      ? { type: "percent", value: Number(entry.value) || 0 }
      : { type: "count", value: Number(entry.value) || 0 };
  }
  if (r.source === "custom") {
    return r.type === "percent"
      ? { type: "percent", value: Number(r.value) || 0 }
      : { type: "count", value: Number(r.value) || 0 };
  }
  // legacy direct `{type, value}` rule stored on the section
  if (r.type === "none") return null;
  if (r.type === "percent") return { type: "percent", value: Number(r.value) || 0 };
  if (typeof r.value === "number") return { type: "count", value: r.value };
  return null;
}
```

- [ ] **Step 5: Запустить весь suite резолвера — убедиться, что зелёный**

Run: `npx vitest run tests/scoring-aggregate.test.ts`
Expected: PASS (новые + существующие ветки `inherit_overall`/`custom`/`none`/legacy).

- [ ] **Step 6: Type-check**

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 7: Commit**

```bash
git add shared/schema.ts shared/scoring/pass-rule.ts tests/scoring-aggregate.test.ts
git commit -m "feat(prd24): by_variant topic pass-rule schema + delivery-context resolver"
```

---

## Task 2: Проброс `formId` через `aggregateStandardResult`

**Files:**

- Modify: `shared/scoring/aggregate.ts` (интерфейс `AggregateSection`, вызов `resolveTopicRule`)
- Test: `tests/scoring-aggregate.test.ts`

- [ ] **Step 1: Написать падающий тест агрегатора**

В `tests/scoring-aggregate.test.ts` добавить (single/percent-вопросы, чтобы percent считался):

```ts
it("applies the delivered variant's threshold via section.formId (PRD-24)", () => {
  const q = (correct: boolean) => ({
    type: "multiple_choice" as const,
    correct: { correctIndex: 0 },
    points: 1,
    answer: correct ? { selectedIndex: 0 } : { selectedIndex: 1 },
  });
  const byVariant = { source: "by_variant", byForm: { fA: { type: "percent", value: 50 }, fB: { type: "percent", value: 100 } } };
  const base = { topicId: "t", topicName: "T", topicPassRule: byVariant, questions: [q(true), q(false)] }; // percent = 50

  const passA = aggregateStandardResult({ sections: [{ ...base, formId: "fA" }], overallPassRule: { type: "percent", value: 70 } });
  expect(passA.topicResults[0].passed).toBe(true); // 50% >= 50

  const failB = aggregateStandardResult({ sections: [{ ...base, formId: "fB" }], overallPassRule: { type: "percent", value: 70 } });
  expect(failB.topicResults[0].passed).toBe(false); // 50% < 100
});
```

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run tests/scoring-aggregate.test.ts -t "delivered variant"`
Expected: FAIL (тип `formId` не принят / порог не применяется — оба топика ведут себя одинаково).

- [ ] **Step 3: Расширить `AggregateSection` и прокинуть `formId`**

В `shared/scoring/aggregate.ts` в интерфейс `AggregateSection` добавить поле (после `topicPassRule`):

```ts
  /** PRD-24: stable formId of the variant delivered for this topic (null/absent = не варианты). */
  formId?: string | null;
```

В теле `aggregateStandardResult`, в `.map((sec) => {...})`, заменить строку резолва:

```ts
    const resolved = resolveTopicRule(sec.topicPassRule, overall, { formId: sec.formId ?? null });
```

- [ ] **Step 4: Запустить тесты агрегатора — зелёные**

Run: `npx vitest run tests/scoring-aggregate.test.ts`
Expected: PASS (новый + существующие).

- [ ] **Step 5: Type-check + commit**

```bash
npm run check
git add shared/scoring/aggregate.ts tests/scoring-aggregate.test.ts
git commit -m "feat(prd24): thread delivered formId through aggregateStandardResult"
```

---

## Task 3: Веб-оценка — передать `formId` в двух местах `attempts.ts`

**Files:**

- Modify: `server/routes/attempts.ts` (обработчик результата раздела ~строка 914; финиш ~строка 994)
- Test: `tests/routes.attempts-tests.test.ts`

- [ ] **Step 1: Написать падающий route-тест**

В `tests/routes.attempts-tests.test.ts` добавить тест: попытка на теме с `by_variant`, где
`variant_json.sections[].formId` задан, тема НЕ проходит по порогу выданного варианта, но
прошла бы по соседнему. Скелет (адаптировать под фабрики моков файла — использовать
существующие хелперы `dbTest`, `makeAttempt` и мок `storage`):

```ts
it("grades a topic against the delivered variant's threshold (PRD-24)", async () => {
  // section with by_variant: fA percent 50, fB percent 100; delivered fB
  const section = { topicId: "t", topicPassRuleJson: { source: "by_variant", byForm: { fA: { type: "percent", value: 50 }, fB: { type: "percent", value: 100 } } } };
  const variant = { sections: [{ topicId: "t", topicName: "T", questionIds: ["q1", "q2"], formId: "fB" }] };
  // one correct of two → percent 50 → below fB's 100 → topic fails
  // (wire storage mocks: getTestSections -> [section], getQuestionsByIds -> two single-choice, one answered correctly)
  const res = await finishAttempt(/* attempt with answersJson, variantJson: variant */);
  const topic = res.body.result.topicResults.find((tr: any) => tr.topicId === "t");
  expect(topic.passed).toBe(false);
});
```

Примечание для исполнителя: точную обвязку моков взять из соседних тестов финиша в этом же
файле (там уже есть примеры `overallPassRuleJson`, `variantJson`, `getQuestionsByIds`).

- [ ] **Step 2: Запустить — убедиться, что падает**

Run: `npx vitest run tests/routes.attempts-tests.test.ts -t "delivered variant"`
Expected: FAIL (тема зачитывается, т.к. `formId` не передан → `by_variant` деградирует к
overall percent 70, а 50% < 70 тоже fail… — подобрать значения так, чтобы БЕЗ формИда
результат отличался: например overall percent 40 → без formId тема passes 50%>=40, с formId fB
fails 50%<100). Скорректировать overall в тесте на `{ type: "percent", value: 40 }`.

- [ ] **Step 3: Пробросить `formId` в обработчике результата раздела**

В `server/routes/attempts.ts` найти `const aggSection: AggregateSection = {` (около 914) и в
объект добавить поле сразу после `topicPassRule`:

```ts
      formId: variantSection.formId ?? null,
```

- [ ] **Step 4: Пробросить `formId` в финише**

В том же файле найти `aggSections.push({` (около 994) и добавить сразу после `topicPassRule`:

```ts
        formId: variantSection.formId ?? null,
```

(`variantSection` в обоих циклах — элемент `variant.sections`, у него уже есть опциональный
`formId` из PRD-17 FR-08.)

- [ ] **Step 5: Запустить route-тесты — зелёные**

Run: `npx vitest run tests/routes.attempts-tests.test.ts`
Expected: PASS.

- [ ] **Step 6: Убедиться, что подпись «Требуется» на вебе резолвится**

Подтвердить, что `topicResults[].passRule` в ответе финиша содержит СЫРОЕ авторское правило
(как сегодня), а подпись строится общим `buildResultContext`. Ничего менять не требуется —
веб уже строит требование через shared-контекст; отдельного теста нет. Зафиксировать
комментарием в тесте, что подпись покрыта Task 4 (parity).

- [ ] **Step 7: Type-check + commit**

```bash
npm run check
git add server/routes/attempts.ts tests/routes.attempts-tests.test.ts
git commit -m "feat(prd24): grade web attempts against the delivered variant threshold"
```

---

## Task 4: SCORM-рантайм — пиннить `formId` и прокидывать в расчёт/подпись

**Files:**

- Modify: `server/scorm/assets/app.js` (запись `formId` в `state.variant.sections`)
- Modify: `server/scorm/template/app/render/resultsPage.js` (`calculateResults`, `computeSectionResult`)
- Modify: `server/scorm/template/app/render/viewResults.js` (`vrRequiredLabel`)
- Test: `tests/forms-port.test.ts` (парити близнеца), `tests/scorm-builders.test.ts` (данные)

- [ ] **Step 1: Пиннить `formId` при выборе варианта (`app.js`)**

Найти в `server/scorm/assets/app.js` блок `state.variant.sections.push({` (около 124).
Сейчас он пишет `topicId/topicName/questionIds`. Добавить `formId`, полученный из ветки
вариантов. Для этого выше, в ветке `if (section.formSet && ...)`, сохранить выбранный id:
после `picked = ...` (строки ~106-112) добавить `var pickedFormId = picked.formId;` и в не-
вариантной ветке `var pickedFormId = null;` перед `questions.forEach(...)`. Затем в push:

```js
    state.variant.sections.push({
      topicId: section.topicId,
      topicName: section.topicName,
      questionIds: questions.map(function(q) { return q.id; }),
      formId: (typeof pickedFormId !== 'undefined') ? pickedFormId : null
    });
```

- [ ] **Step 2: Прокинуть `formId` в `calculateResults` (`resultsPage.js`)**

В `server/scorm/template/app/render/resultsPage.js`, в `calculateResults`, найти
`byTopic[fq.topicId] = { ... topicPassRule: ..., questions: [], extra: {...} }` (около 491).
Добавить `formId`, взяв его из `state.variant.sections`:

```js
      var vs = (state.variant && state.variant.sections || []).find(function (s) { return s.topicId === fq.topicId; });
      byTopic[fq.topicId] = {
        topicId: fq.topicId,
        topicName: fq.topicName,
        topicPassRule: section ? section.topicPassRule : null,
        formId: vs ? (vs.formId || null) : null,
        questions: [],
        extra: {
          topicFeedback: (section && section.topicFeedback) || null,
          recommendedCourses: (section && section.recommendedCourses) || [],
          recommendedEvents: (section && section.recommendedEvents) || []
        }
      };
```

(`aggregateStandardResult` уже читает `sec.formId` после Task 2 — данные дойдут до движка.)

- [ ] **Step 3: Прокинуть `formId` в `computeSectionResult` (`resultsPage.js`)**

В той же функции `computeSectionResult` (около 455) заменить резолв правила, добавив контекст:

```js
  var vs = (state.variant && state.variant.sections || []).find(function (s) { return s.topicId === topicId; });
  var resolvedRule = window.TBTemplate.resolveTopicRule(
    passRule,
    window.TBTemplate.resolveOverallRule(TEST_DATA.overallPassRule),
    { formId: vs ? (vs.formId || null) : null }
  );
```

- [ ] **Step 4: Построить подпись «Требуется» из резолвленного правила (`viewResults.js`)**

Заменить `vrRequiredLabel` (строки 29-36) так, чтобы она использовала резолвленное правило
выданного варианта (а не сырое `section.topicPassRule.type === 'percent'`):

```js
/** Per-topic pass threshold label from the RESOLVED rule of the delivered variant (SCORM-extra). */
function vrRequiredLabel(topicId) {
  var section = TEST_DATA.sections.find(function (s) { return s.topicId === topicId; });
  if (!section) return undefined;
  var vs = (state.variant && state.variant.sections || []).find(function (s) { return s.topicId === topicId; });
  var resolved = window.TBTemplate.resolveTopicRule(
    section.topicPassRule,
    window.TBTemplate.resolveOverallRule(TEST_DATA.overallPassRule),
    { formId: vs ? (vs.formId || null) : null }
  );
  if (resolved && resolved.type === 'percent') return 'Требуется: ' + resolved.value + '%';
  return undefined;
}
```

- [ ] **Step 5: Проверить обратную совместимость чтения состояния без пина**

В `computeSectionResult`/`calculateResults`/`vrRequiredLabel` `vs.formId` под guard'ом
`vs ? (vs.formId || null) : null` — состояние SCORM-сессии, сохранённое ДО этого этапа
(`suspend_data` без `formId`), даёт `null` → деградация §5.3. Никаких доп-правок.

- [ ] **Step 6: Запустить SCORM-тесты**

Run: `npx vitest run tests/forms-port.test.ts tests/scorm-builders.test.ts`
Expected: PASS (пин `formId` не ломает выбор/порт; данные пакета не изменились).

- [ ] **Step 7: Добавить parity-тест веб↔SCORM для `by_variant`**

В `tests/scoring-aggregate.test.ts` (движок общий для обоих хостов) уже покрыты обе стороны
через один резолвер (Task 1). Дополнительно добавить в `tests/forms-port.test.ts` (или новый
`tests/scorm-variant-threshold.test.ts`) сценарий: TEST_DATA с секцией `by_variant`, состояние
с `formId=fB`, прогнать `aggregateStandardResult` с `sections:[{...formId:'fB'}]` и сверить
`passed` с ожидаемым (тот же ожидаемый результат, что даёт веб-хост в Task 3). Код:

```ts
import { aggregateStandardResult } from "@shared/scoring/aggregate";
it("web/SCORM parity: by_variant verdict is identical for the same formId", () => {
  const section = { topicId: "t", topicName: "T", formId: "fB",
    topicPassRule: { source: "by_variant", byForm: { fA: { type: "percent", value: 50 }, fB: { type: "percent", value: 100 } } },
    questions: [
      { type: "multiple_choice" as const, correct: { correctIndex: 0 }, points: 1, answer: { selectedIndex: 0 } },
      { type: "multiple_choice" as const, correct: { correctIndex: 0 }, points: 1, answer: { selectedIndex: 1 } },
    ] };
  const r = aggregateStandardResult({ sections: [section], overallPassRule: { type: "percent", value: 40 } });
  expect(r.topicResults[0].passed).toBe(false); // 50% < 100 (fB)
});
```

- [ ] **Step 8: Запустить + commit**

Run: `npx vitest run tests/forms-port.test.ts`
Expected: PASS.

```bash
npm run check
git add server/scorm/assets/app.js server/scorm/template/app/render/resultsPage.js server/scorm/template/app/render/viewResults.js tests/forms-port.test.ts
git commit -m "feat(prd24): pin delivered formId in SCORM state and grade/label by variant"
```

---

## Task 5: Сборка пакета и манифест

**Files:**

- Modify: `server/scorm/builders/test-json.ts` (снять каст `as PassRule`)
- Modify: `server/scorm/builders/manifest.ts` (`minNormalizedMeasure` для `by_variant`)
- Test: `tests/scorm-builders.test.ts`

- [ ] **Step 1: Снять сужающий каст в `test-json.ts`**

Найти строку `topicPassRule: (s.topicPassRuleJson as PassRule | null) ?? null,` (около 194).
Заменить каст на пропуск как есть (правило теперь может быть `by_variant`):

```ts
      topicPassRule: (s.topicPassRuleJson as unknown) ?? null,
```

- [ ] **Step 2: Написать падающий тест манифеста**

В `tests/scorm-builders.test.ts` добавить: секция `by_variant` с двумя вариантами (percent 60
и absolute при Σ=8 → 4/8=0.5) → `minNormalizedMeasure` = min(0.60, 0.50) = `0.50`.

```ts
it("manifest uses the minimum normalized variant threshold for by_variant (PRD-24)", () => {
  const forms = [
    { id: "f1", label: "Вариант 1", questionIds: ["q1", "q2"] },
    { id: "f2", label: "Вариант 2", questionIds: ["q3", "q4"] },
  ];
  const sec = {
    ...manifestTest.sections?.[0],
    topicPassRuleJson: { source: "by_variant", byForm: { f1: { type: "percent", value: 60 }, f2: { type: "absolute", value: 4 } } },
    formSetJson: { forms },
    questions: [
      { id: "q1", points: 2 }, { id: "q2", points: 2 },
      { id: "q3", points: 4 }, { id: "q4", points: 4 }, // f2 Σ = 8 → 4/8 = 0.50
    ],
  };
  const xml = buildManifest(/* exportData с этой секцией — по образцу соседних тестов */);
  expect(xml).toContain("<imsss:minNormalizedMeasure>0.50</imsss:minNormalizedMeasure>");
});
```

Примечание: точную сборку `exportData`/вызов `buildManifest` взять из существующих тестов
манифеста в этом файле.

- [ ] **Step 3: Запустить — убедиться, что падает**

Run: `npx vitest run tests/scorm-builders.test.ts -t "minimum normalized variant"`
Expected: FAIL (для `by_variant` порог сейчас не считается — падает в дефолт `0.5` или NaN).

- [ ] **Step 4: Реализовать `minNormalizedMeasure` для `by_variant` в `manifest.ts`**

В `server/scorm/builders/manifest.ts`, в `.map((s) => {...})` построения objectives (около
105-120), добавить ветку `by_variant` ПЕРЕД существующей проверкой `if (topicPassRule)`:

```ts
      const topicPassRule = s.topicPassRuleJson as { source?: string; type?: string; value?: number; byForm?: Record<string, { type: string; value: number }> } | null;
      let threshold = "0.5";
      if (topicPassRule && topicPassRule.source === "by_variant" && s.formSetJson) {
        // PRD-24 (FR-17): metadata must not be stricter than the real rule — take the
        // MINIMUM normalized threshold across variants. percent/100; absolute / Σ variant points.
        const pointsById = new Map(s.questions.map((q) => [q.id, (q as { points?: number }).points ?? 1]));
        const norms: number[] = [];
        for (const form of s.formSetJson.forms) {
          const entry = topicPassRule.byForm?.[form.id];
          if (!entry) continue;
          if (entry.type === "percent") {
            norms.push(entry.value / 100);
          } else {
            const sum = form.questionIds.reduce((acc, id) => acc + (pointsById.get(id) ?? 1), 0);
            norms.push(sum > 0 ? entry.value / sum : 0);
          }
        }
        if (norms.length) threshold = Math.min(...norms).toFixed(2);
      } else if (topicPassRule) {
        threshold =
          topicPassRule.type === "percent"
            ? (topicPassRule.value! / 100).toFixed(2)
            : (topicPassRule.value! / Math.max(effectiveDraw(s), 1)).toFixed(2);
      }
```

(Удалить прежние строки `const topicPassRule = ...; let threshold = "0.5"; if (topicPassRule) {...}` —
они заменены блоком выше.)

- [ ] **Step 5: Запустить тесты сборки — зелёные**

Run: `npx vitest run tests/scorm-builders.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check + commit**

```bash
npm run check
git add server/scorm/builders/test-json.ts server/scorm/builders/manifest.ts tests/scorm-builders.test.ts
git commit -m "feat(prd24): bake by_variant rule into TEST_DATA and manifest min threshold"
```

---

## Task 6: Редактор — модель, синхронизация с вариантами, валидация, UI

**Files:**

- Modify: `client/src/features/tests/editor/test-editor.types.ts` (`TopicPassRule` +4-й член)
- Modify: `client/src/features/tests/editor/test-editor.mappers.ts` (`readTopicPassRuleFromApi`)
- Modify: `client/src/features/tests/editor/test-editor.validation.ts` (правила FR-13)
- Modify: `client/src/features/tests/editor/sections/basic-settings-section.tsx`
  (Select +пункт, expand-блок вариантов, sync)
- Modify: `client/src/lib/i18n.ts` (метки, если нужны)
- Test: `client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts`,
  `.../test-editor.validation.test.ts`, `.../basic-settings-section.test.tsx`

- [ ] **Step 1: Расширить тип `TopicPassRule`**

В `test-editor.types.ts` заменить union (строки 143-146) на:

```ts
export type TopicPassRule =
  | { source: "inherit_overall" }
  | { source: "custom"; type: "percent" | "absolute"; value: number }
  | { source: "none" }
  | { source: "by_variant"; byForm: Record<string, { type: "percent" | "absolute"; value: number }> };
```

- [ ] **Step 2: Тест маппера round-trip для `by_variant`**

В `test-editor.mappers.test.ts` добавить:

```ts
it("reads a by_variant topic rule from the API (PRD-24)", () => {
  const api = { sections: [{ topicId: "t", topicName: "T", maxQuestions: 8,
    topicPassRuleJson: { source: "by_variant", byForm: { f1: { type: "percent", value: 65 } } } }] };
  const model = apiToEditorModel(api as never);
  expect(model.passRules.byTopic["t"]).toEqual({ source: "by_variant", byForm: { f1: { type: "percent", value: 65 } } });
});
```

- [ ] **Step 3: Запустить — падает**

Run: `npx vitest run client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts -t "by_variant"`
Expected: FAIL (`readTopicPassRuleFromApi` не знает `by_variant` → вернёт `inherit_overall`).

- [ ] **Step 4: Читать `by_variant` в маппере**

В `test-editor.mappers.ts` в `readTopicPassRuleFromApi` (строки 256-269) добавить ветку ПЕРЕД
`if (raw.source === "custom")`:

```ts
    if (raw.source === "by_variant" && isPlainObject(raw.byForm)) {
      const byForm: Record<string, { type: "percent" | "absolute"; value: number }> = {};
      for (const [formId, entry] of Object.entries(raw.byForm)) {
        if (!isPlainObject(entry)) continue;
        const type = entry.type;
        if (type === "percent" || type === "absolute") {
          byForm[formId] = { type, value: typeof entry.value === "number" ? entry.value : 0 };
        }
      }
      return { source: "by_variant", byForm };
    }
```

(Запись в payload уже проходит: `mapEditorSectionsToPayload` копирует `byTopic[topicId]` целиком —
`by_variant` сериализуется без изменений.)

- [ ] **Step 5: Запустить маппер-тесты — зелёные**

Run: `npx vitest run client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts`
Expected: PASS.

- [ ] **Step 6: Тесты валидации (FR-13)**

В `test-editor.validation.test.ts` добавить кейсы: (a) `by_variant` без `formSet` → ошибка;
(b) непокрытый вариант → ошибка; (c) осиротевший ключ → ошибка; (d) percent вне [0,100] →
ошибка; (e) absolute выше максимума ЭТОГО варианта → ошибка. Пример (a)+(e):

```ts
it("rejects by_variant when the topic has no variant set (PRD-24 FR-02)", () => {
  const model = makeModel({ sections: [{ topicId: "t", topicName: "T", maxQuestions: 4, maxPoints: 4 /* no formSet */ }],
    byTopic: { t: { source: "by_variant", byForm: {} } } });
  const { errors } = validateModel(model);
  expect(errors.some((e) => e.field === "passRules.byTopic[t]")).toBe(true);
});
it("rejects a by_variant absolute threshold above the variant's max points (PRD-24 FR-13)", () => {
  const forms = [{ id: "f1", label: "Вариант 1", questionIds: ["q1", "q2"] }, { id: "f2", label: "Вариант 2", questionIds: ["q3"] }];
  const model = makeModel({ sections: [{ topicId: "t", topicName: "T", maxQuestions: 3, maxPoints: 3, formSet: { forms } }],
    byTopic: { t: { source: "by_variant", byForm: { f1: { type: "absolute", value: 5 }, f2: { type: "absolute", value: 1 } } } } });
  const { errors } = validateModel(model);
  expect(errors.some((e) => e.field === "passRules.byTopic[t].byForm[f1].value")).toBe(true);
});
```

(`makeModel` — существующий хелпер файла; при отсутствии `formSet` в фабрике — расширить
её опции. Максимум варианта считается ТОЧНО: `resolveEffectiveScoring` из
`@shared/scoring/effective-scoring` по цепочке override -> умолчание секции -> умолчание
теста -> системная 1. Все звенья есть в модели: `model.scoring.questionOverrides`,
`section.defaultPoints`, `model.scoring.defaultQuestionPoints`; `contentHash` влияет только
на флаг `stale`, не на цену.)

- [ ] **Step 7: Запустить — падают**

Run: `npx vitest run client/src/features/tests/editor/__tests__/test-editor.validation.test.ts -t "by_variant"`
Expected: FAIL.

- [ ] **Step 8: Реализовать валидацию в `test-editor.validation.ts`**

После существующего блока `for (const [topicId, rule] of Object.entries(model.passRules.byTopic))`
(строки 225-240) добавить отдельный проход `by_variant`:

```ts
  for (const [topicId, rule] of Object.entries(model.passRules.byTopic)) {
    if (rule.source !== "by_variant") continue;
    const section = getSectionByTopicId(model.sections, topicId);
    const forms = section?.formSet?.forms ?? [];
    if (!section || forms.length < 2) {
      errors.push({ field: `passRules.byTopic[${topicId}]`, code: "forbidden_combination",
        message: `«По вариантам» доступно только теме в режиме вариантов (≥2 варианта).`, severity: "error" });
      continue;
    }
    const formIds = new Set(forms.map((f) => f.id));
    // Every variant covered.
    for (const f of forms) {
      if (!rule.byForm[f.id]) {
        errors.push({ field: `passRules.byTopic[${topicId}].byForm[${f.id}].value`, code: "required",
          message: `Задайте порог для варианта «${f.label}».`, severity: "error" });
      }
    }
    for (const [formId, entry] of Object.entries(rule.byForm)) {
      // Orphan key.
      if (!formIds.has(formId)) {
        errors.push({ field: `passRules.byTopic[${topicId}].byForm[${formId}].value`, code: "forbidden_combination",
          message: `Порог ссылается на несуществующий вариант.`, severity: "error" });
        continue;
      }
      if (entry.type === "percent" && (entry.value < 0 || entry.value > 100)) {
        errors.push({ field: `passRules.byTopic[${topicId}].byForm[${formId}].value`, code: "range",
          message: `Порог варианта (%) должен быть в диапазоне 0..100.`, severity: "error" });
      }
      if (entry.type === "absolute") {
        const form = forms.find((f) => f.id === formId)!;
        const variantMax = variantMaxPoints(model, section, form); // Σ эффективных цен варианта
        if (entry.value > variantMax) {
          errors.push({ field: `passRules.byTopic[${topicId}].byForm[${formId}].value`, code: "range",
            message: `Порог варианта (${entry.value}) не может превышать макс. баллов варианта (${variantMax}).`, severity: "error" });
        }
      }
    }
  }
```

- [ ] **Step 9: Запустить валидацию — зелёная**

Run: `npx vitest run client/src/features/tests/editor/__tests__/test-editor.validation.test.ts`
Expected: PASS.

- [ ] **Step 10: Синхронизация правила с набором вариантов**

В `basic-settings-section.tsx` обновить `buildTopicRuleBySource` (строки 1114-1122), добавив
источник `by_variant` (сидирует записи из прежнего правила / overall):

```ts
function buildTopicRuleBySource(
  source: TopicPassRule["source"],
  prev: TopicPassRule,
  section?: EditorSection,
): TopicPassRule {
  if (source === "inherit_overall") return { source: "inherit_overall" };
  if (source === "none") return { source: "none" };
  if (source === "by_variant") {
    const seed = prev.source === "custom" ? prev : { type: "percent" as const, value: 70 };
    const byForm: Record<string, { type: "percent" | "absolute"; value: number }> = {};
    for (const f of section?.formSet?.forms ?? []) {
      byForm[f.id] = prev.source === "by_variant" && prev.byForm[f.id] ? prev.byForm[f.id] : { type: seed.type, value: seed.value };
    }
    return { source: "by_variant", byForm };
  }
  if (prev.source === "custom") return prev;
  return { source: "custom", type: "percent", value: 70 };
}
```

Обновить вызов `onSourceChange` в `PassTopicRow`, передав `section` (см. Step 11). Отдельно —
при выключении режима вариантов правило нормализуется: в компоненте вариантов
(`variants-editor.tsx` / `topics-structure-section.tsx`), где режим вариантов гасится, если
`byTopic[topicId].source === "by_variant"`, заменить на `{ source: "inherit_overall" }`.
Аналогично при удалении варианта — удалить его ключ из `byForm`; при добавлении — досидировать.
Реализовать эти три sync-хука там, где мутируется `formSet` (искать `formSet:` set в
`variants-editor.tsx`), обновляя параллельно `passRules.byTopic`.

- [ ] **Step 11: UI — 4-й пункт Select и expand-блок вариантов**

В `basic-settings-section.tsx` в `PassTopicRow`:

1. В опции Select (строки 1045-1049) добавить пункт «По вариантам» ТОЛЬКО когда у темы есть
   `formSet` с ≥2 вариантами (передать флаг `hasVariants` и список форм в `PassTopicRow` из
   родителя по `section`):

```tsx
            options={[
              { value: "inherit_overall", label: "Как у теста" },
              { value: "custom", label: "Индивидуальное правило" },
              { value: "none", label: "Не проверять отдельно" },
              ...(props.hasVariants ? [{ value: "by_variant" as const, label: "По вариантам" }] : []),
            ]}
```

1. После существующего `isCustom && ...` expand-row добавить expand-блок `by_variant` (grid
   `tb-pass-table__variants` из эскиза), строка на вариант: метка `Вариант N`, Select «Тип»
   (percent/absolute), NumberInput «Порог», под блоком — подсказка `макс. N баллов` для
   абсолютных. Разметку/классы взять 1:1 из согласованного эскиза
   `docs/wireframes/approved/prd7-editor-settings-tab.html` (состояние `s-pass-by-variant`,
   grid `tb-pass-table__variants`/`__variant-label`/`__variant-hint`). Перенести соответствующие
   CSS-правила в `client/src/styles/tb-components.css` (сейчас они добавлены только в
   `docs/wireframes/tb-components.css` — скопировать блок `tb-pass-table__variants` и связанные
   селекторы дословно).
   Обработчики: изменение типа/значения варианта мутируют `byForm[formId]` в
   `passRules.byTopic[topicId]`.

- [ ] **Step 12: Тест рендера секции**

В `basic-settings-section.test.tsx` добавить: тема с `formSet` (2 варианта) + правило
`by_variant` → в таблице есть пункт «По вариантам», раскрыт блок со строкой на вариант; тема
без `formSet` → пункта «По вариантам» нет.

- [ ] **Step 13: Запустить весь редактор-suite**

Run: `npx vitest run client/src/features/tests/editor`
Expected: PASS.

- [ ] **Step 14: Type-check + commit**

```bash
npm run check
git add client/src/features/tests/editor client/src/styles/tb-components.css client/src/lib/i18n.ts
git commit -m "feat(prd24): editor — by_variant pass rule (model, sync, validation, UI)"
```

---

## Task 7: Excel — лист «Пороги вариантов»

**Files:**

- Modify: `server/utils/workbook-sheets.ts` (заголовки/ширины + парсер/сериализатор строки +
  значение «По вариантам» на «Структуре»)
- Modify: `server/routes/tests-workbook.ts` (экспорт листа)
- Modify: `server/services/workbook-import.ts` (импорт-пасс после сборки form_set)
- Test: `tests/routes.tests-workbook.test.ts`

- [ ] **Step 1: Заголовки/ширины и словарь типа порога**

В `server/utils/workbook-sheets.ts` добавить рядом с `QUOTA_HEADERS`:

```ts
/** Canonical «Пороги вариантов» headers (one row per variant, PRD-24). */
export const VARIANT_THRESHOLD_HEADERS = ["Раздел", "Вариант", "Тип порога", "Порог"];
export const VARIANT_THRESHOLD_WIDTHS = [28, 12, 16, 10];
```

В `parseStructureRow` (значение «По вариантам»): расширить разбор `typeRaw`, добавив ветку до
`else { const type = PASS_TYPE_FROM[...] }`:

```ts
  } else if (typeRaw === "по вариантам" || typeRaw === "by_variant") {
    passRule = { source: "by_variant", byForm: {} }; // byForm заполнит пасс листа «Пороги вариантов»
```

В `serializeStructureRow` добавить ветку экспорта:

```ts
  else if (rule.source === "by_variant") passType = "По вариантам";
```

- [ ] **Step 2: Парсер/сериализатор строки листа**

В `workbook-sheets.ts` добавить (по образцу `parseQuotaRow`/`serializeQuotaRow`):

```ts
/** One parsed «Пороги вариантов» row (variant number is 1-based). */
export interface ParsedVariantThreshold {
  topicName: string;
  variantNumber: number;
  type: "percent" | "absolute";
  value: number;
}

export function parseVariantThresholdRow(row: Record<string, unknown>): ParseResult<ParsedVariantThreshold> {
  const topicName = String(row["Раздел"] ?? "").replace(/[\s ​﻿]+/g, " ").trim();
  if (!topicName) return { ok: false, error: "не указан раздел" };
  const m = String(row["Вариант"] ?? "").match(/\d+/);
  if (!m) return { ok: false, error: `некорректный «Вариант»: "${row["Вариант"]}"` };
  const variantNumber = parseInt(m[0], 10);
  if (variantNumber < 1) return { ok: false, error: `«Вариант» должен быть ≥ 1` };
  const typeRaw = String(row["Тип порога"] ?? "").trim().toLowerCase();
  const type = PASS_TYPE_FROM[typeRaw];
  if (!type) return { ok: false, error: `неизвестный «Тип порога»: "${row["Тип порога"]}"` };
  const value = Number(String(row["Порог"] ?? "").trim());
  if (!Number.isFinite(value) || value < 0) return { ok: false, error: `некорректный «Порог»: "${row["Порог"]}"` };
  return { ok: true, value: { topicName, variantNumber, type, value } };
}

export function serializeVariantThresholdRow(s: { topicName: string; variantNumber: number; type: "percent" | "absolute"; value: number }): Record<string, unknown> {
  return { "Раздел": s.topicName, "Вариант": s.variantNumber, "Тип порога": PASS_TYPE_TO[s.type] ?? s.type, "Порог": s.value };
}
```

- [ ] **Step 3: Экспорт листа в `tests-workbook.ts`**

В `server/routes/tests-workbook.ts` рядом со сборкой `quotaRows` построить `variantThresholdRows`:
для каждой секции с `topicPassRuleJson.source === "by_variant"` и `formSetJson` вывести строку
на каждый вариант, номер = позиция формы в `formSetJson.forms` + 1:

```ts
      const variantThresholdRows: Record<string, unknown>[] = [];
      for (const s of orderedSections) {
        const rule = s.topicPassRuleJson as { source?: string; byForm?: Record<string, { type: "percent" | "absolute"; value: number }> } | null;
        const fs = s.formSetJson as FormSet | null;
        if (!rule || rule.source !== "by_variant" || !fs) continue;
        const name = topicName.get(s.topicId) || "";
        fs.forms.forEach((form, i) => {
          const entry = rule.byForm?.[form.id];
          if (entry) variantThresholdRows.push(serializeVariantThresholdRow({ topicName: name, variantNumber: i + 1, type: entry.type, value: entry.value }));
        });
      }
```

Добавить лист (импортировать хелперы/заголовки):

```ts
      addSheet(wb, "Пороги вариантов", variantThresholdRows, VARIANT_THRESHOLD_HEADERS, VARIANT_THRESHOLD_WIDTHS);
```

- [ ] **Step 4: Импорт-пасс после сборки `form_set` в `workbook-import.ts`**

В `server/services/workbook-import.ts`, в Pass 6, ПОСЛЕ цикла, где строится `pending` с
`formSetJson` (после строки ~537), но ДО `pending.sort`, добавить чтение листа «Пороги
вариантов» и заполнение `byForm` в правилах `by_variant` по номеру → `forms[n-1].id`:

```ts
    const vtSheet = findSheet(workbook, "Пороги вариантов");
    if (vtSheet) {
      const vtRows = sheetToRows(vtSheet); // как для «Квоты»
      const byTopicKey = new Map(pending.map((p) => [normalizeName(topicNameById.get(p.payload.topicId) ?? ""), p.payload]));
      for (let i = 0; i < vtRows.length; i++) {
        const parsed = parseVariantThresholdRow(vtRows[i]);
        if (!parsed.ok) { result.errors.push(`Лист «Пороги вариантов», строка ${i + 2}: ${parsed.error}`); continue; }
        const key = normalizeName(parsed.value.topicName);
        const payload = byTopicKey.get(key);
        const forms = (payload?.formSetJson as FormSet | null)?.forms;
        if (!payload || !forms) { result.errors.push(`Лист «Пороги вариантов», строка ${i + 2}: раздел "${parsed.value.topicName}" не в режиме вариантов`); continue; }
        const form = forms[parsed.value.variantNumber - 1];
        if (!form) { result.errors.push(`Лист «Пороги вариантов», строка ${i + 2}: вариант ${parsed.value.variantNumber} не объявлен у темы`); continue; }
        const rule = payload.topicPassRuleJson as { source?: string; byForm?: Record<string, { type: string; value: number }> };
        if (rule?.source === "by_variant") {
          rule.byForm = rule.byForm ?? {};
          rule.byForm[form.id] = { type: parsed.value.type, value: parsed.value.value };
        }
      }
      // Раздел с типом «По вариантам», но неполным покрытием — ошибка (FR-14).
      for (const p of pending) {
        const rule = p.payload.topicPassRuleJson as { source?: string; byForm?: Record<string, unknown> };
        const forms = (p.payload.formSetJson as FormSet | null)?.forms;
        if (rule?.source === "by_variant" && forms && Object.keys(rule.byForm ?? {}).length < forms.length) {
          result.errors.push(`Тема "${topicNameById.get(p.payload.topicId) ?? ""}": не для всех вариантов задан порог на листе «Пороги вариантов»`);
        }
      }
    }
```

Примечание: `topicNameById`/`sheetToRows`/`normalizeName` — существующие хелперы файла (свериться
с их именами; `sheetToRows` может называться иначе — использовать тот же способ чтения строк,
что для «Квоты»). `SectionPayload` в этом сервисе должен допускать `topicPassRuleJson` с
`by_variant` — тип уже `unknown`/editor-shape, менять не требуется.

- [ ] **Step 5: Round-trip тест**

В `tests/routes.tests-workbook.test.ts` добавить: экспорт теста с секцией `by_variant`
(2 варианта, разные пороги) → импорт того же файла (dryRun=false на pglite/моке) →
`topicPassRuleJson` восстановлен идентично; плюс кейсы «неизвестный номер варианта» и «неполное
покрытие» дают ошибку строки/раздела, но остальные листы импортируются.

- [ ] **Step 6: Запустить + type-check + commit**

Run: `npx vitest run tests/routes.tests-workbook.test.ts`
Expected: PASS.

```bash
npm run check
git add server/utils/workbook-sheets.ts server/routes/tests-workbook.ts server/services/workbook-import.ts tests/routes.tests-workbook.test.ts
git commit -m "feat(prd24): Excel «Пороги вариантов» sheet (export/import/round-trip)"
```

---

## Task 8: Отладчик PRD-18 — применённое правило и выданный вариант

**Files:**

- Modify: `server/scorm/debug-player/assets/inspector-compute.js` (читать пин `formId`)
- Modify: `client/src/features/tests/debug-player/inspector-snapshot.ts` (если нужно — показ правила/варианта)
- Test: существующие debug-player тесты (если есть) либо ручная проверка (Task 9)

- [ ] **Step 1: Использовать сохранённый `formId` вместо инференса**

В `server/scorm/debug-player/assets/inspector-compute.js` в `buildDraw` (около 715-737), где
`formId` инферится сопоставлением id-множества, сперва прочитать пин из состояния:
`var pinned = vs && vs.formId ? vs.formId : null;` и если он есть — использовать его как
`out.formId`, оставив инференс как fallback для старых состояний без пина.

- [ ] **Step 2: Показать применённое правило темы**

В результатах темы отладчика (вкладка «Результаты»/«Выдача») вывести резолвленное правило
выданного варианта: вызвать `window.TBTemplate.resolveTopicRule(section.topicPassRule, overall,
{ formId: pinned })` и отобразить `Требуется: N% / N баллов` рядом с меткой выданного варианта.
Место — там, где инспектор формирует строку темы (свериться с текущей структурой compute).

- [ ] **Step 3: Проверка**

Ручной прогон в Task 9 (отдельного unit-теста compute-слой обычно не имеет). Если в
`tests/` есть покрытие inspector-compute — добавить кейс, что при наличии `vs.formId`
`out.formId` равен пину.

- [ ] **Step 4: Type-check + commit**

```bash
npm run check
git add server/scorm/debug-player/assets/inspector-compute.js client/src/features/tests/debug-player
git commit -m "feat(prd24): debug player shows delivered variant + applied threshold"
```

---

## Task 9: Приёмка трека

**Files:**

- Modify: `docs/ROADMAP.md`, `CHANGELOG.md`

- [ ] **Step 1: Полный прогон проверок**

Run: `npm run check`
Run: `npm test`
Run: `npm run lint:md`
Expected: type-check без ошибок; suite зелёный (порог покрытия 80%); markdownlint чист.

- [ ] **Step 2: Сборка пакета + локальный плеер**

Run: `npm run scorm:template`
Run: `npm run scorm:player`
Проверить: тест с темой `by_variant` (2 варианта, разные пороги) выносит верный вердикт по
выпавшему варианту; пин варианта — через отладчик (`#tbff`); проверить оба исхода
(зачтено/не зачтено). Подпись «Требуется» соответствует выданному варианту.

- [ ] **Step 3: Браузерная приёмка редактора (обязательно)**

Прогнать редактор в реальном браузере (Playwright/headless chromium, см.
`reference_wireframe_browser_acceptance` в памяти): выбрать «По вариантам», задать пороги,
сохранить, перезагрузить тест (round-trip через API), выключить режим вариантов →
правило нормализуется в «Как у теста».

- [ ] **Step 4: Опубликованный тест (снапшот PRD-15)**

Проверить, что для опубликованного теста пороги берутся из снапшота (правило и `form_set_json`
заморожены вместе) — доиграть попытку опубликованной версии.

- [ ] **Step 5: Обновить ROADMAP/CHANGELOG + commit**

Отметить PRD-24 как реализованный в `docs/ROADMAP.md`; добавить запись в `CHANGELOG.md`.

```bash
git add docs/ROADMAP.md CHANGELOG.md
git commit -m "docs(prd24): mark variant pass thresholds delivered"
```

---

## Ловушки (перечитать перед стартом)

- **Проброс, а не новая логика.** Любой разбор `source === "by_variant"` ВНЕ `resolveTopicRule`
  (кроме манифеста §5.4, редактора и Excel — там это неизбежно) — ошибка проектирования.
- **Максимум варианта.** Везде через эффективную цену (`shared/scoring/effective-scoring`),
  т.к. цена — свойство теста (PRD-15 блок D). Это касается и редактора: цепочка цен целиком
  доступна из модели (`scoring.questionOverrides` + умолчания секции/теста), как её уже
  считает вкладка «Оценка».
- **`suspend_data`.** Новое поле `formId` в состоянии рантайма читается под guard — старое
  состояние без пина даёт `null` → деградация, не падение.
- **Порядок листов Excel.** Пороги привязываются к номерам ПОСЛЕ сборки `form_set_json`.
- **Устаревший `dist/scorm/assets/shared-runtime.js`** может теневой копией перекрыть правки в
  `shared/` при разработке — известная ловушка сборки SCORM (пересобрать/перезапустить dev).
- **Снапшоты PRD-15** отдельной работы не требуют (секция сериализуется целиком), но в приёмке
  проверить опубликованный тест.
