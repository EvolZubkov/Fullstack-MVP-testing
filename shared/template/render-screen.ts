/**
 * @module shared/template/render-screen
 *
 * Unified screen renderer (PRD-12 Phase 0/1). Composes the path-only DSL
 * ({@link module:shared/template/dsl}) with the controlled DOM passes — `data-path`
 * text bindings and `data-slot` HTML regions — to render a layout against the
 * public render context (§10) into a DOM container.
 *
 * This is the single renderer both hosts mount: the SCORM package and the web
 * React host. It is DOM-touching (runs in the browser / jsdom) but free of any
 * SCORM/host globals — it operates only on the `root` element it is given and the
 * context it is passed, so it is unit-testable under jsdom.
 *
 * Order: DSL first (resolve `{{ }}` / `{{#if}}` / `{{#each}}` / partials, escaped),
 * then `data-path` text bindings, then `data-slot` controlled-HTML regions, then —
 * for content pages — `data-placeholder` filling (by type, with `resultField`
 * drawn via the renderer registry, {@link module:shared/template/renderers}).
 */

import { renderTemplate } from "./dsl";
import { renderResultField } from "./renderers";
import { applyProtection } from "./protection/apply";
import type { ProtectionSpec } from "./protection/spec";

/** A content template's placeholder definition (subset; spec §8.2.1). */
export interface PlaceholderDef {
  key: string;
  /** text | textarea | richText | html | number | image | boolean | resultField | … */
  type: string;
  allowedRenderers?: string[];
  allowedPaths?: string[];
}

/** Content-page data: the template's placeholders + the author-filled values. */
export interface ContentPageData {
  template: { placeholders?: PlaceholderDef[] };
  values: Record<string, unknown>;
}

/** Inputs for one screen render. */
export interface ScreenRenderInput {
  /** Layout HTML, e.g. the template's `layouts[key]`. */
  layout: string;
  /** Public render context (§10) fed to the DSL and `data-path` bindings. */
  context: unknown;
  /** Controlled HTML for `data-slot="name"` regions (e.g. question-interaction). */
  slots?: Record<string, string>;
  /** Partial templates for `{{> name}}`. */
  partials?: Record<string, string>;
  /** Content-page placeholders to fill into `data-placeholder` regions. */
  content?: ContentPageData;
  /**
   * PRD-34 (FR-30, FR-31): what this screen protects, hides and stamps. Built by the
   * SHARED builder in `protection/spec`; absent ⇒ nothing is protected, which is the
   * correct answer for every screen outside the perimeter (FR-09).
   */
  protection?: ProtectionSpec;
}

/** Escape & < > " for placeholder HTML (matches the SCORM placeholder twin). */
function escHtml(s: unknown): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert a placeholder value to safe HTML by type (richText/html pass through). */
function renderPlaceholderHtml(type: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (type) {
    case "text":
    case "textarea":
      return escHtml(String(value)).replace(/\n/g, "<br>");
    case "richText":
    case "html":
      return String(value);
    case "number":
      return escHtml(String(value));
    case "image": {
      // Image placeholders carry a plain URL string. Guard against a non-string
      // (e.g. a legacy media envelope `{ url, name }`) so a stray object never
      // leaks as `<img src="[object Object]">` on either host — extract `.url`
      // when present, otherwise render nothing.
      const src =
        typeof value === "string"
          ? value
          : value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string"
            ? (value as { url: string }).url
            : "";
      return src ? '<img src="' + escHtml(src) + '" alt="" style="max-width:100%;max-height:100%;">' : "";
    }
    case "boolean":
      return value ? "&#10003;" : "";
    default:
      return escHtml(String(value));
  }
}

/** Resolve a dot-notation path against an object; missing segments yield undefined. */
function resolvePath(obj: unknown, path: string): unknown {
  if (!path) return undefined;
  let cur: unknown = obj;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/** Coerce a resolved value to text; objects/arrays render as empty. */
function toText(v: unknown): string {
  if (v === null || v === undefined) return "";
  const t = typeof v;
  return t === "string" || t === "number" || t === "boolean" || t === "bigint" ? String(v) : "";
}

/** Bind `[data-path]` elements to escaped text from the context (via textContent). */
function bindDataPaths(root: Element, context: unknown): void {
  root.querySelectorAll("[data-path]").forEach((el) => {
    el.textContent = toText(resolvePath(context, el.getAttribute("data-path") || ""));
  });
}

/** Fill `[data-slot="name"]` regions with the controlled HTML provided in `slots`. */
function fillSlots(root: Element, slots: Record<string, string>): void {
  for (const name of Object.keys(slots)) {
    const el = root.querySelector(`[data-slot="${name}"]`);
    if (el) el.innerHTML = slots[name] ?? "";
  }
}

/**
 * Fill `[data-placeholder="key"]` regions from a content page's values. Plain
 * placeholders render by type; `resultField` placeholders resolve their path
 * against the context and draw via the renderer registry.
 */
function fillContentPlaceholders(root: Element, content: ContentPageData, context: unknown): void {
  for (const ph of content.template.placeholders ?? []) {
    const el = root.querySelector(`[data-placeholder="${ph.key}"]`);
    if (!el) continue;
    if (ph.type === "resultField") {
      const allowed = ph.allowedRenderers ? new Set(ph.allowedRenderers) : undefined;
      const fieldValue = {
        ...((content.values[ph.key] as Record<string, unknown>) ?? {}),
        allowedPaths: ph.allowedPaths,
      };
      el.innerHTML = renderResultField(fieldValue, context, allowed);
    } else {
      el.innerHTML = renderPlaceholderHtml(ph.type, content.values[ph.key]);
    }
  }
}

/**
 * Renders a layout against the public context into `root` (mutates it). The host
 * supplies the container; this keeps the renderer free of any `document` global.
 */
export function renderScreenInto(root: HTMLElement, input: ScreenRenderInput): void {
  root.innerHTML = renderTemplate(input.layout, input.context, { partials: input.partials });
  bindDataPaths(root, input.context);
  if (input.slots) fillSlots(root, input.slots);
  if (input.content) fillContentPlaceholders(root, input.content, input.context);
  // PRD-34 (FR-31): LAST — the slot HTML above would otherwise overwrite the marks.
  applyProtection(root, input.protection?.copy ?? null);
}
