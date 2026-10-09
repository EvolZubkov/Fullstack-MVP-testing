/**
 * @module shared/template/params-css
 *
 * Single source of truth for turning a template's design PARAMS (the author's
 * branding choices) into CSS custom-property declarations the unified renderer
 * consumes. Both hosts use the SAME mapping so per-test branding renders
 * identically everywhere (PRD-12 parity):
 *   - the web preview applies these vars on the {@link TemplateScreen} host;
 *   - the SCORM package runtime (`templateCore.js`) delegates here via the
 *     `TBTemplate` global (with an inline fallback that mirrors this map).
 *
 * Values are emitted verbatim (HSL component triples like `225 7% 7%`, font
 * names, etc.) — the design CSS wraps colour tokens as `hsl(var(--x))`, so the
 * value must be the bare triple, never `hsl(...)` or `#rrggbb`.
 *
 * Pure — no DOM, no Node — safe to bundle for the browser and to unit-test.
 */

/** Default `param.key` → CSS custom-property name. A param may override via `cssVar`. */
export const DEFAULT_PARAM_CSS_VARS: Readonly<Record<string, string>> = {
  primaryColor: "--primary",
  backgroundColor: "--background",
  foregroundColor: "--foreground",
  cardColor: "--card",
  cardBorderColor: "--card-border",
  borderColor: "--border",
  mutedColor: "--muted",
  accentColor: "--accent",
  fontFamily: "--font-sans",
};

/** A manifest param definition (subset used for CSS-var derivation). */
export interface TemplateParamDef {
  key: string;
  /** Explicit CSS variable name; falls back to {@link DEFAULT_PARAM_CSS_VARS}. */
  cssVar?: string;
  /** Unit appended to numeric values (default `px`). */
  cssUnit?: string;
  /**
   * Data attribute the value is written to on the scene root (`data-…`), so the
   * template's own CSS can SELECT on the choice: a custom property can only be a
   * value, never a selector, and a template that switches a picture per option
   * needs the latter. Mirrors how PRD-23 already carries the pinned palette as
   * `data-theme` on the same element.
   */
  dataAttr?: string;
  /** Manifest default, used when the effective params omit this key. */
  default?: unknown;
}

/** `data-…`, lowercase, no spaces — what both hosts are allowed to set on the root. */
export const DATA_ATTR_PATTERN = /^data-[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Resolve a dot-notation path in an object (mirrors templateCore.resolvePath). */
function resolvePath(obj: unknown, path: string): unknown {
  if (!obj || !path) return undefined;
  const parts = path.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * Build a `{ "--css-var": "value" }` map from effective param values and the
 * manifest param definitions that declare (or default to) a CSS variable.
 * A param contributes only when it resolves a CSS-var name AND a value
 * (effective value, else `def.default`). Numeric values get `def.cssUnit` (px).
 *
 * Byte-for-byte equivalent to `templateCore.buildCssVarDeclarations` — the two
 * MUST stay in sync; this module is the canonical copy.
 */
export function buildTemplateCssVars(
  params: Record<string, unknown> | null | undefined,
  manifestParams: TemplateParamDef[] | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!manifestParams || !params) return result;
  for (const def of manifestParams) {
    const cssVar = def.cssVar || DEFAULT_PARAM_CSS_VARS[def.key];
    if (!cssVar) continue;
    let value = resolvePath(params, def.key);
    if (value === null || value === undefined) value = def.default;
    if (value === null || value === undefined) continue;
    result[cssVar] =
      typeof value === "number" ? String(value) + (def.cssUnit || "px") : String(value);
  }
  return result;
}

/**
 * The effective params Core reads, with the manifest's `default` filling every key the
 * test has not set.
 *
 * {@link buildTemplateCssVars} and {@link buildTemplateDataAttrs} have always fallen back to
 * `def.default`, but the params Core reads ITSELF (the level scheme, the render kinds, the bar
 * colouring) came straight from the stored settings — and those hold only what the author
 * changed. So the editor showed the manifest default as the current value while Core painted
 * its own hard-coded fallback, and a template had no way to choose the look of an untouched
 * test. Resolving here closes that gap for every such param at once.
 *
 * Only a missing value is filled (`null` / `undefined`): an author's explicit choice always
 * wins. Dotted keys (`progress.mode`) are skipped — they address nested settings through
 * {@link resolvePath}, and writing a flat key with a dot in it would create a second, unread
 * copy of the value.
 *
 * @param params Effective params of the test (may be empty).
 * @param manifestParams The template manifest's `params[]`.
 * @returns A new object; the input is not modified.
 */
export function withParamDefaults(
  params: Record<string, unknown> | null | undefined,
  manifestParams: TemplateParamDef[] | null | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...(params ?? {}) };
  for (const def of manifestParams ?? []) {
    if (!def || typeof def.key !== "string" || def.key.includes(".")) continue;
    if (def.default === null || def.default === undefined) continue;
    if (out[def.key] === null || out[def.key] === undefined) out[def.key] = def.default;
  }
  return out;
}

/**
 * Build a `{ "data-x": "value" }` map from the params that declare {@link
 * TemplateParamDef.dataAttr}. Both hosts put these on the scene root next to the CSS
 * vars, so a template can write `[data-brand-logo="b2b"] .logo { … }` — the one thing
 * `cssVar` cannot express, because custom properties do not participate in selectors.
 *
 * Values are stringified as-is (a `select` value is already a plain key). An attribute
 * name outside {@link DATA_ATTR_PATTERN} is SKIPPED rather than written: the manifest
 * validator rejects it up front, and a host must never inject an arbitrary attribute
 * name it was handed.
 *
 * Pure — same rules on both hosts, so a package and a web run cannot drift.
 */
export function buildTemplateDataAttrs(
  params: Record<string, unknown> | null | undefined,
  manifestParams: TemplateParamDef[] | null | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  if (!manifestParams) return result;
  for (const def of manifestParams) {
    if (!def.dataAttr || !DATA_ATTR_PATTERN.test(def.dataAttr)) continue;
    let value = params ? resolvePath(params, def.key) : undefined;
    if (value === null || value === undefined) value = def.default;
    if (value === null || value === undefined) continue;
    result[def.dataAttr] = String(value);
  }
  return result;
}
