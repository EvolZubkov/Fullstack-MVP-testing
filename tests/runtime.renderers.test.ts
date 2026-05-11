/**
 * @module tests/runtime.renderers.test
 * @description Unit tests for built-in resultField renderer plugins.
 *
 * Covers:
 * - core.textMetric: value display, label, suffix, decimals, null value
 * - core.badge: passed/failed tone, custom labels, default label
 * - core.progressBar: width calculation, label, showValue
 * - core.ringChart: SVG path geometry, label, showValue
 * - core.segmentedProgress: segment count, filled count, label
 * - renderResultField: path resolution, allowedRenderers enforcement, fallback
 * - Isolation: renderers do not access SCORM API or mutate state
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Load module ──────────────────────────────────────────────────────────────

function loadRenderers() {
  const coreSrc = readFileSync(
    path.resolve(__dirname, "../server/scorm/template/app/templateCore.js"),
    "utf8"
  );
  const src = readFileSync(
    path.resolve(__dirname, "../server/scorm/template/app/render/renderers.js"),
    "utf8"
  );

  // Execute in the current jsdom scope; modules attach to window.TestBuilder
  // eslint-disable-next-line no-new-func
  new Function(coreSrc)();
  // renderers.js references global TEST_DATA — provide undefined via wrapper
  // eslint-disable-next-line no-new-func
  new Function("TEST_DATA", src)(undefined);

  return (window as any).TestBuilder.renderers as {
    render: (
      fieldValue: Record<string, unknown>,
      testData: Record<string, unknown>,
      allowedRenderers: Set<string> | null
    ) => string;
    _builtins: Record<string, (value: unknown, opts: Record<string, unknown>) => string>;
    register: (id: string, fn: (value: unknown, opts: Record<string, unknown>) => string) => void;
  };
}

// ─── core.textMetric ─────────────────────────────────────────────────────────

describe("core.textMetric", () => {
  let textMetric: (v: unknown, o: Record<string, unknown>) => string;

  beforeEach(() => {
    textMetric = loadRenderers()._builtins["core.textMetric"];
  });

  it("renders a numeric value", () => {
    const html = textMetric(87, {});
    expect(html).toContain("87");
    expect(html).toContain("renderer--text-metric");
  });

  it("renders label when provided", () => {
    const html = textMetric(90, { label: "Score" });
    expect(html).toContain("Score");
  });

  it("renders suffix", () => {
    const html = textMetric(95, { suffix: "%" });
    expect(html).toContain("%");
  });

  it("applies decimals", () => {
    const html = textMetric(87.5, { decimals: 1 });
    expect(html).toContain("87.5");
  });

  it("renders dash for null value", () => {
    const html = textMetric(null, {});
    expect(html).toContain("—");
  });

  it("escapes HTML in label", () => {
    const html = textMetric(1, { label: "<script>alert(1)</script>" });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

// ─── core.badge ──────────────────────────────────────────────────────────────

describe("core.badge", () => {
  let badge: (v: unknown, o: Record<string, unknown>) => string;

  beforeEach(() => {
    badge = loadRenderers()._builtins["core.badge"];
  });

  it("applies passed tone for matching value", () => {
    const html = badge("passed", {
      passed: { value: "passed", label: "Сдал" },
      failed: { value: "failed", label: "Не сдал" },
    });
    expect(html).toContain("renderer--badge-passed");
    expect(html).toContain("Сдал");
  });

  it("applies failed tone for matching value", () => {
    const html = badge("failed", {
      passed: { value: "passed", label: "Сдал" },
      failed: { value: "failed", label: "Не сдал" },
    });
    expect(html).toContain("renderer--badge-failed");
    expect(html).toContain("Не сдал");
  });

  it("uses neutral tone for unmatched value", () => {
    const html = badge("unknown", {
      passed: { value: "passed", label: "Pass" },
    });
    expect(html).toContain("renderer--badge-neutral");
  });

  it("uses default label when value does not match", () => {
    const html = badge("other", { default: "N/A" });
    expect(html).toContain("N/A");
  });

  it("escapes HTML in rendered label", () => {
    const html = badge("<ok>", {});
    expect(html).not.toContain("<ok>");
  });
});

// ─── core.progressBar ────────────────────────────────────────────────────────

describe("core.progressBar", () => {
  let progressBar: (v: unknown, o: Record<string, unknown>) => string;

  beforeEach(() => {
    progressBar = loadRenderers()._builtins["core.progressBar"];
  });

  it("sets fill width to value percent", () => {
    const html = progressBar(75, {});
    expect(html).toContain("width:75.00%");
  });

  it("clamps value above 100 to 100%", () => {
    const html = progressBar(150, {});
    expect(html).toContain("width:100.00%");
  });

  it("clamps negative value to 0%", () => {
    const html = progressBar(-10, {});
    expect(html).toContain("width:0.00%");
  });

  it("renders label when provided", () => {
    const html = progressBar(50, { label: "Progress" });
    expect(html).toContain("Progress");
  });

  it("shows value when showValue=true", () => {
    const html = progressBar(60, { showValue: true });
    expect(html).toContain("60%");
  });

  it("does not show value by default", () => {
    const html = progressBar(60, {});
    // The fill width appears but not as a separate label
    const valueDiv = html.match(/<div class="renderer__value">/g) || [];
    expect(valueDiv.length).toBe(0);
  });
});

// ─── core.ringChart ──────────────────────────────────────────────────────────

describe("core.ringChart", () => {
  let ringChart: (v: unknown, o: Record<string, unknown>) => string;

  beforeEach(() => {
    ringChart = loadRenderers()._builtins["core.ringChart"];
  });

  it("renders SVG element", () => {
    const html = ringChart(50, {});
    expect(html).toContain("<svg");
    expect(html).toContain("renderer--ring-chart");
  });

  it("includes correct dasharray for 50%", () => {
    const size = 120;
    const sw = 10;
    const r = (size - sw) / 2; // 55
    const circ = 2 * Math.PI * r; // ~345.575...
    const filled = 0.5 * circ; // ~172.787...
    const html = ringChart(50, { size, strokeWidth: sw });
    expect(html).toContain(filled.toFixed(2));
  });

  it("shows value when showValue=true", () => {
    const html = ringChart(80, { showValue: true });
    expect(html).toContain("80%");
  });

  it("renders label", () => {
    const html = ringChart(30, { label: "Complete" });
    expect(html).toContain("Complete");
  });
});

// ─── core.segmentedProgress ──────────────────────────────────────────────────

describe("core.segmentedProgress", () => {
  let seg: (v: unknown, o: Record<string, unknown>) => string;

  beforeEach(() => {
    seg = loadRenderers()._builtins["core.segmentedProgress"];
  });

  it("renders correct number of segments", () => {
    const html = seg(60, { segments: 10 });
    // Match class="renderer__segment" but not "renderer__segments" (the container)
    const matches = html.match(/class="renderer__segment(?!s)/g) || [];
    expect(matches.length).toBe(10);
  });

  it("marks filled segments for 60% with 10 segments", () => {
    const html = seg(60, { segments: 10 });
    const filled = html.match(/is-filled/g) || [];
    expect(filled.length).toBe(6);
  });

  it("renders 0 filled segments for 0%", () => {
    const html = seg(0, { segments: 5 });
    expect(html).not.toContain("is-filled");
  });

  it("renders all filled for 100%", () => {
    const html = seg(100, { segments: 5 });
    const filled = html.match(/is-filled/g) || [];
    expect(filled.length).toBe(5);
  });

  it("renders label", () => {
    const html = seg(50, { label: "Done" });
    expect(html).toContain("Done");
  });

  it("shows percent when showValue=true", () => {
    const html = seg(75, { showValue: true });
    expect(html).toContain("75%");
  });
});

// ─── renderResultField ────────────────────────────────────────────────────────

describe("renderResultField", () => {
  let renderers: ReturnType<typeof loadRenderers>;

  beforeEach(() => {
    renderers = loadRenderers();
  });

  it("resolves path from testData and passes value to renderer", () => {
    const html = renderers.render(
      { path: "result.scorePercent", renderer: "core.textMetric", label: "Score" },
      { result: { scorePercent: 88 } },
      null
    );
    expect(html).toContain("88");
    expect(html).toContain("Score");
  });

  it("falls back to core.textMetric for unknown renderer and warns", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderers.render(
      { path: "result.scorePercent", renderer: "unknown.renderer" },
      { result: { scorePercent: 50 } },
      null
    );
    expect(html).toContain("renderer--text-metric");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("enforces allowedRenderers and falls back when renderer not allowed", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = renderers.render(
      { path: "x", renderer: "core.ringChart" },
      { x: 75 },
      new Set(["core.textMetric", "core.progressBar"])
    );
    expect(html).toContain("renderer--text-metric");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("uses renderer that is in allowedRenderers", () => {
    const html = renderers.render(
      { path: "result.scorePercent", renderer: "core.progressBar" },
      { result: { scorePercent: 60 } },
      new Set(["core.progressBar"])
    );
    expect(html).toContain("renderer--progress-bar");
  });

  it("returns empty string for null fieldValue", () => {
    expect(renderers.render(null as any, {}, null)).toBe("");
  });

  it("custom renderer registered via register() is called", () => {
    const customFn = vi.fn().mockReturnValue('<div class="custom">ok</div>');
    renderers.register("custom.widget", customFn);
    const html = renderers.render(
      { path: "x", renderer: "custom.widget" },
      { x: 42 },
      null
    );
    expect(customFn).toHaveBeenCalledWith(42, expect.any(Object));
    expect(html).toContain("custom");
  });

  it("renderer cannot access SCORM API (SCORM is undefined in isolated scope)", () => {
    // Verify that the module loaded with no SCORM global doesn't throw
    expect(() =>
      renderers.render(
        { path: "x", renderer: "core.textMetric" },
        { x: 1 },
        null
      )
    ).not.toThrow();
  });
});
