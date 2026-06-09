/**
 * @module shared/template/smoke-runner
 *
 * PRD-3 Phase 2: the client-side "проверка работоспособности" engine (NFR-03). It
 * renders every screen from {@link buildScreenInputs} (the `manifest.preview.routes[]`
 * system screens PLUS each declared intro/info/summary content variant) against the
 * template's demo dataset through the SAME unified renderer
 * ({@link module:shared/template/render-screen}) the runtime hosts use, in an isolated
 * container, and collects a {@link SmokeReport}.
 *
 * Per screen it flags a blocking error on: an unhandled render exception, a missing
 * or unfilled required slot, a console error during render, an empty render. Console
 * warnings are non-blocking warnings (§4.2). Optionally it syntax-checks `template.js`
 * and JSON-parses the course rules (§4.3) as separate report rows.
 *
 * Environment-agnostic and DOM-only: it runs in the admin's browser (the host passes
 * `createContainer` returning an isolated iframe body) and under jsdom in tests
 * (a detached element). The server never executes this (NFR-02); it only persists
 * the report the browser produces.
 */

import { renderScreenInto, type ScreenRenderInput } from "./render-screen";
import { buildScreenInputs, type PreviewDemoDataset, type PreviewManifest } from "./preview-context";

/** Per-screen smoke result. */
export interface SmokeRouteResult {
  /** Unique screen id (matches {@link ScreenSpec.id}); identity for status lookup. */
  id: string;
  route: string;
  label?: string;
  status: "pass" | "warn" | "fail";
  errors: string[];
  warnings: string[];
}

/** Aggregate smoke report — persisted as `templates.smoke_test_json`. */
export interface SmokeReport {
  /** True when there are no failing screens — necessary for activation (NFR-01). */
  ok: boolean;
  total: number;
  passed: number;
  warned: number;
  failed: number;
  routes: SmokeRouteResult[];
}

export interface SmokeRunOptions {
  dataset: PreviewDemoDataset;
  manifest: PreviewManifest;
  /** Layout HTML by layout key (`manifest.layouts` values, pre-loaded by the host). */
  layouts: Record<string, string>;
  /** Partial templates for `{{> name}}`. */
  partials?: Record<string, string>;
  /** `template.js` source — compiled (not executed) to catch syntax errors. */
  templateJs?: string;
  /** `template-rules.json` source — JSON-parsed to catch malformed rules. */
  rulesJson?: string;
  /** Isolated container factory; default: a detached `<div>` on the global document. */
  createContainer?: () => HTMLElement;
  /** Renderer override (default {@link renderScreenInto}); injectable for tests. */
  render?: (root: HTMLElement, input: ScreenRenderInput) => void;
}

/** Default container: a detached div on the ambient document (browser / jsdom). */
function defaultContainer(): HTMLElement {
  const doc = (globalThis as unknown as { document?: Document }).document;
  if (!doc) throw new Error("smoke-runner requires a DOM (browser or jsdom)");
  return doc.createElement("div");
}

function rowStatus(errors: string[], warnings: string[]): SmokeRouteResult["status"] {
  return errors.length ? "fail" : warnings.length ? "warn" : "pass";
}

/** Render one screen in isolation and collect render/slot/console findings. */
function checkScreen(
  spec: ReturnType<typeof buildScreenInputs>[number],
  opts: SmokeRunOptions,
  render: NonNullable<SmokeRunOptions["render"]>,
): SmokeRouteResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const layout = opts.layouts[spec.layoutKey];
  if (layout == null) {
    errors.push(`Не найден макет «${spec.layoutKey}»`);
    return { id: spec.id, route: spec.route, label: spec.label, status: "fail", errors, warnings };
  }

  const root = (opts.createContainer ?? defaultContainer)();

  // Capture console noise emitted during the render only.
  const capErr: string[] = [];
  const capWarn: string[] = [];
  const origErr = console.error;
  const origWarn = console.warn;
  console.error = (...args: unknown[]) => capErr.push(args.map(String).join(" "));
  console.warn = (...args: unknown[]) => capWarn.push(args.map(String).join(" "));
  try {
    render(root, { layout, ...spec.input });
  } catch (e) {
    errors.push("Ошибка отрисовки: " + ((e as Error)?.message ?? String(e)));
  } finally {
    console.error = origErr;
    console.warn = origWarn;
  }

  for (const m of capErr) errors.push("Ошибка в консоли: " + m);
  for (const m of capWarn) warnings.push("Предупреждение в консоли: " + m);

  if (errors.length === 0) {
    if (!root.innerHTML.trim()) {
      errors.push("Экран отрисован пустым");
    }
    for (const slot of spec.requiredSlots) {
      const el = root.querySelector(`[data-slot="${slot}"]`);
      if (!el) errors.push(`Нет обязательного слота data-slot="${slot}"`);
      else if (!el.innerHTML.trim()) errors.push(`Не заполнен обязательный слот data-slot="${slot}"`);
    }
  }

  return { id: spec.id, route: spec.route, label: spec.label, status: rowStatus(errors, warnings), errors, warnings };
}

/** Syntax-check `template.js` (compile only, never execute — NFR-02). */
function checkTemplateJs(src: string): SmokeRouteResult {
  const errors: string[] = [];
  try {
    // Compile-only: catches syntax errors without running template code.
    // eslint-disable-next-line no-new-func
    new Function(src);
  } catch (e) {
    errors.push("Синтаксическая ошибка в template.js: " + ((e as Error)?.message ?? String(e)));
  }
  return { id: "template.js", route: "template.js", label: "Скрипт шаблона", status: rowStatus(errors, []), errors, warnings: [] };
}

/** JSON-parse the course rules file. */
function checkRules(src: string): SmokeRouteResult {
  const errors: string[] = [];
  try {
    JSON.parse(src);
  } catch (e) {
    errors.push("Невалидный JSON правил: " + ((e as Error)?.message ?? String(e)));
  }
  return { id: "rules", route: "rules", label: "Правила шаблона", status: rowStatus(errors, []), errors, warnings: [] };
}

/**
 * Run the browser smoke-test across all preview screens (+ optional template.js /
 * rules checks) and return the aggregate {@link SmokeReport}. `ok` is the activation
 * gate signal the server persists and enforces (NFR-01).
 */
export function runSmokeChecks(opts: SmokeRunOptions): SmokeReport {
  const render = opts.render ?? renderScreenInto;
  const specs = buildScreenInputs(opts.dataset, opts.manifest);
  const routes: SmokeRouteResult[] = specs.map((spec) => checkScreen(spec, opts, render));

  if (opts.templateJs != null) routes.push(checkTemplateJs(opts.templateJs));
  if (opts.rulesJson != null) routes.push(checkRules(opts.rulesJson));

  const failed = routes.filter((r) => r.status === "fail").length;
  const warned = routes.filter((r) => r.status === "warn").length;
  const passed = routes.filter((r) => r.status === "pass").length;
  return { ok: failed === 0, total: routes.length, passed, warned, failed, routes };
}
