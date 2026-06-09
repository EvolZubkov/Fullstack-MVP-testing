/**
 * @module tests/runtime.template-core.test
 * @description Unit tests for the TestBuilder Runtime Core module.
 *
 * Covers:
 * - resolvePath: dot-path resolution in nested objects
 * - buildCssVarDeclarations: param-to-CSS-variable mapping
 * - renderPlaceholderHtml: escaping and type dispatch
 * - applyTextFit: fixed / autoFitFont / growBox modes
 * - fillPlaceholders: placeholder slot population + textFit application
 * - startAutoAdvance / cancelAutoAdvance: timer lifecycle
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// ─── Load module into the jsdom window ───────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadTemplateCore() {
  const src = readFileSync(
    path.resolve(__dirname, "../server/scorm/template/app/templateCore.js"),
    "utf8"
  );
  // Execute in current scope — module attaches to window in jsdom environment
  // eslint-disable-next-line no-new-func
  new Function(src)();
  return (window as any).TestBuilder as {
    _internal: {
      resolvePath: (obj: unknown, path: string) => unknown;
      buildCssVarDeclarations: (params: unknown, defs: unknown[]) => Record<string, string>;
      renderPlaceholderHtml: (type: string, value: unknown) => string;
      applyTextFit: (el: HTMLElement, config: unknown, authorFontSize: number | null) => void;
      fillPlaceholders: (
        root: HTMLElement,
        ct: { placeholders: unknown[] },
        values: Record<string, unknown>,
        styles: Record<string, unknown>
      ) => void;
      renderPathOnlyDsl: (root: HTMLElement, data: Record<string, unknown>) => void;
      fillControlledSlots: (root: HTMLElement, slots: Record<string, string>) => void;
      startAutoAdvance: (delayMs: number, cb: () => void) => void;
      cancelAutoAdvance: () => void;
      isOverflowing: (el: HTMLElement) => boolean;
    };
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Creates a minimal HTMLElement mock for textFit / fillPlaceholders tests. */
function makeEl(
  tagName = "div",
  opts: { scrollH?: number; clientH?: number; scrollW?: number; clientW?: number } = {}
): HTMLElement {
  const el = document.createElement(tagName);
  // Default: no overflow
  Object.defineProperty(el, "scrollHeight", { get: () => opts.scrollH ?? 0 });
  Object.defineProperty(el, "clientHeight", { get: () => opts.clientH ?? 100 });
  Object.defineProperty(el, "scrollWidth",  { get: () => opts.scrollW ?? 0 });
  Object.defineProperty(el, "clientWidth",  { get: () => opts.clientW ?? 100 });
  return el;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("Runtime Core – resolvePath", () => {
  const { resolvePath } = loadTemplateCore()._internal;

  it("resolves top-level key", () => {
    expect(resolvePath({ a: 1 }, "a")).toBe(1);
  });

  it("resolves nested path", () => {
    expect(resolvePath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns undefined for missing key", () => {
    expect(resolvePath({ a: 1 }, "b")).toBeUndefined();
  });

  it("returns undefined when obj is null", () => {
    expect(resolvePath(null, "a")).toBeUndefined();
  });

  it("returns undefined when path is empty string", () => {
    expect(resolvePath({ a: 1 }, "")).toBeUndefined();
  });

  it("returns undefined for intermediate null", () => {
    expect(resolvePath({ a: null }, "a.b")).toBeUndefined();
  });
});

describe("Runtime Core – path DSL and controlled slots", () => {
  const { renderPathOnlyDsl, fillControlledSlots } = loadTemplateCore()._internal;

  it("fills data-path nodes from dot paths", () => {
    const root = document.createElement("div");
    root.innerHTML = '<span data-path="result.scorePercent"></span>';
    renderPathOnlyDsl(root, { result: { scorePercent: 92 } });
    expect(root.querySelector("[data-path]")?.textContent).toBe("92");
  });

  it("fills controlled data-slot nodes", () => {
    const root = document.createElement("div");
    root.innerHTML = '<section data-slot="page"></section>';
    fillControlledSlots(root, { page: "<p>Content</p>" });
    expect(root.querySelector("[data-slot='page']")?.innerHTML).toBe("<p>Content</p>");
  });
});

describe("Runtime Core – buildCssVarDeclarations", () => {
  const { buildCssVarDeclarations } = loadTemplateCore()._internal;

  const manifestParams = [
    { key: "brand.primaryColor", cssVar: "--rtk-accent", default: "#ff4f12" },
    { key: "layout.panelRadius", cssVar: "--rtk-panel-radius", default: 12 },
    { key: "brand.noVar", default: "#000" },
  ];

  it("maps params with cssVar to CSS custom properties", () => {
    const result = buildCssVarDeclarations(
      { brand: { primaryColor: "#cc0000" }, layout: { panelRadius: 8 } },
      manifestParams
    );
    expect(result["--rtk-accent"]).toBe("#cc0000");
    expect(result["--rtk-panel-radius"]).toBe("8px");
  });

  it("ignores params without cssVar", () => {
    const result = buildCssVarDeclarations(
      { brand: { noVar: "#fff" } },
      manifestParams
    );
    expect("--brand-noVar" in result).toBe(false);
    expect(Object.keys(result).every((k) => k.startsWith("--"))).toBe(true);
  });

  it("falls back to default when param value is missing", () => {
    const result = buildCssVarDeclarations({}, manifestParams);
    expect(result["--rtk-accent"]).toBe("#ff4f12");
    expect(result["--rtk-panel-radius"]).toBe("12px");
  });

  it("appends px for numeric values", () => {
    const result = buildCssVarDeclarations(
      { layout: { panelRadius: 0 } },
      manifestParams
    );
    expect(result["--rtk-panel-radius"]).toBe("0px");
  });

  it("returns empty object when params is null", () => {
    expect(buildCssVarDeclarations(null, manifestParams)).toEqual({});
  });

  it("returns empty object when manifestParams is null", () => {
    expect(buildCssVarDeclarations({ a: 1 }, null as any)).toEqual({});
  });
});

describe("Runtime Core – renderPlaceholderHtml", () => {
  const { renderPlaceholderHtml } = loadTemplateCore()._internal;

  it("escapes HTML in text type", () => {
    const html = renderPlaceholderHtml("text", "<b>hello</b>");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<b>");
  });

  it("converts newlines to <br> for text", () => {
    const html = renderPlaceholderHtml("text", "line1\nline2");
    expect(html).toContain("<br>");
  });

  it("passes richText through without escaping", () => {
    const html = renderPlaceholderHtml("richText", "<strong>bold</strong>");
    expect(html).toBe("<strong>bold</strong>");
  });

  it("passes html through without escaping", () => {
    const html = renderPlaceholderHtml("html", '<em class="x">em</em>');
    expect(html).toBe('<em class="x">em</em>');
  });

  it("renders image as img tag", () => {
    const html = renderPlaceholderHtml("image", "https://example.com/img.png");
    expect(html).toContain("<img");
    expect(html).toContain("https://example.com/img.png");
  });

  it("renders boolean true as checkmark", () => {
    const html = renderPlaceholderHtml("boolean", true);
    expect(html.length).toBeGreaterThan(0);
  });

  it("renders boolean false as empty string", () => {
    expect(renderPlaceholderHtml("boolean", false)).toBe("");
  });

  it("returns empty string for null value", () => {
    expect(renderPlaceholderHtml("text", null)).toBe("");
  });

  it("returns empty string for undefined value", () => {
    expect(renderPlaceholderHtml("text", undefined)).toBe("");
  });

  it("escapes number type", () => {
    expect(renderPlaceholderHtml("number", 42)).toBe("42");
  });
});

describe("Runtime Core – applyTextFit", () => {
  const { applyTextFit } = loadTemplateCore()._internal;

  it("fixed mode sets fontSize to defaultFontSize", () => {
    const el = makeEl();
    applyTextFit(el, { mode: "fixed", defaultFontSize: 24 }, null);
    expect(el.style.fontSize).toBe("24px");
  });

  it("fixed mode uses authorFontSize when allowAuthorFontSize=true", () => {
    const el = makeEl();
    applyTextFit(el, { mode: "fixed", defaultFontSize: 24, allowAuthorFontSize: true }, 18);
    expect(el.style.fontSize).toBe("18px");
  });

  it("fixed mode ignores authorFontSize when allowAuthorFontSize=false", () => {
    const el = makeEl();
    applyTextFit(el, { mode: "fixed", defaultFontSize: 24, allowAuthorFontSize: false }, 18);
    expect(el.style.fontSize).toBe("24px");
  });

  it("autoFitFont mode starts at maxFontSize", () => {
    const el = makeEl(); // no overflow
    applyTextFit(el, { mode: "autoFitFont", defaultFontSize: 36, minFontSize: 24, maxFontSize: 36 }, null);
    expect(el.style.fontSize).toBe("36px");
  });

  it("autoFitFont mode shrinks below maxFontSize when overflowing", () => {
    // Element always overflows
    const el = makeEl("div", { scrollH: 200, clientH: 50 });
    applyTextFit(el, { mode: "autoFitFont", defaultFontSize: 36, minFontSize: 10, maxFontSize: 36 }, null);
    const size = parseFloat(el.style.fontSize);
    expect(size).toBeLessThan(36);
    expect(size).toBeGreaterThanOrEqual(10);
  });

  it("growBox mode sets height to auto", () => {
    const el = makeEl();
    applyTextFit(el, { mode: "growBox", defaultFontSize: 16 }, null);
    expect(el.style.height).toBe("auto");
    expect(el.style.fontSize).toBe("16px");
  });

  it("growBox mode applies maxHeight", () => {
    const el = makeEl();
    applyTextFit(el, { mode: "growBox", defaultFontSize: 16, maxHeight: 200 }, null);
    expect(el.style.maxHeight).toBe("200px");
  });

  it("does nothing when el is null", () => {
    expect(() => applyTextFit(null as any, { mode: "fixed", defaultFontSize: 16 }, null)).not.toThrow();
  });
});

describe("Runtime Core – fillPlaceholders", () => {
  const { fillPlaceholders } = loadTemplateCore()._internal;

  const contentTemplate = {
    key: "info.text",
    placeholders: [
      { key: "title", type: "text", textFit: { mode: "fixed", defaultFontSize: 28 } },
      { key: "body", type: "richText", textFit: { mode: "growBox", defaultFontSize: 16 } },
    ],
  };

  function makeRoot(keys: string[]): HTMLElement {
    const root = document.createElement("div");
    keys.forEach((k) => {
      const slot = document.createElement("div");
      slot.setAttribute("data-placeholder", k);
      root.appendChild(slot);
    });
    return root;
  }

  it("fills text placeholder with escaped content", () => {
    const root = makeRoot(["title", "body"]);
    fillPlaceholders(root, contentTemplate, { title: "<Hello>" }, {});
    const title = root.querySelector('[data-placeholder="title"]') as HTMLElement;
    expect(title.innerHTML).toContain("&lt;Hello&gt;");
  });

  it("fills richText placeholder without escaping", () => {
    const root = makeRoot(["title", "body"]);
    fillPlaceholders(root, contentTemplate, { body: "<b>bold</b>" }, {});
    const body = root.querySelector('[data-placeholder="body"]') as HTMLElement;
    expect(body.innerHTML).toBe("<b>bold</b>");
  });

  it("applies textFit style after filling", () => {
    const root = makeRoot(["title", "body"]);
    fillPlaceholders(root, contentTemplate, { title: "Test" }, {});
    const title = root.querySelector('[data-placeholder="title"]') as HTMLElement;
    expect(title.style.fontSize).toBe("28px");
  });

  it("skips placeholders without matching slot", () => {
    const root = makeRoot(["title"]); // no body slot
    expect(() => fillPlaceholders(root, contentTemplate, { title: "T", body: "B" }, {})).not.toThrow();
  });

  it("does nothing when root is null", () => {
    expect(() => fillPlaceholders(null as any, contentTemplate, {}, {})).not.toThrow();
  });

  it("does nothing when contentTemplate is null", () => {
    const root = makeRoot(["title"]);
    expect(() => fillPlaceholders(root, null as any, {}, {})).not.toThrow();
  });
});

describe("Runtime Core – autoAdvance", () => {
  const { startAutoAdvance, cancelAutoAdvance } = loadTemplateCore()._internal;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    cancelAutoAdvance();
  });

  it("calls callback after delay", () => {
    const cb = vi.fn();
    startAutoAdvance(1000, cb);
    expect(cb).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(cb).toHaveBeenCalledOnce();
  });

  it("does not call callback before delay", () => {
    const cb = vi.fn();
    startAutoAdvance(500, cb);
    vi.advanceTimersByTime(499);
    expect(cb).not.toHaveBeenCalled();
  });

  it("cancelAutoAdvance prevents callback", () => {
    const cb = vi.fn();
    startAutoAdvance(500, cb);
    cancelAutoAdvance();
    vi.advanceTimersByTime(1000);
    expect(cb).not.toHaveBeenCalled();
  });

  it("starting a new timer cancels the previous one", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    startAutoAdvance(500, cb1);
    startAutoAdvance(800, cb2);
    vi.advanceTimersByTime(1000);
    expect(cb1).not.toHaveBeenCalled();
    expect(cb2).toHaveBeenCalledOnce();
  });
});
