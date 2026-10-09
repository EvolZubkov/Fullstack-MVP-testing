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

/**
 * Обезвреживание `javascript:` — до этого набора не покрытое ничем, отчего дефект и
 * прожил незамеченным: замена съедала открывающую кавычку, но не закрывающую, и на
 * выходе оставалось `href="#""`. Для браузера это лишний безымянный атрибут, а для
 * автора — испорченная разметка, которую он не писал.
 */
describe("sanitizeHtml обезвреживает javascript:", () => {
  it("не оставляет лишней кавычки у двойных кавычек", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">клик</a>')).toBe(
      '<a href="#">клик</a>',
    );
  });

  it("не оставляет лишней кавычки у одинарных", () => {
    expect(sanitizeHtml("<a href='javascript:alert(1)'>клик</a>")).toBe(
      '<a href="#">клик</a>',
    );
  });

  it("обезвреживает адрес без кавычек", () => {
    expect(sanitizeHtml("<a href=javascript:alert(1)>клик</a>")).toBe('<a href="#">клик</a>');
  });

  it("не путается в регистре и пробелах", () => {
    expect(sanitizeHtml('<a HREF = " JavaScript:alert(1) ">клик</a>')).toBe(
      '<a HREF="#">клик</a>',
    );
  });

  it("то же у src", () => {
    expect(sanitizeHtml('<img src="javascript:alert(1)">')).toBe('<img src="#">');
  });

  it("не трогает обычную ссылку", () => {
    expect(sanitizeHtml('<a href="/learner/tests">клик</a>')).toBe(
      '<a href="/learner/tests">клик</a>',
    );
  });

  it("сообщает о срабатывании правила одной записью", () => {
    const { removed } = sanitizeHtmlWithDiagnostics('<a href="javascript:alert(1)">к</a>');
    expect(removed).toEqual([{ kind: "uri", label: "javascript:", count: 1 }]);
  });
});

/**
 * Внешний адрес: `src` — это РЕСУРС, который страница грузит сама (ломает автономность
 * пакета и выдаёт адрес учащегося третьей стороне), а `href` у ссылки — НАПРАВЛЕНИЕ,
 * по которому учащийся идёт сам, и ничего не грузится. Прежнее правило не различало
 * их и снимало атрибут у обоих: панель форматирования предлагала кнопку «Ссылка»
 * (PRD-22 FR-33), а сохранялся `<a>` без адреса — от простого текста не отличить.
 * Ровно такую ссылку разметочный конвейер вопроса (`shared/text/markdown`) уже
 * выпускает сам, вместе с `target="_blank"`.
 */
describe("sanitizeHtml и внешние адреса", () => {
  it("сохраняет адрес внешней ссылки", () => {
    const out = sanitizeHtml('<a href="https://example.com/cards">карточки</a>');
    expect(out).toContain('href="https://example.com/cards"');
  });

  it("открывает внешнюю ссылку в новом окне, чтобы не увести кадр с попытки", () => {
    const out = sanitizeHtml('<a href="https://example.com">к</a>');
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it("не трогает уже заданные автором target и rel", () => {
    const src = '<a href="https://example.com" target="_self" rel="nofollow">к</a>';
    expect(sanitizeHtml(src)).toBe(src);
  });

  it("повторная санитизация не добавляет второй target", () => {
    const once = sanitizeHtml('<a href="https://example.com">к</a>');
    expect(sanitizeHtml(once)).toBe(once);
  });

  it("сохраняет адрес без кавычек", () => {
    expect(sanitizeHtml("<a href=https://example.com>к</a>")).toContain("href=https://example.com");
  });

  it("сохраняет адрес у области карты-изображения", () => {
    expect(sanitizeHtml('<area href="https://example.com" shape="rect">')).toContain(
      'href="https://example.com"',
    );
  });

  it("по-прежнему снимает внешний src у картинки", () => {
    expect(sanitizeHtml('<img src="https://example.com/a.png" alt="a">')).toBe('<img alt="a">');
  });

  it("по-прежнему снимает внешний href у не-ссылки", () => {
    expect(sanitizeHtml('<base href="https://evil.example/">')).toBe("<base>");
  });

  it("не наделяет target внутреннюю ссылку", () => {
    expect(sanitizeHtml('<a href="/uploads/media/a.pdf">к</a>')).toBe(
      '<a href="/uploads/media/a.pdf">к</a>',
    );
  });

  it("не наделяет target почтовую ссылку", () => {
    expect(sanitizeHtml('<a href="mailto:a@b.ru">к</a>')).toBe('<a href="mailto:a@b.ru">к</a>');
  });

  it("обезвреженный javascript: не считается внешним адресом", () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">к</a>')).toBe('<a href="#">к</a>');
  });

  it("сообщает о снятом внешнем src, но не о сохранённой ссылке", () => {
    const { removed } = sanitizeHtmlWithDiagnostics(
      '<a href="https://example.com">к</a><img src="https://example.com/a.png">',
    );
    expect(removed).toEqual([{ kind: "uri", label: "external src/href", count: 1 }]);
  });

  it("считает снятый href не-ссылки тем же правилом", () => {
    const { removed } = sanitizeHtmlWithDiagnostics(
      '<base href="https://evil.example/"><img src="https://example.com/a.png">',
    );
    expect(removed).toEqual([{ kind: "uri", label: "external src/href", count: 2 }]);
  });
});
