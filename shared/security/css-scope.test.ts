/**
 * @module shared/security/css-scope.test
 * @description Transformation table for the author-CSS scoper: what an inline
 * `<style>` block written by a content author becomes once it is confined to the
 * placeholder region it was pasted into.
 */
import { describe, it, expect } from "vitest";
import { scopeCss, scopeStyleBlocks } from "./css-scope";

const SCOPE = '[data-placeholder="body"]';

describe("scopeCss", () => {
  it("replaces a `body` rule with the scope itself, so it stops styling the document", () => {
    const { value } = scopeCss("body { display: flex; }", SCOPE);
    expect(value).toBe('[data-placeholder="body"] { display: flex; }');
  });

  it("replaces `html` and `:root` the same way", () => {
    expect(scopeCss("html { height: 100%; }", SCOPE).value).toBe(
      '[data-placeholder="body"] { height: 100%; }',
    );
    expect(scopeCss(":root { --c: red; }", SCOPE).value).toBe(
      '[data-placeholder="body"] { --c: red; }',
    );
  });

  it("collapses a chain of root selectors into a single scope", () => {
    expect(scopeCss("html body { margin: 0; }", SCOPE).value).toBe(
      '[data-placeholder="body"] { margin: 0; }',
    );
  });

  it("keeps the rest of a compound root selector", () => {
    expect(scopeCss("body .card { color: red; }", SCOPE).value).toBe(
      '[data-placeholder="body"] .card { color: red; }',
    );
    expect(scopeCss("body.dark { color: red; }", SCOPE).value).toBe(
      '[data-placeholder="body"].dark { color: red; }',
    );
  });

  it("prefixes the universal selector instead of replacing it", () => {
    expect(scopeCss("* { margin: 0; padding: 0; }", SCOPE).value).toBe(
      '[data-placeholder="body"] * { margin: 0; padding: 0; }',
    );
  });

  it("prefixes an ordinary selector", () => {
    expect(scopeCss(".card { color: red; }", SCOPE).value).toBe(
      '[data-placeholder="body"] .card { color: red; }',
    );
  });

  it("prefixes every part of a selector list", () => {
    expect(scopeCss("h1, h2 { font-weight: 700; }", SCOPE).value).toBe(
      '[data-placeholder="body"] h1, [data-placeholder="body"] h2 { font-weight: 700; }',
    );
  });

  it("does not mistake a class or attribute value for a root selector", () => {
    expect(scopeCss('.body [data-x="body"] { color: red; }', SCOPE).value).toBe(
      '[data-placeholder="body"] .body [data-x="body"] { color: red; }',
    );
  });

  it("scopes the rules inside a conditional at-rule but leaves the at-rule alone", () => {
    const { value } = scopeCss("@media (max-width: 768px) { .card { padding: 0; } }", SCOPE);
    expect(value).toBe(
      '@media (max-width: 768px) { [data-placeholder="body"] .card { padding: 0; } }',
    );
  });

  it("leaves keyframe selectors untouched", () => {
    const css = "@keyframes fade { from { opacity: 0; } to { opacity: 1; } }";
    expect(scopeCss(css, SCOPE).value).toBe(css);
  });

  it("leaves @font-face untouched", () => {
    const css = "@font-face { font-family: X; src: url(x.woff2); }";
    expect(scopeCss(css, SCOPE).value).toBe(css);
  });

  it("drops @import — an external stylesheet breaks package autonomy", () => {
    const { value } = scopeCss('@import url("https://cdn.example/x.css");\n.card { color: red; }', SCOPE);
    expect(value).not.toContain("@import");
    expect(value).toContain('[data-placeholder="body"] .card');
  });

  it("preserves comments and does not read selectors out of them", () => {
    const { value } = scopeCss("/* body { x } */\n.card { color: red; }", SCOPE);
    expect(value).toBe('/* body { x } */\n[data-placeholder="body"] .card { color: red; }');
  });

  it("reports how many rules it rewrote", () => {
    expect(scopeCss("body { a: 1; } .card { b: 2; }", SCOPE).rules).toBe(2);
    expect(scopeCss("@keyframes k { from { opacity: 0; } }", SCOPE).rules).toBe(0);
  });

  it("returns empty input unchanged", () => {
    expect(scopeCss("", SCOPE)).toEqual({ value: "", rules: 0 });
  });
});

describe("scopeCss — malformed and exotic input", () => {
  it("survives an unterminated comment", () => {
    expect(scopeCss(".card { color: red; } /* oops", SCOPE).value).toBe(
      '[data-placeholder="body"] .card { color: red; } /* oops',
    );
  });

  it("survives an unterminated block", () => {
    expect(scopeCss(".card { color: red", SCOPE).value).toBe(
      '[data-placeholder="body"] .card { color: red}',
    );
  });

  it("does not read braces or semicolons out of a quoted string", () => {
    const css = '.a[title="x;y{z"] { color: red; }';
    expect(scopeCss(css, SCOPE).value).toBe('[data-placeholder="body"] .a[title="x;y{z"] { color: red; }');
  });

  it("keeps an escaped quote inside a declaration", () => {
    const css = '.a { content: "a\\"b{"; }';
    expect(scopeCss(css, SCOPE).value).toBe('[data-placeholder="body"] .a { content: "a\\"b{"; }');
  });

  it("keeps a comment written inside a selector", () => {
    expect(scopeCss(".a /* c */ .b { x: 1; }", SCOPE).value).toBe(
      '[data-placeholder="body"] .a /* c */ .b { x: 1; }',
    );
  });

  it("keeps a statement at-rule other than @import", () => {
    expect(scopeCss("@layer base;\n.a { x: 1; }", SCOPE).value).toBe(
      '@layer base;\n[data-placeholder="body"] .a { x: 1; }',
    );
  });

  it("keeps a stray closing brace instead of swallowing the rest", () => {
    expect(scopeCss("} .a { x: 1; }", SCOPE).value).toBe('} [data-placeholder="body"] .a { x: 1; }');
  });

  it("copies trailing text that never opens a block", () => {
    expect(scopeCss(".a { x: 1; } .dangling", SCOPE).value).toBe(
      '[data-placeholder="body"] .a { x: 1; } .dangling',
    );
  });

  it("scopes a root selector nested in a functional pseudo-class", () => {
    expect(scopeCss(":is(body) .a { x: 1; }", SCOPE).value).toBe(
      '[data-placeholder="body"] :is([data-placeholder="body"]) .a { x: 1; }',
    );
  });

  it("does not split a selector list inside :is()", () => {
    expect(scopeCss(":is(h1, h2) { x: 1; }", SCOPE).value).toBe(
      '[data-placeholder="body"] :is(h1, h2) { x: 1; }',
    );
  });

  it("keeps a block with no selector at all", () => {
    expect(scopeCss("{ color: red; }", SCOPE).value).toBe("{ color: red; }");
  });

  it("scopes rules nested in a layered media query", () => {
    const { value, rules } = scopeCss("@layer base { @media print { .a { x: 1; } } }", SCOPE);
    expect(value).toBe('@layer base { @media print { [data-placeholder="body"] .a { x: 1; } } }');
    expect(rules).toBe(1);
  });
});

describe("scopeStyleBlocks", () => {
  it("scopes the CSS inside a style tag and marks the tag as processed", () => {
    const { value, rules } = scopeStyleBlocks("<style>body { display: flex; }</style><p>x</p>", SCOPE);
    expect(value).toBe(
      '<style data-tb-scoped>[data-placeholder="body"] { display: flex; }</style><p>x</p>',
    );
    expect(rules).toBe(1);
  });

  it("is idempotent — a second pass leaves an already-scoped block alone", () => {
    const once = scopeStyleBlocks("<style>.card { color: red; }</style>", SCOPE).value;
    const twice = scopeStyleBlocks(once, SCOPE);
    expect(twice.value).toBe(once);
    expect(twice.rules).toBe(0);
  });

  it("keeps other style-tag attributes", () => {
    const { value } = scopeStyleBlocks('<style type="text/css">.a { b: c; }</style>', SCOPE);
    expect(value).toContain('<style type="text/css" data-tb-scoped>');
  });

  it("recognises the tag whatever its case", () => {
    const { value, rules } = scopeStyleBlocks("<Style>body { a: 1; }</Style>", SCOPE);
    expect(value).toContain('[data-placeholder="body"] { a: 1; }');
    expect(rules).toBe(1);
  });

  it("leaves markup without a style tag untouched", () => {
    const html = "<div class=\"card\"><p>text</p></div>";
    expect(scopeStyleBlocks(html, SCOPE)).toEqual({ value: html, rules: 0 });
  });
});
