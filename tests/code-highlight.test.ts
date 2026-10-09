/**
 * @module tests/code-highlight
 * @description Подсветка синтаксиса (PRD-57 FR-03 — FR-03c). Считается на СЕРВЕРЕ; в
 * пакет и в клиентский бандл библиотека не попадает.
 */
import { describe, it, expect } from "vitest";

import { highlightCodeBlocks } from "../server/services/code-highlight";

const PY = '<pre class="tb-code" data-lang="python"><code>def f(x):\n    return &quot;a&quot;  # тест</code></pre>';

describe("highlightCodeBlocks", () => {
  it("раскрашивает блок с известным языком", () => {
    const html = highlightCodeBlocks(PY);
    expect(html).toContain("tb-code__kw");
    expect(html).toContain("tb-code__str");
    expect(html).toContain("tb-code__com");
  });

  it("классы СВОИ, палитры библиотеки в выводе нет (FR-03c)", () => {
    const html = highlightCodeBlocks(PY);
    expect(html).not.toContain("hljs");
  });

  it("текст кода не меняется — только обёртки", () => {
    const html = highlightCodeBlocks(PY);
    const text = html.replace(/<[^>]+>/g, "");
    expect(text).toContain("def f(x):");
    expect(text).toContain("return &quot;a&quot;");
  });

  it("блок без языка остаётся как был", () => {
    const plain = '<pre class="tb-code"><code>SELECT 1</code></pre>';
    expect(highlightCodeBlocks(plain)).toBe(plain);
  });

  it("незнакомый язык блок не ломает", () => {
    const alien = '<pre class="tb-code" data-lang="брейнфак"><code>+++</code></pre>';
    expect(highlightCodeBlocks(alien)).toBe(alien);
  });

  it("подсвечивает SQL и JavaScript — обязательные языки требования", () => {
    const sql = '<pre class="tb-code" data-lang="sql"><code>SELECT id FROM users</code></pre>';
    expect(highlightCodeBlocks(sql)).toContain("tb-code__kw");
    const js = '<pre class="tb-code" data-lang="javascript"><code>const x = 1; // раз</code></pre>';
    const out = highlightCodeBlocks(js);
    expect(out).toContain("tb-code__kw");
    expect(out).toContain("tb-code__com");
  });

  it("текст без блоков не трогается вовсе", () => {
    const text = "<p>Обычный вопрос с <code class=\"tb-code-inline\">os.path</code></p>";
    expect(highlightCodeBlocks(text)).toBe(text);
  });

  it("несколько блоков в одном тексте раскрашиваются каждый", () => {
    const html = highlightCodeBlocks(`${PY}<p>между</p>${PY}`);
    expect(html.match(/tb-code__kw/g)?.length ?? 0).toBeGreaterThan(1);
  });
});
