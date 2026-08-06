/**
 * @module tests/feedback-text
 * @description Выбор текста обратной связи вопроса по режиму
 * ({@link module:shared/template/feedback-banner}). Правило одно на оба хоста и оба
 * режима выдачи: до этого оно жило тремя копиями в рантайме пакета, а веб-хост его
 * вообще не знал и показывал вердикт без пояснения (issue #34).
 */
import { describe, it, expect } from "vitest";
import { feedbackTextFor } from "@shared/template/feedback-banner";

describe("feedbackTextFor", () => {
  const conditional = {
    feedbackMode: "conditional" as const,
    feedback: null,
    feedbackCorrect: "Верно, потому что…",
    feedbackIncorrect: "Неверно, потому что…",
  };

  it("в условном режиме отдаёт ветку верного ответа", () => {
    expect(feedbackTextFor(conditional, true)).toBe("Верно, потому что…");
  });

  it("в условном режиме отдаёт ветку неверного ответа", () => {
    expect(feedbackTextFor(conditional, false)).toBe("Неверно, потому что…");
  });

  it("в общем режиме отдаёт общий текст независимо от вердикта", () => {
    const general = { feedbackMode: "general" as const, feedback: "Пояснение", feedbackCorrect: null, feedbackIncorrect: null };
    expect(feedbackTextFor(general, true)).toBe("Пояснение");
    expect(feedbackTextFor(general, false)).toBe("Пояснение");
  });

  it("без режима читается как общий (легаси-вопрос до появления колонки)", () => {
    expect(feedbackTextFor({ feedback: "Пояснение" }, false)).toBe("Пояснение");
  });

  it("отдаёт null, когда нужная ветка не заполнена", () => {
    expect(feedbackTextFor({ ...conditional, feedbackCorrect: null }, true)).toBeNull();
    expect(feedbackTextFor({ ...conditional, feedbackIncorrect: "" }, false)).toBeNull();
  });

  it("в условном режиме НЕ подставляет общий текст вместо пустой ветки", () => {
    // Редактор при переключении на условный режим обнуляет `feedback`, но у
    // легаси-строки он мог остаться — показывать его здесь значило бы выдать
    // ученику текст, который автор из этого режима убрал.
    expect(feedbackTextFor({ ...conditional, feedback: "Старый общий", feedbackCorrect: null }, true)).toBeNull();
  });

  it("частичный балл идёт по ветке неверного ответа (isCorrect = ratio === 1)", () => {
    expect(feedbackTextFor(conditional, false)).toBe("Неверно, потому что…");
  });

  it("не падает на вопросе без единого текста", () => {
    expect(feedbackTextFor({}, true)).toBeNull();
    expect(feedbackTextFor({ feedbackMode: "conditional" }, false)).toBeNull();
  });
});
