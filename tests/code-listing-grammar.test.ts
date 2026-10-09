/**
 * @module tests/code-listing-grammar
 * @description Листинг кода в авторском тексте (PRD-57 §4.1, FR-01, FR-02).
 *
 * Главное препятствие PRD-33 §3.1 — типографика: она подменяет кавычки и дефисы, а в коде
 * это меняет смысл. Решается в ГРАММАТИКЕ, а не в стилях: к моменту показа подмена уже
 * произошла бы.
 */
import { describe, it, expect } from "vitest";

import { renderBlockMarkdown, renderInlineMarkdown } from "../shared/text/markdown";

describe("инлайн-код", () => {
  it("превращается в code и экранируется", () => {
    const html = renderInlineMarkdown("Вызовите `os.path.join()` из модуля");
    expect(html).toContain('<code class="tb-code-inline">os.path.join()</code>');
  });

  it("внутри кода типографика НЕ работает (FR-02)", () => {
    const html = renderInlineMarkdown('Строка `print("a" - "b")` и снаружи "цитата" - тире');
    expect(html).toContain('print(&quot;a&quot; - &quot;b&quot;)');
    // Снаружи кода типографика осталась: кавычки стали ёлочками, дефис — тире.
    expect(html).toContain("«цитата»");
    expect(html).toContain("—");
  });

  it("разметка внутри кода остаётся текстом", () => {
    const html = renderInlineMarkdown("`**не жирный**`");
    expect(html).toContain("**не жирный**");
    expect(html).not.toContain("<strong>");
  });

  it("незакрытый апостроф кодом не считается", () => {
    const html = renderInlineMarkdown("Осталось `незакрытым");
    expect(html).not.toContain("tb-code-inline");
    expect(html).toContain("`незакрытым");
  });
});

describe("блок кода", () => {
  const SOURCE = ["```python", "def f(x):", '    return "a" - x  # тест', "```"].join("\n");

  it("превращается в pre с языком", () => {
    const html = renderBlockMarkdown(SOURCE);
    expect(html).toContain('<pre class="tb-code" data-lang="python">');
    expect(html).toContain("<code>");
  });

  it("сохраняет ведущие пробелы и переносы дословно (FR-01)", () => {
    const html = renderBlockMarkdown(SOURCE);
    expect(html).toContain("def f(x):\n    return");
    // Переносы НЕ превращаются в <br>: внутри pre это лишние узлы.
    expect(html.slice(html.indexOf("<pre"), html.indexOf("</pre>"))).not.toContain("<br>");
  });

  it("типографика внутри блока не работает", () => {
    const html = renderBlockMarkdown(SOURCE);
    expect(html).toContain("&quot;a&quot; - x");
    expect(html).not.toContain("«a»");
  });

  it("без имени языка блок остаётся блоком", () => {
    const html = renderBlockMarkdown("```\nSELECT 1\n```");
    expect(html).toContain('<pre class="tb-code"');
    expect(html).not.toContain("data-lang");
  });

  it("неизвестный язык разбор не ломает", () => {
    const html = renderBlockMarkdown("```брейнфак\n+++\n```");
    expect(html).toContain('<pre class="tb-code"');
  });

  it("текст вокруг блока остаётся абзацами", () => {
    const html = renderBlockMarkdown(`До блока\n\n${SOURCE}\n\nПосле блока`);
    // Пробел после короткого слова типографика делает НЕРАЗРЫВНЫМ, поэтому сверяется
    // структура: абзац, блок, абзац — а не буквальная строка.
    expect(html.startsWith("<p>")).toBe(true);
    expect(html.endsWith("</p>")).toBe(true);
    expect(html.indexOf("<pre")).toBeGreaterThan(0);
    expect(html.lastIndexOf("<p>")).toBeGreaterThan(html.indexOf("</pre>"));
  });

  it("блок в ИНЛАЙНОВОМ тексте блоком не становится", () => {
    // Инлайновый рендер печатает в заголовок и в вариант ответа: блочный узел там
    // невалиден. Ограждение остаётся видимым текстом — автор увидит, что ошибся местом.
    const html = renderInlineMarkdown(SOURCE);
    expect(html).not.toContain("<pre");
  });
});

describe("канонизация текста при сохранении (FR-01)", () => {
  it("ведущие пробелы ВНУТРИ блока кода сохраняются", async () => {
    // Это нашла живая приёмка, а не модульный тест: канонизация срезала отступы у
    // каждой строки, и питоновский листинг приезжал участнику без вложенности —
    // то есть неверным кодом.
    const { normalizeAuthorText } = await import("../shared/text/normalize");
    const source = ["Вопрос:", "", "```python", "def f(x):", "    return x", "```"].join("\n");
    expect(normalizeAuthorText(source)).toBe(source);
  });

  it("снаружи блока канонизация работает как прежде", async () => {
    const { normalizeAuthorText } = await import("../shared/text/normalize");
    expect(normalizeAuthorText("  Вопрос  \n\n\n\nВторой абзац  ")).toBe("Вопрос\n\nВторой абзац");
  });

  it("остаётся идемпотентной: путь записи может прогнать её дважды", async () => {
    const { normalizeAuthorText } = await import("../shared/text/normalize");
    const source = ["  Вопрос", "", "```sql", "SELECT 1", "  FROM t", "```", ""].join("\n");
    const once = normalizeAuthorText(source);
    expect(normalizeAuthorText(once)).toBe(once);
    expect(once).toContain("  FROM t");
  });

  it("переводы строк внутри блока всё равно приводятся к LF", async () => {
    const { normalizeAuthorText } = await import("../shared/text/normalize");
    expect(normalizeAuthorText("```\r\nA\r\n```")).toBe("```\nA\n```");
  });
});

describe("формула (PRD-57 FR-07a)", () => {
  it("$$…$$ становится оболочкой с исходной записью", () => {
    const html = renderInlineMarkdown("Площадь круга $$S = \pi r^2$$ известна");
    expect(html).toContain('<span class="tb-formula" data-latex="S = \pi r^2">');
    // Пока сервер не подставил картинку, участник видит саму запись, а не пустое место.
    expect(html).toContain("S = \pi r^2</span>");
  });

  it("одиночный доллар ограждением не считается", () => {
    const html = renderInlineMarkdown("Цена $100 и ещё $200");
    expect(html).not.toContain("tb-formula");
  });

  it("типографика внутри формулы не работает", () => {
    const html = renderInlineMarkdown('$$a - "b"$$');
    expect(html).toContain("&quot;b&quot;");
    expect(html).not.toContain("«b»");
  });

  it("формула не мешает соседям: код и пропуск остаются собой", () => {
    const html = renderInlineMarkdown("Код `x` формула $$y$$ пропуск {{z}}");
    expect(html).toContain("tb-code-inline");
    expect(html).toContain("tb-formula");
    expect(html).toContain("{{z}}");
  });
});
