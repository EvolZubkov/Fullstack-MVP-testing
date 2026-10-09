/**
 * @module shared/template/rich-text.test
 * @description PRD-59 FR-18: markup -> plain text with line breaks preserved.
 */
import { describe, it, expect } from "vitest";
import { richTextToPlain, richTextToOneLine } from "./rich-text";

describe("richTextToPlain", () => {
  it("returns plain source untouched, newlines and all", () => {
    expect(richTextToPlain("Первая строка\nВторая строка", "plain")).toBe(
      "Первая строка\nВторая строка",
    );
  });

  it("treats an absent format as plain", () => {
    expect(richTextToPlain("Текст\nещё", undefined)).toBe("Текст\nещё");
  });

  it("turns paragraph boundaries into line breaks", () => {
    expect(richTextToPlain("<p>Первый</p><p>Второй</p>", "richText")).toBe("Первый\nВторой");
  });

  it("turns <br> into a line break", () => {
    expect(richTextToPlain("Строка<br>Другая", "html")).toBe("Строка\nДругая");
  });

  it("turns list items into separate lines", () => {
    expect(richTextToPlain("<ul><li>Паспорт</li><li>Доступ</li></ul>", "richText")).toBe(
      "Паспорт\nДоступ",
    );
  });

  it("drops inline tags but keeps their text", () => {
    expect(richTextToPlain("<p>Курс для <strong>новых</strong> сотрудников</p>", "richText")).toBe(
      "Курс для новых сотрудников",
    );
  });

  it("decodes named and numeric entities", () => {
    expect(
      richTextToPlain("<p>&laquo;Ремонт&raquo; &amp; &#1090;&#1077;&#1089;&#1090;</p>", "html"),
    ).toBe("«Ремонт» & тест");
  });

  it("collapses three or more line breaks into two", () => {
    expect(richTextToPlain("<p>А</p><p></p><p></p><p>Б</p>", "richText")).toBe("А\n\nБ");
  });

  it("returns an empty string for empty input", () => {
    expect(richTextToPlain("   ", "richText")).toBe("");
    expect(richTextToPlain(null, "html")).toBe("");
  });
});

describe("richTextToOneLine", () => {
  it("collapses line breaks into spaces", () => {
    expect(richTextToOneLine("<p>Первый</p><p>Второй</p>", "richText")).toBe("Первый Второй");
  });

  it("keeps a short text whole, without an ellipsis", () => {
    expect(richTextToOneLine("Короткое описание.", "plain")).toBe("Короткое описание.");
  });

  it("cuts at a word boundary and marks the cut", () => {
    const long =
      "Курс для новых сотрудников компании, перед началом подготовьте паспорт данных и доступ к порталу обучения";
    const out = richTextToOneLine(long, "plain", 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(41);
    expect(out).toBe("Курс для новых сотрудников компании…");
  });

  it("cuts inside a word when there is no space to cut at", () => {
    expect(richTextToOneLine("Абвгдеёжзийклмн", "plain", 5)).toBe("Абвгд…");
  });

  it("returns an empty string for empty input", () => {
    expect(richTextToOneLine("", "richText")).toBe("");
  });
});
