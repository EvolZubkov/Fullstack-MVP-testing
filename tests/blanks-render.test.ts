import { describe, it, expect } from "vitest";

import { referenceAnswer, renderBlanksText } from "../shared/questions/blanks-render";
import type { AnswerRuleSet } from "../shared/answer-check";

const ORGAN: AnswerRuleSet & { id: string } = {
  id: "organ",
  answerKind: "text",
  join: "any",
  rules: [
    { kind: "text", match: "wildcard", value: "Ростехнадзор" },
    { kind: "text", match: "wildcard", value: "РТН" },
  ],
};

const SROK: AnswerRuleSet & { id: string } = {
  id: "srok",
  answerKind: "number",
  join: "any",
  rules: [{ kind: "number", op: "eq", value: 15 }],
};

const TEXT = "Надзор осуществляет {{organ}}, наряд действует {{srok}} суток.";

describe("renderBlanksText — прочерк (обзор, отчёт, списки)", () => {
  it("маркер заменяется прочерком постоянной ширины", () => {
    const text = renderBlanksText(TEXT, { mode: "dash" });
    expect(text).toBe("Надзор осуществляет ______, наряд действует ______ суток.");
  });

  it("экранированные скобки печатаются без слеша", () => {
    expect(renderBlanksText(String.raw`Шаблон \{{name}} печатается`, { mode: "dash" })).toBe(
      "Шаблон {{name}} печатается",
    );
  });

  it("текст без пропусков не меняется", () => {
    expect(renderBlanksText("Обычный вопрос", { mode: "dash" })).toBe("Обычный вопрос");
  });
});

describe("renderBlanksText — ответ участника (разбор)", () => {
  it("подставляет то, что человек написал", () => {
    const text = renderBlanksText(TEXT, { mode: "answer", answer: { organ: "РТН", srok: "15" } });
    expect(text).toBe("Надзор осуществляет РТН, наряд действует 15 суток.");
  });

  it("неотвеченный пропуск остаётся прочерком", () => {
    const text = renderBlanksText(TEXT, { mode: "answer", answer: { organ: "РТН" } });
    expect(text).toBe("Надзор осуществляет РТН, наряд действует ______ суток.");
  });
});

describe("renderBlanksText — эталон автора", () => {
  it("подставляет первое буквальное правило", () => {
    const text = renderBlanksText(TEXT, { mode: "reference", blanks: [ORGAN, SROK] });
    expect(text).toBe("Надзор осуществляет Ростехнадзор, наряд действует 15 суток.");
  });

  it("там, где эталона одной строкой нет, печатается прочерк", () => {
    // У выражения и у допуска «правильного ответа» одной строкой не существует —
    // выдумывать его нельзя.
    const regex: AnswerRuleSet & { id: string } = {
      id: "organ",
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "regex", value: "^рос.*$" }],
    };
    const text = renderBlanksText("Ответ: {{organ}}", { mode: "reference", blanks: [regex] });
    expect(text).toBe("Ответ: ______");
  });

  it("подстановочный знак эталоном не считается", () => {
    const wild: AnswerRuleSet & { id: string } = {
      id: "organ",
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" }],
    };
    expect(renderBlanksText("Ответ: {{organ}}", { mode: "reference", blanks: [wild] })).toBe("Ответ: ______");
  });
});

describe("referenceAnswer", () => {
  it("буквальное правило — это эталон", () => {
    expect(referenceAnswer(ORGAN)).toBe("Ростехнадзор");
  });

  it("числовое равенство без допуска — тоже эталон", () => {
    expect(referenceAnswer(SROK)).toBe("15");
  });

  it("равенство С допуском эталоном одной строки не даёт", () => {
    const tolerant: AnswerRuleSet = {
      answerKind: "number",
      join: "any",
      rules: [{ kind: "number", op: "eq", value: 15, tolerance: { unit: "abs", value: 2 } }],
    };
    expect(referenceAnswer(tolerant)).toBeNull();
  });

  it("набор без правил эталона не имеет", () => {
    expect(referenceAnswer({ answerKind: "text", join: "any", rules: [] })).toBeNull();
  });
});

describe("маркер не утекает туда, где полей нет (FR-24i)", () => {
  it("renderPlainText подставляет прочерк: обзор и PDF читают текст, а не разметку", async () => {
    const { renderPlainText } = await import("../shared/text/plain");
    expect(renderPlainText("Наряд выдаёт {{kto}}")).toContain("______");
    expect(renderPlainText("Наряд выдаёт {{kto}}")).not.toContain("{{kto}}");
  });

  it("stripMarkdown маркер СОХРАНЯЕТ: это машинная проекция", async () => {
    // По ней считается хеш содержимого и идёт круг экспорт-импорт книги Excel: подмена
    // текста там переписала бы задание и разошлась бы с хешем.
    const { stripMarkdown } = await import("../shared/text/plain");
    expect(stripMarkdown("Наряд выдаёт {{kto}}")).toBe("Наряд выдаёт {{kto}}");
  });
});
