import { describe, expect, it } from "vitest";
import { questionLabel } from "../question-label";

describe("questionLabel", () => {
  it("shows a task written as HTML without tags and entities", () => {
    const label = questionLabel({
      type: "single",
      promptFormat: "html",
      prompt: "<div>Какие из&nbsp;мер?</div><div>1. Данное СИ</div>",
    });
    expect(label).not.toMatch(/<div>|&nbsp;/);
    expect(label.replace(/\s+/g, " ")).toContain("Какие из мер?");
    expect(label).toContain("1. Данное СИ");
  });

  it("treats «Форматированный» the same as HTML", () => {
    expect(questionLabel({ type: "single", promptFormat: "richText", prompt: "<p>Текст</p>" })).toBe("Текст");
  });

  it("keeps a markdown task readable as before", () => {
    // Typography binds short words with a no-break space, so compare the words, not the spaces.
    const label = questionLabel({ type: "single", prompt: "Что такое **данные**?" });
    expect(label.replace(/\s+/g, " ")).toBe("Что такое данные?");
  });

  it("names a scenario question by its title", () => {
    expect(
      questionLabel({ type: "simulation", prompt: "<p>Инструкция</p>", dataJson: { scenario: { meta: { title: "Заявка" } } } }),
    ).toBe("Заявка");
  });
});
