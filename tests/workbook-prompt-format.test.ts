/**
 * @module tests/workbook-prompt-format
 * @description Формат текста задания в книге Excel (PRD-57 §4.3, FR-31).
 *
 * Книга — второй способ завести задание, и потерять в ней формат значит получить HTML,
 * прочитанный как разметка: участник увидит теги, а автор — что «импорт всё сломал».
 */
import { describe, it, expect } from "vitest";

import { serializeQuestionRow } from "../server/services/questions-export";
import { parsePromptFormatCell, printPromptFormat } from "../server/services/workbook-answer-rules";
import type { Question } from "../shared/schema";

const question = (over: Partial<Question>): Question => ({
  id: "q1",
  topicId: "t1",
  type: "single",
  prompt: "Текст",
  promptFormat: "markdown",
  dataJson: { options: ["А", "Б"] },
  correctJson: { correctIndex: 0 },
  difficulty: 50,
  orderIndex: 0,
  shuffleAnswers: true,
  feedback: null,
  feedbackMode: "general",
  feedbackCorrect: null,
  feedbackIncorrect: null,
  tags: [],
  createdBy: null,
  createdAt: new Date(),
  ...over,
} as unknown as Question);

describe("ячейка формата", () => {
  it("русские написания читаются", () => {
    expect(parsePromptFormatCell("разметка")).toBe("markdown");
    expect(parsePromptFormatCell("форматированный")).toBe("richText");
    expect(parsePromptFormatCell("html")).toBe("html");
  });

  it("пусто и незнакомое — разметка: так написаны все существующие задания", () => {
    expect(parsePromptFormatCell("")).toBe("markdown");
    expect(parsePromptFormatCell(undefined)).toBe("markdown");
    expect(parsePromptFormatCell("wysiwyg")).toBe("markdown");
  });

  it("регистр и пробелы не мешают", () => {
    expect(parsePromptFormatCell("  HTML ")).toBe("html");
    expect(parsePromptFormatCell("Форматированный")).toBe("richText");
  });

  it("печать канонична и переживает круг", () => {
    for (const format of ["markdown", "richText", "html"] as const) {
      expect(parsePromptFormatCell(printPromptFormat(format))).toBe(format);
    }
  });

  it("у разметки колонка пуста: пустая ячейка и есть «как было»", () => {
    expect(printPromptFormat("markdown")).toBe("");
  });
});

describe("строка книги", () => {
  it("несёт формат задания", () => {
    const row = serializeQuestionRow(question({ promptFormat: "html" } as Partial<Question>), "Тема");
    expect(row["Формат текста"]).toBe("html");
  });

  it("у обычного задания колонка пуста", () => {
    const row = serializeQuestionRow(question({}), "Тема");
    expect(row["Формат текста"]).toBe("");
  });

  it("текст задания печатается СЫРЫМ: круг не должен его переписывать", () => {
    const row = serializeQuestionRow(
      question({ prompt: "<p>Текст <b>жирный</b></p>", promptFormat: "html" } as Partial<Question>),
      "Тема",
    );
    expect(row["Текст вопроса"]).toBe("<p>Текст <b>жирный</b></p>");
  });
});

describe("Сложность в книге — «Не задано» (PRD-16 FR-10)", () => {
  const base = {
    id: "q1", topicId: "t1", type: "single", prompt: "Q?", promptFormat: "markdown",
    dataJson: { options: ["A", "B"] }, correctJson: { correctIndex: 0 },
    shuffleAnswers: true, tags: [], orderIndex: null, mediaUrl: null, mediaType: null,
    feedback: null, feedbackMode: "general", feedbackCorrect: null, feedbackIncorrect: null,
  };

  it("вопрос без сложности уходит ПУСТОЙ клеткой, а не 50", () => {
    expect(serializeQuestionRow({ ...base, difficulty: null } as never, "Тема")["Сложность"]).toBe("");
  });

  it("заданная сложность, в том числе 0, уходит числом", () => {
    expect(serializeQuestionRow({ ...base, difficulty: 0 } as never, "Тема")["Сложность"]).toBe(0);
    expect(serializeQuestionRow({ ...base, difficulty: 73 } as never, "Тема")["Сложность"]).toBe(73);
  });
});
