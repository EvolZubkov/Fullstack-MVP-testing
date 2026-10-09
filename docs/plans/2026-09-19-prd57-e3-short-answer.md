# Короткий ответ (PRD-57, этап Э3): план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** достроить тип «Короткий ответ» до приёмки AC-04b и снять пересчёт верности в
аналитике, заменив его сохранённым по-ответным исходом.

**Architecture:** предел длины — число в конфигурации инстанса плюс `maxLength` в
`questions.data_json`; выдача в LMS — взаимодействие `fill-in` с эталоном только для
буквальных правил; частотная таблица — ветка существующего разброса ответов; по-ответный
исход — список в `AggregateResult`, который читают аналитика и выгрузка.

**Tech Stack:** TypeScript, Zod, Drizzle, React 19, `@universityrt/ui-kit`, Vitest.

**Устройство согласовано:** [docs/specs/2026-09-19-prd57-e3-short-answer-design.md](../specs/2026-09-19-prd57-e3-short-answer-design.md).
Требования: [PRD-57](../specs/prd-57/open-response-and-formatting.md) §6.5, §5.3, §7.
Ветвиться от `feat/prd57-e4-answer-rules`: тип-заготовка живёт там, в `main` его ещё нет.

**Не делать заново — это сделал Э4** (проверено по коду): задание без правил уже не входит в
знаменатель (`shared/scoring/aggregate.ts:232`), уже не участвует в разрезах
(`shared/breakdown/compute.ts:64`) и уже уходит в LMS исходом `neutral`
(`app/render/resultsPage.js:971`). Это FR-15, FR-18 и FR-16.

---

## Карта файлов

| Файл | Ответственность |
| --- | --- |
| `config/*.config.jsonc` | `limits.shortAnswerMaxLength` — системный потолок |
| `shared/schema.ts` | `maxLength` в схеме `dataJson` короткого ответа |
| `shared/template/question-interaction.ts` | `maxlength` и подпись предела у поля |
| `client/src/features/questions/answer-rules/answer-rules-block.tsx` | поле «Предел длины» |
| `server/scorm/template/app/render/resultsPage.js` | `fill-in`, `learner_response`, эталон |
| `server/services/analytics/answer-spread.ts` | частотная свёртка текстовых ответов |
| `client/src/pages/author/analytics.tsx` | ветка `short` в разборе и в эталоне |
| `shared/scoring/aggregate.ts` | список по-ответных исходов в `AggregateResult` |
| `server/routes/analytics/export.ts` | чтение сохранённых исходов вместо пересчёта |
| `server/services/analytics/test-answer-facts.ts` | то же |
| `server/routes/analytics/attempts.ts` | то же |

---

## Task 1: Системный потолок длины

**Files:**

- Modify: `config/development.config.jsonc`, `config/test.config.jsonc`,
  `config/production.config.jsonc` (и прочие файлы каталога — ключ добавляется во ВСЕ),
  `server/config.ts`
- Test: `tests/config.limits.test.ts` (расширить)

- [ ] **Step 1: Написать падающий тест**

```ts
it("несёт системный потолок длины короткого ответа", () => {
  expect(config.limits.shortAnswerMaxLength).toBe(250);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/config.limits.test.ts`
Expected: FAIL, `shortAnswerMaxLength` не определён.

- [ ] **Step 3: Добавить ключ**

В каждый файл `config/*.config.jsonc`, в блок `limits`:

```jsonc
"limits": {
  "participantsImportMaxRows": 500,
  "passwordEmailsPerHour": 3,
  // PRD-57 FR-28v: сколько символов вмещает ответ. 250 — рекомендация SCORM 2004 для
  // `fill-in`; поведение WebTutor на этом пределе ещё не измерено (#51), поэтому число
  // живёт здесь, а не в коде: замер поменяет его, не трогая заведённые задания.
  "shortAnswerMaxLength": 250
}
```

В `server/config.ts` — объявить ключ в схеме `limits` рядом с существующими, с тем же
умолчанием 250.

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/config.limits.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add config server/config.ts tests/config.limits.test.ts
git commit -m "feat(prd-57): системный потолок длины короткого ответа (FR-28v)"
```

---

## Task 2: Предел длины в модели вопроса

**Files:**

- Modify: `shared/schema.ts`
- Test: `tests/answer-check-schema.test.ts` (расширить)

- [ ] **Step 1: Написать падающий тест**

```ts
import { shortAnswerDataSchema } from "../shared/schema";

describe("shortAnswerDataSchema", () => {
  it("принимает предел длины", () => {
    expect(shortAnswerDataSchema.parse({ maxLength: 40 }).maxLength).toBe(40);
  });

  it("принимает пустой объект — предела нет, действует системный потолок", () => {
    expect(shortAnswerDataSchema.parse({}).maxLength).toBeUndefined();
  });

  it("не принимает ноль, отрицательное и дробное", () => {
    expect(() => shortAnswerDataSchema.parse({ maxLength: 0 })).toThrow();
    expect(() => shortAnswerDataSchema.parse({ maxLength: -5 })).toThrow();
    expect(() => shortAnswerDataSchema.parse({ maxLength: 12.5 })).toThrow();
  });
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-schema.test.ts`
Expected: FAIL, `shortAnswerDataSchema` не экспортируется.

- [ ] **Step 3: Добавить схему рядом с `answerRuleSetSchema`**

```ts
/**
 * PRD-57 FR-28v: содержимое короткого ответа — один только предел длины.
 *
 * Вариантов у типа нет, поэтому `data_json` несёт ровно эту настройку. Отсутствие ключа
 * означает «системный потолок» (`limits.shortAnswerMaxLength`): хранить копию потолка в
 * каждом вопросе значило бы заморозить его на момент заведения.
 */
export const shortAnswerDataSchema = z.object({
  maxLength: z.number().int().positive().optional(),
});

export type ShortAnswerData = z.infer<typeof shortAnswerDataSchema>;
```

Верхний предел здесь НЕ проверяется: потолок приходит из конфигурации инстанса, а схема
общая для всех инстансов. Ограничение потолком — дело валидации ящика (Task 3).

- [ ] **Step 4: Прогнать — тест зелёный**

Run: `npm test -- tests/answer-check-schema.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add shared/schema.ts tests/answer-check-schema.test.ts
git commit -m "feat(prd-57): предел длины в содержимом короткого ответа"
```

---

## Task 3: Предел в ящике вопроса

**Files:**

- Modify: `client/src/features/questions/answer-rules/answer-rules-block.tsx`,
  `client/src/features/questions/question-editor-drawer.tsx`
- Test: `client/src/features/questions/__tests__/answer-rules-block.test.tsx` (расширить)

- [ ] **Step 1: Написать падающий тест**

```tsx
it("предел длины вводится и отдаётся наверх", () => {
  const seen: number[] = [];
  render(<Harness initial={TEXT_SET} maxLength={40} onMaxLength={(n) => seen.push(n)} />);
  const input = screen.getByTestId("answer-rules-max-length") as HTMLInputElement;
  expect(input.value).toBe("40");
  fireEvent.change(input, { target: { value: "25" } });
  expect(seen.at(-1)).toBe(25);
  cleanup();
});

it("пустое поле означает системный предел, а не ноль", () => {
  const seen: (number | undefined)[] = [];
  render(<Harness initial={TEXT_SET} maxLength={40} onMaxLength={(n) => seen.push(n)} />);
  fireEvent.change(screen.getByTestId("answer-rules-max-length"), { target: { value: "" } });
  expect(seen.at(-1)).toBeUndefined();
  cleanup();
});
```

Серверная проверка потолка — отдельным тестом в наборе маршрута вопросов.

Харнесс расширяется двумя пропсами (`maxLength`, `onMaxLength`) — предел принадлежит
ВОПРОСУ, а не набору правил, поэтому в черновике правил ему места нет.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- client/src/features/questions/__tests__/answer-rules-block.test.tsx`
Expected: FAIL, поля нет.

- [ ] **Step 3: Добавить поле**

В блок «Проверка ответа», ПЕРЕД переключателем автопроверки: поле «Предел длины ответа»
(`Input` из ui-kit, `data-testid="answer-rules-max-length"`), подпись
«До скольких символов участник может ответить. Пусто — системный предел».

**Поправка к устройству, найденная при исполнении 2026-09-19:** канала серверных настроек к
клиенту в продукте НЕТ — ни одного места, где браузер читал бы `limits`. Поэтому потолок в
подписи числом не называется, а проверка «не больше потолка» живёт на СЕРВЕРЕ, при сохранении
вопроса: он единственный, кто знает настройку инстанса. Ошибка возвращается полем и печатается
существующим баннером `banner-question-validation` — новый механизм не заводится.

Заводить ради одного числа публичную настройку клиента было бы дороже пользы: автор узнаёт о
потолке при сохранении, с числом в тексте ошибки.

В `question-editor-drawer.tsx` — состояние `shortMaxLength`, инициализация из
`question.dataJson.maxLength`, запись в `dataJson` ветки `case "short"`.

- [ ] **Step 4: Прогнать — тесты зелёные**

Run: `npm test -- client/src/features/questions/__tests__/`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add client/src/features/questions tests
git commit -m "feat(prd-57): предел длины в ящике вопроса"
```

---

## Task 4: Предел на экране участника

**Files:**

- Modify: `shared/template/question-interaction.ts`
- Test: `tests/answer-check-render.test.ts` (расширить)

- [ ] **Step 1: Написать падающий тест**

```ts
it("ставит предел длины атрибутом и подписью", () => {
  const html = renderShortAnswer({ type: "short", dataJson: { maxLength: 40 } }, null, { maxLength: 40 });
  expect(html).toContain('maxlength="40"');
  expect(html).toContain("До 40 символов");
});

it("без предела не печатает ни атрибута, ни подписи", () => {
  const html = renderShortAnswer({ type: "short", dataJson: {} }, null);
  expect(html).not.toContain("maxlength");
  expect(html).not.toContain("ou-field__msg");
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-check-render.test.ts`
Expected: FAIL на первом тесте.

- [ ] **Step 3: Дополнить рендерер**

`ShortAnswerOptions` получает `maxLength?: number`. Разметка предела взята из согласованного
эскиза `prd57-question-input.html` (строки 267-271): атрибут `maxlength` на `input` и
`<div class="ou-field__msg">До N символов</div>` ПОСЛЕ `ou-field__box`, внутри `ou-field`.

Рендерер сам в конфигурацию не ходит — он чистый и едет в пакет. ДЕЙСТВУЮЩИЙ предел
подставляет СЕРВЕР: `questionsForClient` (`server/routes/attempts.ts:140`) и сборка данных
пакета (`server/scorm/build-export-data.ts`) кладут в `dataJson.maxLength` авторское значение
либо системный потолок. В пакете конфигурации в рантайме нет вовсе, поэтому иного места для
этой подстановки не существует.

- [ ] **Step 4: Прогнать — тесты зелёные**

Run: `npm test -- tests/answer-check-render.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add shared/template/question-interaction.ts tests/answer-check-render.test.ts
git commit -m "feat(prd-57): предел длины у поля участника"
```

---

## Task 5: Выдача в LMS взаимодействием fill-in

**Files:**

- Modify: `server/scorm/template/app/render/resultsPage.js`
- Test: `tests/scorm-interactions.test.ts` (создать, если такого нет — проверить каталог)

- [ ] **Step 1: Написать падающий тест**

Тест исполняет `resultsPage.js` тем же приёмом, каким это делает
`tests/scoring-engine-port.test.ts` (чтение файла + `new Function`), и проверяет три вещи:

```ts
it("короткий ответ уезжает взаимодействием fill-in", () => {
  expect(mapScormType({ type: "short" })).toBe("fill-in");
});

it("ответ участника уходит строкой как есть", () => {
  expect(formatResponse({ type: "short" }, "Ростехнадзор")).toBe("Ростехнадзор");
  expect(formatResponse({ type: "short" }, null)).toBe("");
});

it("эталон пишется только для буквальных правил", () => {
  const literal = { answerKind: "text", join: "any", rules: [
    { kind: "text", match: "wildcard", value: "Ростехнадзор" },
    { kind: "text", match: "wildcard", value: "РТН" },
  ] };
  expect(formatCorrectPattern({ type: "short", correct: literal })).toBe("Ростехнадзор[,]РТН");

  const wildcard = { answerKind: "text", join: "any", rules: [
    { kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" },
  ] };
  expect(formatCorrectPattern({ type: "short", correct: wildcard })).toBe("");
});
```

Разделитель эталонов `[,]` — запись SCORM 2004 для нескольких допустимых ответов `fill-in`.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/scorm-interactions.test.ts`
Expected: FAIL — `mapScormType` возвращает `other`.

- [ ] **Step 3: Правки в `resultsPage.js`**

В `mapScormType` — ветка по признаку, перед `return 'other'`:

```js
  // PRD-57 FR-27: текстовый ввод — `fill-in`. Признак, а не литерал: пропуски (Э8)
  // войдут сюда же.
  if (typeof TBQType !== 'undefined' && TBQType.isTextEntry(q.type)) return 'fill-in';
```

В `formatResponse` — ветка, возвращающая строку ответа без изменений (ответ УЖЕ строка;
нормализация живёт в сравнении и в отчёт LMS не попадает).

Эталон: функция, собирающая `correct_responses` из набора правил. Правило с `*` или `?`
делает эталон непредставимым в `fill-in`, и тогда не пишется НИЧЕГО — соврать в отчёте
хуже, чем промолчать.

- [ ] **Step 4: Прогнать — тесты зелёные, пакет собирается**

Run: `npm test -- tests/scorm-interactions.test.ts`
Expected: PASS.

Run: `npm run scorm:sample`
Expected: пакет собирается.

- [ ] **Step 5: Коммит**

```bash
git add server/scorm/template/app/render/resultsPage.js tests/scorm-interactions.test.ts
git commit -m "feat(prd-57): короткий ответ уезжает в LMS взаимодействием fill-in (FR-27)"
```

---

## Task 6: Частотная свёртка ответов

**Files:**

- Modify: `server/services/analytics/answer-spread.ts`
- Test: `server/services/analytics/__tests__/answer-spread.test.ts` (расширить)

- [ ] **Step 1: Написать падающий тест**

```ts
it("сворачивает текстовые ответы по частоте, не различая написаний", () => {
  const spread = answerSpread({
    type: "short",
    options: [],
    answers: ["Ростехнадзор", "ростехнадзор", "  РОСТЕХНАДЗОР ", "РТН"],
  });
  expect(spread.answered).toBe(4);
  expect(spread.options[0]).toEqual({ label: "Ростехнадзор", share: 75 });
  expect(spread.options[1]).toEqual({ label: "РТН", share: 25 });
});

it("подписью берёт самое частое исходное написание", () => {
  const spread = answerSpread({
    type: "short",
    options: [],
    answers: ["ртн", "ртн", "РТН"],
  });
  expect(spread.options[0].label).toBe("ртн");
});

it("пустые ответы в знаменатель не идут", () => {
  const spread = answerSpread({ type: "short", options: [], answers: ["РТН", "", null] });
  expect(spread.answered).toBe(1);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- server/services/analytics/__tests__/answer-spread.test.ts`
Expected: FAIL — тип `short` не поддержан.

- [ ] **Step 3: Добавить ветку**

`AnswerSpreadInput.type` принимает `"short"`. Свёртка идёт по ключу
`normalizeForCompare(answer)` (`@shared/answer-check`), подпись строки — самое частое
исходное написание в группе, при равенстве — первое встреченное. Доли считаются по ЛЮДЯМ,
как у шкалы: каждый ответ попадает ровно в одну группу.

Заголовок модуля дополняется третьим случаем: у короткого ответа разброс не заменяет долю
верных, а дополняет её — эталон здесь есть, и автору важно видеть, какие написания правила
НЕ ловят.

- [ ] **Step 4: Прогнать — тесты зелёные**

Run: `npm test -- server/services/analytics/__tests__/answer-spread.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/services/analytics/answer-spread.ts server/services/analytics/__tests__/answer-spread.test.ts
git commit -m "feat(prd-57): частотная свёртка ответов короткого ответа (FR-28x)"
```

---

## Task 7: По-ответный исход в результате попытки

**Files:**

- Modify: `shared/scoring/aggregate.ts`
- Test: `tests/answer-outcomes.test.ts` (создать)

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from "vitest";
import { aggregateStandardResult } from "../shared/scoring/aggregate";

describe("по-ответные исходы", () => {
  it("результат несёт исход каждого вопроса", () => {
    const result = aggregateStandardResult(/* вход собрать по фактической сигнатуре */);
    expect(result.questionOutcomes).toEqual([
      { questionId: "q1", result: "correct", earned: 1, possible: 1 },
      { questionId: "q2", result: "incorrect", earned: 0, possible: 1 },
    ]);
  });

  it("неоцениваемый вопрос получает нейтральный исход, а не «неверно»", () => {
    const result = aggregateStandardResult(/* вопрос-шкала без эталона */);
    expect(result.questionOutcomes?.find((o) => o.questionId === "q3")).toEqual({
      questionId: "q3", result: "neutral", earned: 0, possible: 0,
    });
  });
});
```

Сигнатуру `aggregateStandardResult` взять ФАКТИЧЕСКУЮ из
`shared/scoring/aggregate.ts` и собрать вход по ней — выдумывать её нельзя.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/answer-outcomes.test.ts`
Expected: FAIL, `questionOutcomes` отсутствует.

- [ ] **Step 3: Дополнить `AggregateResult`**

```ts
/** Исход ОДНОГО ответа: то, что аналитика сегодня пересчитывает по живым вопросам. */
export interface QuestionOutcome {
  questionId: string;
  /** Три состояния, как у телеметрии (PRD-54): измерительный ответ не может быть неверным. */
  result: "correct" | "incorrect" | "neutral";
  earned: number;
  possible: number;
}
```

Поле `questionOutcomes?: QuestionOutcome[]` добавляется в `AggregateResult` НЕОБЯЗАТЕЛЬНЫМ:
у попыток, завершённых до этой работы, его нет, и читатель обязан это различать (Task 8).

Заполняется в том же проходе, где считаются баллы, — второго прохода по ответам не заводить:
разойдутся.

- [ ] **Step 4: Прогнать — тесты зелёные, паритет не сломан**

Run: `npm test -- tests/answer-outcomes.test.ts tests/scoring-engine-port.test.ts tests/breakdown-aggregate.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add shared/scoring/aggregate.ts tests/answer-outcomes.test.ts
git commit -m "feat(prd-57): результат попытки несёт по-ответные исходы"
```

---

## Task 8: Аналитика читает сохранённое вместо пересчёта

**Files:**

- Modify: `server/routes/analytics/export.ts` (строки 241, 301, 720, 813),
  `server/services/analytics/test-answer-facts.ts:104`,
  `server/routes/analytics/attempts.ts:132`
- Test: `tests/analytics-stored-outcomes.test.ts` (создать)

- [ ] **Step 1: Написать падающий тест**

```ts
it("берёт исход из попытки, а не считает заново по живому вопросу", () => {
  // Вопрос ИЗМЕНЁН после прохождения: эталон другой. Выгрузка обязана показать то,
  // что засчитала попытка, иначе отчёт противоречит результату участника.
  const attempt = { id: "a1", resultJson: { questionOutcomes: [
    { questionId: "q1", result: "correct", earned: 1, possible: 1 },
  ] } };
  const liveQuestion = { id: "q1", type: "single", correctJson: { correctIndex: 9 } };
  expect(outcomeFor(attempt, liveQuestion, { q1: 0 })).toEqual({ result: "correct", earned: 1, possible: 1 });
});

it("у старой попытки считает на месте — по снимку, а не по живому вопросу", () => {
  const attempt = { id: "a0", snapshotId: "s1", resultJson: { totalCorrect: 1 } };
  const outcome = outcomeFor(attempt, snapshotQuestion, { q1: 0 });
  expect(outcome.computed).toBe(true);
});
```

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- tests/analytics-stored-outcomes.test.ts`
Expected: FAIL, `outcomeFor` не существует.

- [ ] **Step 3: Завести общего читателя и перевести на него все места**

Новый модуль `server/services/analytics/answer-outcome.ts` с единственной функцией
`outcomeFor(attempt, question, answers)`: отдаёт сохранённый исход, когда он есть, и считает
на месте, когда его нет, помечая результат признаком `computed`. Пять мест переводятся на
него; прямые вызовы `checkAnswer` в аналитике и выгрузке исчезают.

Отдельным читателем это делается не ради красоты: пять копий правила «сначала сохранённое,
потом расчёт» разойдутся на первой же правке, а разойдясь — дадут два разных числа в одном
отчёте.

Пересчёт по снимку: источник берётся так же, как это делает завершение попытки
(`dataSourceForAttempt(attempt.snapshotId)` в `server/routes/attempts.ts`).

- [ ] **Step 4: Прогнать — тесты зелёные**

Run: `npm test -- tests/analytics-stored-outcomes.test.ts tests/routes.analytics-export.test.ts tests/routes.analytics-export.coverage.test.ts`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/services/analytics/answer-outcome.ts server/routes/analytics server/services/analytics tests
git commit -m "fix(prd-57): аналитика читает сохранённый исход вместо пересчёта по живому вопросу"
```

---

## Task 9: Разбор ответа на экране

**Files:**

- Modify: `client/src/pages/author/analytics.tsx` (`formatUserAnswer` ~200,
  `formatCorrectAnswer` ~288, блок «Правильный ответ» ~617)
- Test: `client/src/pages/author/__tests__/analytics-short-answer.test.tsx` (создать)

- [ ] **Step 1: Написать падающий тест**

```tsx
it("печатает ответ участника как есть", () => {
  expect(formatUserAnswer({ questionType: "short", userAnswer: "  Ростехнадзор " }))
    .toBe("  Ростехнадзор ");
});

it("эталоном показывает правила, а не пустую рамку", () => {
  expect(formatCorrectAnswer({ questionType: "short", correctAnswer: {
    answerKind: "text", join: "any",
    rules: [{ kind: "text", match: "wildcard", value: "РТН" }],
  } })).toBe("РТН");
});

it("у задания без правил блок эталона не печатается вовсе (FR-17)", () => {
  expect(formatCorrectAnswer({ questionType: "short", correctAnswer: { rules: [] } })).toBe("");
});
```

Формы `DetailedAnswer` взять фактические из файла.

- [ ] **Step 2: Прогнать и убедиться, что падает**

Run: `npm test -- client/src/pages/author/__tests__/analytics-short-answer.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Добавить ветки**

`formatUserAnswer`: ветка `short` возвращает строку без изменений — в разборе спора важно
видеть, что человек написал `3,14`, а не то, во что мы это превратили.

`formatCorrectAnswer`: ветка `short` перечисляет значения правил через запятую; пустой набор
даёт пустую строку, а блок «Правильный ответ:» при пустой строке НЕ печатается (FR-17:
пустая рамка читается как потеря данных).

Решение, принятое здесь и записанное явно: участнику на экране разбора образец правила НЕ
показывается. `Федеральная служба по * надзору` — внутренность правила, а не ответ; печатать
её человеку значит объяснять ему наш синтаксис вместо предмета. Автору в аналитике —
показывается: ему она и адресована.

- [ ] **Step 4: Прогнать — тесты зелёные**

Run: `npm test -- client/src/pages/author/__tests__/`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add client/src/pages/author tests
git commit -m "feat(prd-57): разбор короткого ответа и его эталона (FR-17)"
```

---

## Task 10: Приёмка

- [ ] **Step 1: Прогнать затронутое**

```bash
npm test -- tests/config.limits.test.ts tests/answer-check-schema.test.ts \
  tests/answer-check-render.test.ts tests/scorm-interactions.test.ts \
  server/services/analytics/__tests__/answer-spread.test.ts tests/answer-outcomes.test.ts \
  tests/analytics-stored-outcomes.test.ts tests/scoring-engine-port.test.ts \
  client/src/features/questions/__tests__/ client/src/pages/author/__tests__/
```

Полный `npm test` НЕ запускать по своей воле — спросить владельца.

- [ ] **Step 2: Принять в браузере (AC-04b)**

1. Завести короткий ответ с правилом и пределом 40; убедиться, что в поле участника не
   вводится сорок первый символ и что подпись называет предел.
2. Пройти тест: ответ по правилу приносит балл.
3. Завести короткий ответ БЕЗ правил: балла не приносит, в разрезах не участвует, блок
   «правильный ответ» в разборе не печатается.
4. Открыть аналитику задания: частотная таблица показывает написания и доли.
5. ИЗМЕНИТЬ эталон вопроса после прохождения и открыть выгрузку: она обязана показать
   исход, который засчитала попытка, а не пересчитанный по новому эталону.

- [ ] **Step 3: Принять в пакете**

```bash
npm run scorm:template
npm run scorm:player
```

Пройти тот же вопрос; в инспекторе отладочного плеера сверить тип взаимодействия (`fill-in`),
`learner_response` и отсутствие эталона у правила с подстановочным знаком.

- [ ] **Step 4: Коммит приёмки**

```bash
git add -A
git commit -m "test(prd-57): приёмка этапа Э3"
```

---

## Что этап НЕ закрывает

- Замер предела `fill-in` на живом WebTutor — #51; до него потолок равен рекомендации
  стандарта.
- Пропуски (#48), регулярные выражения (#47), операторы и дроби (#45), проба (#46),
  развёрнутый ответ (#49), книга Excel и периметр защиты (#50).

---

## Приёмка 2026-09-20

Проведена отдельной сессией на живом приложении (второй инстанс, `PORT=8099`), учётной
записью приёмки и заведённым под неё участником; данные после прогона удалены.

Чекбоксы шагов выше остались непроставленными с момента реализации: работа влита в `main`
2026-09-19 цепочкой коммитов, отметки в плане тогда не сделали. Считать их признаком
несделанного нельзя — сверка велась по коду, тестам и живому прогону.

**Прогон наборов:** 31 файл, 415 тестов зелёные.

**Проверено на живом приложении (AC-04b и §5.3):**

- предел длины действует в поле участника и назван подписью: при пределе 40 сорок первый
  символ не вводится, в поле стоит `maxlength`, под полем — «До 40 символов»;
- короткий ответ с правилом приносит балл; эталон участнику не показывается;
- короткий ответ БЕЗ правил балла не приносит и в знаменатель не входит: из трёх выданных
  заданий результат посчитан как «2 вопроса, 2/2 верно», исход ответа — `neutral`, а не
  «неверно»;
- аналитика задания печатает ответ, его длину и исход;
- правка эталона ПОСЛЕ прохождения вердикт попытки не меняет: ответ, который новый набор
  правил уже не засчитал бы, остался `correct`;
- в пакете (отладочный плеер PRD-18, сборка из живого состояния) взаимодействие уходит
  типом `fill-in`, `learner_response` несёт набранное слово в слово, а эталона у правила с
  подстановочным знаком в выгрузке нет.

**Находки, починенные здесь же:**

1. Предел длины не доезжал до участника ни на одном хосте: отрисовка брала его только из
   `options`, а ни веб-хост, ни пакет его не передавали. В поле с пределом 40 набиралось 64
   символа. Предел стал читаться у самого задания.
2. На вебе короткий ответ нельзя было НАБРАТЬ: значение поля участвовало в разметке слота,
   каждое нажатие пересобирало сцену, поле подменялось новым узлом и фокус пропадал —
   один символ на щелчок. Значение текстового поля из пересборки убрано.

Итог: этап принят, обе находки закрыты коммитом `2e0e1f89`.
