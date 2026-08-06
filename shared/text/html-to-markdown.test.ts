/**
 * @module shared/text/html-to-markdown.test
 * @description Behaviour table for turning pasted or imported HTML into the
 * markdown subset the service stores. Two callers rely on it: the Excel import
 * (cells produced by other systems carry markup) and the editor's paste handler.
 */
import { describe, it, expect } from "vitest";
import { looksLikeHtml, htmlToMarkdown } from "./html-to-markdown";

describe("looksLikeHtml", () => {
  it("recognises markup by a known tag", () => {
    expect(looksLikeHtml("<p>текст</p>")).toBe(true);
    expect(looksLikeHtml("Ответ <b>верный</b>")).toBe(true);
  });

  it("does not mistake a comparison for markup", () => {
    expect(looksLikeHtml("если a < b и b > c")).toBe(false);
    expect(looksLikeHtml("5 < 7")).toBe(false);
  });

  it("does not mistake plain text for markup", () => {
    expect(looksLikeHtml("Обычный текст")).toBe(false);
    expect(looksLikeHtml("")).toBe(false);
  });
});

describe("htmlToMarkdown — inline", () => {
  it("turns bold into the markdown marker", () => {
    expect(htmlToMarkdown("Ответ <b>верный</b>")).toBe("Ответ **верный**");
    expect(htmlToMarkdown("Ответ <strong>верный</strong>")).toBe("Ответ **верный**");
  });

  it("turns italic into the markdown marker", () => {
    expect(htmlToMarkdown("Ответ <i>важен</i>")).toBe("Ответ *важен*");
    expect(htmlToMarkdown("Ответ <em>важен</em>")).toBe("Ответ *важен*");
  });

  it("turns a link into the markdown form", () => {
    expect(htmlToMarkdown('Смотри <a href="https://example.com">пример</a>')).toBe(
      "Смотри [пример](https://example.com)",
    );
  });

  it("keeps the label of a link whose protocol is not allowed", () => {
    expect(htmlToMarkdown('<a href="javascript:alert(1)">текст</a>')).toBe("текст");
  });
});

describe("htmlToMarkdown — structure", () => {
  it("turns a line break into a newline", () => {
    expect(htmlToMarkdown("первая<br>вторая")).toBe("первая\nвторая");
  });

  it("turns paragraphs into blank-line separated blocks", () => {
    expect(htmlToMarkdown("<p>Первый</p><p>Второй</p>")).toBe("Первый\n\nВторой");
  });

  it("treats a heading as a paragraph, the subset has no headings", () => {
    expect(htmlToMarkdown("<h1>Заголовок</h1><p>Текст</p>")).toBe("Заголовок\n\nТекст");
  });

  it("puts every list item on its own line", () => {
    expect(htmlToMarkdown("<ul><li>Первый</li><li>Второй</li></ul>")).toBe("Первый\nВторой");
  });
});

describe("htmlToMarkdown — noise", () => {
  it("drops a style block with its content, not just its tags", () => {
    expect(htmlToMarkdown("<style>.a{color:red}</style><p>Текст</p>")).toBe("Текст");
  });

  it("drops a script block with its content", () => {
    expect(htmlToMarkdown("<script>alert(1)</script><p>Текст</p>")).toBe("Текст");
  });

  it("drops Word's own tags and keeps the words", () => {
    expect(htmlToMarkdown('<p class="MsoNormal">Текст<o:p></o:p></p>')).toBe("Текст");
  });

  it("strips a tag it has no rule for, keeping what was inside", () => {
    expect(htmlToMarkdown('<span style="color:red">Текст</span>')).toBe("Текст");
  });
});

describe("htmlToMarkdown — entities", () => {
  it("decodes the named entities a document editor emits", () => {
    expect(htmlToMarkdown("<p>A &amp; B &lt;C&gt; &quot;D&quot;</p>")).toBe('A & B <C> "D"');
  });

  it("decodes a non-breaking space into an ordinary one", () => {
    expect(htmlToMarkdown("<p>в&nbsp;Москве</p>")).toBe("в Москве");
  });

  it("decodes a hexadecimal entity", () => {
    expect(htmlToMarkdown("<p>&#x41;&#x42;</p>")).toBe("AB");
  });

  it("leaves an entity it does not know as it was, rather than guessing", () => {
    expect(htmlToMarkdown("<p>&unknown; текст</p>")).toBe("&unknown; текст");
  });

  it("decodes a numeric entity", () => {
    expect(htmlToMarkdown("<p>&#1058;&#1077;&#1082;&#1089;&#1090;</p>")).toBe("Текст");
  });
});

describe("htmlToMarkdown — result shape", () => {
  it("returns canonical text: no edge whitespace, at most one blank line", () => {
    expect(htmlToMarkdown("<p>  Первый  </p><p></p><p></p><p>Второй</p>")).toBe(
      "Первый\n\nВторой",
    );
  });

  it("returns an empty string for empty input", () => {
    expect(htmlToMarkdown("")).toBe("");
  });
});
