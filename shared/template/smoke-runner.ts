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
 * Per screen it flags a blocking error on: an unhandled render exception, a console
 * error during render, an empty render. Blocking is reserved for what makes a package
 * unusable; a missing layout or slot is NOT blocking (spec §17.1/§17.2, PRD-3
 * §4.2/§4.3/NFR-06) — such a screen falls back to the standard template and is
 * reported as a warning. Console warnings are warnings too (§4.2). Optionally it
 * syntax-checks `template.js` as a separate report row.
 *
 * Environment-agnostic and DOM-only: it runs in the admin's browser (the host passes
 * `createContainer` returning an isolated iframe body) and under jsdom in tests
 * (a detached element). The server never executes this (NFR-02); it only persists
 * the report the browser produces.
 */

import { renderScreenInto, type ScreenRenderInput } from "./render-screen";
import { buildScreenInputs, type PreviewDemoDataset, type PreviewManifest } from "./preview-context";
import { REPORT_KINDS, reportVariants, resolveReportValues } from "../report/report-variants";
import { buildAdaptiveReportContext, buildReportContext } from "../report/report-context";
import {
  buildAdaptiveReportPreviewInput,
  buildReportPreviewInput,
  type ReportPreviewTest,
} from "../report/report-preview";

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
  /**
   * The STANDARD template's layouts, same keying. Optional: when supplied, a screen
   * whose layout this template omits is rendered from here — the fallback the hosts
   * apply (PRD-1 §4.3.2, PRD-3 NFR-06) — so the check exercises the screen the
   * learner actually gets. Without it such a screen is only reported as a warning.
   */
  fallbackLayouts?: Record<string, string>;
  /** Partial templates for `{{> name}}`. */
  partials?: Record<string, string>;
  /** `template.js` source — compiled (not executed) to catch syntax errors. */
  templateJs?: string;
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

/**
 * A variant that ships its own layout owes ONE thing: the fields it declares must
 * have somewhere to land. There are two legitimate ways — a `data-placeholder`
 * region per field, or the generic `page-content` slot the host fills with the
 * placeholder skeleton. When a layout offers neither, the author fills fields in
 * «Структуре» and nothing of it reaches the learner; that is worth saying plainly.
 *
 * Silent when the variant declares no fields (system screens, question variants):
 * there is nothing to lose.
 * @param spec      Screen under check
 * @param root      Container the screen was rendered into
 * @param warnings  Collector, appended in place
 */
function checkPlaceholdersReachTheScreen(
  spec: ReturnType<typeof buildScreenInputs>[number],
  root: HTMLElement,
  warnings: string[],
): void {
  const declared = spec.input.content?.template?.placeholders ?? [];
  if (declared.length === 0) return;
  // The skeleton lands in the slot, so every declared field reaches the screen.
  if (root.querySelector('[data-slot="page-content"]')) return;

  const missing = declared.filter((ph) => root.querySelector(`[data-placeholder="${ph.key}"]`) == null);
  if (missing.length === 0) return;
  if (missing.length === declared.length) {
    warnings.push(
      "Поля варианта не попадут на экран: в макете нет ни одного data-placeholder " +
        'из объявленных и нет слота data-slot="page-content"',
    );
    return;
  }
  // Partial loss is the sneakier case: the screen looks right in the preview, and
  // only the author who filled the missing field notices it vanished.
  warnings.push(
    "В макете нет области для полей: " + missing.map((ph) => ph.key).join(", ") +
      " — значения этих полей на экран не попадут",
  );
}

/** Render one screen in isolation and collect render/slot/console findings. */
function checkScreen(
  spec: ReturnType<typeof buildScreenInputs>[number],
  opts: SmokeRunOptions,
  render: NonNullable<SmokeRunOptions["render"]>,
): SmokeRouteResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // A layout the template does not declare is NOT a failure (spec §17.1, PRD-3
  // NFR-06): the screen falls back to the standard template. When the host supplies
  // the standard template's layouts we render THAT — so the check exercises what the
  // learner will actually see — and warn either way.
  let layout = opts.layouts[spec.layoutKey];
  if (layout == null) {
    const fallback = opts.fallbackLayouts?.[spec.layoutKey];
    warnings.push(
      fallback != null
        ? `Макет «${spec.layoutKey}» не объявлен — экран отрисован из стандартного шаблона`
        : `Макет «${spec.layoutKey}» не объявлен — экран будет отрисован из стандартного шаблона`,
    );
    if (fallback == null) {
      return { id: spec.id, route: spec.route, label: spec.label, status: "warn", errors, warnings };
    }
    layout = fallback;
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
    // A missing/unfilled slot never blocks activation (spec §17.1/§17.2, PRD-3
    // §4.2/§4.3): the engine skips an absent slot (render-screen `fillSlots`).
    // The warning names what the author loses — the screen's own content region —
    // and NOT «renders from the standard template», which is true only when the
    // layout itself is missing (handled above).
    for (const slot of spec.expectedSlots) {
      const el = root.querySelector(`[data-slot="${slot}"]`);
      if (!el) {
        warnings.push(`Нет слота data-slot="${slot}" — эта часть экрана не будет заполнена`);
      } else if (!el.innerHTML.trim()) {
        warnings.push(`Не заполнен слот data-slot="${slot}"`);
      }
    }
    checkPlaceholdersReachTheScreen(spec, root, warnings);
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

/**
 * Экраны ОТЧЁТА — по одному варианту каждого объявленного вида (PRD-27 FR-26).
 *
 * Отчёт не входит в `preview.routes[]`: это не экран прохождения, а документ. Но
 * ломается он ровно так же, а замечает автор — только когда обучающийся не смог
 * скачать PDF. Данные берутся тем же построителем, что и предпросмотр в настройках
 * теста, чтобы проверка гоняла ровно ту страницу, что уйдёт в PDF.
 *
 * @param manifest Манифест проверяемого шаблона.
 * @param dataset Демонстрационный набор шаблона — из него берутся название и темы.
 */
function reportSpecs(
  manifest: PreviewManifest,
  dataset: PreviewDemoDataset,
): ReturnType<typeof buildScreenInputs> {
  const out: ReturnType<typeof buildScreenInputs> = [];
  const test: ReportPreviewTest = {
    testName: dataset.course?.title || "Тест",
    sections: (dataset.course?.topics ?? []).map((t) => ({ topicName: t.title })),
  };
  for (const kind of REPORT_KINDS) {
    const variants = reportVariants(manifest, kind);
    if (variants.length === 0) continue;
    const variant = variants.find((v) => v.isDefault === true) ?? variants[0];
    const values = resolveReportValues(variant, null);
    // Исход «не пройден»: на нём страница показывает БОЛЬШЕ — вердикт, непройденные
    // темы и блок рекомендаций, — то есть отрисовывается больше макета.
    const context =
      kind === "report.adaptive"
        ? buildAdaptiveReportContext(buildAdaptiveReportPreviewInput(test, "failed"), { values, isPreview: true })
        : buildReportContext(buildReportPreviewInput(test, "failed"), { values, isPreview: true });
    out.push({
      id: variant.key,
      route: variant.key,
      label: variant.label || variant.key,
      variantKey: variant.key,
      layoutKey: variant.layoutFile || kind,
      expectedSlots: [],
      input: { context: context as unknown as Record<string, unknown> },
    } as ReturnType<typeof buildScreenInputs>[number]);
  }
  return out;
}

/**
 * Run the browser smoke-test across all preview screens (+ optional template.js
 * check) and return the aggregate {@link SmokeReport}. `ok` is the activation
 * gate signal the server persists and enforces (NFR-01).
 */
export function runSmokeChecks(opts: SmokeRunOptions): SmokeReport {
  const render = opts.render ?? renderScreenInto;
  const specs = buildScreenInputs(opts.dataset, opts.manifest);
  const routes: SmokeRouteResult[] = specs.map((spec) => checkScreen(spec, opts, render));

  // PRD-27 FR-26: виды отчёта проверяются наравне с экранами.
  for (const spec of reportSpecs(opts.manifest, opts.dataset)) {
    routes.push(checkScreen(spec, opts, render));
  }

  if (opts.templateJs != null) routes.push(checkTemplateJs(opts.templateJs));

  const failed = routes.filter((r) => r.status === "fail").length;
  const warned = routes.filter((r) => r.status === "warn").length;
  const passed = routes.filter((r) => r.status === "pass").length;
  return { ok: failed === 0, total: routes.length, passed, warned, failed, routes };
}
