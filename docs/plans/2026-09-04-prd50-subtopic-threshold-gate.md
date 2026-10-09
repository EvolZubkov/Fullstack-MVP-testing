# PRD-50 §16: производный порог подтемы и гейт вердикта темы

> **Для исполнителя:** обязательный под-навык — `superpowers:subagent-driven-development`
> (рекомендуется) либо `superpowers:executing-plans`. Шаги помечены `- [ ]` для отметок.

**Цель:** вернуть подтеме (тегу вопроса) порог — производный от порога её темы, — научить строку
разреза печатать исход, дать автору один переключатель «непройденная подтема роняет вердикт темы»
(по умолчанию выключен) и вычистить индивидуальные пороги подтем из интерфейса и из структуры.

**Архитектура:** порог подтемы нигде не хранится — он вычисляется из разрешённого правила темы
(`resolveTopicRule`) и общего правила теста. Исход штампуется ОДИН раз, в
`aggregateStandardResult`, прямо в запись разреза (`BreakdownEntry.passed` +
`thresholdPercent`), сохраняется с попыткой и дальше только печатается. Отсюда все три
потребителя читают одно поле: окраска строки, выдача текста подтемы и гейт вердикта темы.
Ядро живёт в `shared/breakdown/`, едет в `shared-runtime`, поэтому веб-хост и SCORM-пакет
считают одним кодом.

**Стек:** TypeScript, Drizzle ORM + PostgreSQL, React 19 + `@skillum/ui-kit`, Vitest,
шаблоны на `shared/template` (mustache-подмножество).

**Спека:** [PRD-50 §16](../specs/prd-50/result-breakdowns.md) (FR-52 - FR-57).

---

## Карта файлов

Создаются:

- `shared/breakdown/gate.ts` — разрешение порога подтемы и штамповка исхода в записи.
- `shared/breakdown/__tests__/gate.test.ts` — тесты ядра.
- `drizzle/0028_prd50_subtopic_gate.sql` — миграция.
- `docs/wireframes/prd50-subtopic-gate.html` — эскиз переключателя и таблицы квот без порогов.

Правятся:

- `shared/breakdown/types.ts` — запись разреза получает `passed` и `thresholdPercent`; уходят
  `BreakdownThreshold` и `BreakdownRules`.
- `shared/breakdown/feedback.ts` — отбор текстов по исходу записи; уходит `passThresholdPercent`.
- `shared/scoring/aggregate.ts` — второй проход штампует исход и применяет гейт; сводные записи
  штампуются общим порогом.
- `shared/scoring/pass-rule.ts` — уходят `resolveBreakdownRules`, `breakdownThresholdFor`,
  `ResolvedBreakdownRules`.
- `shared/template/context.ts`, `shared/template/result-context.ts` — строка контекста получает
  `passed`, `passClass`, `requiredLabel`.
- `shared/breakdown/publish-warnings.ts`, `server/services/breakdown-warnings.ts` — уходит
  предупреждение о недостижимом пороге ключа, появляется предупреждение «гейт включён при
  скрытых подытогах».
- `shared/schema.ts` — колонка `tests.breakdown_gate_enabled`; уходят `breakdownRulesSchema`,
  `breakdownThresholdSchema`, `test_sections.breakdown_rules_json`.
- `server/routes/tests.ts`, `server/services/test-settings.ts`, `server/services/result-compute.ts`,
  `server/routes/attempts.ts`, `server/scorm/builders/test-json.ts` — передача флага, снятие поля.
- `client/src/features/tests/editor/test-editor.types.ts`, `test-editor.mappers.ts`,
  `sections/topics-structure-section.tsx`, `sections/basic-settings-section.tsx` — чистка ручки и
  новый переключатель.
- `server/utils/workbook-settings.ts` — строка книги.
- Шаблоны `server/scorm/templates/default/` и `templates/certification/`: `layouts/results.html`,
  `layouts/report/topics.html`, `layouts/report/breakdown.html`,
  `layouts/report/adaptive/breakdown.html`, `styles/theme.css`.
- Документация: `docs/specs/spec-template-platform.md` (контракт строки + версия),
  `docs/guides/template-development.md`, `docs/guides/test-authoring-guide.md` (раздел 7.3a),
  `docs/ROADMAP.md`, `README.md`, `CLAUDE.md`, `CHANGELOG.md`.

Удаляются:

- `tests/breakdown-rules-schema.test.ts` — предмета больше нет.

---

## Задача 1. Ядро: порог подтемы и штамповка исхода

**Файлы:**

- Создать: `shared/breakdown/gate.ts`
- Создать: `shared/breakdown/__tests__/gate.test.ts`
- Изменить: `shared/breakdown/types.ts:23-40`

- [ ] **Шаг 1: расширить запись разреза**

В `shared/breakdown/types.ts`, в интерфейс `BreakdownEntry`, после `percentUnits`:

```ts
  /**
   * PRD-50 FR-54: исход подтемы. `true`/`false` — взята или не взята по порогу FR-52,
   * `null`/отсутствие — порога нет (тема не судит) либо запись сделана до §16. Штампуется
   * ОДИН раз, при подведении итога попытки, и хранится с ней: цвет строки, выдача текста
   * подтемы и гейт вердикта темы читают это одно поле.
   */
  passed?: boolean | null;
  /** Порог, по которому вынесен {@link passed}, в процентах. Отсутствие = порога не было. */
  thresholdPercent?: number | null;
```

- [ ] **Шаг 2: написать падающий тест ядра**

Создать `shared/breakdown/__tests__/gate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { thresholdPercentOf, applyBreakdownGate } from "../gate";
import type { BreakdownEntry } from "../types";

function entry(key: string, percentPoints: number): BreakdownEntry {
  return {
    scope: "section:s1", axis: "tag", key,
    items: 3, answered: 3, earned: percentPoints / 10, possible: 10,
    unitEarned: 0, unitPossible: 3,
    percentPoints, percentUnits: percentPoints,
  };
}

describe("thresholdPercentOf", () => {
  it("правило в процентах отдаёт своё значение", () => {
    expect(thresholdPercentOf({ type: "percent", value: 70 }, 40)).toBe(70);
  });

  it("правило в баллах переводится в долю от достижимого", () => {
    expect(thresholdPercentOf({ type: "count", value: 20 }, 40)).toBe(50);
  });

  it("правила нет — порога нет", () => {
    expect(thresholdPercentOf(null, 40)).toBeNull();
  });

  it("баллы без достижимого не переводятся", () => {
    expect(thresholdPercentOf({ type: "count", value: 20 }, 0)).toBeNull();
  });
});

describe("applyBreakdownGate", () => {
  it("штампует исход и порог, возвращает признак провала", () => {
    const rows = [entry("Право", 80), entry("Пожарная безопасность", 33)];
    const failed = applyBreakdownGate(rows, 70);
    expect(failed).toBe(true);
    expect(rows[0].passed).toBe(true);
    expect(rows[1].passed).toBe(false);
    expect(rows[1].thresholdPercent).toBe(70);
  });

  it("ровно порог — взята", () => {
    const rows = [entry("Право", 70)];
    expect(applyBreakdownGate(rows, 70)).toBe(false);
    expect(rows[0].passed).toBe(true);
  });

  it("порога нет — исход null, провала нет", () => {
    const rows = [entry("Право", 10)];
    expect(applyBreakdownGate(rows, null)).toBe(false);
    expect(rows[0].passed).toBeNull();
    expect(rows[0].thresholdPercent).toBeNull();
  });
});
```

- [ ] **Шаг 3: запустить тест и убедиться, что он падает**

Команда: `npm test -- shared/breakdown/__tests__/gate.test.ts`
Ожидание: FAIL — модуль `../gate` не найден.

- [ ] **Шаг 4: написать модуль**

Создать `shared/breakdown/gate.ts`:

```ts
/**
 * @module shared/breakdown/gate
 * @description PRD-50 §16 (FR-52 - FR-54): порог подтемы и её исход.
 *
 * Своего числа у подтемы нет и не будет: порог ПРОИЗВОДНЫЙ — разрешённое правило её темы,
 * а у сводных записей области теста — общее правило теста. Индивидуальные пороги ключей
 * отменены владельцем 2026-09-04: подтема несёт два-четыре вопроса, и собственный порог на
 * такой выборке означает «ошибся один — провал». Автору, которому нужен другой порог, ответ
 * один — завести отдельную тему.
 *
 * Модуль чистый: ни DOM, ни Node, ни типов хоста. Он едет в бандл `shared-runtime`, поэтому
 * экран итогов, отчёт и SCORM-пакет судят подтему ОДНИМ кодом.
 */
import type { BreakdownEntry } from "./types";
import type { ResolvedRule } from "../scoring/pass-rule";

/**
 * Порог области в процентах, или `null`, когда порога нет.
 *
 * Правило, заданное СУММОЙ БАЛЛОВ, переводится в долю от достижимого в этой области: подтема
 * несёт свою, малую сумму баллов, и сравнивать её с абсолютом темы бессмысленно. Без перевода
 * тест с порогом в баллах молча остался бы без окраски и без текстов подтем — настройка,
 * которая ничего не делает, хуже приблизительного перевода (то же решение, что в FR-50).
 *
 * @param rule Разрешённое правило области (`resolveTopicRule` / `resolveOverallRule`).
 * @param possiblePoints Достижимые баллы области — темы для её подтем, теста для сводных.
 */
export function thresholdPercentOf(
  rule: ResolvedRule | null,
  possiblePoints: number,
): number | null {
  if (!rule) return null;
  if (rule.type === "percent") return rule.value;
  const possible = Number(possiblePoints);
  if (!Number.isFinite(possible) || possible <= 0) return null;
  return (rule.value / possible) * 100;
}

/**
 * Проставить исход каждой записи и сказать, провалена ли хоть одна.
 *
 * Сравнивается доля БАЛЛОВ (`percentPoints`) независимо от выбранной базы показа (FR-21):
 * база решает, какое число НАПЕЧАТАТЬ, а не по какому судить. Записи правятся на месте —
 * они принадлежат результату попытки, который вызывающий как раз собирает.
 *
 * Возвращаемый признак — единственное, что нужно вердикту темы (FR-53); сам вердикт этот
 * модуль не выносит: политика теста живёт в `aggregate`.
 */
export function applyBreakdownGate(
  entries: BreakdownEntry[],
  thresholdPercent: number | null,
): boolean {
  const threshold =
    typeof thresholdPercent === "number" && Number.isFinite(thresholdPercent)
      ? thresholdPercent
      : null;
  let anyFailed = false;
  for (const entry of entries) {
    if (threshold === null) {
      entry.passed = null;
      entry.thresholdPercent = null;
      continue;
    }
    const passed = entry.percentPoints >= threshold;
    entry.passed = passed;
    entry.thresholdPercent = threshold;
    if (!passed) anyFailed = true;
  }
  return anyFailed;
}
```

- [ ] **Шаг 5: убедиться, что тест проходит**

Команда: `npm test -- shared/breakdown/__tests__/gate.test.ts`
Ожидание: PASS, 7 тестов.

- [ ] **Шаг 6: коммит**

```bash
git add shared/breakdown/gate.ts shared/breakdown/__tests__/gate.test.ts shared/breakdown/types.ts
git commit -m "feat(prd-50): порог подтемы наследуется от темы"
```

---

## Задача 2. Агрегация: гейт вердикта темы

**Файлы:**

- Изменить: `shared/scoring/aggregate.ts:86-92` (вход секции), `:103-118` (вход теста),
  `:297-317` (второй проход), `:331-352` (сводные записи и возврат)
- Тест: `tests/breakdown-gate.test.ts` (существующий файл переписывается)

- [ ] **Шаг 1: написать падающие тесты гейта**

Заменить содержимое `tests/breakdown-gate.test.ts` на:

```ts
import { describe, it, expect } from "vitest";
import { aggregateStandardResult } from "@shared/scoring/aggregate";

/** Тест из одной темы: два вопроса с тегом «Право», один с тегом «Охрана труда». */
function input(opts: {
  topicPassRule?: unknown;
  overall?: unknown;
  gate?: boolean;
}) {
  return {
    overallPassRule: opts.overall ?? { type: "percent", value: 70 },
    passDecisionPolicy: "overall_and_required_topics",
    breakdownGateEnabled: opts.gate,
    sections: [
      {
        topicId: "s1",
        topicName: "Тема",
        topicPassRule: opts.topicPassRule ?? { source: "inherit_overall" },
        required: true,
        questions: [
          { type: "single" as const, correct: { correctIndex: 0 }, points: 1, answer: 0, axisKeys: { tag: ["Право"] } },
          { type: "single" as const, correct: { correctIndex: 0 }, points: 1, answer: 0, axisKeys: { tag: ["Право"] } },
          { type: "single" as const, correct: { correctIndex: 0 }, points: 1, answer: 1, axisKeys: { tag: ["Охрана труда"] } },
        ],
      },
    ],
  };
}

describe("PRD-50 §16: гейт подтем", () => {
  it("выключен — тема судится своим правилом, исход подтем штампуется", () => {
    const result = aggregateStandardResult(input({}));
    // 2 из 3 баллов = 66.7 % < 70 % — тема и так не пройдена своим правилом.
    expect(result.topicResults[0].passed).toBe(false);
    const rows = result.topicResults[0].breakdown;
    expect(rows.find((r) => r.key === "Право")?.passed).toBe(true);
    expect(rows.find((r) => r.key === "Охрана труда")?.passed).toBe(false);
  });

  it("выключен — проваленная подтема не роняет пройденную тему", () => {
    const result = aggregateStandardResult(input({ overall: { type: "percent", value: 50 } }));
    expect(result.topicResults[0].passed).toBe(true);
    expect(result.topicResults[0].breakdown.find((r) => r.key === "Охрана труда")?.passed).toBe(false);
  });

  it("включён — проваленная подтема роняет пройденную тему", () => {
    const result = aggregateStandardResult(
      input({ overall: { type: "percent", value: 50 }, gate: true }),
    );
    expect(result.topicResults[0].passed).toBe(false);
    expect(result.passed).toBe(false);
  });

  it("тема «не проверять отдельно» не судит и свои подтемы", () => {
    const result = aggregateStandardResult(
      input({ topicPassRule: { source: "none" }, gate: true }),
    );
    expect(result.topicResults[0].passed).toBeNull();
    for (const row of result.topicResults[0].breakdown) {
      expect(row.passed).toBeNull();
      expect(row.thresholdPercent).toBeNull();
    }
  });

  it("сводные записи судятся общим порогом теста", () => {
    const result = aggregateStandardResult(input({ overall: { type: "percent", value: 50 } }));
    expect(result.breakdowns.find((r) => r.key === "Право")?.passed).toBe(true);
    expect(result.breakdowns.find((r) => r.key === "Охрана труда")?.passed).toBe(false);
  });
});
```

- [ ] **Шаг 2: запустить и убедиться, что тесты падают**

Команда: `npm test -- tests/breakdown-gate.test.ts`
Ожидание: FAIL — `passed` у записей `undefined`, вердикт темы не меняется при `gate: true`.

- [ ] **Шаг 3: расширить вход агрегата**

В `shared/scoring/aggregate.ts` заменить поле `breakdownRules` интерфейса `AggregateSection`
(строки 85-92) — удалить его целиком. В `AggregateInput` после `passDecisionPolicy` добавить:

```ts
  /**
   * PRD-50 FR-53: `tests.breakdown_gate_enabled` — учитывать ли подтемы в вердикте темы.
   * Отсутствие = ВЫКЛЮЧЕНО, и это ровно поведение до §16: попытка по старому снимку или
   * пакету, собранному раньше, судится как судилась.
   */
  breakdownGateEnabled?: boolean;
```

- [ ] **Шаг 4: применить гейт во втором проходе**

В `shared/scoring/aggregate.ts` добавить импорт рядом с импортом `computeBreakdowns`:

```ts
import { applyBreakdownGate, thresholdPercentOf } from "../breakdown/gate";
```

Заменить тело второго прохода (строки 300-317) на:

```ts
  const gateOn = input.breakdownGateEnabled === true;
  for (let i = 0; i < topicResults.length; i++) {
    const topic = topicResults[i];
    const gate = gates[i];
    topic.breakdown = bySection.get(sectionScope(topic.topicId)) ?? [];
    // FR-52: порог подтем — разрешённое правило ТЕМЫ. Правила нет («Не проверять отдельно»
    // либо у теста нет общего порога) — порога нет и у подтем: тема молчит, молчат и они.
    const keysFailed = applyBreakdownGate(
      topic.breakdown,
      thresholdPercentOf(gate.rule, topic.possiblePoints),
    );
    // FR-09: раздел, где нечего оценивать, остаётся БЕЗ вердикта (`null`), а не проваливает
    // своё правило на 0 %.
    const ownPassed =
      gate.rule && gate.scored > 0 ? checkPassRule(gate.rule, topic.percent, topic.earnedPoints) : null;
    // FR-53: подтема роняет тему только при включённом переключателе и только там, где тема
    // вообще судит. Тема без вердикта его не получает — суд не возвращается вопреки настройке.
    const passed = ownPassed === null ? null : ownPassed && !(gateOn && keysFailed);
    topic.passed = passed;
    if (passed === false) {
      allTopicsPassed = false;
      if (gate.required) requiredTopicsPassed = false;
    }
  }
```

- [ ] **Шаг 5: судить сводные записи общим порогом**

В том же файле, перед `return` (после вычисления `percent` и `overallPassed`, строка ~336):

```ts
  // FR-52: у сводных записей темы нет — их судит общее правило теста. Гейта в области теста
  // по-прежнему нет (FR-23): блок ГОВОРИТ о тесте, а вердикт теста выносит политика.
  const testEntries = entries.filter((e) => e.scope === TEST_SCOPE);
  applyBreakdownGate(testEntries, thresholdPercentOf(overall, tPossible));
```

и в объекте результата заменить `breakdowns: entries.filter((e) => e.scope === TEST_SCOPE),`
на `breakdowns: testEntries,`.

- [ ] **Шаг 6: убедиться, что тесты проходят**

Команда: `npm test -- tests/breakdown-gate.test.ts tests/scoring-aggregate.test.ts`
Ожидание: PASS обоих файлов.

- [ ] **Шаг 7: коммит**

```bash
git add shared/scoring/aggregate.ts tests/breakdown-gate.test.ts
git commit -m "feat(prd-50): непройденная подтема роняет вердикт темы по переключателю"
```

---

## Задача 3. Тексты подтем выдаются по исходу записи

**Файлы:**

- Изменить: `shared/breakdown/feedback.ts` (целиком), `shared/template/result-context.ts:38`,
  `:1140-1152`
- Тест: `shared/breakdown/__tests__/feedback.test.ts`

- [ ] **Шаг 1: переписать тест отбора**

Заменить содержимое `shared/breakdown/__tests__/feedback.test.ts` на:

```ts
import { describe, it, expect } from "vitest";
import { collectBreakdownFeedback } from "../feedback";
import type { BreakdownEntry } from "../types";

function entry(key: string, passed: boolean | null): BreakdownEntry {
  return {
    scope: "section:s1", axis: "tag", key,
    items: 2, answered: 2, earned: 1, possible: 2,
    unitEarned: 1, unitPossible: 2,
    percentPoints: 50, percentUnits: 50,
    passed,
  };
}

describe("collectBreakdownFeedback", () => {
  it("отдаёт текст непройденной подтемы", () => {
    const out = collectBreakdownFeedback([
      { breakdown: [entry("Право", false)], breakdownFeedback: { "Право": "учить" } },
    ]);
    expect(out).toEqual(["учить"]);
  });

  it("молчит о пройденной подтеме", () => {
    const out = collectBreakdownFeedback([
      { breakdown: [entry("Право", true)], breakdownFeedback: { "Право": "учить" } },
    ]);
    expect(out).toEqual([]);
  });

  it("молчит, когда порога нет (исход null)", () => {
    const out = collectBreakdownFeedback([
      { breakdown: [entry("Право", null)], breakdownFeedback: { "Право": "учить" } },
    ]);
    expect(out).toEqual([]);
  });

  it("подтема без написанного текста ничего не даёт", () => {
    const out = collectBreakdownFeedback([
      { breakdown: [entry("Право", false)], breakdownFeedback: { "Охрана труда": "учить" } },
    ]);
    expect(out).toEqual([]);
  });
});
```

- [ ] **Шаг 2: запустить и убедиться, что тесты падают**

Команда: `npm test -- shared/breakdown/__tests__/feedback.test.ts`
Ожидание: FAIL — функция требует второй аргумент и сравнивает проценты.

- [ ] **Шаг 3: переписать модуль**

Заменить в `shared/breakdown/feedback.ts` шапку модуля, удалить `passThresholdPercent` целиком
и заменить `collectBreakdownFeedback` на:

```ts
/**
 * @module shared/breakdown/feedback
 * @description PRD-50 FR-55: какие тексты подтем получает обучающийся.
 *
 * Правило одно: текст выдаётся, когда подтема НЕ ВЗЯТА по порогу своей темы — при любом
 * вердикте теста и темы. «При любом вердикте» — часть правила, а не упрощение: провал по
 * подтеме внутри сданного теста и есть тот случай, ради которого текст пишут. Обратная связь
 * ТЕМЫ так себя не ведёт (её гасит пройденная тема), и это сознательное расхождение.
 *
 * Считать здесь нечего: исход подтемы штампует `shared/breakdown/gate` при подведении итога,
 * и модуль только читает готовое поле. Так экран, отчёт и пакет не могут разойтись в том,
 * что человек прочитал, а тексты старой попытки не переезжают при смене настроек теста.
 */

import type { BreakdownEntry } from "./types";

/** Раздел глазами отбора: его подытоги и тексты его подтем. */
export interface BreakdownFeedbackTopic<T> {
  breakdown?: BreakdownEntry[] | null;
  /** Ключ подтемы -> её текст (`test_sections.breakdown_feedback_json`). */
  breakdownFeedback?: Record<string, T> | null;
}

/**
 * Тексты подтем, которые обучающийся должен прочитать, в порядке разделов и подытогов.
 *
 * `passed === false` и ничто иное: `null` значит «порога не было» (тема не судит либо попытка
 * завершена до §16), и выдавать по нему текст было бы суждением, которого никто не выносил.
 * Подтема, которой выдача не дала ни одного вопроса, в подытогах не появляется — значит, и
 * текста не даёт: рекомендация по неспрошенному ни на чём не основана.
 */
export function collectBreakdownFeedback<T>(
  topics: ReadonlyArray<BreakdownFeedbackTopic<T>>,
): T[] {
  const out: T[] = [];
  for (const topic of topics) {
    const texts = topic.breakdownFeedback;
    if (!texts) continue;
    for (const entry of topic.breakdown ?? []) {
      if (entry.passed !== false) continue;
      const block = texts[entry.key];
      if (block) out.push(block);
    }
  }
  return out;
}
```

- [ ] **Шаг 4: поправить единственного потребителя**

В `shared/template/result-context.ts` строка 38 — убрать `passThresholdPercent` из импорта:

```ts
import { collectBreakdownFeedback } from "../breakdown/feedback";
```

и заменить вызов (строки 1147-1152) на:

```ts
  // PRD-50 FR-55: тексты ПОДТЕМ — последними, они самые узкие (одна подтема одного раздела),
  // и дедуп оставит копию пошире, если автор написал то же самое теме. Вердикт теста и темы
  // здесь не спрашивается: исход подтемы уже вынесен ядром по порогу её темы.
  recommendationSources.push(...collectBreakdownFeedback(input.topicResults || []));
```

- [ ] **Шаг 5: проверить, что `passThresholdPercent` больше нигде не звучит**

Команда: `npm run check`
Ожидание: 0 ошибок. Если компилятор укажет на `shared/template/runtime-entry.ts` — удалить
экспорт оттуда тем же шагом.

- [ ] **Шаг 6: прогнать затронутые тесты**

Команда: `npm test -- shared/breakdown/__tests__ shared/template/__tests__/result-context-breakdown-feedback.test.ts`
Ожидание: PASS. Тест контекста, ожидавший отбор по порогу теста, переписать под новое правило:
записи в фикстуре получают `passed: false` вместо низкого процента.

- [ ] **Шаг 7: коммит**

```bash
git add shared/breakdown/feedback.ts shared/breakdown/__tests__/feedback.test.ts shared/template/result-context.ts shared/template/__tests__/result-context-breakdown-feedback.test.ts
git commit -m "feat(prd-50): текст подтемы выдаётся по её исходу, а не по порогу теста"
```

---

## Задача 4. Контекст шаблона: строка печатает исход

**Файлы:**

- Изменить: `shared/template/context.ts:118-157`, `shared/template/result-context.ts:750-777`
- Тест: `shared/template/__tests__/result-context-breakdown.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `shared/template/__tests__/result-context-breakdown.test.ts`:

```ts
  it("PRD-50 FR-54: строка несёт исход, класс и надпись порога", () => {
    const ctx = buildResultContext(
      {
        ...baseInput,
        topicResults: [
          {
            ...baseTopic,
            breakdown: [
              { scope: "section:s1", axis: "tag", key: "Право", items: 2, answered: 2,
                earned: 1, possible: 2, unitEarned: 1, unitPossible: 2,
                percentPoints: 50, percentUnits: 50, passed: false, thresholdPercent: 70 },
            ],
          },
        ],
      },
      { ...baseOpts, breakdownDisplay: { visibility: "bar_and_value", basis: "points" } },
    );
    const row = ctx.result.topicResults![0].breakdown![0];
    expect(row.passed).toBe(false);
    expect(row.passClass).toBe("is-fail");
    expect(row.requiredLabel).toBe("Нужно 70 %");
  });

  it("PRD-50 FR-57: запись без исхода печатается нейтрально", () => {
    const ctx = buildResultContext(
      {
        ...baseInput,
        topicResults: [
          {
            ...baseTopic,
            breakdown: [
              { scope: "section:s1", axis: "tag", key: "Право", items: 2, answered: 2,
                earned: 1, possible: 2, unitEarned: 1, unitPossible: 2,
                percentPoints: 50, percentUnits: 50 },
            ],
          },
        ],
      },
      { ...baseOpts, breakdownDisplay: { visibility: "bar_and_value", basis: "points" } },
    );
    const row = ctx.result.topicResults![0].breakdown![0];
    expect(row.passed).toBeNull();
    expect(row.passClass).toBe("");
    expect(row.requiredLabel).toBeUndefined();
  });
```

(`baseInput`, `baseTopic`, `baseOpts` — фикстуры, уже объявленные в этом файле; если имена в нём
другие, использовать существующие.)

- [ ] **Шаг 2: запустить и убедиться, что тест падает**

Команда: `npm test -- shared/template/__tests__/result-context-breakdown.test.ts`
Ожидание: FAIL — `row.passClass` равен `undefined`.

- [ ] **Шаг 3: расширить контракт строки**

В `shared/template/context.ts` заменить абзац «The row carries NO verdict…» (строки 126-129) на:

```ts
 * Строка снова несёт исход (PRD-50 §16, FR-54): `passed`, `passClass` и `requiredLabel`.
 * Словесной метки у неё нет и не будет — строка узкая, и слово рядом с процентом дублировало
 * бы цвет; вердикт СЛОВОМ говорит карточка темы вокруг. Шаблон, ничего о новых полях не
 * знающий, печатает ровно то, что печатал: класс подставляется в атрибут, надпись гейтится
 * своим `{{#if}}`.
```

и добавить в `CtxBreakdownRow` после `valueLabel`:

```ts
  /** Исход подтемы: `true` / `false` / `null` — порога не было (FR-52). */
  passed?: boolean | null;
  /** Готовый модификатор строки: `is-pass`, `is-fail` или пусто. */
  passClass?: string;
  /**
   * Надпись порога, например «Нужно 70 %». Печатается только там, где автор включил показ
   * значения: цвет без причины читается как приговор. Отсутствует, когда порога нет.
   */
  requiredLabel?: string;
```

- [ ] **Шаг 4: заполнить поля в `breakdownRow`**

В `shared/template/result-context.ts` заменить тело `breakdownRow` (строки 758-777) на:

```ts
function breakdownRow(e: BreakdownEntry, display: BreakdownDisplaySetting): CtxBreakdownRow {
  const showValue = display.visibility === "bar_and_value";
  const value = display.basis === "points" ? e.percentPoints : e.percentUnits;
  const passed = e.passed ?? null;
  const threshold = typeof e.thresholdPercent === "number" ? e.thresholdPercent : null;
  return {
    key: e.key,
    items: e.items,
    answered: e.answered,
    // One decimal everywhere a real number reaches the layout, exactly like
    // `pointsLabel` does: these fields are bound DIRECTLY by templates, and a raw
    // ratio prints as «73.33333333333333». The bar keeps its own integer.
    earned: round1(e.earned),
    possible: round1(e.possible),
    percent: round1(value),
    percentUnits: round1(e.percentUnits),
    percentPoints: round1(e.percentPoints),
    barPercent: Math.round(value),
    showValue,
    valueLabel: showValue ? Math.round(value) + " %" : "",
    // PRD-50 FR-54: исход ВЗЯТ у записи, а не вычислен здесь. Считать его в контексте значило
    // бы завести вторую правду о пороге и перекрашивать старые попытки при смене настроек.
    passed,
    passClass: passed === true ? "is-pass" : passed === false ? "is-fail" : "",
    ...(showValue && threshold !== null ? { requiredLabel: "Нужно " + Math.round(threshold) + " %" } : {}),
  };
}
```

- [ ] **Шаг 5: убедиться, что тесты проходят**

Команда: `npm test -- shared/template/__tests__/result-context-breakdown.test.ts shared/template/__tests__/result-context-breakdown-block.test.ts`
Ожидание: PASS.

- [ ] **Шаг 6: коммит**

```bash
git add shared/template/context.ts shared/template/result-context.ts shared/template/__tests__/result-context-breakdown.test.ts
git commit -m "feat(prd-50): строка разреза печатает исход подтемы"
```

---

## Задача 5. Шаблоны, стили и контракт

**Файлы:**

- Изменить (в шаблоне `server/scorm/templates/default/` и в `templates/certification/`):
  `layouts/results.html`, `layouts/results.adaptive.html`, `layouts/report/topics.html`,
  `layouts/report/breakdown.html`, `layouts/report/adaptive/breakdown.html`,
  `styles/theme.css`
- Изменить: `docs/specs/spec-template-platform.md`, `docs/guides/template-development.md`
- Тест: `shared/template/__tests__/certification-layout.test.ts`, `tests/report-label-keys.test.ts`

- [ ] **Шаг 1: научить строку макета классу**

Во ВСЕХ перечисленных макетах обоих шаблонов заменить открывающий тег строки разреза:

```html
<div class="tb-breakdown__row" data-item="{{ key }}">
```

на

```html
<div class="tb-breakdown__row {{ passClass }}" data-item="{{ key }}">
```

и в отчётных макетах (`report/topics.html`, `report/breakdown.html`,
`report/adaptive/breakdown.html`) соответственно:

```html
<div class="tb-report__breakdown-row {{ passClass }}" data-item="{{ key }}">
```

В каждом из макетов сразу после строки со значением добавить надпись порога:

```html
{{#if requiredLabel}}<div class="tb-breakdown__req">{{ requiredLabel }}</div>{{/if}}
```

(в отчётных — с классом `tb-report__breakdown-req`).

- [ ] **Шаг 2: дать тону стиль**

В `server/scorm/templates/default/styles/theme.css` после строки `.tb-breakdown__val …` (679-681)
добавить:

```css
/* PRD-50 §16: тон строки разреза. Полоса — единственное, что красится: подтема говорит о
   результате, а слово вердикта принадлежит карточке темы вокруг. Порога нет — класса нет,
   и строка остаётся ровно такой, какой была до §16. */
.tb-breakdown__row.is-pass .tb-breakdown__bar span { background: var(--ou-success-default); }
.tb-breakdown__row.is-fail .tb-breakdown__bar span { background: var(--ou-error-default); }
.tb-breakdown__req { font: var(--ou-text-body-s); color: var(--ou-fg-muted); margin-top: 2px; }
```

То же — в `templates/certification/styles/` (файл темы этого шаблона) и в отчётных стилях
(`templates/certification/styles/report.css` и соответствующий файл отчёта шаблона `default`),
с классами `tb-report__breakdown-*`.

- [ ] **Шаг 3: обновить контракт**

В `docs/specs/spec-template-platform.md` в описании строки разреза добавить три поля
(`passed`, `passClass`, `requiredLabel`) и поднять версию контракта на минорную (2.0.0 -> 2.1.0)
в самом документе, в `docs/guides/template-development.md` и в манифестах поставляемых шаблонов,
если версия указана там.

- [ ] **Шаг 4: пересобрать PDF руководства**

Команда: `npm run docs:pdf`
Ожидание: собирается без ошибок, `docs/dist/` обновлён.

- [ ] **Шаг 5: прогнать тесты шаблонов**

Команда: `npm test -- shared/template/__tests__/certification-layout.test.ts tests/report-label-keys.test.ts`
Ожидание: PASS. Если `report-label-keys` падает составом — добавить новую надпись в список
`PRINTED` этого теста.

- [ ] **Шаг 6: коммит**

```bash
git add server/scorm/templates templates/certification docs/specs/spec-template-platform.md docs/guides/template-development.md docs/dist
git commit -m "feat(prd-50): шаблоны печатают тон строки разреза"
```

---

## Задача 6. Структура: миграция, схема, передача флага

**Файлы:**

- Создать: `drizzle/0028_prd50_subtopic_gate.sql`
- Изменить: `shared/schema.ts:745-760` (схемы порогов), `:789` (колонка раздела),
  `:996` (insert-схема), таблица `tests` (новая колонка рядом с `breakdownDisplayJson`)
- Изменить: `shared/scoring/pass-rule.ts:186-245`, `server/routes/tests.ts:8,65`,
  `server/services/test-settings.ts:123-125`, `server/routes/attempts.ts`,
  `server/services/result-compute.ts`, `server/scorm/builders/test-json.ts:264-286`
- Удалить: `tests/breakdown-rules-schema.test.ts`

- [ ] **Шаг 1: написать миграцию**

Создать `drizzle/0028_prd50_subtopic_gate.sql`:

```sql
-- PRD-50 §16 (FR-53, FR-56).
-- Переключатель «учитывать подтемы в вердикте темы». NOT NULL DEFAULT false: существующие
-- тесты судятся ровно как судились, и включает его только автор.
ALTER TABLE "tests" ADD COLUMN "breakdown_gate_enabled" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
-- Индивидуальные пороги подтем отменены владельцем 2026-09-04: порог подтемы производный от
-- порога темы. Вердикта колонка не меняла с 2026-09-03, поэтому её снятие не влияет ни на
-- один сохранённый результат.
ALTER TABLE "test_sections" DROP COLUMN "breakdown_rules_json";
```

- [ ] **Шаг 2: поправить схему Drizzle**

В `shared/schema.ts`: удалить `breakdownThresholdSchema` и `breakdownRulesSchema` (строки
745-760), удалить колонку `breakdownRulesJson` (строка 789) и её строку в
`insertTestSectionSchema` (строка 996). В таблицу `tests`, сразу после `breakdownDisplayJson`,
добавить:

```ts
  /**
   * PRD-50 FR-53: учитывать ли подтемы в вердикте темы. `false` (умолчание и значение
   * бэкфилла) = подтема говорит о результате, но не судит его — поведение до §16.
   */
  breakdownGateEnabled: boolean("breakdown_gate_enabled").notNull().default(false),
```

- [ ] **Шаг 3: вычистить резольверы порогов**

В `shared/scoring/pass-rule.ts` удалить весь блок «PRD-50: stored key thresholds» (строки
186-245) вместе с импортом `BreakdownRules`. В `shared/breakdown/types.ts` удалить
`BreakdownThreshold` и `BreakdownRules`. Удалить файл:

```bash
git rm tests/breakdown-rules-schema.test.ts
```

- [ ] **Шаг 4: снять поле с маршрута и сервисов, передать флаг**

В `server/routes/tests.ts` убрать `breakdownRulesSchema` из импорта (строка 8) и строку 65.
В `server/services/test-settings.ts` удалить поле `breakdownRulesJson` (строки 123-125) и
добавить `breakdownGateEnabled` в список настроек теста рядом с `passDecisionPolicy`.
В веб-грейдинге (`server/routes/attempts.ts` / `server/services/result-compute.ts`, там, где
собирается `AggregateInput`) добавить:

```ts
      breakdownGateEnabled: test.breakdownGateEnabled === true,
```

и убрать передачу `breakdownRules` из сборки секций, если она там есть.

- [ ] **Шаг 5: запечь флаг в пакет**

В `server/scorm/builders/test-json.ts` после `passDecisionPolicy` (строка 267) добавить:

```ts
    // PRD-50 FR-53: выпекается ТОЛЬКО когда автор включил, поэтому пакет теста, который его не
    // трогал, остаётся байт-в-байт прежним; рантайм читает отсутствие как «выключено».
    ...(data.test.breakdownGateEnabled ? { breakdownGateEnabled: true } : {}),
```

и убедиться, что рантайм пакета передаёт его в `aggregateStandardResult`
(`server/scorm/template/app/render/resultsPage.js`, там же, где передаётся
`passDecisionPolicy`).

- [ ] **Шаг 6: применить миграцию и проверить типы**

Команды:

```bash
npm run db:migrate
npm run check
```

Ожидание: миграция применяется (колонка удалена, новая добавлена); `tsc` — 0 ошибок. Кэш `tsc`
общий на все worktree: если проверка подозрительно зелёная, удалить `*.tsbuildinfo` и повторить.

- [ ] **Шаг 7: прогнать серверные тесты**

Команда: `npm test -- server/scorm/__tests__/test-json-prd50.test.ts tests/breakdown-snapshot-freeze.test.ts tests/routes.tests.test.ts`
Ожидание: PASS. Тест `test-json-prd50`, проверявший, что пороги не запекаются, заменить на
проверку запекания флага.

- [ ] **Шаг 8: коммит**

```bash
git add drizzle shared/schema.ts shared/scoring/pass-rule.ts shared/breakdown/types.ts server tests
git commit -m "feat(prd-50): переключатель гейта подтем в структуре и в пакете"
```

---

## Задача 7. Редактор: эскиз, чистка ручки, переключатель

**Файлы:**

- Создать: `docs/wireframes/prd50-subtopic-gate.html`
- Изменить: `client/src/features/tests/editor/sections/topics-structure-section.tsx:296-302`,
  `:520-535`, `:600-620`, `:673-687`, `:733-745`, `:821-852`
- Изменить: `client/src/features/tests/editor/sections/basic-settings-section.tsx`
  (подраздел «Правила прохождения»), `test-editor.types.ts`, `test-editor.mappers.ts`
- Тест: `client/src/features/tests/editor/sections/__tests__/topics-structure-breakdown.test.tsx`,
  `client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts`

- [ ] **Шаг 1: нарисовать эскиз и согласовать**

Собрать `docs/wireframes/prd50-subtopic-gate.html` по образцу соседних эскизов: два состояния —
подраздел «Правила прохождения» с новым переключателем под «Тест пройден, если» и блок квот темы
БЕЗ переключателя порогов и без столбца «Порог». Проверить в браузере
(`chrome-headless-shell` + `http.server` из КОРНЯ репозитория) и показать владельцу. React не
трогать, пока эскиз не согласован.

- [ ] **Шаг 2: написать падающий тест переключателя**

Дописать в `client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts`:

```ts
  it("PRD-50 FR-53: гейт подтем читается и пишется", () => {
    const model = testFromApi({ ...apiTest, breakdownGateEnabled: true });
    expect(model.settings.breakdownGateEnabled).toBe(true);
    expect(testToPayload(model).breakdownGateEnabled).toBe(true);
  });

  it("PRD-50 FR-53: отсутствие поля читается как выключено", () => {
    const model = testFromApi({ ...apiTest });
    expect(model.settings.breakdownGateEnabled).toBe(false);
  });
```

(`testFromApi` / `testToPayload` / `apiTest` — уже существующие в файле помощники; если имена
другие, использовать те, что есть.)

- [ ] **Шаг 3: запустить и убедиться, что тест падает**

Команда: `npm test -- client/src/features/tests/editor/__tests__/test-editor.mappers.test.ts`
Ожидание: FAIL — поля нет в модели.

- [ ] **Шаг 4: провести поле через модель**

В `test-editor.types.ts` в `TestSettingsPayload` после `passDecisionPolicy`:

```ts
  /** PRD-50 FR-53: учитывать ли подтемы (теги) в вердикте темы. */
  breakdownGateEnabled: boolean;
```

В `test-editor.mappers.ts` — в `ApiTestResponse` добавить `breakdownGateEnabled?: boolean | null;`,
в чтение модели `breakdownGateEnabled: api.breakdownGateEnabled === true,`, в payload — то же
поле. Одновременно удалить из типов и мапперов поле раздела `breakdownRules` со всеми
помощниками (`withKeyThreshold` и прочими).

- [ ] **Шаг 5: снять ручку порогов**

В `topics-structure-section.tsx` удалить: проп `onChangeBreakdownRules` и его прокидывание
(строки 296-302, 520-535), переключатель «Пороги по подтемам (тегам)» (673-687), столбец «Порог»
в шапке (740) и ячейку с селектом и полем процентов (821-852), переменные `rulesOn`, `rules`,
`threshold`, `withKeyThreshold`.

Условие раскрытия таблицы (строка 618) НЕ сводить к одним квотам. Решение владельца
2026-09-05: в вариантном режиме таблица остаётся раскрытой СПРАВКОЙ — иначе вместе с порогами
пропадёт столбец «В вариантах», который показывает раскладку тегов по вариантам и появился
одним коммитом с ними (`483dbbf7`). Заменить на:

```ts
  // Таблица раскрыта, когда есть что показывать: живые квоты ЛИБО вариантный режим, где
  // квоты неприменимы (PRD-17 FR-03), но раскладка тегов по вариантам — единственная
  // справка автору о том, ровно ли легли теги. Поля квот там неактивны, как и сейчас.
  const expanded = quotasLive || variants != null;
```

(объявление `variants` поднять выше этой строки). Состав строк: ключи квот, а при вариантном
режиме — все теги темы, чтобы справка была полной; добор «под пороги» убрать.

- [ ] **Шаг 6: добавить переключатель в подраздел «Вердикт»**

АДРЕС УТОЧНЁН 2026-09-05: после перестройки ящика карточка «Тест пройден, если» живёт во
вкладке «Оценка результата», подраздел «Вердикт» (`VerdictPane` в `basic-settings-section.tsx`,
подключён из `editor-tabs.tsx:226-268`), а «Правила прохождения» — другая вкладка, про навигацию
и ограничения. Переключатель ставится в `VerdictPane`, сразу после блока «Тест пройден, если»:

```tsx
<div className="ou-formfield">
  <label className="tb-quota-toggle">
    <Switch
      checked={model.settings.breakdownGateEnabled}
      onChange={(e) =>
        updateModel((m) => ({
          ...m,
          settings: { ...m.settings, breakdownGateEnabled: e.target.checked },
        }))
      }
      aria-label="Учитывать подтемы в вердикте темы"
      data-testid="breakdown-gate-toggle"
    />
    <span className="tb-section-label">Учитывать подтемы в вердикте темы</span>
  </label>
  <div className="tb-card-desc">
    Тема не пройдена, если хотя бы одна её подтема (тег) набрала меньше порога темы. Отдельных
    порогов у подтем нет: подтема живёт по правилу своей темы, а тема с «Не проверять отдельно»
    не судит и свои подтемы.
  </div>
</div>
```

- [ ] **Шаг 7: прогнать тесты редактора**

Команда: `npm test -- client/src/features/tests/editor`
Ожидание: PASS. Тест `topics-structure-breakdown.test.tsx`, проверявший пороги, переписать под
их отсутствие: таблица квот не содержит `key-threshold-mode-*`.

- [ ] **Шаг 8: коммит**

```bash
git add client/src/features/tests/editor docs/wireframes/prd50-subtopic-gate.html
git commit -m "feat(prd-50): переключатель гейта подтем вместо индивидуальных порогов"
```

---

## Задача 8. Книга Excel

**Файлы:**

- Изменить: `server/utils/workbook-settings.ts:553-558`
- Тест: `tests/workbook-settings.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `tests/workbook-settings.test.ts` проверку, что лист настроек содержит строку
«Учитывать подтемы в вердикте темы» со значением «Да»/«Нет» и что импорт возвращает её в
`breakdownGateEnabled` — по образцу соседней проверки для `showDifficultyLevel`.

- [ ] **Шаг 2: запустить и убедиться, что тест падает**

Команда: `npm test -- tests/workbook-settings.test.ts`
Ожидание: FAIL — строки нет.

- [ ] **Шаг 3: добавить строку**

В `server/utils/workbook-settings.ts` сразу после строки с `passDecisionPolicy` (556):

```ts
  boolParam(
    "Учитывать подтемы в вердикте темы",
    (s) => s.breakdownGateEnabled,
    "test",
    "breakdownGateEnabled",
  ),
```

- [ ] **Шаг 4: убедиться, что тест проходит**

Команда: `npm test -- tests/workbook-settings.test.ts tests/routes.tests-workbook.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5: коммит**

```bash
git add server/utils/workbook-settings.ts tests/workbook-settings.test.ts
git commit -m "feat(prd-50): книга знает о гейте подтем"
```

---

## Задача 9. Предупреждения при публикации

**Файлы:**

- Изменить: `shared/breakdown/publish-warnings.ts`, `server/services/breakdown-warnings.ts:25-35`
- Тест: `shared/breakdown/publish-warnings.test.ts`

- [ ] **Шаг 1: переписать тесты предупреждений**

В `shared/breakdown/publish-warnings.test.ts` удалить случаи о недостижимом пороге ключа
(FR-46) и добавить:

```ts
  it("FR-56: гейт включён при скрытых подытогах — предупреждение", () => {
    const out = collectBreakdownWarnings({
      sections: [{ topicId: "s1", topicName: "Тема", questions: [{ id: "q1", tags: ["Право"] }] }],
      breakdownGateEnabled: true,
      breakdownVisible: false,
    });
    expect(out.map((w) => w.code)).toContain("gate_without_display");
  });

  it("FR-56: гейт включён и подытоги видны — молчание", () => {
    const out = collectBreakdownWarnings({
      sections: [{ topicId: "s1", topicName: "Тема", questions: [{ id: "q1", tags: ["Право"] }] }],
      breakdownGateEnabled: true,
      breakdownVisible: true,
    });
    expect(out.map((w) => w.code)).not.toContain("gate_without_display");
  });
```

- [ ] **Шаг 2: запустить и убедиться, что тесты падают**

Команда: `npm test -- shared/breakdown/publish-warnings.test.ts`
Ожидание: FAIL — кода `gate_without_display` нет.

- [ ] **Шаг 3: править движок предупреждений**

В `shared/breakdown/publish-warnings.ts` убрать импорт `resolveBreakdownRules`, поле `rules` из
входа раздела и ветку FR-46; добавить в тип кода `"gate_without_display"` и правило уровня
ТЕСТА:

```ts
  // FR-56: переключатель включён, а подытоги скрыты — участник получит «Не пройдена» без
  // единой видимой причины. Публикацию не блокирует: это предупреждение, как и остальные три.
  if (input.breakdownGateEnabled && !input.breakdownVisible) {
    out.push({
      code: "gate_without_display",
      topicId: null,
      topicName: null,
      message:
        "Подтемы учитываются в вердикте темы, но подытоги по подтемам скрыты — участник не увидит причину.",
    });
  }
```

В `server/services/breakdown-warnings.ts` заменить передачу `rules: s.breakdownRulesJson ?? null`
на передачу двух новых полей теста: `breakdownGateEnabled` и
`breakdownVisible: test.breakdownDisplayJson?.visibility !== "hidden"` (отсутствие настройки
считается «скрыто»).

- [ ] **Шаг 4: убедиться, что тесты проходят**

Команда: `npm test -- shared/breakdown/publish-warnings.test.ts tests/breakdown-gate.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5: коммит**

```bash
git add shared/breakdown/publish-warnings.ts shared/breakdown/publish-warnings.test.ts server/services/breakdown-warnings.ts
git commit -m "feat(prd-50): предупреждение о гейте при скрытых подытогах"
```

---

## Задача 10. Документация продукта

**Файлы:**

- Изменить: `docs/guides/test-authoring-guide.md` (раздел 7.3a), `docs/ROADMAP.md`,
  `README.md`, `CLAUDE.md`, `CHANGELOG.md`

- [ ] **Шаг 1: переписать раздел руководства автора**

В `docs/guides/test-authoring-guide.md` раздел 7.3a «Пороги по подтемам» переписать под §16:
индивидуальных порогов нет, порог подтемы — порог её темы, тема без порога не судит подтемы,
переключатель «Учитывать подтемы в вердикте темы» живёт в «Правилах прохождения» и выключен по
умолчанию, цвет строки объясняется надписью порога.

- [ ] **Шаг 2: обновить остальные документы**

`docs/ROADMAP.md` — запись о §16 в разделе PRD-50; `README.md` и `CLAUDE.md` — колонка
`tests.breakdown_gate_enabled` вместо `test_sections.breakdown_rules_json` в перечне колонок
миграций; `CHANGELOG.md` — раздел текущей версии.

- [ ] **Шаг 3: проверить разметку**

Команда: `npm run lint:md`
Ожидание: 0 issues.

- [ ] **Шаг 4: пересобрать PDF руководств**

Команда: `npm run docs:pdf`
Ожидание: собирается без ошибок.

- [ ] **Шаг 5: коммит**

```bash
git add docs README.md CLAUDE.md CHANGELOG.md
git commit -m "docs(prd-50): документация знает о производном пороге подтемы"
```

---

## Задача 11. Приёмка

**Файлы:**

- Создать: `docs/reports/prd50-subtopic-gate-acceptance.md`

- [ ] **Шаг 1: прогнать полный набор тестов**

ПЕРЕД запуском спросить владельца — полный прогон занимает около восьми минут и занимает машину.
Команда после разрешения: `npm test`
Ожидание: PASS целиком.

- [ ] **Шаг 2: подготовить тест для приёмки**

На dev-стенде: тест с темой (порог 70 %), в теме два тега; вопросы размечены так, чтобы один тег
дал 100 %, второй — 33 %. Показ подытогов включить («полоса и значение»), текст подтемы написать
для отстающего тега.

- [ ] **Шаг 3: пройти семь пунктов приёмки §16.1**

Отыграть в браузере пункты 1-7 списка `docs/specs/prd-50/result-breakdowns.md` §16.1: экран
итогов, PDF-отчёт, отладочный прогон, тема «Не проверять отдельно», порог в баллах, старая
попытка, отсутствие ручек порогов в редакторе. Снимки экрана и расхождения записать в
`docs/reports/prd50-subtopic-gate-acceptance.md`.

- [ ] **Шаг 4: коммит протокола**

```bash
git add docs/reports/prd50-subtopic-gate-acceptance.md
git commit -m "docs(prd-50): протокол приёмки гейта подтем"
```

---

## Задача 12. Адаптивный режим судит подтемы общим порогом

Добавлена 2026-09-05 по решению владельца. Волна A вскрыла регресс: отбор текстов подтем
переехал на исход записи, а адаптивная ветка исход не штампует — значит в адаптивном тесте
тексты подтем пропали бы вовсе. Правило §16: адаптив судит подтемы ОБЩИМ порогом теста, и
записи раздела, и сводные.

**Файлы:**

- Изменить: `shared/scoring/aggregate.ts` (`adaptiveResultAsStandard`, ~строки 591-640)
- Изменить: вызывающих — веб (`buildAdaptiveResult` в серверном слое) и пакет
  (`server/scorm/template/app/render/adaptiveRender.js`); найти их `Grep` по
  `adaptiveResultAsStandard`
- Тест: `tests/breakdown-adaptive.test.ts`

- [ ] **Шаг 1: написать падающий тест**

Дописать в `tests/breakdown-adaptive.test.ts`:

```ts
  it("PRD-50 §16: адаптив судит подтемы общим порогом теста", () => {
    const out = adaptiveResultAsStandard(adaptiveResult, items, { type: "percent", value: 70 });
    const low = out.breakdowns.find((e) => e.key === "Охрана труда");
    expect(low?.passed).toBe(false);
    expect(low?.thresholdPercent).toBe(70);
    expect(out.topicResults[0].breakdown.some((e) => e.passed === false)).toBe(true);
  });

  it("PRD-50 §16: без общего порога подтемы адаптива молчат", () => {
    const out = adaptiveResultAsStandard(adaptiveResult, items, { type: "none" });
    for (const e of out.breakdowns) expect(e.passed).toBeNull();
  });
```

(`adaptiveResult` и `items` — фикстуры этого файла; если имена другие, взять существующие.)

- [ ] **Шаг 2: запустить и убедиться, что тест падает**

Команда: `npm test -- tests/breakdown-adaptive.test.ts`
Ожидание: FAIL — третий аргумент не принимается, `passed` не проставлен.

- [ ] **Шаг 3: штамповать исход в адаптивной ветке**

В `shared/scoring/aggregate.ts` расширить сигнатуру и тело:

```ts
export function adaptiveResultAsStandard<E = unknown>(
  result: AdaptiveResult<E>,
  breakdownItems: readonly BreakdownItem[] = [],
  overallPassRule?: unknown,
): AdaptiveAsStandard {
```

и сразу после построения `bySection`:

```ts
  // PRD-50 §16: у ступени порога нет и быть не может, поэтому подтемы адаптива судит ОБЩИЙ
  // порог теста — и записи раздела, и сводные. Иначе тексты подтем, которые адаптивный экран
  // выдавал до §16, исчезли бы вместе с переездом отбора на исход записи. Балл адаптива —
  // один за вопрос, поэтому достижимое здесь равно числу выданных вопросов.
  const adaptiveThreshold = thresholdPercentOf(resolveOverallRule(overallPassRule), totalQuestions);
  applyBreakdownGate(entries, adaptiveThreshold);
```

(`entries` штампуется целиком: `bySection` держит те же объекты, поэтому записи разделов
получают исход тем же вызовом.)

- [ ] **Шаг 4: передать правило обоими хостами**

В найденных вызывающих добавить третий аргумент — сохранённое `tests.overall_pass_rule_json`
(в пакете — `TEST_DATA.overallPassRule`, там же, откуда его берёт стандартная ветка).

- [ ] **Шаг 5: убедиться, что тесты проходят**

Команда: `npm test -- tests/breakdown-adaptive.test.ts shared/breakdown shared/template/__tests__`
Ожидание: PASS.

- [ ] **Шаг 6: коммит**

```bash
git add shared/scoring/aggregate.ts tests/breakdown-adaptive.test.ts server
git commit -m "feat(prd-50): адаптив судит подтемы общим порогом теста"
```

---

## Задача 13. Индикация проблем: рейл и предупреждения — ПЕРЕДАНА

**НЕ ДЕЛАТЬ В ЭТОМ ТРЕКЕ.** 2026-09-05 общая механика индикации целиком отошла треку «ящик
редактора по эскизу» (соседняя сессия): точка на пункте рейла, участие предупреждений в обоих
индикаторах, сводные баннеры и переход с фокусом — там. Иначе два трека правили бы одни и те же
файлы (`test-editor.tsx`, `editor-tabs.tsx`, `basic-settings-section.tsx`,
`test-editor.validation.ts`, `tb-components.css`) — ровно то, что уже стоило расцепления веток.

Здесь остаётся ОДИН пункт: нехватка вопросов под квоту перестаёт быть локальным баннером
карточки и подаётся как ПРЕДУПРЕЖДЕНИЕ (знак у значения строки — задача 7); подхватить его в
общую индикацию — работа принимающего трека, после вливания этой ветки.

Описание ниже сохранено как передаточная записка.

Добавлена 2026-09-05 по правилу владельца, записанному в
`docs/architecture/test-editor-contracts.md`, раздел «Индикация проблем». Для ОШИБОК механика
уже есть: точка на вкладке (`StatusBadge`, `status-dot`), сводный баннер и переход с фокусом
(`goToError`). Недостаёт двух вещей, и обе — предмет этой задачи.

**Файлы:**

- Изменить: `client/src/features/tests/editor/test-editor.tsx` (сбор статусов вкладок, баннер),
  `sections/basic-settings-section.tsx` и `sections/editor-tabs.tsx` (рейлы подразделов),
  `test-editor.validation.ts` (предупреждения как отдельный уровень)
- Изменить: `client/src/styles/tb-components.css` (точка в пункте рейла)
- Тест: `client/src/features/tests/editor/__tests__/test-editor.test.tsx`

- [ ] **Шаг 1: точка на пункте рейла**

Пункт рейла получает ту же точку, что вкладка: `<span class="status-dot warn" aria-label="есть
предупреждения" />` внутри `.ou-drawer__rail-item`, тон по худшему уровню внутри подраздела.
Разметка — как в эскизе `docs/wireframes/prd50-subtopic-gate.html`, состояние «2 · Квоты без
порогов».

- [ ] **Шаг 2: предупреждения в общей механике**

Нехватка вопросов под квоту (`anyShortfall` в `topics-structure-section.tsx`) перестаёт быть
локальным баннером карточки и становится ПРЕДУПРЕЖДЕНИЕМ валидации: попадает в статус вкладки
«Состав и сценарий», в статус подраздела «Состав» и в сводный баннер вверху формы с действием
«Перейти к предупреждениям» (тот же `goToError`, якорь `data-field` на строке квоты).

Баннеры уровней НЕ сливаются (правило владельца 2026-09-05): когда в форме есть и ошибки, и
предупреждения, вверху стоят ДВА баннера, ошибки выше, у каждого своё действие перехода.
Нынешний баннер ошибок остаётся как есть, баннер предупреждений добавляется рядом.

- [ ] **Шаг 3: убрать баннер из карточки квот**

Локальный баннер внутри `.tb-quota-block` снимается: сводный текст теперь вверху формы, а в
карточке говорит знак у значения строки (задача 7).

- [ ] **Шаг 4: тесты**

Проверить: точка на вкладке и на рейле при нехватке; баннер печатает число предупреждений;
действие баннера переключает вкладку и ставит фокус на строку квоты; чистый тест не показывает
ни точек, ни баннера.

Команда: `npm test -- client/src/features/tests/editor`

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/tests/editor client/src/styles/tb-components.css
git commit -m "feat(editor): предупреждения видны на вкладке, в рейле и в баннере формы"
```

---

## Самопроверка плана

Покрытие спеки: FR-52 — задачи 1, 2; FR-53 — задачи 2, 6, 7, 8; FR-54 — задачи 1, 4, 5;
FR-55 — задача 3; FR-56 — задачи 6, 7, 9; FR-57 — задачи 1, 2, 6 (умолчания и отсутствие полей).
Приёмка §16.1 — задача 11.

Имена, использованные сквозь план: `thresholdPercentOf`, `applyBreakdownGate`,
`BreakdownEntry.passed`, `BreakdownEntry.thresholdPercent`, `AggregateInput.breakdownGateEnabled`,
`tests.breakdown_gate_enabled`, `CtxBreakdownRow.passClass`, `CtxBreakdownRow.requiredLabel`,
код предупреждения `gate_without_display`.
