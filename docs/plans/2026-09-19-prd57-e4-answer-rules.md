# Правила сравнения ответа (PRD-57, этап Э4): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** дать продукту общий движок сравнения открытого ответа и минимальный тип задания
«Короткий ответ», на который опираются следующие этапы трека.

**Architecture:** чистый модуль `shared/answer-check/` (нормализация, обычное сравнение,
числовое сравнение, набор правил) вывозится в SCORM-пакет через `shared/template/runtime-entry.ts`;
ES5-двойник движка оценки делегирует в него, а не повторяет логику. Правила хранятся в
`questions.correct_json`. Поле участника рисует общий рендерер `question-interaction.ts`, поэтому
оба хоста получают его из одного кода.

**Tech Stack:** TypeScript, Zod, Drizzle, React 19, `@universityrt/ui-kit`, Vitest.

**Устройство согласовано:** [docs/specs/2026-09-19-prd57-e4-answer-rules-design.md](../specs/2026-09-19-prd57-e4-answer-rules-design.md).
Требования: [PRD-57](../specs/prd-57/open-response-and-formatting.md) §6.1, §6.5, §6.6.
Эскиз: `docs/wireframes/approved/prd57-answer-rule.html`.

**Перед началом:** работа ведётся в ОТДЕЛЬНОМ git worktree (навык
`superpowers:using-git-worktrees`). В главной копии сейчас лежат чужие несохранённые правки
(`.gitignore`, `docs/specs/tooling/`) — переключать её ветку нельзя.

**Границы этапа.** Не делается: режим `regex` (Э7), проба ответа (Э6), операторы сверх «равно» и
обыкновенные дроби (Э5), предел длины и аналитика (Э3), пропуски (Э8). Форма данных под них
задаётся сейчас, поведение — нет.

---

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `shared/answer-check/normalize.ts` | форма сравнения: регистр, пробелы, `ё`, кавычки, дефисы |
| `shared/answer-check/wildcard.ts` | обычное сравнение с `*` и `?`, двухуказательный проход |
| `shared/answer-check/number.ts` | разбор числа участника и сравнение с допуском |
| `shared/answer-check/rules.ts` | типы правила и набора, связка, исход по каждому правилу |
| `shared/answer-check/index.ts` | единая точка входа модуля |
| `shared/schema.ts` | схема Zod набора правил; тип `short` в перечислениях |
| `shared/questions/question-type.ts` | `QUESTION_TYPES`, признак `isTextEntry`, `isMeasurementOnly` |
| `shared/scoring/engine.ts` | `Answer` принимает строку; ветки `exactCorrect` и `countTallies` |
| `shared/template/runtime-entry.ts` | вывоз `answer-check` в пакет |
| `shared/template/question-interaction.ts` | `renderShortAnswer` — поле участника |
| `shared/template/short-answer-dom.ts` | ввод участника отдаёт ответ хосту |
| `server/scorm/template/app/scoring/engine.js` | ветка строкового ответа, делегирует в `TBTemplate` |
| `server/scorm/template/app/utils/qtype.js` | зеркало признаков типа |
| `client/src/features/questions/answer-rules/answer-rules-block.tsx` | блок «Проверка ответа» |
| `client/src/features/questions/answer-rules/answer-rules-model.ts` | черновик обоих видов ответа |
| `client/src/features/questions/question-editor-drawer.tsx` | подключение блока |

---

## Task 1: Нормализация сравнения

**Files:**

- Create: `shared/answer-check/normalize.ts`
- Test: `tests/answer-check-normalize.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { normalizeForCompare } from "../shared/answer-check/normalize";

describe("normalizeForCompare", () => {
  it("снимает регистр", () => {
    expect(normalizeForCompare("Ростехнадзор")).toBe("ростехнадзор");
  });

  it("сводит ё к е", () => {
    expect(normalizeForCompare("Ёлка приёма")).toBe("елка приема");
  });

  it("схлопывает повторные пробелы и обрезает края", () => {
    expect(normalizeForCompare("  два   слова  ")).toBe("два слова");
  });

  it("сводит неразрывный пробел к обычному", () => {
    expect(normalizeForCompare("10 кг")).toBe("10 кг");
  });

  it("сводит виды дефисов к одному", () => {
    expect(normalizeForCompare("что—то")).toBe("что-то");
    expect(normalizeForCompare("минус − 5")).toBe("минус - 5");
  });

  it("сводит виды кавычек к прямым", () => {
    expect(normalizeForCompare("«Роса»")).toBe('"роса"');
    expect(normalizeForCompare("“роса”")).toBe('"роса"');
    expect(normalizeForCompare("‘роса’")).toBe("'роса'");
  });

  it("не падает на пустом и на не-строке", () => {
    expect(normalizeForCompare("")).toBe("");
    expect(normalizeForCompare(null)).toBe("");
    expect(normalizeForCompare(undefined)).toBe("");
  });

  it("идемпотентна", () => {
    const once = normalizeForCompare("  Ёлка — «Роса»  ");
    expect(normalizeForCompare(once)).toBe(once);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-normalize.test.ts`
Expected: FAIL, `Failed to resolve import "../shared/answer-check/normalize"`.

- [ ] **Step 3: Написать модуль**

```ts
/**
 * @module shared/answer-check/normalize
 *
 * The COMPARISON form of an answer (PRD-57 FR-28a). Applied to both sides — the
 * author's rule and the learner's answer — immediately before matching, and never
 * on the way into the database.
 *
 * Deliberately NOT an extension of `shared/text/normalize`: that module is the single
 * transform on the write path, and the content hash of a question depends on it, which
 * ties it to publication snapshots and to the PRD-52 comment pins. This one answers a
 * different question — «did the learner mean the same word?» — and touches nothing
 * stored.
 *
 * What is removed is technical noise only: a different keyboard layout for quotes or a
 * dash is not a different answer. Pure and framework-free — safe to bundle into the
 * SCORM runtime.
 */

/** Non-breaking, narrow no-break and figure spaces. */
const SPACES = /[   ]/g;
/** Hyphens, dashes and the minus sign — all read as a plain hyphen. */
const DASHES = /[‐-―−]/g;
/** Single quotes, apostrophes and the prime. */
const SINGLE_QUOTES = /[‘’‚‛′]/g;
/** Double quotes, guillemets and the double prime. */
const DOUBLE_QUOTES = /[“”„‟″«»]/g;

/**
 * Bring an answer to the form both sides are compared in.
 *
 * Order matters: the case is folded BEFORE `ё` is mapped to `е`, so `Ё` needs no
 * separate rule; whitespace is collapsed LAST, after the exotic spaces have become
 * ordinary ones.
 *
 * Idempotent by construction — the result of one pass is a fixed point of the next.
 *
 * @param value Raw text from either side; anything that is not a string reads as empty.
 * @returns The comparison form, or an empty string.
 */
export function normalizeForCompare(value: string | null | undefined): string {
  if (typeof value !== "string" || value === "") return "";
  return value
    .replace(SPACES, " ")
    .replace(DASHES, "-")
    .replace(SINGLE_QUOTES, "'")
    .replace(DOUBLE_QUOTES, '"')
    .toLowerCase()
    .replace(/ё/g, "е")
    .replace(/\s+/g, " ")
    .trim();
}
```

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-check-normalize.test.ts`
Expected: PASS, 8 тестов.

- [ ] **Step 5: Коммит**

```bash
git add shared/answer-check/normalize.ts tests/answer-check-normalize.test.ts
git commit -m "feat(prd-57): форма сравнения ответа (FR-28a)"
```

---

## Task 2: Обычное сравнение с подстановочными знаками

**Files:**

- Create: `shared/answer-check/wildcard.ts`
- Test: `tests/answer-check-wildcard.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { matchWildcard } from "../shared/answer-check/wildcard";

describe("matchWildcard", () => {
  it("сравнивает буквально, когда знаков нет", () => {
    expect(matchWildcard("ростехнадзор", "ростехнадзор")).toBe(true);
    expect(matchWildcard("ростехнадзор", "ростехнадзора")).toBe(false);
  });

  it("* заменяет любое продолжение, в том числе пустое", () => {
    expect(matchWildcard("федеральная служба по * надзору", "федеральная служба по атомному надзору")).toBe(true);
    expect(matchWildcard("рос*", "ростехнадзор")).toBe(true);
    expect(matchWildcard("рос*", "рос")).toBe(true);
    expect(matchWildcard("*надзор", "ростехнадзор")).toBe(true);
  });

  it("? заменяет ровно один символ", () => {
    expect(matchWildcard("гост ?", "гост р")).toBe(true);
    expect(matchWildcard("гост ?", "гост рв")).toBe(false);
    expect(matchWildcard("гост ?", "гост ")).toBe(false);
  });

  it("несколько звёзд подряд равны одной", () => {
    expect(matchWildcard("**надзор**", "ростехнадзор")).toBe(true);
  });

  it("образец из одних звёзд подходит всему, включая пустое", () => {
    expect(matchWildcard("*", "")).toBe(true);
    expect(matchWildcard("*", "что угодно")).toBe(true);
  });

  it("пустой образец подходит только пустому ответу", () => {
    expect(matchWildcard("", "")).toBe(true);
    expect(matchWildcard("", "ответ")).toBe(false);
  });

  it("не разворачивает откат на образце из чередующихся звёзд", () => {
    const started = Date.now();
    expect(matchWildcard("*а*а*а*а*а*а*а*а*б", "а".repeat(200))).toBe(false);
    expect(Date.now() - started).toBeLessThan(200);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-wildcard.test.ts`
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Написать модуль**

```ts
/**
 * @module shared/answer-check/wildcard
 *
 * Ordinary comparison with the two wildcards the author gets (PRD-57 FR-28d1):
 * `*` — any continuation, `?` — exactly one character.
 *
 * Matching is a TWO-POINTER scan, deliberately NOT a compiled `RegExp`. A pattern
 * translated into a regular expression would bring back the backtracking surface the
 * track postponed to Э7 together with its time budget (§6.4): the measured cases blow
 * up at 24–30 characters, which is inside any sane short-answer limit. The scan below
 * is bounded by the product of the two lengths and has no catastrophic case, which is
 * what makes this stage shippable before the budget exists.
 *
 * Both arguments are expected to be in the comparison form already
 * ({@link module:shared/answer-check/normalize}) — this module does not normalise, so
 * the caller cannot normalise one side and forget the other.
 *
 * Escaping a literal `*` or `?` is NOT provided: the specification does not ask for it,
 * and inventing a syntax the author is never told about is worse than not having one.
 * If the need appears, it arrives as its own decision.
 */

/**
 * Does `text` match `pattern`?
 *
 * @param pattern Author pattern in comparison form; may contain `*` and `?`.
 * @param text    Learner answer in comparison form.
 * @returns True when the whole text is covered by the whole pattern.
 */
export function matchWildcard(pattern: string, text: string): boolean {
  let p = 0;
  let t = 0;
  // Position of the last `*` seen, and how much of the text it had eaten by then:
  // the single point the scan returns to instead of exploring alternatives.
  let star = -1;
  let eaten = 0;

  while (t < text.length) {
    if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
      p++;
      t++;
    } else if (p < pattern.length && pattern[p] === "*") {
      star = p;
      p++;
      eaten = t;
    } else if (star >= 0) {
      p = star + 1;
      eaten++;
      t = eaten;
    } else {
      return false;
    }
  }

  while (p < pattern.length && pattern[p] === "*") p++;
  return p === pattern.length;
}
```

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-check-wildcard.test.ts`
Expected: PASS, 7 тестов.

- [ ] **Step 5: Коммит**

```bash
git add shared/answer-check/wildcard.ts tests/answer-check-wildcard.test.ts
git commit -m "feat(prd-57): обычное сравнение с подстановочными знаками (FR-28d1)"
```

---

## Task 3: Числовое сравнение (каркас)

**Files:**

- Create: `shared/answer-check/number.ts`
- Test: `tests/answer-check-number.test.ts`

Каркас: оператор `eq` и допуск в единицах либо в процентах. Остальные операторы, включительность
границ и обыкновенные дроби — Э5; разбор их не принимает и возвращает `null`.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { parseNumericAnswer, matchNumber } from "../shared/answer-check/number";

describe("parseNumericAnswer", () => {
  it("принимает точку и запятую как разделитель", () => {
    expect(parseNumericAnswer("3.14")).toBe(3.14);
    expect(parseNumericAnswer("3,14")).toBe(3.14);
  });

  it("не замечает пробелов, включая неразрывный", () => {
    expect(parseNumericAnswer(" 3,14 ")).toBe(3.14);
    expect(parseNumericAnswer("1 000,5")).toBe(1000.5);
  });

  it("принимает отрицательные значения", () => {
    expect(parseNumericAnswer("-25")).toBe(-25);
    expect(parseNumericAnswer("−25")).toBe(-25);
  });

  it("возвращает null на том, что числом не является", () => {
    expect(parseNumericAnswer("")).toBeNull();
    expect(parseNumericAnswer("пять")).toBeNull();
    expect(parseNumericAnswer("3,14 кг")).toBeNull();
    expect(parseNumericAnswer(null)).toBeNull();
  });

  it("обыкновенные дроби пока не принимаются — это Э5", () => {
    expect(parseNumericAnswer("1/3")).toBeNull();
  });
});

describe("matchNumber", () => {
  const rule = { kind: "number", op: "eq", value: 3.14, tolerance: { unit: "abs", value: 0.01 } } as const;

  it("зачитывает ответ внутри допуска в единицах", () => {
    expect(matchNumber(rule, 3.14)).toBe(true);
    expect(matchNumber(rule, 3.1416)).toBe(true);
    expect(matchNumber(rule, 3.15)).toBe(true);
    expect(matchNumber(rule, 3.2)).toBe(false);
  });

  it("зачитывает ответ внутри допуска в процентах", () => {
    const pct = { kind: "number", op: "eq", value: 200, tolerance: { unit: "pct", value: 5 } } as const;
    expect(matchNumber(pct, 191)).toBe(false);
    expect(matchNumber(pct, 195)).toBe(true);
    expect(matchNumber(pct, 210)).toBe(true);
    expect(matchNumber(pct, 211)).toBe(false);
  });

  it("процентный допуск от отрицательного эталона считается по модулю", () => {
    const pct = { kind: "number", op: "eq", value: -200, tolerance: { unit: "pct", value: 5 } } as const;
    expect(matchNumber(pct, -195)).toBe(true);
    expect(matchNumber(pct, -180)).toBe(false);
  });

  it("без допуска сравнивает точно", () => {
    const exact = { kind: "number", op: "eq", value: 7 } as const;
    expect(matchNumber(exact, 7)).toBe(true);
    expect(matchNumber(exact, 7.0001)).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-number.test.ts`
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Написать модуль**

```ts
/**
 * @module shared/answer-check/number
 *
 * The NUMERIC rule (PRD-57 §6.6): the learner types a number, the author compares it
 * with a tolerance. A numeric answer is a RULE, not a question type — the same short
 * answer and the same blank carry it.
 *
 * This stage (Э4) is the frame: the `eq` operator and a tolerance in units or in per
 * cent. The remaining operators, the inclusiveness of a range boundary and vulgar
 * fractions belong to Э5, so the parser rejects what it cannot yet honour instead of
 * guessing — a fraction read as «not a number» is a visible «не зачтено», a fraction
 * read wrongly is a silent one.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */

/** A numeric rule as stored in `questions.correct_json`. */
export interface NumericRule {
  kind: "number";
  op: "eq";
  value: number;
  tolerance?: { unit: "abs" | "pct"; value: number };
}

/** Spaces the learner may type inside a number, the non-breaking one included. */
const NUMBER_SPACES = /[\s   ]/g;

/**
 * Read the number the learner typed.
 *
 * Both decimal separators are accepted and spacing is ignored: AC-05f requires `3.14`,
 * `3,14` and ` 3,14 ` to behave identically. What the learner typed is stored and
 * reported to the LMS verbatim elsewhere — this is the comparison form only.
 *
 * @param value Raw input; anything that is not a string reads as absent.
 * @returns The finite number, or `null` when the input is not one.
 */
export function parseNumericAnswer(value: string | null | undefined): number | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(NUMBER_SPACES, "").replace(/−/g, "-").replace(",", ".");
  if (compact === "") return null;
  if (!/^[+-]?(\d+\.?\d*|\.\d+)$/.test(compact)) return null;
  const parsed = Number(compact);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Does the answer satisfy the rule?
 *
 * A per-cent tolerance is taken from the ABSOLUTE value of the reference, so a negative
 * reference (-25 °C, and such a rule is expected — §6.6) keeps a positive window.
 *
 * @param rule   The numeric rule.
 * @param answer The learner's number, already parsed.
 * @returns True when the answer falls inside the tolerance window.
 */
export function matchNumber(rule: NumericRule, answer: number): boolean {
  if (!Number.isFinite(answer)) return false;
  const tolerance = rule.tolerance;
  const window = !tolerance
    ? 0
    : tolerance.unit === "pct"
      ? (Math.abs(rule.value) * tolerance.value) / 100
      : Math.abs(tolerance.value);
  return Math.abs(answer - rule.value) <= window;
}
```

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-check-number.test.ts`
Expected: PASS, 9 тестов.

- [ ] **Step 5: Коммит**

```bash
git add shared/answer-check/number.ts tests/answer-check-number.test.ts
git commit -m "feat(prd-57): числовое правило — каркас оператора и допуска"
```

---

## Task 4: Правило, набор и связка

**Files:**

- Create: `shared/answer-check/rules.ts`, `shared/answer-check/index.ts`
- Test: `tests/answer-check-rules.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { checkRuleSet, hasRules, type AnswerRuleSet } from "../shared/answer-check/rules";

const textSet = (join: "any" | "all", values: string[]): AnswerRuleSet => ({
  answerKind: "text",
  join,
  rules: values.map((value) => ({ kind: "text", match: "wildcard", value })),
});

describe("checkRuleSet — текст", () => {
  it("связка «любое» зачитывает по одному выполненному правилу", () => {
    const set = textSet("any", ["Ростехнадзор", "РТН"]);
    expect(checkRuleSet(set, "ртн")).toEqual({ passed: true, perRule: [false, true] });
  });

  it("связка «все» требует каждого", () => {
    const set = textSet("all", ["*надзор*", "*ростех*"]);
    expect(checkRuleSet(set, "ростехнадзор")).toEqual({ passed: true, perRule: [true, true] });
    expect(checkRuleSet(set, "госнадзор")).toEqual({ passed: false, perRule: [true, false] });
  });

  it("нормализует обе стороны", () => {
    const set = textSet("any", ["  Приём  "]);
    expect(checkRuleSet(set, "прием").passed).toBe(true);
  });

  it("подстановочный знак работает после нормализации", () => {
    const set = textSet("any", ["Федеральная служба по * надзору"]);
    const answer = "федеральная служба по экологическому, технологическому и атомному надзору";
    expect(checkRuleSet(set, answer).passed).toBe(true);
  });

  it("режим regex не зачитывается на этом этапе", () => {
    const set: AnswerRuleSet = {
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "regex", value: "^рос" }],
    };
    expect(checkRuleSet(set, "ростехнадзор")).toEqual({ passed: false, perRule: [false] });
  });
});

describe("checkRuleSet — число", () => {
  const set: AnswerRuleSet = {
    answerKind: "number",
    join: "any",
    rules: [{ kind: "number", op: "eq", value: 3.14, tolerance: { unit: "abs", value: 0.01 } }],
  };

  it("зачитывает по допуску, а не по написанию", () => {
    expect(checkRuleSet(set, "3,14").passed).toBe(true);
    expect(checkRuleSet(set, "3.1416").passed).toBe(true);
    expect(checkRuleSet(set, "3,2").passed).toBe(false);
  });

  it("нечисловой ответ не выполняет ни одного правила", () => {
    expect(checkRuleSet(set, "около трёх")).toEqual({ passed: false, perRule: [false] });
  });
});

describe("пустой набор", () => {
  const empty: AnswerRuleSet = { answerKind: "text", join: "any", rules: [] };

  it("не зачитывает ничего", () => {
    expect(checkRuleSet(empty, "что угодно")).toEqual({ passed: false, perRule: [] });
  });

  it("распознаётся как отсутствие правил", () => {
    expect(hasRules(empty)).toBe(false);
    expect(hasRules(textSet("any", ["РТН"]))).toBe(true);
    expect(hasRules(null)).toBe(false);
    expect(hasRules({} as AnswerRuleSet)).toBe(false);
  });
});

describe("пустой ответ", () => {
  it("не зачитывается даже образцом из звезды", () => {
    expect(checkRuleSet(textSet("any", ["*"]), "").passed).toBe(false);
    expect(checkRuleSet(textSet("any", ["*"]), "   ").passed).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-rules.test.ts`
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Написать модуль**

```ts
/**
 * @module shared/answer-check/rules
 *
 * The SET of comparison rules an open answer is checked against (PRD-57 §6.1) — the
 * single engine behind the short answer (§6.5) and, from Э8 on, every blank (FR-24c).
 *
 * Shape decisions, all taken by the owner on 2026-09-18 and recorded as requirements:
 * the answer KIND is a property of the question, not of a rule (FR-28d) — text and
 * number never stand side by side, because a rule of the other kind could not fire once;
 * the JOIN is one per set (FR-28c) — mixing «и» with «или» would need brackets, and
 * brackets turn a list into an expression builder the track walks away from.
 *
 * An EMPTY set is not an error: it means the author has not written the check yet. It
 * matches nothing, and {@link hasRules} is what callers ask before treating the question
 * as graded at all — the same way a keyless scale is measurement-only.
 *
 * `match: "regex"` is part of the STORED shape but is never satisfied here. The regular
 * expression arrives in Э7 together with the runtime budget it cannot ship without
 * (FR-28q); until then a rule that says `regex` fires for nobody rather than running
 * unbudgeted.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */
import { normalizeForCompare } from "./normalize";
import { matchWildcard } from "./wildcard";
import { matchNumber, parseNumericAnswer, type NumericRule } from "./number";

/** A textual rule: ordinary comparison today, a regular expression from Э7. */
export interface TextRule {
  kind: "text";
  match: "wildcard" | "regex";
  value: string;
}

/** One rule of either kind. */
export type AnswerRule = TextRule | NumericRule;

/** The whole check of one question (or, from Э8, of one blank). */
export interface AnswerRuleSet {
  answerKind: "text" | "number";
  join: "any" | "all";
  rules: AnswerRule[];
  /** Display unit shown beside the learner's field, e.g. `°C`; never typed by them. */
  unit?: string;
}

/** The verdict plus which rules fired — the list drives the Э6 probe marks. */
export interface RuleSetOutcome {
  passed: boolean;
  perRule: boolean[];
}

/** Does this set actually check anything? */
export function hasRules(set: AnswerRuleSet | null | undefined): boolean {
  return !!set && Array.isArray(set.rules) && set.rules.length > 0;
}

/** Apply one rule to an answer that has already been prepared for its kind. */
function matchOne(rule: AnswerRule, text: string, numeric: number | null): boolean {
  if (rule.kind === "number") {
    return numeric === null ? false : matchNumber(rule, numeric);
  }
  if (rule.match !== "wildcard") return false;
  return matchWildcard(normalizeForCompare(rule.value), text);
}

/**
 * Check a learner's answer against the whole set.
 *
 * An empty answer never passes: a set whose pattern is a bare `*` would otherwise award
 * the question to someone who typed nothing.
 *
 * @param set    The author's rules.
 * @param answer The learner's raw input.
 * @returns The verdict and the per-rule outcomes, in the authored order.
 */
export function checkRuleSet(set: AnswerRuleSet, answer: string | null | undefined): RuleSetOutcome {
  const rules = Array.isArray(set?.rules) ? set.rules : [];
  const text = normalizeForCompare(answer);
  if (rules.length === 0 || text === "") {
    return { passed: false, perRule: rules.map(() => false) };
  }
  const numeric = set.answerKind === "number" ? parseNumericAnswer(answer) : null;
  const perRule = rules.map((rule) => matchOne(rule, text, numeric));
  const passed = set.join === "all" ? perRule.every(Boolean) : perRule.some(Boolean);
  return { passed, perRule };
}
```

Точка входа:

```ts
/**
 * @module shared/answer-check
 *
 * Public face of the open-answer comparison engine (PRD-57 §6.1). Hosts import from
 * here; the SCORM package receives the same functions through
 * `shared/template/runtime-entry`, so there is no per-host copy (FR-28s).
 */
export { normalizeForCompare } from "./normalize";
export { matchWildcard } from "./wildcard";
export { parseNumericAnswer, matchNumber, type NumericRule } from "./number";
export {
  checkRuleSet,
  hasRules,
  type AnswerRule,
  type AnswerRuleSet,
  type RuleSetOutcome,
  type TextRule,
} from "./rules";
```

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-check-rules.test.ts`
Expected: PASS, 11 тестов.

- [ ] **Step 5: Коммит**

```bash
git add shared/answer-check/rules.ts shared/answer-check/index.ts tests/answer-check-rules.test.ts
git commit -m "feat(prd-57): набор правил, связка и исход по каждому правилу (FR-28b, FR-28c)"
```

---

## Task 5: Схема данных и валидация

**Files:**

- Modify: `shared/schema.ts` (рядом с прочими схемами Zod вопроса)
- Test: `tests/answer-check-schema.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { answerRuleSetSchema } from "../shared/schema";

describe("answerRuleSetSchema", () => {
  it("принимает текстовый набор", () => {
    const parsed = answerRuleSetSchema.parse({
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }],
    });
    expect(parsed.rules).toHaveLength(1);
  });

  it("принимает числовой набор с допуском и единицей", () => {
    const parsed = answerRuleSetSchema.parse({
      answerKind: "number",
      join: "all",
      unit: "°C",
      rules: [{ kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } }],
    });
    expect(parsed.unit).toBe("°C");
  });

  it("принимает пустой набор — правил ещё нет", () => {
    expect(answerRuleSetSchema.parse({ answerKind: "text", join: "any", rules: [] }).rules).toEqual([]);
  });

  it("не принимает regex до Э7", () => {
    const bad = { answerKind: "text", join: "any", rules: [{ kind: "text", match: "regex", value: "^рос" }] };
    expect(() => answerRuleSetSchema.parse(bad)).toThrow();
  });

  it("не принимает операторов сверх «равно» до Э5", () => {
    const bad = { answerKind: "number", join: "any", rules: [{ kind: "number", op: "gt", value: 5 }] };
    expect(() => answerRuleSetSchema.parse(bad)).toThrow();
  });

  it("не принимает набор, где вид ответа и правило расходятся", () => {
    const bad = { answerKind: "number", join: "any", rules: [{ kind: "text", match: "wildcard", value: "пять" }] };
    expect(() => answerRuleSetSchema.parse(bad)).toThrow();
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-schema.test.ts`
Expected: FAIL, `answerRuleSetSchema` не экспортируется.

- [ ] **Step 3: Добавить схему в `shared/schema.ts`**

Поставить рядом с прочими схемами содержимого вопроса (там же, где `matchingDataSchema` и
соседи, около строки 1378):

```ts
/**
 * PRD-57 §6.1: the answer check of an open question, stored in `questions.correct_json`.
 *
 * The rules ARE the answer key of a short answer, which is why they live in the existing
 * key column rather than in one of their own: snapshots, the SCORM bake, test transfer
 * and the Excel workbook already carry that column.
 *
 * Two fields are described here but NOT accepted yet, on purpose: `match: "regex"` waits
 * for the runtime budget of Э7 (FR-28q), and every numeric operator but `eq` waits for
 * Э5. The stored SHAPE is final, so those stages lift a restriction in validation
 * instead of migrating questions that are already saved.
 */
export const answerRuleSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("text"),
    match: z.literal("wildcard"),
    value: z.string().min(1),
  }),
  z.object({
    kind: z.literal("number"),
    op: z.literal("eq"),
    value: z.number().finite(),
    tolerance: z
      .object({ unit: z.enum(["abs", "pct"]), value: z.number().finite().nonnegative() })
      .optional(),
  }),
]);

export const answerRuleSetSchema = z
  .object({
    answerKind: z.enum(["text", "number"]),
    join: z.enum(["any", "all"]),
    rules: z.array(answerRuleSchema),
    unit: z.string().max(16).optional(),
  })
  .refine(
    (set) => set.rules.every((rule) => (set.answerKind === "number" ? rule.kind === "number" : rule.kind === "text")),
    { message: "Вид ответа и правила должны совпадать: текст либо число", path: ["rules"] },
  );

export type AnswerRuleSetInput = z.infer<typeof answerRuleSetSchema>;
```

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-check-schema.test.ts`
Expected: PASS, 6 тестов.

- [ ] **Step 5: Коммит**

```bash
git add shared/schema.ts tests/answer-check-schema.test.ts
git commit -m "feat(prd-57): схема набора правил в correct_json"
```

---

## Task 6: Тип «Короткий ответ» в перечислениях и признаках

**Files:**

- Modify: `shared/questions/question-type.ts`, `shared/schema.ts` (четыре перечисления: строки 274,
  1662, 1734, 2070), `server/scorm/template/app/utils/qtype.js`
- Test: `tests/answer-check-question-type.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { QUESTION_TYPES, isTextEntry, isMeasurementOnly, hasOptionList } from "../shared/questions/question-type";

describe("тип «Короткий ответ»", () => {
  it("объявлен в перечне типов", () => {
    expect(QUESTION_TYPES).toContain("short");
  });

  it("узнаётся признаком текстового ввода", () => {
    expect(isTextEntry("short")).toBe(true);
    expect(isTextEntry("single")).toBe(false);
  });

  it("не несёт списка вариантов", () => {
    expect(hasOptionList("short")).toBe(false);
  });

  it("без правил неоцениваем — как шкала без эталона", () => {
    expect(isMeasurementOnly({ type: "short", correctJson: {} })).toBe(true);
    expect(isMeasurementOnly({ type: "short", correctJson: { answerKind: "text", join: "any", rules: [] } })).toBe(true);
  });

  it("с правилами оценивается", () => {
    const correctJson = {
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "wildcard", value: "РТН" }],
    };
    expect(isMeasurementOnly({ type: "short", correctJson })).toBe(false);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-question-type.test.ts`
Expected: FAIL, `isTextEntry` не экспортируется.

- [ ] **Step 3: Правки**

В `shared/questions/question-type.ts`:

```ts
export const QUESTION_TYPES = [
  "single",
  "multiple",
  "matching",
  "ranking",
  "scale",
  "allocation",
  "short",
] as const;

/**
 * Answered by TYPING — the learner's answer is a string, not an index (PRD-57 §6.5).
 *
 * This is the trait behind every «is there an answer key to compare against?» branch the
 * open answer adds. Consumers ask it instead of `type === "short"`, so the blanks type
 * of Э8 joins by declaring the trait here and nothing downstream changes.
 */
export function isTextEntry(type: string): boolean {
  return type === "short";
}
```

В том же файле — ветка в `isMeasurementOnly`, сразу после ветки `distributesBudget`:

```ts
  // PRD-57 §5.3: a typed answer with NO rules collects text and earns nothing. The
  // absence of rules IS the switch, exactly as the absence of `correctIndex` is for a
  // scale — so an author who has not written the check yet cannot silently drag the
  // percent down.
  if (isTextEntry(question.type)) {
    const set = (question.correctJson ?? question.correct) as { rules?: unknown } | null | undefined;
    return !set || !Array.isArray(set.rules) || set.rules.length === 0;
  }
```

В `shared/schema.ts` — добавить `"short"` в КАЖДОЕ из четырёх перечислений (строки 274, 1662,
1734, 2070), сохраняя порядок остальных значений.

Четвёртое из них — `scorm_answers.question_type`, и пропустить его нельзя: без `short` в нём
телеметрия прохождения и импорт выгрузки LMS (PRD-54) упрут короткий ответ в ограничение типа
колонки. Это единственное из четырёх мест, где пропуск проявится не при сборке, а на живых данных.

В `server/scorm/template/app/utils/qtype.js` — зеркало признака рядом с остальными:

```js
  // Mirror of shared/questions/question-type.ts → isTextEntry (PRD-57 §6.5).
  function isTextEntry(type) {
    return type === 'short';
  }
```

и включить `isTextEntry` в возвращаемый объект `TBQType`.

- [ ] **Step 4: Прогнать — тест зелёный, типы сходятся**

Run: `npm test -- tests/answer-check-question-type.test.ts`
Expected: PASS, 5 тестов.

Run: `npm run check`
Expected: без ошибок. Важно: кэш `tsc` общий у worktree — если проверка молчит подозрительно
быстро, удалить `.tsbuildinfo` и прогнать заново.

- [ ] **Step 5: Коммит**

```bash
git add shared/questions/question-type.ts shared/schema.ts server/scorm/template/app/utils/qtype.js tests/answer-check-question-type.test.ts
git commit -m "feat(prd-57): тип «Короткий ответ» и признак текстового ввода"
```

---

## Task 7: Движок оценки принимает строковый ответ

**Files:**

- Modify: `shared/scoring/engine.ts` (строки 35, 102-137, 140-176)
- Test: `tests/answer-check-scoring.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { scoreAnswer, explainAnswer } from "../shared/scoring/engine";

const correct = {
  answerKind: "text",
  join: "any",
  rules: [{ kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" }],
} as const;

describe("scoreAnswer — короткий ответ", () => {
  it("зачитывает подходящий ответ", () => {
    const r = scoreAnswer({ type: "short", correct, answer: "Федеральная служба по атомному надзору" });
    expect(r.ratio).toBe(1);
  });

  it("не зачитывает неподходящий", () => {
    expect(scoreAnswer({ type: "short", correct, answer: "Минэнерго" }).ratio).toBe(0);
  });

  it("не зачитывает пустой и отсутствующий ответ", () => {
    expect(scoreAnswer({ type: "short", correct, answer: "" }).ratio).toBe(0);
    expect(scoreAnswer({ type: "short", correct, answer: null }).ratio).toBe(0);
  });

  it("считает счётчики один к одному", () => {
    const hit = explainAnswer({ type: "short", correct, answer: "федеральная служба по горному надзору" });
    expect({ c: hit.c, x: hit.x, total: hit.total }).toEqual({ c: 1, x: 0, total: 1 });
    const miss = explainAnswer({ type: "short", correct, answer: "нет" });
    expect({ c: miss.c, x: miss.x, total: miss.total }).toEqual({ c: 0, x: 1, total: 1 });
  });

  it("набор без правил не приносит балла", () => {
    const empty = { answerKind: "text", join: "any", rules: [] } as const;
    expect(scoreAnswer({ type: "short", correct: empty, answer: "что угодно" }).ratio).toBe(0);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-scoring.test.ts`
Expected: FAIL — тип `"short"` не принимается, `ratio` равен 0 там, где ожидается 1.

- [ ] **Step 3: Правки в `shared/scoring/engine.ts`**

Расширить тип ответа и форму эталона:

```ts
/** Learner answer shapes by question type (runtime encoding). */
export type Answer = number | number[] | string | Record<string, number> | null | undefined;
```

```ts
/** correct_json fields by type (a permissive superset for easy access). */
export interface CorrectData {
  correctIndex?: number;
  correctIndices?: number[];
  pairs?: Array<{ left: number; right: number }>;
  correctOrder?: number[];
  /** PRD-57 §6.1: the comparison rules of a typed answer. */
  answerKind?: "text" | "number";
  join?: "any" | "all";
  rules?: unknown[];
}
```

Импорт и ветка в `exactCorrect`, сразу после проверки на пустой ответ:

```ts
import { checkRuleSet, type AnswerRuleSet } from "../answer-check/rules";
import { isTextEntry } from "../questions/question-type";
```

```ts
  // PRD-57 §6.5: a typed answer is checked by the rule set, not by an index. An empty
  // set scores nothing — the question is not graded at all (isMeasurementOnly).
  if (isTextEntry(type)) {
    if (typeof answer !== "string") return 0;
    return checkRuleSet(correct as unknown as AnswerRuleSet, answer).passed ? 1 : 0;
  }
```

В `countTallies` — ветка перед последней строкой про `single`:

```ts
  if (isTextEntry(type)) {
    const c = exactCorrect(type, correct, answer);
    return { c, x: typeof answer === "string" && answer !== "" ? 1 - c : 0, total: 1 };
  }
```

- [ ] **Step 4: Прогнать — новый тест зелёный, прежние не сломаны**

Run: `npm test -- tests/answer-check-scoring.test.ts tests/check-answer.test.ts tests/check-answer-graded.test.ts`
Expected: PASS во всех трёх.

- [ ] **Step 5: Коммит**

```bash
git add shared/scoring/engine.ts tests/answer-check-scoring.test.ts
git commit -m "feat(prd-57): движок оценки принимает строковый ответ"
```

---

## Task 8: Один движок на оба хоста

**Files:**

- Modify: `shared/template/runtime-entry.ts`, `server/scorm/template/app/scoring/engine.js`
- Test: `tests/scoring-engine-port.test.ts` (расширить)

- [ ] **Step 1: Дописать случай в золотой тест паритета**

В `tests/scoring-engine-port.test.ts` добавить к перебираемым случаям короткий ответ:

```ts
  {
    name: "короткий ответ — подстановочный знак",
    input: {
      type: "short",
      correct: {
        answerKind: "text",
        join: "any",
        rules: [{ kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" }],
      },
      answer: "федеральная служба по атомному надзору",
    },
  },
  {
    name: "короткий ответ — мимо",
    input: { type: "short", correct: { answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "РТН" }] }, answer: "минэнерго" },
  },
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/scoring-engine-port.test.ts`
Expected: FAIL — двойник в пакете возвращает 0 там, где TypeScript даёт 1.

- [ ] **Step 3: Вывезти модуль и научить двойник делегировать**

В `shared/template/runtime-entry.ts`, рядом с прочими вывозами из `shared/scoring`:

```ts
export { checkRuleSet, hasRules, normalizeForCompare } from "../answer-check";
```

В `server/scorm/template/app/scoring/engine.js`, в `exactCorrect`, сразу после проверки на пустой
ответ:

```js
    // PRD-57 §6.5. The comparison itself is NOT reimplemented here: it arrives with the
    // shared runtime bundle (TBTemplate), the same way TBQType does. A second copy would
    // mean the author saved a rule the learner was never checked against (FR-28s).
    if (typeof TBQType !== 'undefined' && TBQType.isTextEntry(type)) {
      if (typeof answer !== 'string') return 0;
      if (typeof TBTemplate === 'undefined' || !TBTemplate.checkRuleSet) return 0;
      return TBTemplate.checkRuleSet(correct, answer).passed ? 1 : 0;
    }
```

и такую же ветку в `countTallies` двойника — `c` из `exactCorrect`, `x` равен `1 - c` при непустой
строке, `total` равен 1.

- [ ] **Step 4: Прогнать паритет и сборку пакета**

Run: `npm test -- tests/scoring-engine-port.test.ts`
Expected: PASS.

Run: `npm run scorm:sample`
Expected: пакет собирается, `out/*.zip` обновлён.

- [ ] **Step 5: Коммит**

```bash
git add shared/template/runtime-entry.ts server/scorm/template/app/scoring/engine.js tests/scoring-engine-port.test.ts
git commit -m "feat(prd-57): сравнение ответа одно на оба хоста (FR-28s)"
```

---

## Task 9: Поле участника в общем рендерере

**Files:**

- Modify: `shared/template/question-interaction.ts`, `shared/template/runtime-entry.ts`
- Create: `shared/template/short-answer-dom.ts`
- Test: `tests/answer-check-render.test.ts`

Разметку поля брать ДОСЛОВНО из согласованного эскиза
`docs/wireframes/approved/prd57-question-input.html` (состояние короткого ответа). Ничего не
изобретать: правило «дали образец — брать дословно» действует.

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { renderShortAnswer } from "../shared/template/question-interaction";

describe("renderShortAnswer", () => {
  it("рисует одно однострочное поле", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, null);
    expect(html).toContain("ou-field__input");
    expect(html).not.toContain("<textarea");
  });

  it("подставляет ответ участника", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, "РТН");
    expect(html).toContain('value="РТН"');
  });

  it("экранирует ответ, а не исполняет его", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, '"><img src=x onerror=alert(1)>');
    expect(html).not.toContain("<img");
    expect(html).toContain("&quot;");
  });

  it("показывает единицу измерения подписью у поля", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, null, { numeric: true, unit: "°C" });
    expect(html).toContain("ou-field__affix");
    expect(html).toContain("°C");
    expect(html).toContain('inputmode="decimal"');
  });

  it("в режиме только для чтения поле заперто", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, "РТН", { readonly: true });
    expect(html).toContain("disabled");
  });
});
```

Единица измерения приходит ТРЕТЬИМ аргументом, а не полем вопроса: она живёт в наборе правил
(`AnswerRuleSet.unit`), и хост передаёт её сам. Класть её на вопрос значило бы завести второе место,
где она хранится.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-render.test.ts`
Expected: FAIL, `renderShortAnswer` не экспортируется.

- [ ] **Step 3: Написать рендерер и привязку ввода**

В `shared/template/question-interaction.ts`, рядом с остальными рендерерами типа. Классы взяты из
эскиза дословно: текстовое поле — строки 267-269 файла `prd57-question-input.html`, числовое —
286-289. `maxlength` и подпись «До 40 символов» НЕ ставятся: предел длины — FR-28v, этап Э3.

```ts
/** How the host wants the field drawn; all three come from the question's rule set. */
export interface ShortAnswerOptions {
  /** The rule set is numeric — narrower field and a decimal keyboard (§6.6). */
  numeric?: boolean;
  /** Display unit printed beside the field (`°C`); the learner never types it. */
  unit?: string;
  /** Review and preview draw the answer locked. */
  readonly?: boolean;
}

/**
 * The single-line field of a typed answer (PRD-57 FR-28u).
 *
 * The value is the learner's raw text, not its comparison form: what they typed is what
 * goes to the LMS and to the report, and normalisation belongs to the comparison alone.
 */
export function renderShortAnswer(
  question: InteractionQuestion,
  answer: unknown,
  options: ShortAnswerOptions = {},
): string {
  const value = typeof answer === "string" ? answer : "";
  const numeric = options.numeric === true;
  const wrap = numeric
    ? "ou-field ou-field--l tb-answer-field tb-answer-field--num"
    : "ou-field ou-field--l ou-field--full tb-answer-field";
  const mode = numeric ? ' inputmode="decimal"' : "";
  const locked = options.readonly ? " disabled" : "";
  const affix = options.unit ? `<span class="ou-field__affix">${attrText(options.unit)}</span>` : "";
  return (
    `<div class="${wrap}">` +
    `<div class="ou-field__box">` +
    `<input class="ou-field__input" type="text"${mode} value="${attrText(value)}"` +
    ` aria-label="Ваш ответ" data-action="short-answer"${locked} />` +
    affix +
    `</div>` +
    `</div>`
  );
}
```

Создать `shared/template/short-answer-dom.ts` по договору, который уже действует у распределения
(`attachAllocation`, `shared/template/allocation-dom.ts:143`) — хост отдаёт функции доступа, модуль
возвращает отписку:

```ts
/**
 * @module shared/template/short-answer-dom
 *
 * Wires the typed answer field (PRD-57 §6.5) to its host. Interaction everywhere else in
 * the unified renderer is delegated through `data-action`, but a text field is different:
 * the answer changes on every keystroke, not on a click, so the host subscribes here
 * instead of routing through the click delegate.
 *
 * The RAW string is handed over — trimming or folding it here would mean the LMS report
 * shows something the learner did not type.
 */
export interface ShortAnswerHost {
  getAnswer(): string;
  setAnswer(value: string): void;
  isLocked?(): boolean;
}

export type DetachShortAnswer = () => void;

/** Subscribe the field inside `root`; returns the unsubscribe function. */
export function attachShortAnswer(root: HTMLElement, host: ShortAnswerHost): DetachShortAnswer {
  const field = root.querySelector<HTMLInputElement>('[data-action="short-answer"]');
  if (!field) return () => {};
  const onInput = (): void => {
    if (host.isLocked?.()) return;
    host.setAnswer(field.value);
  };
  field.addEventListener("input", onInput);
  return () => field.removeEventListener("input", onInput);
}
```

Оба экспорта добавить в `shared/template/runtime-entry.ts`:

```ts
export { renderShortAnswer, type ShortAnswerOptions } from "./question-interaction";
export { attachShortAnswer, type ShortAnswerHost } from "./short-answer-dom";
```

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-check-render.test.ts`
Expected: PASS, 5 тестов.

- [ ] **Step 5: Коммит**

```bash
git add shared/template/question-interaction.ts shared/template/short-answer-dom.ts shared/template/runtime-entry.ts tests/answer-check-render.test.ts
git commit -m "feat(prd-57): поле короткого ответа в общем рендерере (FR-30)"
```

---

## Task 10: Проводка веб-хоста

**Files:**

- Modify: `client/src/pages/learner/template-question-screen.tsx`
- Test: `tests/answer-check-web-host.test.ts`

- [ ] **Step 1: Написать падающий тест**

Тест монтирует экран вопроса типа `short`, вводит текст в поле и проверяет, что наверх ушла
строка — ровно та, что набрана, без нормализации:

```ts
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { TemplateQuestionScreen } from "../client/src/pages/learner/template-question-screen";

describe("экран вопроса — короткий ответ", () => {
  it("отдаёт набранную строку как ответ", async () => {
    const onAnswer = vi.fn();
    const { container } = render(
      <TemplateQuestionScreen
        question={{ id: "q1", type: "short", prompt: "Кто выдаёт наряд-допуск?", dataJson: {}, correctJson: {} }}
        answer={null}
        onAnswer={onAnswer}
      />,
    );
    const input = container.querySelector(".ou-field__input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "  Ростехнадзор " } });
    expect(onAnswer).toHaveBeenCalledWith("  Ростехнадзор ");
  });
});
```

Сигнатуры пропсов сверить с фактическими в `template-question-screen.tsx` и привести тест к ним —
файл существует, выдумывать его контракт нельзя.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-web-host.test.ts`
Expected: FAIL — поле не отрисовано, обработчик не вызван.

- [ ] **Step 3: Подключить привязку**

В `template-question-screen.tsx` — вызов `attachShortAnswer` там же, где экран уже подключает
`attachAllocation` и перетаскивание: ветка по признаку `isTextEntry(question.type)`, а не по
литералу типа.

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-check-web-host.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add client/src/pages/learner/template-question-screen.tsx tests/answer-check-web-host.test.ts
git commit -m "feat(prd-57): веб-хост принимает строковый ответ"
```

---

## Task 11: Блок «Проверка ответа» в ящике вопроса

**Files:**

- Create: `client/src/features/questions/answer-rules/answer-rules-block.tsx`,
  `client/src/features/questions/answer-rules/answer-rules-model.ts`
- Test: `tests/answer-rules-block.test.tsx`, `tests/answer-rules-model.test.ts`

Разметка берётся ДОСЛОВНО из `docs/wireframes/approved/prd57-answer-rule.html`: состояние
`k-list` (строки 275-360) — переключатель «Проверять ответ автоматически», сегменты «Ответ
участника — это» и «Ответ засчитывается, если выполнено», аккордеон правил с разделителями
`tb-rules__join`, кнопка «Добавить правило»; поля раскрытого правила — строки 352-370 (текст) и
888-935 (число). Строка пробы («Проверить ответ») в этом этапе НЕ делается — она принадлежит Э6.

Компоненты берутся из `@universityrt/ui-kit` импортом, а не воспроизведением классов `.ou-*`
руками.

- [ ] **Step 1: Написать падающий тест модели черновика**

```ts
import { describe, it, expect } from "vitest";
import { createDraft, switchKind, setJoin, addRule, removeRule, toCorrectJson } from "../client/src/features/questions/answer-rules/answer-rules-model";

describe("черновик набора правил", () => {
  it("переключение вида ответа не теряет набранного и возвращает его назад", () => {
    let draft = createDraft({ answerKind: "text", join: "any", rules: [{ kind: "text", match: "wildcard", value: "РТН" }] });
    draft = switchKind(draft, "number");
    draft = addRule(draft);
    expect(toCorrectJson(draft).rules[0].kind).toBe("number");
    draft = switchKind(draft, "text");
    expect(toCorrectJson(draft).rules).toEqual([{ kind: "text", match: "wildcard", value: "РТН" }]);
  });

  it("связка одна на набор", () => {
    const draft = setJoin(createDraft(null), "all");
    expect(toCorrectJson(draft).join).toBe("all");
  });

  it("удаление правила не трогает соседей", () => {
    let draft = createDraft({ answerKind: "text", join: "any", rules: [
      { kind: "text", match: "wildcard", value: "А" },
      { kind: "text", match: "wildcard", value: "Б" },
    ] });
    draft = removeRule(draft, 0);
    expect(toCorrectJson(draft).rules).toEqual([{ kind: "text", match: "wildcard", value: "Б" }]);
  });

  it("пустой набор отдаётся как отсутствие правил", () => {
    expect(toCorrectJson(createDraft(null)).rules).toEqual([]);
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-rules-model.test.ts`
Expected: FAIL, модуль не найден.

- [ ] **Step 3: Написать модель и блок**

`answer-rules-model.ts` держит ОБА набора (`text` и `number`) в одном черновике, поэтому
переключение вида ничего не теряет до сохранения (FR-28d); `toCorrectJson` отдаёт набор ТЕКУЩЕГО
вида. Функции чистые, без React — именно поэтому они тестируются отдельно от разметки.

`answer-rules-block.tsx` рисует блок по эскизу и вызывает функции модели. Переключатель «Как
сравнивать» показывает «Регулярное выражение» ЗАПЕРТЫМ с пояснением, что режим появится позже:
спрятать его нельзя — автор решит, что выражений не будет вовсе.

- [ ] **Step 4: Прогнать — тесты зелёные**

Run: `npm test -- tests/answer-rules-model.test.ts tests/answer-rules-block.test.tsx`
Expected: PASS.

Run: `npm run check:editor-ui`
Expected: без нарушений (гейт приёмки ящика по эскизам).

- [ ] **Step 5: Коммит**

```bash
git add client/src/features/questions/answer-rules tests/answer-rules-model.test.ts tests/answer-rules-block.test.tsx
git commit -m "feat(prd-57): блок «Проверка ответа» в ящике вопроса (FR-28b, FR-28c, FR-28d)"
```

---

## Task 12: Подключение блока к ящику

**Files:**

- Modify: `client/src/features/questions/question-editor-drawer.tsx` (перечень типов ~строка 244,
  `buildQuestionData` строки 299-347, `applyTypeChange` строки 493-510, разметка ~строки 620-690)
- Test: `tests/answer-rules-drawer.test.tsx`

- [ ] **Step 1: Написать падающий тест**

```tsx
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { QuestionEditorDrawer } from "../client/src/features/questions/question-editor-drawer";

describe("ящик вопроса — короткий ответ", () => {
  it("на типе «Короткий ответ» показывает блок правил вместо вариантов", async () => {
    render(<QuestionEditorDrawer open question={{ id: "q1", type: "short", prompt: "", dataJson: {}, correctJson: {} }} />);
    expect(await screen.findByText("Проверка ответа")).toBeTruthy();
    expect(screen.queryByText("Варианты ответа")).toBeNull();
  });
});
```

Пропсы сверить с фактической сигнатурой `QuestionEditorDrawer` (строка 97) и привести тест к ней.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-rules-drawer.test.tsx`
Expected: FAIL — блока нет.

- [ ] **Step 3: Подключить**

- в перечень типов Select добавить «Короткий ответ» с пиктограммой `#i-qt-short` (эскиз, строка
  243) — тип показывается ТОЛЬКО пиктограммой и подписью, сырое `short` в интерфейс не попадает;
- в `buildQuestionData` — ветка `case "short"`, отдающая `correctJson` из модели черновика;
- в `applyTypeChange` — переход на `short` и с него сохраняет уже набранное так же, как это делают
  остальные типы (FR-32 PRD-16);
- в разметке — блок правил вместо блока вариантов по признаку `isTextEntry`.

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-rules-drawer.test.tsx`
Expected: PASS.

Run: `npm run check`
Expected: без ошибок.

- [ ] **Step 5: Коммит**

```bash
git add client/src/features/questions/question-editor-drawer.tsx tests/answer-rules-drawer.test.tsx
git commit -m "feat(prd-57): тип «Короткий ответ» в ящике вопроса"
```

---

## Task 13: Приёмка

**Files:** правок кода не предполагается; всё найденное чинится и коммитится отдельно.

- [ ] **Step 1: Прогнать затронутое**

Run:

```bash
npm test -- tests/answer-check-normalize.test.ts tests/answer-check-wildcard.test.ts \
  tests/answer-check-number.test.ts tests/answer-check-rules.test.ts \
  tests/answer-check-schema.test.ts tests/answer-check-question-type.test.ts \
  tests/answer-check-scoring.test.ts tests/scoring-engine-port.test.ts \
  tests/answer-check-render.test.ts tests/answer-check-web-host.test.ts \
  tests/answer-rules-model.test.ts tests/answer-rules-block.test.tsx \
  tests/answer-rules-drawer.test.tsx
```

Expected: PASS во всех.

Полный прогон `npm test` НЕ запускать по своей воле: он занимает около восьми минут и занимает
машину. Спросить владельца и дождаться явного разрешения.

- [ ] **Step 2: Принять в браузере (AC-05a)**

Поднять `npm run dev`, войти учётной записью приёмки (`acceptance@local.test`), затем:

1. завести вопрос типа «Короткий ответ» с тремя правилами через связку «любое»:
   `Ростехнадзор`, `РТН`, `Федеральная служба по * надзору`;
2. убедиться, что свёрнутая строка называет, что правило проверяет, а связка действует на весь
   набор;
3. переключить вид ответа на «Число» и обратно — набранные правила должны вернуться целиком;
4. сохранить, пройти тест ответом «федеральная служба по экологическому, технологическому и
   атомному надзору» и увидеть балл (AC-05b, часть про подстановочные знаки);
5. проверить вопрос БЕЗ правил: балла не приносит и в знаменателе не участвует.

- [ ] **Step 3: Принять в пакете**

```bash
npm run scorm:template
npm run scorm:player
```

Пройти тот же вопрос в локальном плеере и сверить вердикт с вебом. Расхождение означает, что
двойник не делегирует — чинить в Task 8, а не подгонять.

- [ ] **Step 4: Коммит приёмки**

```bash
git add -A
git commit -m "test(prd-57): приёмка этапа Э4"
```

---

## Что этап НЕ закрывает

- Строка пробы ответа и отметки «выполнено» на строках списка — Э6 (#46); модель уже отдаёт
  `perRule`, дорисовать останется только интерфейс.
- Режим регулярного выражения, панель вставки, замер времени и бюджет в рантайме — Э7 (#47).
- Операторы сверх «равно», включительность границ, обыкновенные дроби, гистограмма — Э5 (#45).
- Предел длины ответа, поведение задания без правил на экранах §5.3, взаимодействие `fill-in`,
  аналитика и по-ответный вердикт вместо пересчёта в выгрузке — Э3 (#43).
- Пропуски — Э8 (#48).

---

## Приёмка 2026-09-20

Проведена отдельной сессией на живом приложении вместе с приёмкой Э3 (#43) — этапы делят
и тип задания, и экран прохождения. Данные после прогона удалены.

Чекбоксы шагов выше остались непроставленными с момента реализации: работа влита в `main`
2026-09-19, отметки в плане тогда не сделали.

**Прогон наборов:** 31 файл, 415 тестов зелёные.

**Проверено на живом приложении (AC-05a и часть AC-05b):**

- набор из трёх правил заводится в ящике вопроса, свёрнутая строка называет, что правило
  проверяет («Ростехнадзор» · «Обычное сравнение»);
- связка действует на весь набор и стоит МЕЖДУ строками — «или» при «любом правиле»;
- переключение вида ответа «Текст» → «Число» → «Текст» возвращает все три правила целиком,
  а несохранённые изменения помечены и возвращаются одним действием;
- подстановочный знак засчитывается: правило «Федеральная служба по * надзору» приняло
  ответ «федеральная служба по эко надзору» — и на вебе, и в пакете, вердикты совпали;
- задание без правил балла не приносит и в знаменателе не участвует.

Смешанного набора завести нельзя по построению: вид ответа переключает ВЕСЬ набор.

Итог: этап принят. Найденное на общем с Э3 экране починено коммитом `2e0e1f89`.
