/**
 * @module shared/template/__tests__/fit-font
 * @description Формула fit() эталона: от max отнимаем per за каждый символ сверх from,
 * зажимаем в [min, max]. Вопрос 16..32, вариант 14..22.
 */
import { describe, it, expect } from "vitest";
import { fitFont, questionFont, optionFont, QUESTION_FIT, OPTION_FIT } from "../fit-font";

describe("fitFont", () => {
  it("clamps to max for short text and min for long text", () => {
    expect(fitFont(10, QUESTION_FIT)).toBe("32px"); // below `from` → max
    expect(fitFont(1000, QUESTION_FIT)).toBe("16px"); // far past `from` → min
    expect(fitFont(10, OPTION_FIT)).toBe("22px");
    expect(fitFont(1000, OPTION_FIT)).toBe("14px");
  });

  it("shrinks linearly between from and the min floor", () => {
    // 58 chars = exactly `from` → still max (no shrink yet).
    expect(fitFont(58, QUESTION_FIT)).toBe("32px");
    // 100 chars: 32 - (100-58)*0.17 = 32 - 7.14 = 24.86 → 25px
    expect(fitFont(100, QUESTION_FIT)).toBe("25px");
  });

  it("measures the VISIBLE text: markdown markers and a URL are not seen", () => {
    // The markers become tags and the URL never reaches the screen, so counting
    // those characters would shrink the text for something nobody reads.
    expect(questionFont("Что такое **замыкание** в JavaScript и зачем оно нужно тут?")).toBe(
      questionFont("Что такое замыкание в JavaScript и зачем оно нужно тут?"),
    );
    expect(questionFont("Смотри [пример](https://example.com/a/very/long/path/here)")).toBe(
      questionFont("Смотри пример"),
    );
    expect(optionFont(["**" + "о".repeat(120) + "**"])).toBe(fitFont(120, OPTION_FIT));
  });

  it("questionFont sizes by prompt length; optionFont by the LONGEST option", () => {
    expect(questionFont("Короткий вопрос")).toBe("32px");
    expect(optionFont(["A", "B", "C"])).toBe("22px");
    // one long option drives the whole group down
    const long = "о".repeat(120);
    expect(optionFont(["A", long])).toBe(fitFont(120, OPTION_FIT));
    expect(optionFont(["A", long])).not.toBe("22px");
  });
});
