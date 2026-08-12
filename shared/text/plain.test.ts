/**
 * @module shared/text/plain.test
 * @description Behaviour table for the two plain-text projections of author
 * markdown: the machine-facing one (exports, hashes, font metrics) and the
 * reader-facing one (review screen, PDF).
 */
import { describe, it, expect } from "vitest";
import { stripMarkdown, renderPlainText } from "./plain";

/** Non-breaking space, spelled out so expectations stay readable in a diff. */
const NB = String.fromCharCode(160);

describe("stripMarkdown", () => {
  it("drops emphasis markers and keeps the words", () => {
    expect(stripMarkdown("Ответ **верный** и *важный*")).toBe("Ответ верный и важный");
  });

  it("keeps only the label of a link", () => {
    expect(stripMarkdown("Смотри [пример](https://example.com) тут")).toBe(
      "Смотри пример тут",
    );
  });

  it("keeps a bare address readable as text", () => {
    expect(stripMarkdown("Смотри https://example.com")).toBe("Смотри https://example.com");
  });

  it("leaves typography alone, so an Excel round-trip cannot rewrite the stored text", () => {
    expect(stripMarkdown('Слово "важное" - здесь')).toBe('Слово "важное" - здесь');
  });

  it("does not escape HTML: the result is text, not markup", () => {
    expect(stripMarkdown("<b>x</b>")).toBe("<b>x</b>");
  });

  it("renders empty input as an empty string", () => {
    expect(stripMarkdown("")).toBe("");
  });
});

describe("renderPlainText", () => {
  it("drops the markup and applies typography, for a screen that shows text only", () => {
    expect(renderPlainText('Ответ **верный** - "точно"')).toBe("Ответ верный — «точно»");
  });

  it("binds hanging words, as every other learner screen does", () => {
    expect(renderPlainText("в Москве")).toBe(`в${NB}Москве`);
  });

  it("renders empty input as an empty string", () => {
    expect(renderPlainText("")).toBe("");
  });
});
