/**
 * @module shared/template/renderers
 *
 * Built-in `resultField` renderers (PRD-12; spec-template-platform §8.2.1.2),
 * ported to TS as the single source shared by both hosts. Each renderer is a pure
 * `(value, options) -> HTML string` function; none touches SCORM/runtime state.
 * The HTML output is kept identical to the SCORM package twin
 * (server/scorm/template/app/render/renderers.js) so the two render the same DOM.
 *
 * Built-in ids: core.textMetric, core.badge, core.progressBar, core.ringChart,
 * core.segmentedProgress.
 */

type RendererOptions = Record<string, any>;
type RendererFn = (value: unknown, options: RendererOptions) => string;

/** Escape & < > " — matches the SCORM renderers twin (note: does not escape '). */
function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function clamp(v: unknown, min: number, max: number): number {
  return Math.min(Math.max(Number(v) || 0, min), max);
}

/** Resolve a dot-notation path against an object. */
function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function textMetric(value: unknown, rendererOptions: RendererOptions): string {
  const opts = rendererOptions || {};
  const label = opts.label ? esc(String(opts.label)) : "";
  const suffix = opts.suffix ? esc(String(opts.suffix)) : "";
  const decimals = opts.decimals !== undefined ? Number(opts.decimals) : null;
  const display =
    value === null || value === undefined
      ? "—"
      : decimals !== null
        ? esc(Number(value).toFixed(decimals))
        : esc(String(value));
  return (
    '<div class="renderer renderer--text-metric">' +
    (label ? '<div class="renderer__label">' + label + "</div>" : "") +
    '<div class="renderer__value">' +
    display +
    (suffix ? '<span class="renderer__suffix">&thinsp;' + suffix + "</span>" : "") +
    "</div>" +
    "</div>"
  );
}

function badge(value: unknown, rendererOptions: RendererOptions): string {
  const opts = rendererOptions || {};
  const strValue = String(value);
  let tone = "neutral";
  let label = esc(strValue);
  if (opts.passed && String(opts.passed.value) === strValue) {
    tone = "passed";
    label = opts.passed.label ? esc(String(opts.passed.label)) : label;
  } else if (opts.failed && String(opts.failed.value) === strValue) {
    tone = "failed";
    label = opts.failed.label ? esc(String(opts.failed.label)) : label;
  } else if (opts.default) {
    label = esc(String(opts.default));
  }
  return '<span class="renderer renderer--badge renderer--badge-' + esc(tone) + '">' + label + "</span>";
}

function progressBar(value: unknown, rendererOptions: RendererOptions): string {
  const opts = rendererOptions || {};
  const pct = clamp(value, 0, 100);
  const label = opts.label ? esc(String(opts.label)) : "";
  const decimals = opts.decimals !== undefined ? Number(opts.decimals) : 0;
  const display = pct.toFixed(decimals) + "%";
  return (
    '<div class="renderer renderer--progress-bar">' +
    (label ? '<div class="renderer__label">' + label + "</div>" : "") +
    '<div class="renderer__track">' +
    '<div class="renderer__fill" style="width:' +
    pct.toFixed(2) +
    '%"></div>' +
    "</div>" +
    (opts.showValue ? '<div class="renderer__value">' + esc(display) + "</div>" : "") +
    "</div>"
  );
}

function ringChart(value: unknown, rendererOptions: RendererOptions): string {
  const opts = rendererOptions || {};
  const pct = clamp(value, 0, 100);
  const size = Number(opts.size) || 120;
  const sw = Number(opts.strokeWidth) || 10;
  const r = (size - sw) / 2;
  const circumference = 2 * Math.PI * r;
  const filled = (pct / 100) * circumference;
  const label = opts.label ? esc(String(opts.label)) : "";
  const decimals = opts.decimals !== undefined ? Number(opts.decimals) : 0;
  const display = pct.toFixed(decimals) + "%";
  const cx = size / 2;
  const cy = size / 2;
  return (
    '<div class="renderer renderer--ring-chart">' +
    (label ? '<div class="renderer__label">' + label + "</div>" : "") +
    '<svg class="renderer__ring" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 ' +
    size +
    " " +
    size +
    '" aria-hidden="true">' +
    '<circle class="renderer__ring-track" cx="' +
    cx +
    '" cy="' +
    cy +
    '" r="' +
    r +
    '" fill="none" stroke-width="' +
    sw +
    '"/>' +
    '<circle class="renderer__ring-fill" cx="' +
    cx +
    '" cy="' +
    cy +
    '" r="' +
    r +
    '" fill="none" stroke-width="' +
    sw +
    '"' +
    ' stroke-dasharray="' +
    filled.toFixed(2) +
    " " +
    circumference.toFixed(2) +
    '"' +
    ' stroke-dashoffset="0"' +
    ' transform="rotate(-90 ' +
    cx +
    " " +
    cy +
    ')"/>' +
    "</svg>" +
    (opts.showValue ? '<div class="renderer__value">' + esc(display) + "</div>" : "") +
    "</div>"
  );
}

function segmentedProgress(value: unknown, rendererOptions: RendererOptions): string {
  const opts = rendererOptions || {};
  const pct = clamp(value, 0, 100);
  const total = Math.max(Number(opts.segments) || 10, 1);
  const filled = Math.round((pct / 100) * total);
  const label = opts.label ? esc(String(opts.label)) : "";
  let segs = "";
  for (let i = 0; i < total; i++) {
    segs += '<span class="renderer__segment' + (i < filled ? " is-filled" : "") + '"></span>';
  }
  return (
    '<div class="renderer renderer--segmented-progress">' +
    (label ? '<div class="renderer__label">' + label + "</div>" : "") +
    '<div class="renderer__segments">' +
    segs +
    "</div>" +
    (opts.showValue ? '<div class="renderer__value">' + esc(pct.toFixed(0) + "%") + "</div>" : "") +
    "</div>"
  );
}

const builtins: Record<string, RendererFn> = {
  "core.textMetric": textMetric,
  "core.badge": badge,
  "core.progressBar": progressBar,
  "core.ringChart": ringChart,
  "core.segmentedProgress": segmentedProgress,
};

/** The author's saved `resultField` value (spec §8.2.1.2). */
export interface ResultFieldValue {
  path?: string;
  renderer?: string;
  label?: string;
  rendererOptions?: Record<string, unknown>;
  /** Allowed runtime paths from the placeholder definition (enforced here). */
  allowedPaths?: string[];
}

/** Built-in renderer ids available to `resultField` placeholders. */
export const CORE_RENDERER_IDS = Object.keys(builtins);

/**
 * Render a `resultField` value: resolve its path against the context and draw it
 * with the chosen renderer. Falls back to `core.textMetric` when the renderer is
 * not allowed/known or throws, and renders an empty value when the path is not in
 * `allowedPaths` (mirrors the SCORM twin).
 */
export function renderResultField(
  fieldValue: ResultFieldValue | null | undefined,
  context: unknown,
  allowedRenderers?: Set<string>,
): string {
  if (!fieldValue) return "";
  let rId = fieldValue.renderer || "core.textMetric";
  const opts: RendererOptions = { ...(fieldValue.rendererOptions || {}) };
  if (fieldValue.label) opts.label = opts.label || fieldValue.label;

  if (allowedRenderers && !allowedRenderers.has(rId)) rId = "core.textMetric";

  if (fieldValue.allowedPaths && fieldValue.path && fieldValue.allowedPaths.indexOf(fieldValue.path) === -1) {
    return builtins["core.textMetric"](null, opts);
  }

  const value = fieldValue.path ? resolvePath(context, fieldValue.path) : null;
  const fn = builtins[rId] || builtins["core.textMetric"];
  try {
    return fn(value, opts);
  } catch {
    return builtins["core.textMetric"](value, opts);
  }
}
