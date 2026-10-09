import { describe, it, expect } from "vitest";

import { QUESTION_TYPES, hasBlanks, isMeasurementOnly, isTextEntry } from "../shared/questions/question-type";
import { blanksCorrectSchema } from "../shared/schema";

const RULES = [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }];

describe("тип «Пропуски»", () => {
  it("объявлен в перечне типов", () => {
    expect(QUESTION_TYPES).toContain("blanks");
  });

  it("не считается коротким ответом", () => {
    // У короткого ответа ОДИН набор правил на задание, у пропусков — по набору на
    // пропуск. Смешать их значит потом чинить каждое место, где «текстовый ввод»
    // означало одно поле.
    expect(isTextEntry("blanks")).toBe(false);
    expect(hasBlanks("blanks")).toBe(true);
    expect(hasBlanks("short")).toBe(false);
  });

  it("задание, где ни у одного пропуска нет правил, неоцениваемо", () => {
    expect(
      isMeasurementOnly({ type: "blanks", correctJson: { blanks: [{ id: "a", answerKind: "text", join: "any", rules: [] }] } }),
    ).toBe(true);
    expect(isMeasurementOnly({ type: "blanks", correctJson: {} })).toBe(true);
  });

  it("одного пропуска с правилами достаточно, чтобы задание оценивалось", () => {
    expect(
      isMeasurementOnly({
        type: "blanks",
        correctJson: {
          blanks: [
            { id: "a", answerKind: "text", join: "any", rules: RULES },
            { id: "b", answerKind: "text", join: "any", rules: [] },
          ],
        },
      }),
    ).toBe(false);
  });
});

describe("blanksCorrectSchema", () => {
  it("принимает наборы правил по пропускам", () => {
    const parsed = blanksCorrectSchema.parse({
      blanks: [
        { id: "organ", answerKind: "text", join: "any", rules: RULES },
        { id: "srok", answerKind: "number", join: "any", rules: [{ kind: "number", op: "eq", value: 15 }] },
      ],
    });
    expect(parsed.blanks).toHaveLength(2);
  });

  it("отвергает повтор имени (FR-24a)", () => {
    const bad = {
      blanks: [
        { id: "a", answerKind: "text", join: "any", rules: RULES },
        { id: "a", answerKind: "text", join: "any", rules: RULES },
      ],
    };
    expect(() => blanksCorrectSchema.parse(bad)).toThrow();
  });

  it("отвергает имя не по правилам разметки", () => {
    const bad = { blanks: [{ id: "два слова", answerKind: "text", join: "any", rules: RULES }] };
    expect(() => blanksCorrectSchema.parse(bad)).toThrow();
  });

  it("принимает задание без пропусков: автор ещё не написал текст", () => {
    expect(blanksCorrectSchema.parse({ blanks: [] }).blanks).toEqual([]);
  });

  it("принимает пропуск без правил: это несделанная работа, а не ошибка формы", () => {
    const parsed = blanksCorrectSchema.parse({ blanks: [{ id: "a", answerKind: "text", join: "any", rules: [] }] });
    expect(parsed.blanks[0].rules).toEqual([]);
  });
});
