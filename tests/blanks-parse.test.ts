import { describe, it, expect } from "vitest";

import { blankIds, parseBlanks } from "../shared/questions/blanks";

describe("parseBlanks", () => {
  it("находит пропуски по порядку вхождения", () => {
    const text = "Надзор осуществляет {{organ}}, а наряд действует {{srok}} суток.";
    expect(parseBlanks(text).map((b) => b.id)).toEqual(["organ", "srok"]);
  });

  it("возвращает положения, чтобы рендер и список читали один разбор", () => {
    const text = "до {{a}} после";
    const [first] = parseBlanks(text);
    expect(text.slice(first.start, first.end)).toBe("{{a}}");
  });

  it("повтор имени виден отдельным признаком", () => {
    const blanks = parseBlanks("{{a}} и снова {{a}}");
    expect(blanks.map((b) => b.duplicate)).toEqual([false, true]);
    expect(blankIds("{{a}} и снова {{a}}")).toEqual(["a"]);
  });

  it("экранированные скобки пропуском не считаются (FR-24e)", () => {
    expect(parseBlanks(String.raw`Шаблон \{{name}} печатается как есть`)).toEqual([]);
  });

  it("зарезервированные префиксы — не пропуски, но помечены (FR-24j)", () => {
    const blanks = parseBlanks("{{#if}} {{$var}} {{&raw}} {{>part}}");
    expect(blanks).toEqual([]);
    expect(parseBlanks("{{#if}}", { withReserved: true })).toEqual([
      { id: "#if", start: 0, end: 7, duplicate: false, reserved: true },
    ]);
  });

  it("пропуск без имени — ещё не пропуск и не ошибка (FR-24b)", () => {
    expect(parseBlanks("Наряд выдаёт {{}}")).toEqual([]);
  });

  it("имя — латиница, цифры и подчёркивание; регистр значим", () => {
    expect(blankIds("{{organ_1}} {{Organ}}")).toEqual(["organ_1", "Organ"]);
    // Кириллица и пробелы именем не являются: имя машинное, его читает движок.
    expect(blankIds("{{орган}} {{two words}} {{a-b}}")).toEqual([]);
  });

  it("текст без пропусков разбирается в пустой список", () => {
    expect(parseBlanks("Обычный вопрос без пропусков")).toEqual([]);
    expect(parseBlanks("")).toEqual([]);
  });
});
