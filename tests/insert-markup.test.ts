/**
 * @module tests/insert-markup
 * @description Вставка разметки кнопкой в текст задания (PRD-57 FR-09a, FR-24b).
 *
 * Кнопка вставки — не удобство, а условие пользования механикой: автор, обязанный помнить
 * три обратные кавычки с языком и два доллара, просто не станет ими пользоваться. Поэтому
 * проверяется не «что-то вставилось», а три вещи разом: куда встала разметка, что стало с
 * выделенным текстом и ГДЕ остался курсор — от последнего зависит, продолжит автор печатать
 * внутри вставки или снаружи.
 */
import { describe, it, expect } from "vitest";

import { insertMarkup, CODE_LANGUAGES } from "../client/src/features/questions/insert-markup";

/** Короткая запись: текст с `|` вместо курсора (или `[…]` вокруг выделения). */
function at(text: string): { value: string; from: number; to: number } {
  const start = text.indexOf("[");
  if (start >= 0) {
    const end = text.indexOf("]");
    return {
      value: text.slice(0, start) + text.slice(start + 1, end) + text.slice(end + 1),
      from: start,
      to: end - 1,
    };
  }
  const caret = text.indexOf("|");
  return { value: text.replace("|", ""), from: caret, to: caret };
}

/** Результат в той же записи: `|` показывает, где остался курсор. */
function show(result: { value: string; caret: number }): string {
  return result.value.slice(0, result.caret) + "|" + result.value.slice(result.caret);
}

describe("пропуск", () => {
  it("встаёт в позицию курсора, курсор — внутри скобок", () => {
    const { value, from, to } = at("Столица — |, основана в 1703.");
    expect(show(insertMarkup({ kind: "blank", value, from, to })))
      .toBe("Столица — {{|}}, основана в 1703.");
  });

  it("оборачивает выделенное: имя пропуска уже набрано", () => {
    const { value, from, to } = at("Столица — [city], основана в 1703.");
    const result = insertMarkup({ kind: "blank", value, from, to });
    expect(result.value).toBe("Столица — {{city}}, основана в 1703.");
    // Курсор за вставкой: имя уже есть, дописывать внутри нечего.
    expect(show(result)).toBe("Столица — {{city}}|, основана в 1703.");
  });
});

describe("формула", () => {
  it("ставит два доллара и курсор между ними", () => {
    const { value, from, to } = at("Доля считается по формуле |.");
    expect(show(insertMarkup({ kind: "formula", value, from, to })))
      .toBe("Доля считается по формуле $$|$$.");
  });

  it("оборачивает выделенную запись", () => {
    const { value, from, to } = at("Формула [E = mc^2] известна всем.");
    const result = insertMarkup({ kind: "formula", value, from, to });
    expect(result.value).toBe("Формула $$E = mc^2$$ известна всем.");
    expect(show(result)).toBe("Формула $$E = mc^2$$| известна всем.");
  });
});

describe("листинг", () => {
  it("ставит блок с языком, курсор — на пустой строке внутри", () => {
    const { value, from, to } = at("Что выведет код?\n\n|");
    const result = insertMarkup({ kind: "code", language: "python", value, from, to });
    expect(result.value).toBe("Что выведет код?\n\n```python\n\n```");
    expect(show(result)).toBe("Что выведет код?\n\n```python\n|\n```");
  });

  it("«без подсветки» — блок без языка, а не со словом «text»", () => {
    const { value, from, to } = at("|");
    const result = insertMarkup({ kind: "code", language: "", value, from, to });
    expect(result.value).toBe("```\n\n```");
  });

  it("оборачивает выделенный фрагмент кода, отделяя блок от абзаца", () => {
    // Пустая строка ставится и здесь: правило одно для всех вставок листинга, иначе блок
    // оказывался бы то отделён, то приклеен — в зависимости от того, было ли выделение.
    const { value, from, to } = at("Код:\n[SELECT 1;]\nКонец.");
    const result = insertMarkup({ kind: "code", language: "sql", value, from, to });
    expect(result.value).toBe("Код:\n\n```sql\nSELECT 1;\n```\nКонец.");
  });

  it("отделяется от предыдущей строки пустой: иначе блок прилипнет к абзацу", () => {
    const { value, from, to } = at("Что выведет код?|");
    const result = insertMarkup({ kind: "code", language: "sql", value, from, to });
    expect(result.value).toBe("Что выведет код?\n\n```sql\n\n```");
  });

  it("языки — ровно те, что умеет подсветка сервера", () => {
    expect(CODE_LANGUAGES.map((l: { value: string }) => l.value)).toEqual(["python", "sql", "javascript", ""]);
  });
});

describe("пустое поле и край текста", () => {
  it("вставка в пустое поле работает", () => {
    const result = insertMarkup({ kind: "formula", value: "", from: 0, to: 0 });
    expect(result.value).toBe("$$$$");
    expect(result.caret).toBe(2);
  });

  it("положение курсора за пределами текста не ломает вставку", () => {
    const result = insertMarkup({ kind: "blank", value: "Текст", from: 999, to: 999 });
    expect(result.value).toBe("Текст{{}}");
  });
});
