/**
 * @module server/services/__tests__/question-text
 * @description Behaviour table for the write-path normalisation of question
 * texts: what a save may rewrite, and — just as important — what it must leave
 * untouched so a partial update cannot wipe a field.
 */
import { describe, it, expect } from "vitest";
import {
  normalizeOptionalText,
  normalizeQuestionData,
  normalizeIncomingText,
} from "../question-text";

describe("normalizeIncomingText", () => {
  it("stores markup as literal text by default: the editor sends markdown already", () => {
    expect(normalizeIncomingText("Ответ <b>верный</b>")).toBe("Ответ <b>верный</b>");
  });

  it("converts markup into markdown when the caller is the import path", () => {
    expect(normalizeIncomingText("Ответ <b>верный</b>", { convertHtml: true })).toBe(
      "Ответ **верный**",
    );
  });

  it("still canonicalises whitespace when there is no markup to convert", () => {
    expect(normalizeIncomingText(" текст \r\n ещё ", { convertHtml: true })).toBe("текст\nещё");
  });
});

describe("normalizeOptionalText", () => {
  it("normalises a string value", () => {
    expect(normalizeOptionalText("текст \r\n\r\n\r\n ещё")).toBe("текст\n\nещё");
  });

  it("keeps undefined as undefined: a field absent from a PUT must stay unchanged", () => {
    expect(normalizeOptionalText(undefined)).toBeUndefined();
  });

  it("keeps null as null: clearing a field is an explicit intent", () => {
    expect(normalizeOptionalText(null)).toBeNull();
  });

  it("passes a non-string value through untouched: it is not text to normalise", () => {
    expect(normalizeOptionalText(42)).toBe(42);
  });
});

describe("normalizeQuestionData", () => {
  it("normalises single- and multiple-choice options", () => {
    expect(normalizeQuestionData({ options: ["первый  ", "второй\r\n"] })).toEqual({
      options: ["первый", "второй"],
    });
  });

  it("normalises ranking items", () => {
    expect(normalizeQuestionData({ items: ["шаг 1 ", "шаг 2\r"] })).toEqual({
      items: ["шаг 1", "шаг 2"],
    });
  });

  it("normalises both sides of a matching question", () => {
    expect(normalizeQuestionData({ left: ["A "], right: ["Б\r\n"] })).toEqual({
      left: ["A"],
      right: ["Б"],
    });
  });

  it("keeps every other field of the payload as it was", () => {
    expect(normalizeQuestionData({ options: ["a "], shuffle: true, meta: { n: 1 } })).toEqual({
      options: ["a"],
      shuffle: true,
      meta: { n: 1 },
    });
  });

  it("leaves a non-string element alone instead of destroying the payload", () => {
    expect(normalizeQuestionData({ options: ["a ", 7] })).toEqual({ options: ["a", 7] });
  });

  it("passes a value that is not an object straight through", () => {
    expect(normalizeQuestionData(undefined)).toBeUndefined();
    expect(normalizeQuestionData(null)).toBeNull();
    expect(normalizeQuestionData("текст")).toBe("текст");
  });
});
