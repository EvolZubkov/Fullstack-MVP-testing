/**
 * @module tests/formula-prompt
 * @description Подстановка формулы в текст задания (PRD-57 FR-07, FR-08, FR-10).
 */
import { describe, it, expect } from "vitest";

import { formulasFor, promptHtmlOf } from "../server/services/prompt-html";

describe("promptHtmlOf — формулы", () => {
  it("подставляет SVG вместо оболочки", () => {
    const html = promptHtmlOf({ prompt: String.raw`Площадь: $$S = \pi r^2$$` }).promptHtml ?? "";
    expect(html).toContain("<svg");
    expect(html).toContain('class="tb-formula"');
  });

  it("исходная запись остаётся рядом с картинкой (FR-08)", () => {
    const html = promptHtmlOf({ prompt: "Формула $$x^2$$" }).promptHtml ?? "";
    expect(html).toContain('data-latex="x^2"');
  });

  it("берёт ГОТОВУЮ картинку из задания, когда она есть", () => {
    // Требование: при переносе между установками SVG едет вместе с вопросом, а не
    // пересчитывается на приёмнике — иначе вид зависит от версии библиотеки там.
    const html = promptHtmlOf({
      prompt: "Формула $$x^2$$",
      dataJson: { formulas: { "x^2": "<svg id=\"из-запаса\"></svg>" } },
    }).promptHtml ?? "";
    expect(html).toContain("из-запаса");
  });

  it("неразобранная запись остаётся исходным текстом (FR-10)", () => {
    const html = promptHtmlOf({ prompt: String.raw`Сломано: $$\frac{a}{$$` }).promptHtml ?? "";
    expect(html).not.toContain("<svg");
    expect(html).toContain("frac");
  });

  it("текст без формул и листинга разметку заранее не считает", () => {
    expect(promptHtmlOf({ prompt: "Обычный вопрос" })).toEqual({});
  });
});

describe("formulasFor — запас задания", () => {
  it("собирает по одной картинке на запись", () => {
    const store = formulasFor("$$a^2$$ и ещё $$b^2$$ и снова $$a^2$$");
    expect(Object.keys(store).sort()).toEqual(["a^2", "b^2"]);
    expect(store["a^2"]).toContain("<svg");
  });

  it("сломанную запись в запас не кладёт", () => {
    expect(formulasFor("$$\frac{a}{$$")).toEqual({});
  });

  it("текст без формул даёт пустой запас", () => {
    expect(formulasFor("Обычный вопрос")).toEqual({});
  });
});
