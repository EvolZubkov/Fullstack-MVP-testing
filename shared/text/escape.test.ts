/**
 * @module shared/text/escape.test
 * @description Contract for the shared HTML escaper used by the markdown
 * renderer and by every host that interpolates author text into markup.
 */
import { describe, it, expect } from "vitest";
import { escapeHtml } from "./escape";

describe("escapeHtml", () => {
  it("neutralises the characters that let author text become markup", () => {
    expect(escapeHtml(`<b>x</b> & "y" 'z'`)).toBe(
      "&lt;b&gt;x&lt;/b&gt; &amp; &quot;y&quot; &#39;z&#39;",
    );
  });

  it("escapes the ampersand first, so an escaped entity is not double-escaped into nonsense", () => {
    expect(escapeHtml("<")).toBe("&lt;");
  });

  it("renders null and undefined as an empty string rather than as their names", () => {
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  it("coerces a non-string value", () => {
    expect(escapeHtml(42)).toBe("42");
  });
});
