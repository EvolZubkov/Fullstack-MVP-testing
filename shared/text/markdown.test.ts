/**
 * @module shared/text/markdown.test
 * @description Behaviour table for the markdown subset authors may type into
 * question prompts and answer options, and for the safety property that makes it
 * usable: author text is escaped before any tag is generated.
 */
import { describe, it, expect } from "vitest";
import { renderInlineMarkdown, renderBlockMarkdown } from "./markdown";

/** Non-breaking space, spelled out so expectations stay readable in a diff. */
const NB = String.fromCharCode(160);

describe("renderInlineMarkdown — safety", () => {
  it("shows author markup as text instead of rendering it", () => {
    expect(renderInlineMarkdown("<b>жирный</b>")).toBe("&lt;b&gt;жирный&lt;/b&gt;");
  });

  it("shows a script the author typed as text", () => {
    expect(renderInlineMarkdown("<script>alert(1)</script>")).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("renders empty input as an empty string", () => {
    expect(renderInlineMarkdown("")).toBe("");
  });
});

describe("renderInlineMarkdown — emphasis", () => {
  it("renders double asterisks as bold", () => {
    expect(renderInlineMarkdown("Ответ **верный**")).toBe("Ответ <strong>верный</strong>");
  });

  it("renders single asterisks as italic", () => {
    expect(renderInlineMarkdown("Ответ *важен*")).toBe("Ответ <em>важен</em>");
  });

  it("leaves a lone asterisk alone, an unclosed marker is not markup", () => {
    expect(renderInlineMarkdown("Формула 5 * 3")).toBe("Формула 5 * 3");
  });
});

describe("renderInlineMarkdown — links", () => {
  it("renders a markdown link and opens it outside the attempt window", () => {
    expect(renderInlineMarkdown("Сайт [пример](https://example.com/a-b) открыт")).toBe(
      'Сайт <a href="https://example.com/a-b" target="_blank" rel="noopener noreferrer">пример</a> открыт',
    );
  });

  it("refuses a javascript: link and leaves the source visible as text", () => {
    expect(renderInlineMarkdown("[текст](javascript:alert(1))")).toBe(
      "[текст](javascript:alert(1))",
    );
  });

  it("auto-links a bare address", () => {
    expect(renderInlineMarkdown("Ссылка https://example.com дальше")).toBe(
      'Ссылка <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a> дальше',
    );
  });

  it("keeps sentence punctuation out of an auto-linked address", () => {
    expect(renderInlineMarkdown("Смотри https://example.com.")).toBe(
      'Смотри <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a>.',
    );
  });

  it("applies typography inside a link label", () => {
    expect(renderInlineMarkdown('[раздел "новый"](https://example.com)')).toBe(
      '<a href="https://example.com" target="_blank" rel="noopener noreferrer">раздел «новый»</a>',
    );
  });

  it("auto-links an e-mail address into mailto, staying in the same window", () => {
    expect(renderInlineMarkdown("Пишите на mail@example.com")).toBe(
      `Пишите на${NB}<a href="mailto:mail@example.com">mail@example.com</a>`,
    );
  });
});

describe("renderInlineMarkdown — line breaks", () => {
  it("renders a line break inline, so the result stays valid inside a heading", () => {
    expect(renderInlineMarkdown("первая\nвторая")).toBe("первая<br>вторая");
  });

  it("collapses a run of blank lines into a single visual gap", () => {
    expect(renderInlineMarkdown("первая\n\n\n\nвторая")).toBe("первая<br><br>вторая");
  });
});

describe("renderBlockMarkdown", () => {
  it("renders a blank line as a paragraph break", () => {
    expect(renderBlockMarkdown("Первый абзац\n\nВторой абзац")).toBe(
      "<p>Первый абзац</p><p>Второй абзац</p>",
    );
  });

  it("renders a single line break inside a paragraph", () => {
    expect(renderBlockMarkdown("Строка\nвторая")).toBe("<p>Строка<br>вторая</p>");
  });

  it("wraps a single line in a paragraph too, so the output shape never varies", () => {
    expect(renderBlockMarkdown("Одна строка")).toBe("<p>Одна строка</p>");
  });

  it("normalises CRLF, which is what a paste from Windows brings", () => {
    expect(renderBlockMarkdown("Первый\r\n\r\nВторой")).toBe("<p>Первый</p><p>Второй</p>");
  });

  it("drops whitespace-only paragraphs instead of rendering empty boxes", () => {
    expect(renderBlockMarkdown("Первый\n\n   \n\nВторой")).toBe("<p>Первый</p><p>Второй</p>");
  });

  it("renders empty input as nothing at all", () => {
    expect(renderBlockMarkdown("")).toBe("");
    expect(renderBlockMarkdown("   ")).toBe("");
  });

  it("carries the inline subset into each paragraph", () => {
    expect(renderBlockMarkdown("Ответ **верный**\n\nСайт https://example.com")).toBe(
      "<p>Ответ <strong>верный</strong></p>" +
        '<p>Сайт <a href="https://example.com" target="_blank" rel="noopener noreferrer">https://example.com</a></p>',
    );
  });
});

describe("renderInlineMarkdown — typography", () => {
  it("applies the typography pass to the text around the markup", () => {
    expect(renderInlineMarkdown('Слово "важное" здесь')).toBe("Слово «важное» здесь");
  });

  it("never touches the inside of a URL, where a hyphen is not a dash", () => {
    expect(renderInlineMarkdown("https://example.com/a-b-c")).toBe(
      '<a href="https://example.com/a-b-c" target="_blank" rel="noopener noreferrer">https://example.com/a-b-c</a>',
    );
  });
});
