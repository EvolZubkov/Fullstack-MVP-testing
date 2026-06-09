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
  /** Manifest default, used when the effective params omit this key. */
  default?: unknown;
}

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
