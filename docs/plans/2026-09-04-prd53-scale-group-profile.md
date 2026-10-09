# PRD-53 «Профиль по группе шкал» — план реализации

> **Исполнителю-агенту:** ОБЯЗАТЕЛЬНЫЙ ПОДНАВЫК — `superpowers:subagent-driven-development`
> (рекомендуется) либо `superpowers:executing-plans`. Шаги размечены чекбоксами (`- [ ]`).

**Цель:** научить продукт толковать результат по НАБОРУ ведущих шкал — новым источником формулы
`topGroup`, исходами с кодом-набором и генератором матрицы в редакторе, — чтобы типологический
опросник собирался автором без скриптов.

**Архитектура:** правило верхней зоны и код набора живут в чистом ядре `shared/formula/scale-group.ts`;
парсер, вычислитель и валидатор получают узел `scaleGroup`; толкование опирается на существующий
механизм исходов, где `findOutcome` учится сравнивать наборы и падать на запасной `count:<N>`.
Схема БД не меняется. Плоский двойник рантайма `formula.js` повторяет ядро, паритет держит золотой
корпус.

**Стек:** TypeScript, Vitest, React 19 + `@skillum/ui-kit`, Drizzle/PostgreSQL, ExcelJS.

**Спека:** [docs/specs/prd-53/scale-group-profile.md](../specs/prd-53/scale-group-profile.md).

---

## Что нужно знать перед началом

- Тесты гоняются ТОЛЬКО через `npm test -- <путь>`. `npx vitest run` в этом репозитории падает.
- Полный прогон `npm test` занимает ~8 минут и запускается только по явному разрешению владельца.
  В работе — точечные прогоны.
- `npm run check` — проверка типов. Кэш `tsbuildinfo` общий у worktree, поэтому зелёный результат
  после чужой сборки бывает ложным: при сомнении удалить `*.tsbuildinfo` и перепроверить.
- Трейлер `Co-Authored-By` в коммиты НЕ добавляется.
- Комментарии и JSDoc — по-английски; текст, который видит автор или ученик, — по-русски.
- DSL продублирован: авторитетная реализация в `shared/formula/`, плоский двойник для SCORM-пакета в
  `server/scorm/template/app/dsl/formula.js`. Расхождение проявится только на стенде LMS.

## Карта файлов

| Файл | Ответственность | Задача |
| --- | --- | --- |
| `shared/formula/scale-group.ts` (новый) | Порог, верхняя зона, канонический код, перечень подмножеств | 1 |
| `shared/formula/types.ts` | Узел `scaleGroup`, список свойств | 2 |
| `shared/formula/parser.ts` | Разбор `topGroup(...)` | 2 |
| `shared/formula/evaluator.ts` | Вычисление узла | 3 |
| `shared/formula/validate.ts` | Вывод типа и проверки | 4 |
| `shared/formula/outcome-literals.ts` | Ветка узла в обходе AST | 4 |
| `shared/scales/interpretation.ts` | Сопоставление исхода по набору и запасной `count:<N>` | 5 |
| `shared/template/result-context.ts` | Единое сопоставление исхода, отсев измерений без значения, карточка «вне профиля» | 6, 7 |
| `shared/template/context.ts` | Поля `description` и `restScales` у измерения | 7 |
| `server/services/result-context.ts` | Заполнение новых полей на веб-хосте | 7 |
| `server/scorm/template/app/render/viewResults.js` | То же в пакете | 7 |
| `server/scorm/builders/test-json.ts` | Запекание `description` и `restScales` в пакет | 7 |
| `server/scorm/template/app/dsl/formula.js` | Двойник узла `scaleGroup` | 8 |
| `tests/fixtures/formula-cases.json` | Золотой корпус паритета | 8 |
| `client/src/features/tests/editor/result-variables-builder.ts` | Пятый шаблон конструктора | 9 |
| `client/src/features/tests/editor/sections/result-variables-section.tsx` | Форма шаблона, подсказки кодов | 9, 10 |
| `server/utils/workbook-sheets.ts` | Колонка «Рекомендации» на листе исходов: разбор, сборка, слияние | 11 |
| `server/services/workbook-template.ts` | Справка по новой колонке | 11 |
| `scripts/db/prd53-chil-to-profile.ts` (новый) | Перевод опросника ЧИЛ | 12 |

---

## Задача 1. Ядро: порог, верхняя зона, код набора

**Файлы:**

- Создать: `shared/formula/scale-group.ts`
- Тест: `shared/formula/__tests__/scale-group.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { groupCode, parseGroupThreshold, resolveTopGroup, subsetCodes } from "../scale-group";
import type { ScaleResult } from "../types";

const ORDER = ["cel", "vdo", "kom", "pro"];

function scales(raw: Record<string, number | null>): Record<string, ScaleResult> {
  return Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      {
        raw: value ?? 0,
        normalized: value ?? 0,
        percent: 0,
        level: "",
        label: "",
        hasValue: value !== null,
      },
    ]),
  );
}

describe("parseGroupThreshold", () => {
  it("читает абсолютный порог числом", () => {
    expect(parseGroupThreshold(5)).toEqual({ kind: "abs", value: 5 });
  });

  it("читает долю строкой «N%»", () => {
    expect(parseGroupThreshold("10%")).toEqual({ kind: "pct", value: 10 });
  });

  it("отвергает отрицательный порог и мусор", () => {
    expect(parseGroupThreshold(-1)).toBeNull();
    expect(parseGroupThreshold("десять")).toBeNull();
    expect(parseGroupThreshold("10")).toBeNull();
  });
});

describe("resolveTopGroup", () => {
  const values = scales({ cel: 42, vdo: 7, kom: 7, pro: 42 });

  it("контрольный случай книги ЧИЛ: 42/7/7/42 при Δ=5 даёт cel+pro", () => {
    expect(resolveTopGroup(ORDER, values, ORDER, { kind: "abs", value: 5 })).toEqual({
      code: "cel+pro",
      count: 2,
      max: 42,
    });
  });

  it("граница включается: отставание ровно на Δ — в зоне, на Δ+1 — нет", () => {
    const v = scales({ cel: 30, vdo: 25, kom: 24, pro: 19 });
    expect(resolveTopGroup(ORDER, v, ORDER, { kind: "abs", value: 5 }).code).toBe("cel+vdo");
  });

  it("код набора всегда в авторском порядке, а не в порядке аргумента", () => {
    const got = resolveTopGroup(["pro", "kom", "vdo", "cel"], values, ORDER, { kind: "abs", value: 5 });
    expect(got.code).toBe("cel+pro");
  });

  it("шкала без значения не участвует ни в максимуме, ни в наборе", () => {
    const v = scales({ cel: 10, vdo: null, kom: 8, pro: 1 });
    expect(resolveTopGroup(ORDER, v, ORDER, { kind: "abs", value: 5 })).toEqual({
      code: "cel+kom",
      count: 2,
      max: 10,
    });
  });

  it("пустая группа не выдумывает набор", () => {
    expect(resolveTopGroup(["vdo"], scales({ vdo: null }), ORDER, { kind: "abs", value: 5 })).toEqual({
      code: "",
      count: 0,
      max: 0,
    });
  });

  it("долевой порог считается от максимума по группе", () => {
    // max = 42, 10% = 4.2 → порог 37.8: cel и pro внутри, vdo и kom нет.
    expect(resolveTopGroup(ORDER, values, ORDER, { kind: "pct", value: 10 }).code).toBe("cel+pro");
  });

  it("ключ, повторённый в группе, не занимает два места", () => {
    expect(resolveTopGroup(["cel", "cel", "pro"], values, ORDER, { kind: "abs", value: 5 }).count).toBe(2);
  });
});

describe("groupCode / subsetCodes", () => {
  it("канонизирует произвольный порядок ключей", () => {
    expect(groupCode(["pro", "cel"], ORDER)).toBe("cel+pro");
  });

  it("перечисляет все непустые подмножества по возрастанию размера", () => {
    const codes = subsetCodes(["cel", "vdo"], ORDER);
    expect(codes).toEqual(["cel", "vdo", "cel+vdo"]);
  });

  it("для четырёх шкал даёт ровно пятнадцать наборов", () => {
    expect(subsetCodes(ORDER, ORDER)).toHaveLength(15);
  });

  it("отказывается перечислять слишком большую группу", () => {
    const many = Array.from({ length: 13 }, (_, i) => `s${i}`);
    expect(subsetCodes(many, many)).toEqual([]);
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/formula/__tests__/scale-group.test.ts`
Ожидание: FAIL, `Failed to resolve import "../scale-group"`.

- [ ] **Шаг 3: написать реализацию**

Создать `shared/formula/scale-group.ts`:

```ts
/**
 * @module shared/formula/scale-group
 *
 * Верхняя зона группы шкал (PRD-53 §4.1) — арифметика источника `topGroup(...)`.
 *
 * Типологическая методика толкует результат не по одной шкале, а по НАБОРУ шкал, отставших от
 * максимума не более чем на порог. Три решения, которые этот модуль фиксирует:
 *
 *  1. **Сравнение по НОРМАЛИЗОВАННОМУ значению**, как и ранжирование в `scale-rank`: сырые значения
 *     шкал с разными доменами несопоставимы, а `direction: inverse` уже применён к нормализованному.
 *  2. **Граница включается**: отставание ровно на порог — ещё верхняя зона. Иначе методика,
 *     объявившая «разница ≤ 5», на разнице 5 давала бы другой профиль.
 *  3. **Код набора канонический** — ключи в АВТОРСКОМ порядке шкал теста. Одна и та же зона обязана
 *     давать одну строку в вебе, в пакете и при пересчёте из снимка.
 *
 * Чистый модуль — ни DOM, ни Node; плоский двойник живёт в
 * `server/scorm/template/app/dsl/formula.js`.
 */

import type { ScaleResult } from "./types";

/** Порог верхней зоны: абсолютный либо доля от максимума по группе. */
export interface GroupThreshold {
  kind: "abs" | "pct";
  value: number;
}

/** Что источник отдаёт формуле. */
export interface TopGroupResult {
  /** Канонический код набора; `""` у пустой группы. */
  code: string;
  /** Сколько шкал в верхней зоне; `0` у пустой группы. */
  count: number;
  /** Максимум по группе; `0` у пустой группы. */
  max: number;
}

const PERCENT = /^(\d+(?:\.\d+)?)%$/;

/**
 * Столько шкал в группе ещё можно перечислить подмножествами. 2^12−1 = 4095 строк — уже за
 * пределами осмысленного, но конечно; выше начинается зависание редактора, а не помощь автору.
 */
export const MAX_GROUP_FOR_SUBSETS = 12;

/**
 * Порог из аргумента формулы. `null` — аргумент не порог; вычислитель тогда отдаёт `null`, как и на
 * всяком другом неопределённом значении, и попытка не ломается.
 *
 * Строка принимается ТОЛЬКО в виде «N%»: голая строка «10» означала бы, что автор ошибся кавычками,
 * и молча превратить её в абсолютный порог значило бы скрыть опечатку.
 */
export function parseGroupThreshold(raw: number | string): GroupThreshold | null {
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 0 ? { kind: "abs", value: raw } : null;
  }
  const match = PERCENT.exec(String(raw).trim());
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? { kind: "pct", value } : null;
}

/** Ключи в авторском порядке шкал теста; неизвестный ключ уходит в конец. */
function inAuthorOrder(keys: readonly string[], authorOrder: readonly string[]): string[] {
  const index = new Map(authorOrder.map((key, i) => [key, i]));
  return [...keys].sort(
    (a, b) => (index.get(a) ?? Number.MAX_SAFE_INTEGER) - (index.get(b) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Канонический код набора: ключи в авторском порядке через «+». */
export function groupCode(keys: readonly string[], authorOrder: readonly string[]): string {
  return inAuthorOrder(keys, authorOrder).join("+");
}

/**
 * Верхняя зона группы.
 *
 * Шкала без значения выброшена ДО подсчёта максимума — по той же причине, по которой её выбрасывает
 * `rankScales`: неотвеченная шкала не имеет места в сравнении, а её ноль занял бы низ впереди
 * действительно измеренных. Ключ, повторённый в группе, места не удваивает.
 */
export function resolveTopGroup(
  keys: readonly string[],
  values: Record<string, ScaleResult>,
  authorOrder: readonly string[],
  threshold: GroupThreshold,
): TopGroupResult {
  const present = keys
    .filter((key, i, all) => all.indexOf(key) === i)
    .filter((key) => values[key]?.hasValue === true);
  if (present.length === 0) return { code: "", count: 0, max: 0 };

  const max = present.reduce((acc, key) => Math.max(acc, values[key].normalized), -Infinity);
  // Доля берётся от МОДУЛЯ максимума: у шкалы с отрицательными значениями иначе получился бы
  // отрицательный порог, то есть зона шире всей группы.
  const delta = threshold.kind === "abs" ? threshold.value : (Math.abs(max) * threshold.value) / 100;
  const top = present.filter((key) => values[key].normalized >= max - delta);

  return { code: groupCode(top, authorOrder), count: top.length, max };
}

/**
 * Все непустые подмножества группы, по возрастанию размера, — заготовки исходов для генератора
 * матрицы. Слишком большая группа даёт пустой список: перечислять её бессмысленно, а редактор
 * предупреждает об этом отдельно.
 */
export function subsetCodes(keys: readonly string[], authorOrder: readonly string[]): string[] {
  const ordered = inAuthorOrder([...new Set(keys)], authorOrder);
  if (ordered.length === 0 || ordered.length > MAX_GROUP_FOR_SUBSETS) return [];

  const bySize: string[][] = Array.from({ length: ordered.length + 1 }, () => []);
  for (let mask = 1; mask < 1 << ordered.length; mask++) {
    const subset = ordered.filter((_, i) => (mask >> i) & 1);
    bySize[subset.length].push(subset.join("+"));
  }
  return bySize.flat();
}
```

- [ ] **Шаг 4: прогнать тест и убедиться, что он проходит**

Команда: `npm test -- shared/formula/__tests__/scale-group.test.ts`
Ожидание: PASS, 14 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add shared/formula/scale-group.ts shared/formula/__tests__/scale-group.test.ts
git commit -m "feat(formula): ядро верхней зоны группы шкал (PRD-53)"
```

---

## Задача 2. Разбор `topGroup(...)`

**Файлы:**

- Изменить: `shared/formula/types.ts`
- Изменить: `shared/formula/parser.ts`
- Тест: `shared/formula/__tests__/scale-group-parse.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { parse } from "../parser";
import { FormulaSyntaxError } from "../types";

describe("разбор topGroup", () => {
  it("читает список ключей, числовой порог и свойство", () => {
    expect(parse('topGroup(["cel","pro"], 5).code')).toEqual({
      type: "scaleGroup",
      keys: ["cel", "pro"],
      threshold: 5,
      prop: "code",
    });
  });

  it("читает долевой порог строкой", () => {
    expect(parse('topGroup(["cel","pro"], "10%").count')).toEqual({
      type: "scaleGroup",
      keys: ["cel", "pro"],
      threshold: "10%",
      prop: "count",
    });
  });

  it("знает свойство max", () => {
    expect(parse('topGroup(["cel","pro"], 5).max').type).toBe("scaleGroup");
  });

  it("отвергает неизвестное свойство", () => {
    expect(() => parse('topGroup(["cel"], 5).label')).toThrow(FormulaSyntaxError);
  });

  it("отвергает порог, который не число и не строка", () => {
    expect(() => parse('topGroup(["cel"], percent).code')).toThrow(FormulaSyntaxError);
  });

  it("работает внутри выражения", () => {
    const ast = parse('IF(topGroup(["cel","pro"], 5).count > 1, "набор", "один")');
    expect(ast.type).toBe("if");
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/formula/__tests__/scale-group-parse.test.ts`
Ожидание: FAIL, «Неизвестный источник «topGroup»».

- [ ] **Шаг 3: добавить узел в типы**

В `shared/formula/types.ts` после объявления `ScaleRankFn` добавить:

```ts
/** `topGroup(["k1","k2"], порог).prop` — верхняя зона группы шкал (PRD-53 §4.2). */
export type ScaleGroupFn = "topGroup";

/**
 * Свойства верхней зоны. Названий шкал среди них НЕТ и быть не может: контекст вычислителя несёт
 * {@link ScaleResult}, у которого `label` — подпись УРОВНЯ, а не имя шкалы. Имя нужно метке исхода,
 * а её составляет редактор, где имена под рукой.
 */
export const SCALE_GROUP_PROPS: readonly string[] = ["code", "count", "max"];
```

В объединении `Ast` добавить вариант после `scaleRank`:

```ts
  | { type: "scaleGroup"; keys: string[]; threshold: number | string; prop: string }
```

- [ ] **Шаг 4: добавить разбор в парсер**

В `shared/formula/parser.ts` расширить импорт из `./types`:

```ts
import {
  type Ast,
  type AccessorFn,
  type CountFn,
  type NullaryFn,
  type ScaleRankFn,
  ACCESSOR_PROPS,
  SCALE_RANK_PROPS,
  SCALE_GROUP_PROPS,
  FormulaSyntaxError,
} from "./types";
```

В `parseIdent`, сразу ПОСЛЕ блока `SCALE_RANK_FNS` и ПЕРЕД блоком `COUNT_FNS`, вставить:

```ts
    // `topGroup(["k1","k2"], 5).code` — форма повторяет `topScale`, но второй аргумент это ПОРОГ,
    // а не место, и он принимает строку «N%»: доля нужна, когда шкалы группы имеют разные домены
    // или домена не имеют вовсе.
    if (name === "topGroup") {
      this.next();
      this.expectPunct("(");
      const keys = this.parseKeyList();
      this.expectPunct(",");
      const thresholdTok = this.next();
      if (thresholdTok.type !== "number" && thresholdTok.type !== "string") {
        throw new FormulaSyntaxError(
          "Порог верхней зоны — число или строка вида «10%»",
          thresholdTok.pos,
        );
      }
      const threshold =
        thresholdTok.type === "number" ? Number(thresholdTok.value) : thresholdTok.value;
      this.expectPunct(")");
      this.expectPunct(".");
      const groupProp = this.next();
      if (groupProp.type !== "ident") throw new FormulaSyntaxError("Ожидалось свойство", groupProp.pos);
      if (!SCALE_GROUP_PROPS.includes(groupProp.value)) {
        throw new FormulaSyntaxError(`У «topGroup» нет свойства «${groupProp.value}»`, groupProp.pos);
      }
      return { type: "scaleGroup", keys, threshold, prop: groupProp.value };
    }
```

- [ ] **Шаг 5: прогнать тест и убедиться, что он проходит**

Команда: `npm test -- shared/formula/__tests__/scale-group-parse.test.ts`
Ожидание: PASS, 6 тестов.

- [ ] **Шаг 6: коммит**

```bash
git add shared/formula/types.ts shared/formula/parser.ts shared/formula/__tests__/scale-group-parse.test.ts
git commit -m "feat(formula): источник topGroup в парсере (PRD-53)"
```

---

## Задача 3. Вычисление узла

**Файлы:**

- Изменить: `shared/formula/evaluator.ts`
- Тест: `shared/formula/__tests__/scale-group-eval.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { evaluate } from "../evaluator";
import { parse } from "../parser";
import type { EvalContext, ScaleResult } from "../types";

function ctx(raw: Record<string, number | null>): EvalContext {
  const scales: Record<string, ScaleResult> = Object.fromEntries(
    Object.entries(raw).map(([key, value]) => [
      key,
      { raw: value ?? 0, normalized: value ?? 0, percent: 0, level: "", label: "", hasValue: value !== null },
    ]),
  );
  return {
    percent: 0,
    score: 0,
    topics: {},
    tags: {},
    scales,
    scaleOrder: Object.keys(scales),
    sections: {},
    vars: {},
  };
}

const run = (formula: string, raw: Record<string, number | null>) => evaluate(parse(formula), ctx(raw));
const CHIL = { cel: 42, vdo: 7, kom: 7, pro: 42 };

describe("вычисление topGroup", () => {
  it("отдаёт код набора", () => {
    expect(run('topGroup(["cel","vdo","kom","pro"], 5).code', CHIL)).toBe("cel+pro");
  });

  it("отдаёт размер набора и максимум", () => {
    expect(run('topGroup(["cel","vdo","kom","pro"], 5).count', CHIL)).toBe(2);
    expect(run('topGroup(["cel","vdo","kom","pro"], 5).max', CHIL)).toBe(42);
  });

  it("пустой группе отдаёт пустой код и нули, а не null", () => {
    expect(run('topGroup(["vdo"], 5).code', { vdo: null })).toBe("");
    expect(run('topGroup(["vdo"], 5).count', { vdo: null })).toBe(0);
  });

  it("непонятный порог даёт null и не бросает исключение", () => {
    expect(run('topGroup(["cel","pro"], "десять").code', CHIL)).toBeNull();
  });

  it("сравнивается со строкой в IF", () => {
    const formula = 'IF(topGroup(["cel","vdo","kom","pro"], 5).code = "cel+pro", "да", "нет")';
    expect(run(formula, CHIL)).toBe("да");
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/formula/__tests__/scale-group-eval.test.ts`
Ожидание: FAIL — вычислитель возвращает `undefined` для неизвестного узла.

- [ ] **Шаг 3: написать реализацию**

В `shared/formula/evaluator.ts` добавить импорт:

```ts
import { parseGroupThreshold, resolveTopGroup } from "./scale-group";
```

И ветку сразу после `case "scaleRank"`:

```ts
    case "scaleGroup": {
      // Тот же порядок-разрешитель, что у `scaleRank`: авторский порядок шкал теста, а при его
      // отсутствии — порядок ключей пространства имён, который `computeScales` наполняет по
      // `sort_order`.
      const order = ctx.scaleOrder ?? Object.keys(ctx.scales);
      const threshold = parseGroupThreshold(node.threshold);
      // Непонятный порог — неопределённое значение, а не исключение: ошибка формулы не должна
      // ломать завершение попытки.
      if (!threshold) return null;
      const group = resolveTopGroup(node.keys, ctx.scales, order, threshold);
      const value = (group as unknown as Record<string, FormulaValue>)[node.prop];
      // `??`, а не `||`: пустой код и нулевой размер — законные значения пустой группы.
      return value ?? null;
    }
```

- [ ] **Шаг 4: прогнать тест и убедиться, что он проходит**

Команда: `npm test -- shared/formula/__tests__/scale-group-eval.test.ts`
Ожидание: PASS, 5 тестов.

- [ ] **Шаг 5: коммит**

```bash
git add shared/formula/evaluator.ts shared/formula/__tests__/scale-group-eval.test.ts
git commit -m "feat(formula): вычисление topGroup (PRD-53)"
```

---

## Задача 4. Валидация и обход AST

**Файлы:**

- Изменить: `shared/formula/validate.ts`
- Изменить: `shared/formula/outcome-literals.ts`
- Тест: `shared/formula/__tests__/scale-group-validate.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { validate } from "../validate";
import { collectStringLiterals } from "../outcome-literals";

const REFS = { scaleKeys: new Set(["cel", "vdo", "kom", "pro"]) };

describe("валидация topGroup", () => {
  it("code — строка, count и max — числа", () => {
    expect(validate('topGroup(["cel","pro"], 5).code', "string", REFS).returnType).toBe("string");
    expect(validate('topGroup(["cel","pro"], 5).count', "number", REFS).returnType).toBe("number");
    expect(validate('topGroup(["cel","pro"], 5).max', "number", REFS).returnType).toBe("number");
  });

  it("требует хотя бы две шкалы в группе", () => {
    const result = validate('topGroup(["cel"], 5).code', "string", REFS);
    expect(result.valid).toBe(false);
    expect(result.errors.map((e) => e.code)).toContain("scale-group-small");
  });

  it("ловит неизвестную шкалу", () => {
    const result = validate('topGroup(["cel","нет"], 5).code', "string", REFS);
    expect(result.errors.map((e) => e.code)).toContain("unknown-scale");
  });

  it("ловит неверный порог", () => {
    const result = validate('topGroup(["cel","pro"], "десять").code', "string", REFS);
    expect(result.errors.map((e) => e.code)).toContain("scale-group-threshold");
  });

  it("подсказывает, что коды исходов — наборы ключей", () => {
    const result = validate('topGroup(["cel","pro"], 5).code', "string", REFS);
    expect(result.valid).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("scale-group-code");
  });

  it("предупреждает о разной нормализации шкал группы при абсолютном пороге", () => {
    const refs = {
      ...REFS,
      scaleNormalizations: { cel: "none", pro: "percent", vdo: "none", kom: "none" },
    };
    const result = validate('topGroup(["cel","pro"], 5).code', "string", refs);
    expect(result.warnings.map((w) => w.code)).toContain("scale-group-normalization");
  });

  it("не предупреждает о нормализации при долевом пороге", () => {
    const refs = {
      ...REFS,
      scaleNormalizations: { cel: "none", pro: "percent", vdo: "none", kom: "none" },
    };
    const result = validate('topGroup(["cel","pro"], "10%").code', "string", refs);
    expect(result.warnings.map((w) => w.code)).not.toContain("scale-group-normalization");
  });

  it("ключи группы и порог-строка не считаются кодами исходов", () => {
    expect(collectStringLiterals('topGroup(["cel","pro"], "10%").code')).toEqual([]);
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/formula/__tests__/scale-group-validate.test.ts`
Ожидание: FAIL — `returnType` выходит `unknown`, проверок нет.

- [ ] **Шаг 3: расширить вывод типа и проверки**

В `shared/formula/types.ts` дополнить `ValidationRefs`:

```ts
  /**
   * PRD-53: режим нормализации каждой шкалы теста. Нужен ровно одной проверке — АБСОЛЮТНЫЙ порог
   * верхней зоны на группе, где шкалы нормализованы по-разному, сравнивает несопоставимые
   * величины. Отсутствие карты отключает проверку, как и у прочих наборов ссылок.
   */
  scaleNormalizations?: Record<string, string>;
```

В `shared/formula/validate.ts` добавить импорт:

```ts
import { parseGroupThreshold } from "./scale-group";
```

В `inferType` добавить ветку после `case "scaleRank"`:

```ts
    case "scaleGroup":
      // `code` — строка-набор, `count`/`max` — числа. Тот же раскол, что у ранга.
      return node.prop === "code" ? "string" : "number";
```

В `walk`-обходчике `validate`, после блока `if (n.type === "scaleRank")`, вставить:

```ts
    if (n.type === "scaleGroup") {
      if (n.keys.length < 2) {
        errors.push({
          code: "scale-group-small",
          message: "В группе профиля нужны хотя бы две шкалы",
        });
      }
      if (parseGroupThreshold(n.threshold) === null) {
        errors.push({
          code: "scale-group-threshold",
          message: "Порог верхней зоны — неотрицательное число или строка вида «10%»",
        });
      }
      if (refs.scaleKeys && refs.scaleKeys.size > 0) {
        for (const key of n.keys) {
          if (!refs.scaleKeys.has(key)) {
            errors.push({ code: "unknown-scale", message: `Неизвестная шкала «${key}»` });
          }
        }
      }
      // Абсолютный порог на группе с разной нормализацией сравнивает несопоставимые величины:
      // у одной шкалы «5» это пять баллов, у другой — пять процентов. Долевой порог от этого
      // свободен, поэтому предупреждение только для абсолютного.
      const threshold = parseGroupThreshold(n.threshold);
      if (threshold?.kind === "abs" && refs.scaleNormalizations) {
        const modes = new Set(
          n.keys.map((key) => refs.scaleNormalizations?.[key]).filter((m): m is string => !!m),
        );
        if (modes.size > 1) {
          warnings.push({
            code: "scale-group-normalization",
            message:
              "Шкалы группы нормализованы по-разному: порог в баллах сравнивает несопоставимые" +
              " величины. Задайте порог долей от максимума",
          });
        }
      }
      if (n.prop === "code") {
        // Проверить, что коды исходов покрывают все наборы, здесь нельзя: коды приходят из
        // ДАННЫХ показателя, а не из формулы. Отсюда подсказка, а не ошибка — как у `topScale`.
        warnings.push({
          code: "scale-group-code",
          message: "Коды исходов должны быть наборами ключей шкал через «+»",
        });
      }
    }
```

Затем найти вызывающий код, собирающий `ValidationRefs` для показателей теста
(`grep -rn "scaleBandLevels" server client shared --include=*.ts`), и рядом с заполнением
`scaleBandLevels` добавить `scaleNormalizations` из тех же шкал.

- [ ] **Шаг 4: закрыть обход в outcome-literals**

В `shared/formula/outcome-literals.ts` добавить `scaleGroup` в список безмолвных узлов:

```ts
    case "number":
    case "boolean":
    case "percent":
    case "score":
    case "accessor":
    case "var":
    case "nullary":
    case "count":
    case "scaleRank":
    case "scaleGroup":
      // Строки внутри этих узлов — ключи сущностей и порог, а не коды исходов: они лежат в
      // ПОЛЯХ узла, а не отдельными строковыми узлами, и в выдачу попасть не могут.
      return;
```

- [ ] **Шаг 5: прогнать тест и убедиться, что он проходит**

Команда: `npm test -- shared/formula/__tests__/scale-group-validate.test.ts`
Ожидание: PASS, 8 тестов.

- [ ] **Шаг 6: убедиться, что прежние тесты формул целы**

Команда: `npm test -- shared/formula`
Ожидание: PASS, падений нет.

- [ ] **Шаг 7: коммит**

```bash
git add shared/formula/validate.ts shared/formula/outcome-literals.ts shared/formula/__tests__/scale-group-validate.test.ts
git commit -m "feat(formula): валидация и обход узла topGroup (PRD-53)"
```

---

## Задача 5. Сопоставление исхода по набору и запасной `count:<N>`

**Файлы:**

- Изменить: `shared/scales/interpretation.ts`
- Тест: `shared/scales/__tests__/outcome-set-match.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { findOutcome, type InterpretationOutcome } from "../interpretation";

const outcomes: InterpretationOutcome[] = [
  { code: "cel", label: "Сфокусированный: Целеустремленный" },
  { code: "cel+pro", label: "Двухвекторный: Целеустремленный и Процессный" },
  { code: "count:3", label: "Широкий профиль" },
];

describe("findOutcome и наборы", () => {
  it("находит по точному коду", () => {
    expect(findOutcome(outcomes, "cel+pro")?.label).toContain("Двухвекторный");
  });

  it("находит независимо от порядка ключей в наборе", () => {
    expect(findOutcome(outcomes, "pro+cel")?.code).toBe("cel+pro");
  });

  it("падает на запасной исход по размеру набора", () => {
    expect(findOutcome(outcomes, "cel+vdo+kom")?.code).toBe("count:3");
  });

  it("точный код важнее запасного", () => {
    const withBoth = [...outcomes, { code: "count:2", label: "Любой двухвекторный" }];
    expect(findOutcome(withBoth, "cel+pro")?.code).toBe("cel+pro");
  });

  it("одиночный код по-прежнему сравнивается точно", () => {
    expect(findOutcome(outcomes, "cel")?.code).toBe("cel");
    expect(findOutcome(outcomes, "vdo")).toBeNull();
  });

  it("пустое и отсутствующее значение исхода не находят", () => {
    expect(findOutcome(outcomes, "")).toBeNull();
    expect(findOutcome(outcomes, null)).toBeNull();
    expect(findOutcome(outcomes, undefined)).toBeNull();
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/scales/__tests__/outcome-set-match.test.ts`
Ожидание: FAIL на «независимо от порядка» и «запасной исход».

- [ ] **Шаг 3: написать реализацию**

В `shared/scales/interpretation.ts` заменить `findOutcome` на:

```ts
/**
 * Ключ сопоставления кода: набор ключей, приведённый к порядко-независимому виду.
 *
 * Сортировка здесь АЛФАВИТНАЯ, а не авторская, и это намеренно: модулю толкования порядок шкал
 * теста неизвестен, а для сравнения важно лишь, чтобы обе стороны нормализовались одинаково.
 * Отображаемый код при этом остаётся авторским — его строит `shared/formula/scale-group`.
 *
 * Код без «+» нормализуется сам в себя, поэтому правило безопасно для показателей, к профилям
 * отношения не имеющих: сравнение вырождается в прежнее точное равенство.
 */
function outcomeMatchKey(code: string): string {
  if (!code.includes("+")) return code;
  return code
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean)
    .sort()
    .join("+");
}

/**
 * The outcome a string/boolean value maps to.
 *
 * Три шага, в порядке убывания точности (PRD-53 §4.3): точное равенство кода, равенство НАБОРОВ
 * (порядок ключей не важен) и запасной исход `count:<N>` по размеру набора. Последний существует
 * потому, что число сочетаний растёт как 2ⁿ−1: при шести шкалах их 63, и заполнять столько текстов
 * никто не станет.
 */
export function findOutcome(
  outcomes: InterpretationOutcome[],
  value: string | boolean | null | undefined,
): InterpretationOutcome | null {
  if (value === null || value === undefined) return null;
  const code = String(value);
  if (code === "") return null;

  for (const outcome of outcomes) {
    if (outcome.code === code) return outcome;
  }

  const key = outcomeMatchKey(code);
  if (key !== code) {
    for (const outcome of outcomes) {
      if (outcomeMatchKey(outcome.code) === key) return outcome;
    }
  }

  const size = code.split("+").filter(Boolean).length;
  const fallback = `count:${size}`;
  for (const outcome of outcomes) {
    if (outcome.code === fallback) return outcome;
  }
  return null;
}
```

- [ ] **Шаг 4: прогнать тест и убедиться, что он проходит**

Команда: `npm test -- shared/scales/__tests__/outcome-set-match.test.ts`
Ожидание: PASS, 6 тестов.

- [ ] **Шаг 5: убедиться, что прежнее толкование цело**

Команда: `npm test -- shared/scales shared/template/__tests__/measure-view.test.ts`
Ожидание: PASS, падений нет.

> ВНИМАНИЕ. `findOutcome` перестал находить исход по коду `""`. Прежняя версия сравнивала `""` с
> кодом исхода, но `asOutcomes` отбрасывает исход без кода, поэтому пустой код в списке не выживает
> и найтись всё равно не мог. Если какой-то тест на это опирался — он опирался на несуществующий
> случай, и его надо править, а не возвращать поведение.

- [ ] **Шаг 6: коммит**

```bash
git add shared/scales/interpretation.ts shared/scales/__tests__/outcome-set-match.test.ts
git commit -m "feat(scales): исход по набору ключей и запасной count:N (PRD-53)"
```

---

## Задача 6. Единое сопоставление исхода и отсев измерений без значения

**Файлы:**

- Изменить: `shared/template/result-context.ts:461-470` (`firedFeedback`)
- Изменить: `shared/template/result-context.ts:496-508` (`resolveMeasures`)
- Тест: `shared/template/__tests__/result-context-measure-absent.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { buildResultContext } from "../result-context";
import type { MeasureInput } from "../result-context";

/**
 * Минимальный показатель. `value` — единственное, что различает случаи теста.
 */
function indicator(key: string, value: unknown): MeasureInput {
  return {
    key,
    name: key,
    value: value as never,
    visibility: "level",
    interpretation: {
      domainMin: null,
      domainMax: null,
      valence: "none",
      bands: [],
      outcomes: [{ code: "cel+pro", label: "Двухвекторный", text: "Текст профиля" }],
    },
  } as MeasureInput;
}

describe("измерение без значения", () => {
  it("не печатает карточку", () => {
    const ctx = buildResultContext({
      title: "Тест",
      result: { percent: 0, score: 0, topicResults: [] } as never,
      measures: {
        scales: [],
        indicators: [indicator("profile", "cel+pro"), indicator("added_later", null)],
        scaleKind: "label",
        indicatorKind: "label",
        ramp: "neutral",
      } as never,
    } as never);
    expect(ctx.indicators?.map((c) => c.key)).toEqual(["profile"]);
  });

  it("рекомендации берутся тем же сопоставлением, что и карточка", () => {
    const withFeedback = indicator("profile", "pro+cel");
    withFeedback.interpretation.outcomes![0].feedback = { text: "Совет" };
    const ctx = buildResultContext({
      title: "Тест",
      result: { percent: 0, score: 0, topicResults: [] } as never,
      measures: {
        scales: [],
        indicators: [withFeedback],
        scaleKind: "label",
        indicatorKind: "label",
        ramp: "neutral",
      } as never,
    } as never);
    expect(JSON.stringify(ctx.recommendations)).toContain("Совет");
  });
});
```

> Точную форму аргумента `buildResultContext` сверить с соседним тестом
> `shared/template/__tests__/result-context.blocks.test.ts` и повторить её; выше показан смысл
> проверки, а не готовая фикстура.

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/template/__tests__/result-context-measure-absent.test.ts`
Ожидание: FAIL — карточек две, а рекомендация не найдена (порядок ключей в коде другой).

- [ ] **Шаг 3: свести сопоставление к одной функции**

В `shared/template/result-context.ts` добавить `findOutcome` в существующий импорт из
`../scales/interpretation`, затем заменить тело `firedFeedback`:

```ts
/** Feedback of the level that actually fired, for the recommendations block. */
function firedFeedback(m: MeasureInput): FeedbackBlock | null {
  const { interpretation } = m;
  if (typeof m.value === "number") {
    const band = interpretation.bands.find((b) => (m.value as number) >= b.min && (m.value as number) <= b.max);
    return normalizeFeedback(band?.feedback);
  }
  // Через `findOutcome`, а не собственным сравнением: набор ключей и запасной `count:<N>`
  // (PRD-53 §4.3) обязаны действовать и в карточке, и в блоке рекомендаций. Две копии правила
  // означали бы, что текст профиля нашёлся, а совет к нему — нет.
  const outcomes = (interpretation as IndicatorInterpretation).outcomes ?? [];
  return normalizeFeedback(findOutcome(outcomes, m.value as string | boolean)?.feedback);
}
```

- [ ] **Шаг 4: отсеять измерения без значения**

Там же заменить фильтр в `resolveMeasures`:

```ts
  // Измерение без значения карточку не печатает (PRD-53 §7.2). Показатель, заведённый ПОСЛЕ
  // завершения попытки, значения в ней не имеет, и прежде это давало пустую карточку с одними
  // отступами. `null`/`undefined` — единственные признаки отсутствия: `false` и `0` это значения.
  const hasValue = (m: MeasureInput) => m.value !== null && m.value !== undefined;
  const visibleScales = measures.scales.filter((m) => m.visibility !== "hidden" && hasValue(m));
  const visibleIndicators = measures.indicators.filter((m) => m.visibility !== "hidden" && hasValue(m));
```

- [ ] **Шаг 5: прогнать тест и убедиться, что он проходит**

Команда: `npm test -- shared/template/__tests__/result-context-measure-absent.test.ts`
Ожидание: PASS, 2 теста.

- [ ] **Шаг 6: прогнать соседние тесты итогов**

Команда: `npm test -- shared/template tests/results-indicator-card.test.ts`
Ожидание: PASS. Тест, ожидавший карточку у измерения без значения, если такой найдётся, править по
новому поведению — оно и есть требование FR-21.

- [ ] **Шаг 7: коммит**

```bash
git add shared/template/result-context.ts shared/template/__tests__/result-context-measure-absent.test.ts
git commit -m "fix(results): измерение без значения не печатает карточку; исход ищется одной функцией (PRD-53)"
```

---

## Задача 7. Карточка «шкалы вне профиля»

**Файлы:**

- Изменить: `shared/template/result-context.ts` (тип `MeasureInput`, сборка карточек)
- Изменить: `server/services/result-context.ts:225-251`
- Изменить: `server/scorm/builders/test-json.ts:750-760`
- Изменить: `server/scorm/template/app/render/viewResults.js:415-456`
- Тест: `shared/template/__tests__/rest-scales-card.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { buildRestScalesView } from "../result-context";
import type { MeasureInput } from "../result-context";

function scale(key: string, name: string, value: number, description: string): MeasureInput {
  return {
    key,
    name,
    value,
    description,
    visibility: "level_and_value",
    interpretation: { domainMin: null, domainMax: null, displayMax: null, valence: "none", bands: [] },
  } as MeasureInput;
}

const SCALES = [
  scale("cel", "Целеустремленный", 42, "Ориентирован на результат."),
  scale("vdo", "Вдохновляющий", 7, "Ориентирован на развитие людей."),
  scale("kom", "Командный", 12, "Ориентирован на команду."),
  scale("pro", "Процессный", 42, "Ориентирован на организацию работы."),
];

const profile = (value: string): MeasureInput =>
  ({
    key: "lead_style",
    name: "Профиль",
    value,
    visibility: "level",
    interpretation: { domainMin: null, domainMax: null, valence: "none", bands: [], outcomes: [] },
    restScales: { show: true, label: "Ознакомьтесь с другими стилями", keys: ["cel", "vdo", "kom", "pro"] },
  }) as MeasureInput;

describe("карточка «вне профиля»", () => {
  it("перечисляет шкалы группы вне набора по убыванию значения", () => {
    const card = buildRestScalesView(profile("cel+pro"), SCALES);
    expect(card?.name).toBe("Ознакомьтесь с другими стилями");
    expect(card?.text).toBe(
      "Командный\nОриентирован на команду.\n\nВдохновляющий\nОриентирован на развитие людей.",
    );
  });

  it("не печатается, когда в наборе все шкалы группы", () => {
    expect(buildRestScalesView(profile("cel+vdo+kom+pro"), SCALES)).toBeNull();
  });

  it("не печатается при выключенном переключателе", () => {
    const off = profile("cel+pro");
    off.restScales!.show = false;
    expect(buildRestScalesView(off, SCALES)).toBeNull();
  });

  it("берёт только шкалы ГРУППЫ, а не все шкалы теста", () => {
    const narrow = profile("cel");
    narrow.restScales!.keys = ["cel", "vdo"];
    expect(buildRestScalesView(narrow, SCALES)?.text).toBe(
      "Вдохновляющий\nОриентирован на развитие людей.",
    );
  });

  it("шкала без описания печатает одно название", () => {
    const noDesc = SCALES.map((s) => ({ ...s, description: "" }));
    expect(buildRestScalesView(profile("cel+pro"), noDesc as MeasureInput[])?.text).toBe(
      "Командный\n\nВдохновляющий",
    );
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- shared/template/__tests__/rest-scales-card.test.ts`
Ожидание: FAIL, `buildRestScalesView is not exported`.

- [ ] **Шаг 3: расширить контракт измерения**

В `shared/template/result-context.ts` в интерфейсе `MeasureInput` добавить два поля:

```ts
  /**
   * Собственное описание шкалы (`scales.description`). Читает только карточка «вне профиля»
   * (PRD-53 §4.4): она собирает текст ИЗ ШКАЛ, а не из пятнадцати рукописных копий у показателя.
   */
  description?: string;
  /**
   * PRD-53 §4.4. Показатель-профиль печатает вторую карточку — шкалы группы, не вошедшие в набор.
   * `keys` дублируют группу из формулы намеренно: контекст отрисовки формулы не несёт, а разбирать
   * её на этапе показа значило бы тащить парсер в оба хоста ради списка, который редактор знает.
   */
  restScales?: { show: boolean; label: string; keys: string[] };
```

- [ ] **Шаг 4: написать сборку карточки**

Там же, рядом с `firedFeedback`, добавить экспортируемую функцию:

```ts
/**
 * Вторая карточка показателя-профиля: шкалы группы, НЕ вошедшие в верхнюю зону.
 *
 * Порядок — по убыванию значения, а не канонический: канонический порядок хранит КОД набора, а
 * методика перечисляет оставшиеся стили от более выраженного к менее. Текст берётся из самих шкал,
 * поэтому смена описания шкалы правит и этот блок, а не расходится с ним.
 *
 * `null` — печатать нечего: переключатель выключен, значения нет, или в набор вошла вся группа.
 *
 * @public
 */
export function buildRestScalesView(
  indicator: MeasureInput,
  scales: readonly MeasureInput[],
): CtxMeasureView | null {
  const config = indicator.restScales;
  if (!config?.show) return null;
  const code = typeof indicator.value === "string" ? indicator.value : "";
  if (!code) return null;

  const inProfile = new Set(code.split("+").filter(Boolean));
  const group = new Set(config.keys);
  const rest = scales
    .filter((s) => group.has(s.key) && !inProfile.has(s.key))
    .filter((s) => typeof s.value === "number" && Number.isFinite(s.value))
    .sort((a, b) => (b.value as number) - (a.value as number));
  if (rest.length === 0) return null;

  const text = rest.map((s) => `${s.name}\n${s.description ?? ""}`.trimEnd()).join("\n\n");
  return {
    key: `${indicator.key}__rest`,
    name: config.label,
    renderKind: "label",
    showValue: false,
    // Заголовок уровня погашен: у этой карточки его роль играет её собственное имя.
    hideLevel: true,
    valueText: "",
    maxText: "",
    valueLabel: "",
    levelLabel: "",
    tone: "neutral",
    toneClass: "tb-tone--neutral",
    bannerVariant: "info",
    text,
    textHtml: richTextToHtml(text),
    zones: [],
    marks: [],
  };
}
```

- [ ] **Шаг 5: вставить карточку в блок показателей**

Там же заменить сборку показателей:

```ts
  if (blocks.indicators && visibleIndicators.length) {
    result.indicators = visibleIndicators.flatMap((m) => {
      const card = buildMeasureView({ ...m, requestedKind: measures.indicatorKind, ramp: measures.ramp });
      const rest = buildRestScalesView(m, measures.scales);
      // Карточка «вне профиля» идёт СРАЗУ за своим профилем: она его продолжение, а не отдельный
      // показатель, и между ними не должно оказаться чужой карточки.
      return rest ? [card, rest] : [card];
    });
  }
```

> Внимание: `measures.scales` — ПОЛНЫЙ список шкал, а не `visibleScales`. Шкала, скрытая от ученика
> на своей карточке, всё равно может входить в группу профиля, и её описание блок печатает.

- [ ] **Шаг 6: заполнить поля на веб-хосте**

В `server/services/result-context.ts` в сборке `scales` добавить `description: s.description ?? ""`,
в сборке `indicators` — чтение конфигурации:

```ts
      // PRD-53 §4.4: карточка «вне профиля». Форма читается защитно — это jsonb, который правит автор.
      restScales: readRestScales(v.configJson),
```

и рядом объявить читалку:

```ts
/** `config_json.restScales` показателя-профиля; `undefined`, когда настройки нет или она неполна. */
function readRestScales(configJson: unknown): { show: boolean; label: string; keys: string[] } | undefined {
  const raw = (configJson as { restScales?: unknown } | null)?.restScales as
    | { show?: unknown; label?: unknown; keys?: unknown }
    | undefined;
  if (!raw || raw.show !== true) return undefined;
  const keys = Array.isArray(raw.keys) ? raw.keys.map(String).filter(Boolean) : [];
  if (keys.length === 0) return undefined;
  return { show: true, label: String(raw.label ?? ""), keys };
}
```

- [ ] **Шаг 7: запечь поля в пакет**

В `server/scorm/builders/test-json.ts` в строку шкалы добавить `description: s.description ?? ""`,
а в строку показателя — `restScales` тем же защитным чтением (продублировать функцию нельзя:
экспортировать `readRestScales` из `server/services/result-context.ts` и импортировать здесь).

В `server/scorm/template/app/render/viewResults.js` в сборке `scales` добавить
`description: s.description || ''`, в сборке `indicators` — `restScales: v.restScales || undefined`.

- [ ] **Шаг 8: прогнать тесты**

Команда: `npm test -- shared/template/__tests__/rest-scales-card.test.ts shared/template`
Ожидание: PASS.

Команда: `npm run check`
Ожидание: без ошибок.

- [ ] **Шаг 9: коммит**

```bash
git add shared/template/result-context.ts server/services/result-context.ts server/scorm/builders/test-json.ts server/scorm/template/app/render/viewResults.js shared/template/__tests__/rest-scales-card.test.ts
git commit -m "feat(results): карточка «шкалы вне профиля» из описаний шкал (PRD-53)"
```

---

## Задача 8. Двойник рантайма и золотой корпус

**Файлы:**

- Изменить: `server/scorm/template/app/dsl/formula.js`
- Изменить: `tests/fixtures/formula-cases.json`
- Тест: `tests/formula-port.test.ts` (существующий, новых файлов не нужно)

- [ ] **Шаг 1: добавить случаи в золотой корпус**

В `tests/fixtures/formula-cases.json` в массив `cases` добавить (контекст фикстуры:
`cel=34, vdo=16, kom=14, pro=34, empty` без значения; `scaleOrder` начинается с `leadership`):

```json
    { "formula": "topGroup([\"cel\",\"vdo\",\"kom\",\"pro\"], 5).code", "expected": "cel+pro" },
    { "formula": "topGroup([\"pro\",\"cel\",\"vdo\",\"kom\"], 5).code", "expected": "cel+pro" },
    { "formula": "topGroup([\"cel\",\"vdo\",\"kom\",\"pro\"], 5).count", "expected": 2 },
    { "formula": "topGroup([\"cel\",\"vdo\",\"kom\",\"pro\"], 5).max", "expected": 34 },
    { "formula": "topGroup([\"cel\",\"vdo\",\"kom\",\"pro\"], 20).code", "expected": "cel+vdo+kom+pro" },
    { "formula": "topGroup([\"cel\",\"vdo\",\"kom\",\"pro\"], \"10%\").code", "expected": "cel+pro" },
    { "formula": "topGroup([\"cel\",\"empty\"], 5).code", "expected": "cel" },
    { "formula": "topGroup([\"empty\"], 5).code", "expected": "" },
    { "formula": "topGroup([\"empty\"], 5).count", "expected": 0 },
    { "formula": "topGroup([\"cel\",\"pro\"], \"десять\").code", "expected": null },
    { "formula": "IF(topGroup([\"cel\",\"vdo\",\"kom\",\"pro\"], 5).count > 1, \"набор\", \"один\")", "expected": "набор" }
```

- [ ] **Шаг 2: прогнать паритетный тест и убедиться, что он падает**

Команда: `npm test -- tests/formula-port.test.ts`
Ожидание: FAIL — двойник не знает `topGroup`.

- [ ] **Шаг 3: научить двойник**

В `server/scorm/template/app/dsl/formula.js` рядом с `SCALE_RANK_PROPS` добавить:

```js
  // PRD-53 §4.2: верхняя зона группы шкал. Форма как у topScale, но второй аргумент — ПОРОГ.
  var SCALE_GROUP_PROPS = ["code", "count", "max"];
  var PERCENT_RE = /^(\d+(?:\.\d+)?)%$/;
```

В разборе, сразу после блока `SCALE_RANK_FNS[name]`, добавить:

```js
      if (name === "topGroup") {
        nextTok(); expectPunct("("); expectPunct("[");
        var gkeys = [];
        if (!(peek().type === "punct" && peek().value === "]")) {
          gkeys.push(parseStr());
          while (peek().type === "punct" && peek().value === ",") { nextTok(); gkeys.push(parseStr()); }
        }
        expectPunct("]"); expectPunct(",");
        var thTok = nextTok();
        if (thTok.type !== "number" && thTok.type !== "string") {
          throw new Error("Порог верхней зоны — число или строка вида «10%»");
        }
        var threshold = thTok.type === "number" ? Number(thTok.value) : thTok.value;
        expectPunct(")"); expectPunct(".");
        var gp = nextTok();
        if (gp.type !== "ident") throw new Error("Ожидалось свойство");
        if (SCALE_GROUP_PROPS.indexOf(gp.value) < 0) throw new Error("У «topGroup» нет свойства «" + gp.value + "»");
        return { type: "scaleGroup", keys: gkeys, threshold: threshold, prop: gp.value };
      }
```

Рядом с `scaleAtRank` добавить арифметику — дословный перенос `shared/formula/scale-group.ts`:

```js
  function parseGroupThreshold(raw) {
    if (typeof raw === "number") return isFinite(raw) && raw >= 0 ? { kind: "abs", value: raw } : null;
    var m = PERCENT_RE.exec(String(raw).replace(/^\s+|\s+$/g, ""));
    if (!m) return null;
    var v = Number(m[1]);
    return isFinite(v) ? { kind: "pct", value: v } : null;
  }

  function inAuthorOrder(keys, authorOrder) {
    var index = {}, i;
    for (i = 0; i < authorOrder.length; i++) index[authorOrder[i]] = i;
    return keys.slice().sort(function (a, b) {
      var ia = index[a] === undefined ? Number.MAX_SAFE_INTEGER : index[a];
      var ib = index[b] === undefined ? Number.MAX_SAFE_INTEGER : index[b];
      return ia - ib;
    });
  }

  function resolveTopGroup(keys, values, authorOrder, threshold) {
    var present = [], i, k;
    for (i = 0; i < keys.length; i++) {
      k = keys[i];
      if (present.indexOf(k) >= 0) continue;
      if (values[k] && values[k].hasValue === true) present.push(k);
    }
    if (!present.length) return { code: "", count: 0, max: 0 };

    var max = -Infinity;
    for (i = 0; i < present.length; i++) max = Math.max(max, values[present[i]].normalized);
    var delta = threshold.kind === "abs" ? threshold.value : (Math.abs(max) * threshold.value) / 100;

    var top = [];
    for (i = 0; i < present.length; i++) {
      if (values[present[i]].normalized >= max - delta) top.push(present[i]);
    }
    return { code: inAuthorOrder(top, authorOrder).join("+"), count: top.length, max: max };
  }
```

И ветку вычисления сразу после `case "scaleRank"`:

```js
      case "scaleGroup": {
        var gOrder = ctx.scaleOrder || Object.keys(ctx.scales || {});
        var th = parseGroupThreshold(node.threshold);
        if (!th) return null;
        var group = resolveTopGroup(node.keys, ctx.scales || {}, gOrder, th);
        return group[node.prop] === undefined ? null : group[node.prop];
      }
```

- [ ] **Шаг 4: прогнать паритетный тест и убедиться, что он проходит**

Команда: `npm test -- tests/formula-port.test.ts`
Ожидание: PASS, все случаи корпуса совпадают на обеих реализациях.

- [ ] **Шаг 5: коммит**

```bash
git add server/scorm/template/app/dsl/formula.js tests/fixtures/formula-cases.json
git commit -m "feat(scorm): topGroup в двойнике DSL, паритет закреплён корпусом (PRD-53)"
```

---

## Задача 9. Пятый шаблон конструктора показателей

**Файлы:**

- Изменить: `client/src/features/tests/editor/result-variables-builder.ts`
- Тест: `client/src/features/tests/editor/__tests__/result-variables-builder.test.ts` (дополнить)

- [ ] **Шаг 1: написать падающий тест**

Дополнить существующий файл:

```ts
describe("шаблон «Профиль по группе шкал»", () => {
  it("порождает каноничный DSL с абсолютным порогом", () => {
    expect(buildProfileFormula({ keys: ["cel", "vdo", "kom", "pro"], threshold: 5, unit: "abs" })).toBe(
      'topGroup(["cel","vdo","kom","pro"], 5).code',
    );
  });

  it("порождает долевой порог строкой", () => {
    expect(buildProfileFormula({ keys: ["cel", "pro"], threshold: 10, unit: "pct" })).toBe(
      'topGroup(["cel","pro"], "10%").code',
    );
  });

  it("тип результата шаблона — строка", () => {
    expect(TEMPLATE_TYPE.profile).toBe("string");
  });

  it("шаблон значится в списке", () => {
    expect(TEMPLATE_OPTIONS.map((o) => o.value)).toContain("profile");
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- client/src/features/tests/editor/__tests__/result-variables-builder.test.ts`
Ожидание: FAIL, `buildProfileFormula is not exported`.

- [ ] **Шаг 3: написать реализацию**

В `client/src/features/tests/editor/result-variables-builder.ts`:

```ts
export type BuilderTemplate = "threshold" | "category" | "weighted" | "verdict" | "profile";

export const TEMPLATE_OPTIONS: Array<{ value: BuilderTemplate; label: string }> = [
  { value: "threshold", label: "Порог" },
  { value: "category", label: "Категория по уровням шкалы" },
  { value: "weighted", label: "Взвешенная сумма" },
  { value: "verdict", label: "Сертификация / вердикт" },
  { value: "profile", label: "Профиль по группе шкал" },
];

export const TEMPLATE_TYPE: Record<BuilderTemplate, ResultVariableType> = {
  threshold: "boolean",
  category: "string",
  weighted: "number",
  verdict: "boolean",
  profile: "string",
};

/** Настройка шаблона «Профиль по группе шкал» (PRD-53 §5.1). */
export type ProfileTemplate = {
  /** Ключи шкал группы в авторском порядке. */
  keys: string[];
  /** Порог верхней зоны. */
  threshold: number;
  /** Единица порога: баллы шкалы или доля от максимума по группе. */
  unit: "abs" | "pct";
};

/**
 * Каноничный DSL шаблона. Доля пишется СТРОКОЙ «N%» — так её отличает парсер; голое число всегда
 * означает абсолютный порог.
 */
export function buildProfileFormula(t: ProfileTemplate): string {
  const keys = t.keys.map((k) => JSON.stringify(k)).join(",");
  const threshold = t.unit === "pct" ? JSON.stringify(`${t.threshold}%`) : String(t.threshold);
  return `topGroup([${keys}], ${threshold}).code`;
}
```

- [ ] **Шаг 4: прогнать тест и убедиться, что он проходит**

Команда: `npm test -- client/src/features/tests/editor/__tests__/result-variables-builder.test.ts`
Ожидание: PASS.

- [ ] **Шаг 5: коммит**

```bash
git add client/src/features/tests/editor/result-variables-builder.ts client/src/features/tests/editor/__tests__/result-variables-builder.test.ts
git commit -m "feat(editor): шаблон «Профиль по группе шкал» в конструкторе показателей (PRD-53)"
```

---

## Задача 10. Форма шаблона, генератор матрицы и метки наборов

**Файлы:**

- Создать: `client/src/features/tests/editor/profile-matrix.ts`
- Изменить: `client/src/features/tests/editor/sections/result-variables-section.tsx`
- Тест: `client/src/features/tests/editor/__tests__/profile-matrix.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { profileMatrix, profileSetLabel } from "../profile-matrix";

const SCALES = [
  { key: "cel", label: "Целеустремленный" },
  { key: "vdo", label: "Вдохновляющий" },
  { key: "kom", label: "Командный" },
  { key: "pro", label: "Процессный" },
];

describe("profileSetLabel", () => {
  it("один стиль", () => {
    expect(profileSetLabel(["cel"], SCALES)).toBe("Сфокусированный: Целеустремленный");
  });

  it("два стиля соединяются союзом", () => {
    expect(profileSetLabel(["cel", "pro"], SCALES)).toBe(
      "Двухвекторный: Целеустремленный и Процессный",
    );
  });

  it("три стиля — запятые и союз перед последним", () => {
    expect(profileSetLabel(["cel", "vdo", "kom"], SCALES)).toBe(
      "Широкий: Целеустремленный, Вдохновляющий и Командный",
    );
  });

  it("вся группа", () => {
    expect(profileSetLabel(["cel", "vdo", "kom", "pro"], SCALES)).toBe(
      "Сбалансированный: Целеустремленный, Вдохновляющий, Командный и Процессный",
    );
  });
});

describe("profileMatrix", () => {
  it("для четырёх шкал даёт пятнадцать заготовок", () => {
    expect(profileMatrix(["cel", "vdo", "kom", "pro"], SCALES)).toHaveLength(15);
  });

  it("заготовка несёт код и метку, но не текст", () => {
    const first = profileMatrix(["cel", "vdo"], SCALES)[0];
    expect(first).toEqual({ code: "cel", label: "Сфокусированный: Целеустремленный" });
  });

  it("порядок — по возрастанию размера набора", () => {
    expect(profileMatrix(["cel", "vdo"], SCALES).map((r) => r.code)).toEqual(["cel", "vdo", "cel+vdo"]);
  });

  it("заготовки по размеру набора нумеруются count:N", () => {
    expect(profileMatrix(["cel", "vdo"], SCALES, { byCountOnly: true })).toEqual([
      { code: "count:1", label: "Сфокусированный" },
      { code: "count:2", label: "Двухвекторный" },
    ]);
  });
});
```

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- client/src/features/tests/editor/__tests__/profile-matrix.test.ts`
Ожидание: FAIL, модуля нет.

- [ ] **Шаг 3: написать реализацию**

Создать `client/src/features/tests/editor/profile-matrix.ts`:

```ts
/**
 * @module features/tests/editor/profile-matrix
 * @description Заготовки исходов для шаблона «Профиль по группе шкал» (PRD-53 §5.2).
 *
 * Генератор живёт В РЕДАКТОРЕ, а не в ядре формул, по одной причине: метке набора нужны НАЗВАНИЯ
 * шкал, а контекст вычислителя их не несёт — там у измерения есть подпись уровня, но не имя. В
 * редакторе имена под рукой, и автор правит предложенную метку, если методика называет профиль
 * иначе.
 */

import { subsetCodes } from "@shared/formula/scale-group";

/** Минимальная шкала, какой её знает форма шаблона. */
export type ProfileScale = { key: string; label: string };

/** Одна строка матрицы: код набора и предложенная метка. Тексты автор пишет сам. */
export type ProfileMatrixRow = { code: string; label: string };

/**
 * Как назвать набор по его размеру. Названия предложенные: методика вправе называть профили иначе,
 * и метка исхода правится.
 */
const SIZE_NAME = ["Сфокусированный", "Двухвекторный", "Широкий", "Сбалансированный"];

function sizeName(size: number): string {
  return SIZE_NAME[size - 1] ?? `Набор из ${size}`;
}

/** «X», «X и Y», «X, Y и Z» — запятые и союз перед последним, единообразно для любого размера. */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} и ${names[names.length - 1]}`;
}

/** Предложенная метка набора: размер и состав. @public */
export function profileSetLabel(keys: readonly string[], scales: readonly ProfileScale[]): string {
  const byKey = new Map(scales.map((s) => [s.key, s.label || s.key]));
  const names = keys.map((k) => byKey.get(k) ?? k);
  return `${sizeName(keys.length)}: ${joinNames(names)}`;
}

/**
 * Заготовки исходов группы.
 *
 * `byCountOnly` даёт четыре запасных исхода по размеру набора вместо всех сочетаний — путь для
 * группы из пяти и более шкал, где точных наборов 31 и больше.
 *
 * @public
 */
export function profileMatrix(
  keys: readonly string[],
  scales: readonly ProfileScale[],
  options: { byCountOnly?: boolean } = {},
): ProfileMatrixRow[] {
  const order = scales.map((s) => s.key);
  if (options.byCountOnly) {
    return Array.from({ length: keys.length }, (_, i) => ({
      code: `count:${i + 1}`,
      label: sizeName(i + 1),
    }));
  }
  return subsetCodes(keys, order).map((code) => ({
    code,
    label: profileSetLabel(code.split("+"), scales),
  }));
}
```

- [ ] **Шаг 4: прогнать тест и убедиться, что он проходит**

Команда: `npm test -- client/src/features/tests/editor/__tests__/profile-matrix.test.ts`
Ожидание: PASS, 8 тестов.

- [ ] **Шаг 5: подключить к секции показателей**

В `client/src/features/tests/editor/sections/result-variables-section.tsx`:

1. Форма шаблона `profile` — мультивыбор шкал, число порога, переключатель единиц, тумблер
   «Показывать шкалы вне профиля» и поле его заголовка. При изменении любого поля пересобирать
   формулу через `buildProfileFormula` и писать `config_json.restScales` из тумблера и заголовка
   (`keys` — та же группа).
2. `suggestedOutcomeCodes` дополнить кодами матрицы: когда формула показателя разбирается в узел
   `scaleGroup`, подсказки берутся из `profileMatrix`, а не из строковых литералов.
3. Две кнопки над `OutcomesEditor`: «Собрать наборы» (`profileMatrix(keys, scales)`) и «Заготовки по
   размеру набора» (`{ byCountOnly: true }`). Обе ДОБАВЛЯЮТ недостающие коды и не трогают
   заполненные — правило уже реализовано в `OutcomesEditor` через `suggestedCodes`, кнопки лишь
   подставляют другой источник.
4. При длине группы ≥ 5 перед построением показать `Banner` с числом строк (`2 ** keys.length - 1`) и
   предложением обойтись заготовками по размеру набора.
5. **Предупреждение о непокрытых наборах** (спека §5.3). Рядом с существующим `unknownOutcomeCodes`
   завести обратную проверку: коды матрицы, для которых нет ни точного исхода, ни `count:<N>`
   подходящего размера. Показывать `Banner` со списком (не более десяти кодов и «и ещё N»). Как и у
   соседа, подавлять при пустом списке исходов: автор ещё не начал заполнять.
6. **Предупреждение о пустых описаниях шкал** (спека §5.3). При включённом тумблере «Показывать
   шкалы вне профиля» перечислить шкалы группы с пустым `description`: блок напечатает для них одно
   название без текста.

- [ ] **Шаг 6: прогнать тесты секции**

Команда: `npm test -- client/src/features/tests/editor`
Ожидание: PASS.

Команда: `npm run check`
Ожидание: без ошибок.

- [ ] **Шаг 7: коммит**

```bash
git add client/src/features/tests/editor/profile-matrix.ts client/src/features/tests/editor/sections/result-variables-section.tsx client/src/features/tests/editor/__tests__/profile-matrix.test.ts
git commit -m "feat(editor): форма профиля и генератор матрицы наборов (PRD-53)"
```

---

## Задача 11. Колонка «Рекомендации» на листе исходов

Нового листа НЕ нужно: лист «Исходы показателей» переносит исход с ЛЮБЫМ кодом — колонка «Код» это
свободный текст, — значит `cel+pro` и `count:2` он везёт уже сейчас. Не хватает второго крупного
текста методики: обратной связи исхода.

**Файлы:**

- Изменить: `server/utils/workbook-sheets.ts:56-57`, `:1270-1345` (разбор, сборка, слияние)
- Изменить: `server/services/workbook-template.ts` (строка справки по листу исходов)
- Тест: `tests/workbook-outcome-feedback.test.ts`

- [ ] **Шаг 1: написать падающий тест**

```ts
import { describe, expect, it } from "vitest";
import { OUTCOME_HEADERS, parseOutcomeRow, serializeOutcomeRows } from "@server/utils/workbook-sheets";

describe("«Исходы показателей»: колонка «Рекомендации»", () => {
  it("значится в колонках последней", () => {
    expect(OUTCOME_HEADERS).toEqual([
      "Показатель", "Код", "Метка", "Текст", "Тональность", "Рекомендации",
    ]);
  });

  it("читается, когда колонка в книге есть", () => {
    const headers = new Set(OUTCOME_HEADERS);
    const row = {
      "Показатель": "lead_style",
      "Код": "cel+pro",
      "Метка": "Двухвекторный",
      "Текст": "Характеристика",
      "Рекомендации": "Совет",
    };
    const parsed = parseOutcomeRow(row, headers);
    expect(parsed.ok && parsed.value.feedbackText).toBe("Совет");
  });

  it("код-набор проходит без правок разбора", () => {
    const parsed = parseOutcomeRow(
      { "Показатель": "lead_style", "Код": "count:2" },
      new Set(OUTCOME_HEADERS),
    );
    expect(parsed.ok && parsed.value.code).toBe("count:2");
  });

  it("колонки НЕТ — поле не трогается", () => {
    const parsed = parseOutcomeRow(
      { "Показатель": "lead_style", "Код": "cel" },
      new Set(["Показатель", "Код"]),
    );
    expect(parsed.ok && "feedbackText" in parsed.value).toBe(false);
  });

  it("выгружается из feedback.text", () => {
    const rows = serializeOutcomeRows({
      name: "lead_style",
      configJson: { outcomes: [{ code: "cel+pro", label: "Д", text: "Х", feedback: { text: "Совет" } }] },
    });
    expect(rows[0]["Рекомендации"]).toBe("Совет");
  });
});
```

> Псевдоним `@server` в тестах может отсутствовать — сверить с соседним тестом книги и
> использовать тот путь импорта, который там уже работает.

- [ ] **Шаг 2: прогнать тест и убедиться, что он падает**

Команда: `npm test -- tests/workbook-outcome-feedback.test.ts`
Ожидание: FAIL — колонки в `OUTCOME_HEADERS` нет, `feedbackText` не читается.

- [ ] **Шаг 3: добавить колонку**

В `server/utils/workbook-sheets.ts`:

```ts
// «Рекомендации» добавлены PRD-53: у профиля это ВТОРОЙ крупный текст методики, и лист без него
// переносит половину. Колонка везёт только ТЕКСТ обратной связи; вложения, ссылки и формат
// по-прежнему вне книги и сохраняются при слиянии.
export const OUTCOME_HEADERS = ["Показатель", "Код", "Метка", "Текст", "Тональность", "Рекомендации"];
export const OUTCOME_WIDTHS = [18, 14, 28, 60, 16, 60];
```

В `ParsedOutcomeRow` добавить поле:

```ts
  /** Present only when the sheet HAS the column. */
  feedbackText?: string;
```

В `parseOutcomeRow` — чтение по тому же правилу, что у остальных колонок:

```ts
  if (headers.has("Рекомендации")) parsed.feedbackText = String(row["Рекомендации"] ?? "").trim();
```

В `serializeOutcomeRows` — выгрузку:

```ts
    "Рекомендации": String((o.feedback as { text?: unknown } | undefined)?.text ?? ""),
```

В функции слияния строк на сохранённые исходы (тот же раздел файла) — применение поля: колонка,
которая ЕСТЬ, задаёт `feedback.text` целиком, включая опустошение; прочие поля обратной связи
(`format`, `links`, `events`, `assets`) переносятся с сохранённого исхода нетронутыми.

- [ ] **Шаг 4: обновить справку книги**

В `server/services/workbook-template.ts` в строке справки по листу «Исходы показателей» добавить
описание колонки: «Рекомендации — текст обратной связи исхода. Вложения и ссылки книга не переносит;
при загрузке они сохраняются».

- [ ] **Шаг 5: прогнать тесты**

Команда: `npm test -- tests/workbook-outcome-feedback.test.ts`
Ожидание: PASS, 5 тестов.

Команда: `npm test -- tests/workbook`
Ожидание: PASS. Тесты, перечисляющие `OUTCOME_HEADERS` целиком, поправить под новую колонку.

- [ ] **Шаг 6: коммит**

```bash
git add server/utils/workbook-sheets.ts server/services/workbook-template.ts tests/workbook-outcome-feedback.test.ts
git commit -m "feat(workbook): колонка «Рекомендации» на листе исходов показателей (PRD-53)"
```

---

## Задача 12. Перевод опросника ЧИЛ

**Файлы:**

- Создать: `scripts/db/prd53-chil-to-profile.ts`
- Тест: ручная приёмка по критериям спеки

- [ ] **Шаг 1: написать скрипт перевода**

Скрипт идемпотентен, работает чистым SQL в ОДНОЙ транзакции и берёт установку из `DATABASE_URL`
(живые установки отстают по миграциям, слой `storage` на их схеме падает). За образец взять
`.playwright-mcp/chil-v5-apply.ts` — он уже устроен именно так.

Что делает:

1. `profile_summary`: формула → `topGroup(["cel","vdo","kom","pro"], 5).code`, тип → `string`,
   пятнадцать ДИАПАЗОНОВ переносятся в ИСХОДЫ с кодами наборов (`1` → `cel`, `9` → `cel+pro`, … по
   той же маске Ц=1/В=2/К=4/П=8). Диапазоны ОСТАЮТСЯ: их читают попытки, завершённые до перевода.
2. `lead_style`: формула остаётся `var("profile_summary")`, диапазоны переносятся в исходы тем же
   правилом, старые исходы (`cel`/`vdo`/`kom`/`pro` от версии до пилота) НЕ трогаются.
3. `other_styles` гасится (`learner_visibility = 'hidden'`), а его работу берёт
   `config_json.restScales` показателя `lead_style`:
   `{"show": true, "label": "Ознакомьтесь с другими стилями", "keys": ["cel","vdo","kom","pro"]}`.
4. Описания четырёх стилей (текст до заголовка «Сильные стороны») кладутся в `scales.description`.
5. Проверка до записи: у всех четырёх шкал непустое `description`, иначе отказ.

- [ ] **Шаг 2: сухой прогон на dev**

```bash
DATABASE_URL=<dev> TEST_ID=26553608-e1c6-428d-b09d-7b9939a526d8 npx tsx scripts/db/prd53-chil-to-profile.ts --dry
```

Ожидание: перечень изменений, «СУХОЙ ПРОГОН — транзакция откачена».

- [ ] **Шаг 3: применить на dev и проверить расчёт**

```bash
DATABASE_URL=<dev> TEST_ID=26553608-e1c6-428d-b09d-7b9939a526d8 npx tsx scripts/db/prd53-chil-to-profile.ts
DATABASE_URL=<dev> TEST_ID=26553608-e1c6-428d-b09d-7b9939a526d8 npx tsx .playwright-mcp/chil-v5-verify.ts "docs/references/new/Опросник ЧИЛ_V5_после пилота.xlsx" .playwright-mcp/chil-v5.json
```

Ожидание: контрольное заполнение даёт 42/7/7/42 и код `cel+pro`.

- [ ] **Шаг 4: приёмка в браузере**

Пройти тест через API (`.playwright-mcp/chil-attempt.mjs`) и открыть экран итогов. Проверить:
профиль «Двухвекторный: Целеустремленный и Процессный»; карточка «Ознакомьтесь с другими стилями» с
Командным и Вдохновляющим В ПОРЯДКЕ УБЫВАНИЯ балла; рекомендации на месте; попытка, завершённая до
перевода, печатает свой прежний текст.

- [ ] **Шаг 5: применить на двух удалённых установках**

Те же команды с `DATABASE_URL` и `TEST_ID` установок из §14 спеки. Перед каждой — резервная копия
затрагиваемых строк, как это сделано в `.playwright-mcp/chil-v5-backup-*.json`.

- [ ] **Шаг 6: коммит**

```bash
git add scripts/db/prd53-chil-to-profile.ts
git commit -m "chore(chil): перевод опросника на профиль по группе шкал (PRD-53)"
```

---

## Задача 13. Документация и закрытие трека

**Файлы:**

- Изменить: `docs/guides/test-authoring.md` (раздел о показателях)
- Изменить: `docs/ROADMAP.md`
- Изменить: `CLAUDE.md` (перечень источников DSL)
- Изменить: `CHANGELOG.md`
- Изменить: `docs/specs/prd-53/scale-group-profile.md` (§14 — состояние)

- [ ] **Шаг 1: руководство автора**

Добавить раздел «Профиль по группе шкал»: что такое верхняя зона, чем абсолютный порог отличается от
долевого, как собрать матрицу, зачем запасные исходы `count:<N>` и откуда берётся блок «вне профиля».

- [ ] **Шаг 2: ROADMAP и CLAUDE.md**

В `docs/ROADMAP.md` завести строку трека PRD-53. В `CLAUDE.md` в описании `shared/formula/` упомянуть
источник `topGroup`.

- [ ] **Шаг 3: журнал изменений**

Добавить запись в `CHANGELOG.md` по образцу соседних.

- [ ] **Шаг 4: состояние в спеке**

Заменить §14 спеки на фактическое состояние: реализовано, принято, три установки переведены.

- [ ] **Шаг 5: проверки перед сдачей**

```bash
npm run check
npx markdownlint-cli2 "docs/**/*.md"
```

Ожидание: без ошибок.

Полный `npm test` и одиночный `npm run test:cov` — ТОЛЬКО по явному разрешению владельца.

- [ ] **Шаг 6: коммит**

```bash
git add docs CLAUDE.md CHANGELOG.md
git commit -m "docs(prd-53): руководство, журнал и состояние трека"
```

---

## Сверка плана со спекой

| Требование спеки | Задача |
| --- | --- |
| FR-01…FR-03 источник и свойства | 2 |
| FR-04…FR-07 верхняя зона, код, пустая группа | 1, 3 |
| FR-08, FR-09 сопоставление по набору и `count:<N>` | 5 |
| FR-10 проверки валидатора | 4 |
| FR-11 предупреждения: нормализация — 4; непокрытые коды — 10 | 4, 10 |
| FR-12…FR-14 карточка «вне профиля» | 7 |
| FR-15…FR-18 редактор и генератор | 9, 10 |
| FR-19 колонка «Рекомендации» на листе исходов | 11 |
| FR-20 двойник и корпус | 8 |
| FR-21 измерение без значения | 6 |
| FR-22 перевод без затирания | 12 |
| FR-23 схема БД не меняется | ни одна задача не трогает `drizzle/` и `shared/schema.ts` |
