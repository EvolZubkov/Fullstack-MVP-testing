/**
 * @module shared/template/dsl.test
 *
 * Test suite for the path-only template DSL renderer (PRD-12 Phase 0,
 * spec-template-platform §9). Covers interpolation + escaping, if/unless/each
 * (including @index/@number/@first/@last and @root), partials with the current
 * context and recursion guard, and the parse-time errors the host relies on to
 * fall back safely.
 */

import { describe, it, expect } from "vitest";
import { renderTemplate, compileTemplate } from "./dsl";

describe("interpolation", () => {
  it("renders plain text unchanged", () => {
    expect(renderTemplate("<p>hello</p>", {})).toBe("<p>hello</p>");
  });

  it("resolves a simple path", () => {
    expect(renderTemplate("{{ name }}", { name: "Ada" })).toBe("Ada");
  });

  it("resolves a dotted path", () => {
    expect(renderTemplate("{{ test.title }}", { test: { title: "Quiz" } })).toBe("Quiz");
  });

  it("renders missing paths as empty", () => {
    expect(renderTemplate("[{{ a.b.c }}]", { a: {} })).toBe("[]");
  });

  it("trims whitespace inside the tag", () => {
    expect(renderTemplate("{{   name   }}", { name: "x" })).toBe("x");
  });

  it("coerces numbers and booleans, but not objects", () => {
    expect(renderTemplate("{{ n }}/{{ b }}/{{ o }}", { n: 3, b: true, o: { x: 1 } })).toBe("3/true/");
  });

  it("HTML-escapes interpolated values", () => {
    expect(renderTemplate("{{ v }}", { v: `<img src=x onerror="1">&'` })).toBe(
      "&lt;img src=x onerror=&quot;1&quot;&gt;&amp;&#39;",
    );
  });
});

describe("if / unless", () => {
  it("renders if-body when truthy", () => {
    expect(renderTemplate("{{#if ok}}YES{{/if}}", { ok: true })).toBe("YES");
  });

  it("skips if-body when falsy", () => {
    expect(renderTemplate("{{#if ok}}YES{{/if}}", { ok: false })).toBe("");
  });

  it("treats an empty array as falsy", () => {
    expect(renderTemplate("{{#if items}}has{{/if}}", { items: [] })).toBe("");
    expect(renderTemplate("{{#if items}}has{{/if}}", { items: [1] })).toBe("has");
  });

  it("treats 0 and empty string as falsy", () => {
    expect(renderTemplate("{{#if n}}x{{/if}}", { n: 0 })).toBe("");
    expect(renderTemplate("{{#if s}}x{{/if}}", { s: "" })).toBe("");
  });

  it("renders unless-body when falsy", () => {
    expect(renderTemplate("{{#unless ok}}NO{{/unless}}", { ok: false })).toBe("NO");
    expect(renderTemplate("{{#unless ok}}NO{{/unless}}", { ok: true })).toBe("");
  });
});

describe("each", () => {
  it("iterates an array exposing the item as context", () => {
    const out = renderTemplate("{{#each xs}}<i>{{ name }}</i>{{/each}}", {
      xs: [{ name: "a" }, { name: "b" }],
    });
    expect(out).toBe("<i>a</i><i>b</i>");
  });

  it("exposes @index, @number, @first and @last", () => {
    const out = renderTemplate(
      "{{#each xs}}{{ @number }}:{{ @index }}{{#if @first}}F{{/if}}{{#if @last}}L{{/if}};{{/each}}",
      { xs: ["a", "b", "c"] },
    );
    expect(out).toBe("1:0F;2:1;3:2L;");
  });

  it("exposes the current primitive via this", () => {
    expect(renderTemplate("{{#each xs}}{{ this }}{{/each}}", { xs: ["x", "y"] })).toBe("xy");
  });

  it("reaches the root context via @root", () => {
    const out = renderTemplate("{{#each xs}}{{ @root.title }}:{{ name }};{{/each}}", {
      title: "T",
      xs: [{ name: "a" }, { name: "b" }],
    });
    expect(out).toBe("T:a;T:b;");
  });

  it("renders nothing for an empty or non-array value", () => {
    expect(renderTemplate("{{#each xs}}x{{/each}}", { xs: [] })).toBe("");
    expect(renderTemplate("{{#each xs}}x{{/each}}", { xs: null })).toBe("");
    expect(renderTemplate("{{#each xs}}x{{/each}}", {})).toBe("");
  });

  it("supports nested each and if", () => {
    const out = renderTemplate(
      "{{#each groups}}[{{ label }}{{#each items}}{{#if ok}}-{{ n }}{{/if}}{{/each}}]{{/each}}",
      {
        groups: [
          { label: "G1", items: [{ ok: true, n: 1 }, { ok: false, n: 2 }] },
          { label: "G2", items: [{ ok: true, n: 3 }] },
        ],
      },
    );
    expect(out).toBe("[G1-1][G2-3]");
  });
});

describe("partials", () => {
  it("includes a partial with the current context", () => {
    const out = renderTemplate("{{> row }}", { name: "a" }, { partials: { row: "<td>{{ name }}</td>" } });
    expect(out).toBe("<td>a</td>");
  });

  it("passes the each-item context into the partial", () => {
    const out = renderTemplate("{{#each xs}}{{> row }}{{/each}}", { xs: [{ name: "a" }, { name: "b" }] }, {
      partials: { row: "[{{ name }}]" },
    });
    expect(out).toBe("[a][b]");
  });

  it("renders a missing partial as empty", () => {
    expect(renderTemplate("a{{> nope }}b", {})).toBe("ab");
  });

  it("uses resolvePartial as a fallback", () => {
    const out = renderTemplate("{{> dyn }}", { v: 1 }, { resolvePartial: () => "<x>{{ v }}</x>" });
    expect(out).toBe("<x>1</x>");
  });

  it("throws on recursive partials", () => {
    expect(() => renderTemplate("{{> loop }}", {}, { partials: { loop: "x{{> loop }}" } })).toThrow(
      /recursion/i,
    );
  });
});

describe("контролируемый HTML ({{& path }})", () => {
  // Единственный канал разметки, доступный ВНУТРИ `{{#each}}`: `data-slot` адресуется по
  // имени и повторяющемуся узлу не годится, а именно там печатаются толкования уровней и
  // тексты рекомендаций, которым автор задал формат «Форматированный» или «HTML».
  it("вставляет значение как разметку, а не как текст", () => {
    expect(renderTemplate("{{& body }}", { body: "<b>жирно</b>" })).toBe("<b>жирно</b>");
  });

  it("обычная интерполяция того же значения по-прежнему экранирует", () => {
    expect(renderTemplate("{{ body }}", { body: "<b>жирно</b>" })).toBe("&lt;b&gt;жирно&lt;/b&gt;");
  });

  it("работает внутри цикла и видит поле элемента", () => {
    const out = renderTemplate("{{#each items}}<p>{{& html }}</p>{{/each}}", {
      items: [{ html: "<em>раз</em>" }, { html: "<em>два</em>" }],
    });
    expect(out).toBe("<p><em>раз</em></p><p><em>два</em></p>");
  });

  it("отсутствующее значение печатается пустотой, а не словом undefined", () => {
    expect(renderTemplate("{{& nope }}", {})).toBe("");
  });

  it("выражений не допускает, как и обычная интерполяция", () => {
    expect(() => renderTemplate("{{& a b }}", {})).toThrow(/not supported/i);
  });
});

describe("parse errors (host falls back, spec §8.2.1.3)", () => {
  it("rejects raw triple-brace interpolation", () => {
    // Тройные скобки остаются запрещёнными: у контролируемого HTML один явный вид записи.
    expect(() => renderTemplate("{{{ html }}}", {})).toThrow(/not supported/i);
  });

  it("rejects an unclosed tag", () => {
    expect(() => renderTemplate("{{ name ", {})).toThrow(/unclosed/i);
  });

  it("rejects an unclosed block", () => {
    expect(() => renderTemplate("{{#if a}}x", {})).toThrow(/unclosed/i);
  });

  it("rejects a mismatched closing tag", () => {
    expect(() => renderTemplate("{{#if a}}x{{/each}}", {})).toThrow(/closing/i);
  });

  it("rejects expressions / helpers inside a tag", () => {
    expect(() => renderTemplate("{{ a b }}", {})).toThrow(/not supported/i);
  });

  it("rejects an unknown block helper", () => {
    expect(() => renderTemplate("{{#with a}}x{{/with}}", {})).toThrow(/unknown block/i);
  });
});

describe("compileTemplate reuse", () => {
  it("renders the same compiled template against different contexts", () => {
    const tpl = compileTemplate("{{ greeting }}, {{ name }}!");
    expect(tpl({ greeting: "Hi", name: "A" })).toBe("Hi, A!");
    expect(tpl({ greeting: "Hej", name: "B" })).toBe("Hej, B!");
  });
});
