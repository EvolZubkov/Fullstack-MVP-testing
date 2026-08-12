/**
 * @module shared/text/normalize.test
 * @description Behaviour table for the canonical form author text is stored in.
 * The point of the pass is that two authors who typed the same thing on
 * different machines end up with the same bytes — and therefore the same content
 * hash.
 */
import { describe, it, expect } from "vitest";
import { normalizeAuthorText } from "./normalize";

describe("normalizeAuthorText", () => {
  it("normalises CRLF, so the same text typed on Windows and on Linux is stored alike", () => {
    expect(normalizeAuthorText("первая\r\nвторая")).toBe("первая\nвторая");
  });

  it("normalises a lone CR, which a paste from an old document still brings", () => {
    expect(normalizeAuthorText("первая\rвторая")).toBe("первая\nвторая");
  });

  it("drops trailing spaces on every line, they are invisible but change the hash", () => {
    expect(normalizeAuthorText("первая   \nвторая\t")).toBe("первая\nвторая");
  });

  it("drops leading spaces on every line: the subset gives indentation no meaning", () => {
    expect(normalizeAuthorText("первая\n   вторая")).toBe("первая\nвторая");
  });

  it("caps a run of blank lines at one, matching what the renderer would show anyway", () => {
    expect(normalizeAuthorText("первая\n\n\n\nвторая")).toBe("первая\n\nвторая");
  });

  it("trims the whole value", () => {
    expect(normalizeAuthorText("  \n текст \n  ")).toBe("текст");
  });

  it("leaves the markdown and the typography of the text alone", () => {
    expect(normalizeAuthorText('**жирный** - "цитата"')).toBe('**жирный** - "цитата"');
  });

  it("is a no-op on its own output", () => {
    const once = normalizeAuthorText("первая \r\n\r\n\r\n вторая ");
    expect(normalizeAuthorText(once)).toBe(once);
  });

  it("renders a blank or missing value as an empty string", () => {
    expect(normalizeAuthorText("")).toBe("");
    expect(normalizeAuthorText("   ")).toBe("");
    expect(normalizeAuthorText(null)).toBe("");
    expect(normalizeAuthorText(undefined)).toBe("");
  });

  it("leaves a non-string value alone by reporting it as empty", () => {
    expect(normalizeAuthorText(42 as unknown as string)).toBe("");
  });
});
