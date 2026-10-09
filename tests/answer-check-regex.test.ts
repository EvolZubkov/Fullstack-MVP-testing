import { describe, it, expect } from "vitest";

import { compileExpression, matchExpression } from "../shared/answer-check/regex";

describe("compileExpression", () => {
  it("компилирует без флага g: два вызова подряд дают один результат", () => {
    // С флагом `g` у RegExp появляется память (lastIndex), и повторная проверка того же
    // ответа тем же правилом отвечает иначе — это выглядит как случайная оценка.
    const re = compileExpression("надзор");
    expect(re).not.toBeNull();
    expect(re!.global).toBe(false);
    expect(re!.test("надзор")).toBe(true);
    expect(re!.test("надзор")).toBe(true);
  });

  it("сравнивает без учёта регистра", () => {
    expect(compileExpression("Ростехнадзор")!.ignoreCase).toBe(true);
  });

  it("невалидное выражение даёт null, а не исключение", () => {
    expect(compileExpression("([а-я")).toBeNull();
    expect(compileExpression("*")).toBeNull();
  });

  it("устаревшие экранирования не отвергаются", () => {
    // Флаг `u` отверг бы это выражение — и отверг бы СОХРАНЁННОЕ задание при обновлении.
    expect(compileExpression("\\d+\\-\\d+")).not.toBeNull();
  });
});

describe("matchExpression", () => {
  it("зачитывает подходящий ответ независимо от регистра", () => {
    expect(matchExpression("^ростехнадзор$", "Ростехнадзор")).toBe(true);
  });

  it("снимает краевые пробелы ответа", () => {
    expect(matchExpression("^ростехнадзор$", "  Ростехнадзор  ")).toBe(true);
  });

  it("нормализацию §6.1 НЕ применяет: автор сам решает, что считать различием", () => {
    // «ё» к «е» не сводится: выражение — это про форму ответа, и правило автора здесь
    // сильнее общих послаблений обычного сравнения.
    expect(matchExpression("^ёлка$", "елка")).toBe(false);
    expect(matchExpression("^ёлка$", "Ёлка")).toBe(true);
  });

  it("невалидное выражение не совпадает ни с чем", () => {
    expect(matchExpression("([а-я", "что угодно")).toBe(false);
  });

  it("пустой ответ не зачитывается даже выражением, которое ему рад", () => {
    expect(matchExpression(".*", "")).toBe(false);
    expect(matchExpression(".*", "   ")).toBe(false);
  });

  it("выражение из требований ловит то, ради чего написано", () => {
    const expr = "^федеральная служба по .* надзору$";
    expect(matchExpression(expr, "Федеральная служба по экологическому надзору")).toBe(true);
    expect(matchExpression(expr, "Роспотребнадзор")).toBe(false);
  });
});
