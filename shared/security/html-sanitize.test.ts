/**
 * @module shared/security/html-sanitize.test
 * @description Scoping of author `<style>` blocks: the sanitiser is the single
 * seam where a pasted fragment is normalised, so confining its CSS to the
 * placeholder region happens here too (both hosts then render the same CSS).
 */
import { describe, it, expect } from "vitest";
import { sanitizeHtml, sanitizeHtmlWithDiagnostics, sanitizeValuesWithDiagnostics } from "./html-sanitize";

const DOC_CSS = '<style>body { display: flex; } .btn { color: red; }</style><div class="btn">x</div>';

describe("sanitizeHtml with a scope", () => {
  it("leaves a style block alone when no scope is given (legacy callers)", () => {
    expect(sanitizeHtml(DOC_CSS)).toContain("<style>body { display: flex; }");
  });

  it("confines document-level CSS to the scope", () => {
    const out = sanitizeHtml(DOC_CSS, { scope: '[data-placeholder="body"]' });
    expect(out).not.toMatch(/<style[^>]*>body \{/);
    expect(out).toContain('[data-placeholder="body"] { display: flex; }');
    expect(out).toContain('[data-placeholder="body"] .btn { color: red; }');
  });

  it("still strips unsafe tags when scoping", () => {
    const out = sanitizeHtml('<script>x</script><style>body { a: 1; }</style>', {
      scope: ".content-page--html",
    });
    expect(out).not.toContain("<script>");
    expect(out).toContain(".content-page--html { a: 1; }");
  });

  it("reports the scoped block as a diagnostic, not as a removal", () => {
    const { removed } = sanitizeHtmlWithDiagnostics(DOC_CSS, { scope: '[data-placeholder="body"]' });
    const styleRecord = removed.find((r) => r.kind === "style");
    expect(styleRecord).toEqual({ kind: "style", label: "<style>", count: 2 });
  });

  it("reports nothing when the markup carries no CSS", () => {
    const { removed } = sanitizeHtmlWithDiagnostics("<p>plain</p>", { scope: ".x" });
    expect(removed).toEqual([]);
  });
});

describe("sanitizeValuesWithDiagnostics", () => {
  it("scopes each html placeholder to its own region", () => {
    const { values, diagnostics } = sanitizeValuesWithDiagnostics(
      { body: DOC_CSS, title: "Plain" },
      [
        { key: "body", type: "html" },
        { key: "title", type: "text" },
      ],
    );
    expect(String(values.body)).toContain('[data-placeholder="body"] { display: flex; }');
    expect(values.title).toBe("Plain");
    expect(diagnostics.body?.some((r) => r.kind === "style")).toBe(true);
  });

  it("is idempotent — re-sanitising a stored value does not stack prefixes", () => {
    const placeholders = [{ key: "body", type: "html" }];
    const once = sanitizeValuesWithDiagnostics({ body: DOC_CSS }, placeholders).values;
    const twice = sanitizeValuesWithDiagnostics(once, placeholders);
    expect(twice.values.body).toBe(once.body);
    expect(twice.diagnostics.body).toBeUndefined();
  });
});
