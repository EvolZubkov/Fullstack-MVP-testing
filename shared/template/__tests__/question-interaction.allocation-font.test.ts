/**
 * @module shared/template/__tests__/question-interaction.allocation-font
 *
 * Font sizing of the allocation statements (PRD-44 FR-35) — the SAME mechanism the other
 * types use, asserted rather than assumed.
 *
 * Two shared passes size the answers, and the allocation type must feed both:
 *
 *  - the length pass ({@link optionFont} over {@link answerTexts}) sets `--tb-answer-fs`
 *    from the LONGEST answer text before the question renders;
 *  - the runtime height pass (`fitQuestionScene`) then shrinks that same variable until
 *    the answers fit the field.
 *
 * The first one is what these tests lock. `answerTexts` returns the statements through
 * its `options` branch, which is a consequence of storing them in `dataJson.options`
 * (FR-02) — a design decision that would silently regress if someone gave the type its
 * own `dataJson` shape, leaving every statement at the maximum font size.
 */
import { describe, expect, it } from "vitest";
import { answerTexts } from "../question-interaction";
import { OPTION_FIT, fitFont, optionFont } from "../fit-font";

const question = (options: string[]) => ({
  type: "allocation",
  dataJson: { options, budget: 7, minPerOption: 0, maxPerOption: 7 },
});

describe("подгонка шрифта утверждений (FR-35)", () => {
  it("общий проход видит утверждения распределения", () => {
    const q = question(["Первое утверждение", "Второе утверждение"]);
    expect(answerTexts(q)).toEqual(["Первое утверждение", "Второе утверждение"]);
  });

  it("размер считается по САМОМУ ДЛИННОМУ утверждению, как у остальных типов", () => {
    const long = "Расскажу, ради чего мы это делаем, и чем именно он усилит нашу команду";
    const q = question(["Коротко", long]);
    expect(optionFont(answerTexts(q))).toBe(fitFont(long.length, OPTION_FIT));
  });

  it("длинные утверждения дают шрифт мельче коротких", () => {
    const short = optionFont(answerTexts(question(["Да", "Нет"])));
    const long = optionFont(
      answerTexts(question(["Да", "Расскажу, ради чего мы это делаем, и чем он усилит команду"])),
    );
    expect(parseFloat(long)).toBeLessThan(parseFloat(short));
  });

  it("размер не опускается ниже нижней границы шкалы вариантов", () => {
    const huge = "с".repeat(400);
    expect(optionFont(answerTexts(question([huge, huge])))).toBe(`${OPTION_FIT.min}px`);
  });

  it("пустой список утверждений даёт максимальный размер, а не исключение", () => {
    expect(optionFont(answerTexts(question([])))).toBe(`${OPTION_FIT.max}px`);
  });
});
