/**
 * @module shared/text/html-text.test
 * @description Behaviour table for the markup-aware author-text pass: page fields
 * that legitimately hold HTML still get canonical whitespace and Russian
 * typography, but never markdown — and never inside a tag, an attribute, a style
 * block or preformatted text.
 */
import { describe, it, expect } from "vitest";
import { applyTypographyToHtml, normalizeAuthorHtml } from "./html-text";

const NB = String.fromCharCode(160);

describe("applyTypographyToHtml — text", () => {
  it("applies quotes and dashes to the text between tags", () => {
    expect(applyTypographyToHtml('<p>Слово "важное" - тут</p>')).toBe(
      "<p>Слово «важное» — тут</p>",
    );
  });

  it("binds hanging words in the text", () => {
    expect(applyTypographyToHtml("<p>в Москве</p>")).toBe(`<p>в${NB}Москве</p>`);
  });

  it("pairs a quote that opens before a tag and closes after it", () => {
    expect(applyTypographyToHtml('<p>"<strong>текст</strong>"</p>')).toBe(
      "<p>«<strong>текст</strong>»</p>",
    );
  });
});

describe("applyTypographyToHtml — what it must not touch", () => {
  it("leaves attribute values alone", () => {
    const html = '<a href="https://example.com/a-b" class="ou-link" title="a - b">текст</a>';
    expect(applyTypographyToHtml(html)).toBe(html);
  });

  it("leaves a style block alone: CSS is not prose", () => {
    const html = '<style>.a{font-family:"Arial";margin:0 -1px}</style><p>Текст</p>';
    expect(applyTypographyToHtml(html)).toBe(html);
  });

  it("leaves preformatted text alone", () => {
    const html = '<pre>a - b   "c"</pre>';
    expect(applyTypographyToHtml(html)).toBe(html);
  });

  it("leaves code alone", () => {
    const html = "<code>const a = b - c;</code>";
    expect(applyTypographyToHtml(html)).toBe(html);
  });

  it("never introduces markdown: asterisks stay characters", () => {
    expect(applyTypographyToHtml("<p>Формула a * b</p>")).toBe("<p>Формула a * b</p>");
    expect(applyTypographyToHtml("<p>**жирный**</p>")).toBe("<p>**жирный**</p>");
  });

  it("is a no-op on its own output", () => {
    const once = applyTypographyToHtml('<p>Он сказал "жди - я в пути"</p>');
    expect(applyTypographyToHtml(once)).toBe(once);
  });
});

describe("normalizeAuthorHtml", () => {
  it("normalises line endings", () => {
    expect(normalizeAuthorHtml("<p>первый</p>\r\n<p>второй</p>")).toBe(
      "<p>первый</p>\n<p>второй</p>",
    );
  });

  it("caps a run of blank lines and trims the value", () => {
    expect(normalizeAuthorHtml("\n\n<p>текст</p>\n\n\n\n<p>ещё</p>  \n")).toBe(
      "<p>текст</p>\n\n<p>ещё</p>",
    );
  });

  it("applies typography to the text while keeping the markup", () => {
    expect(normalizeAuthorHtml('<p>Слово "важное" - тут</p>')).toBe(
      "<p>Слово «важное» — тут</p>",
    );
  });

  it("keeps preformatted text byte-for-byte", () => {
    const html = '<pre>  a - b\n\n\n   "c"  </pre>';
    expect(normalizeAuthorHtml(html)).toBe(html);
  });

  it("returns an empty string for a blank value", () => {
    expect(normalizeAuthorHtml("")).toBe("");
    expect(normalizeAuthorHtml("   ")).toBe("");
  });

  it("is a no-op on its own output", () => {
    const once = normalizeAuthorHtml('<p>Слово "важное" - тут</p>\r\n\r\n\r\n<p>ещё</p>');
    expect(normalizeAuthorHtml(once)).toBe(once);
  });
});
