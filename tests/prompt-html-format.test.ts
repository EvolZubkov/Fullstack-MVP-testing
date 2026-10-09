/**
 * @module tests/prompt-html-format
 * @description Выдача текста задания по его формату (PRD-57 §4.3, FR-09a, FR-09d).
 *
 * Разметка и HTML идут РАЗНЫМИ ветками одного конвейера, но приходят к одному: участник
 * видит один и тот же экран независимо от того, в каком режиме автор набирал текст. Здесь
 * проверяется именно это схождение, а не каждая ветка по отдельности.
 */
import { describe, it, expect } from "vitest";

import { promptHtmlOf } from "../server/services/prompt-html";

const html = (prompt: string, promptFormat = "html") =>
  promptHtmlOf({ prompt, promptFormat }).promptHtml ?? "";

describe("листинг", () => {
  it("в разметке подсвечивается, как и раньше", () => {
    const out = promptHtmlOf({ prompt: "Код:\n\n```sql\nSELECT 1;\n```" }).promptHtml ?? "";
    expect(out).toContain("tb-code__kw");
  });

  it("в HTML автор пишет <pre><code class=\"language-sql\">, и он тоже подсвечивается", () => {
    const out = html('<p>Код:</p><pre><code class="language-sql">SELECT 1;</code></pre>');
    expect(out).toContain("tb-code");
    expect(out).toContain("tb-code__kw");
  });

  it("блок без языка остаётся блоком кода, а не абзацем", () => {
    const out = html("<pre><code>просто текст</code></pre>");
    expect(out).toContain("tb-code");
  });

  it("экранированные угловые скобки внутри листинга остаются текстом", () => {
    const out = html('<pre><code class="language-javascript">if (a &lt; b) {}</code></pre>');
    expect(out).toContain("&lt;");
    expect(out).not.toContain("<b>");
  });
});

describe("формула и пропуск пишутся одинаково во всех режимах (FR-09a)", () => {
  it("формула в HTML становится картинкой", () => {
    const out = html("<p>Доля: $$E = mc^2$$</p>");
    expect(out).toContain("tb-formula");
    expect(out).toContain("<svg");
  });

  it("пропуск в HTML доезжает до хоста как есть: поля ставит рендер сцены", () => {
    const out = html("<p>Столица — {{city}}.</p>");
    expect(out).toContain("{{city}}");
  });
});

describe("типографика работает во всех трёх режимах (FR-09d)", () => {
  it("в тексте кавычки становятся ёлочками", () => {
    const out = html('<p>Он сказал "да" - и ушёл</p>');
    expect(out).toContain("«да»");
  });

  it("в значении атрибута — не трогает ничего", () => {
    const out = html('<p class="a b">Текст</p>');
    expect(out).toContain('class="a b"');
    expect(out).not.toContain("«a b»");
  });

  it("внутрь кода не заходит: там каждый символ значим", () => {
    const out = html('<pre><code class="language-python">print("да")</code></pre>');
    expect(out).toContain("&quot;да&quot;");
    expect(out).not.toContain("«да»");
  });
});

describe("санитайзер", () => {
  it("скрипт в тексте задания до участника не доезжает", () => {
    const out = html('<p>Текст</p><script>alert(1)</script>');
    expect(out).not.toContain("<script");
    expect(out).toContain("Текст");
  });

  it("обработчик события снимается с тега", () => {
    const out = html('<p onclick="alert(1)">Текст</p>');
    expect(out).not.toContain("onclick");
  });
});

describe("совместимость", () => {
  it("задание без формата идёт прежней дорогой", () => {
    const out = promptHtmlOf({ prompt: "Обычный **текст**" }).promptHtml;
    // Разметка без листинга и формул разметку заранее не считает — как и до §4.3.
    expect(out).toBeUndefined();
  });

  it("richText идёт той же дорогой, что html: данные у них одни", () => {
    const asRich = html("<p>Доля: $$E = mc^2$$</p>", "richText");
    const asHtml = html("<p>Доля: $$E = mc^2$$</p>", "html");
    // Сравнение по СМЫСЛУ, а не по байтам: MathJax нумерует внутренние идентификаторы
    // сквозным счётчиком, и два рендера одной формулы отличаются только этими номерами.
    const shape = (out: string) => out.replace(/MJX-\d+/g, "MJX-N");
    expect(shape(asRich)).toBe(shape(asHtml));
  });

  it("пустой текст не роняет выдачу", () => {
    expect(promptHtmlOf({ prompt: "", promptFormat: "html" }).promptHtml ?? "").toBe("");
  });
});
