/**
 * @module shared/template/theme-css
 *
 * Prints a test's per-theme colour overrides as a CSS text block, and says which
 * theme the scene must be pinned to (PRD-23). Both hosts use this ONE printer, so a
 * themed test paints identically in the web preview and in the SCORM package.
 *
 * Why a stylesheet and not inline custom properties: overrides used to be set on the
 * scene root's `style` attribute, which cannot be scoped to a media query. A template
 * with two palettes needs exactly that scoping — the dark value has to apply only when
 * the dark palette is in force. So per-theme values are printed as rules that mirror
 * the structure templates already use in their own `theme.css`:
 *
 *   <root>                                       — the light palette
 *   @media (prefers-color-scheme: dark)
 *     <root>:not([data-theme="light"])           — the dark palette, system choice
 *   <root>[data-theme="dark"]                    — the dark palette, pinned
 *
 * Specificity of the last two is higher than the base rule, so the dark value wins
 * whenever dark is in force, and the author's pin always beats the system setting.
 * The block is injected AFTER the template's own stylesheet, so at equal specificity
 * the test's choice wins over the template's default palette.
 *
 * Params that do not depend on the palette (font, logo, progress mode) are NOT printed
 * here — they keep flowing through `buildTemplateCssVars` as before. The two sets are
 * disjoint by construction ({@link module:shared/template/theme-params}), so nothing
 * is declared twice.
 *
 * Pure string processing — no DOM, no Node — safe to bundle for the browser.
 */
import { buildTemplateCssVars, type TemplateParamDef } from "./params-css";
import { paramsForTheme, resolveThemeParams, type StoredDesignSettings } from "./theme-params";
import { declaredThemes, type ThemeId } from "./themes";

/** Manifest, in the part the printer reads. */
export interface ThemeCssManifest {
  params?: TemplateParamDef[];
  themes?: unknown;
}

export interface ThemeCssOptions {
  /**
   * Selector of the scene root. `:root` for the SCORM document, `:host` for the
   * web host's shadow root — inside a shadow tree `:root` matches nothing.
   */
  rootSelector?: string;
}

/** `--name: value;` pairs of one rule body. */
function declarations(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([name, value]) => `${name}: ${value};`)
    .join(" ");
}

/**
 * Attaches a condition (`[data-theme="dark"]`, `:not([data-theme="light"])`) to
 * the scene root.
 *
 * `:root` takes it as a plain compound suffix. `:host` does NOT: inside a shadow
 * tree the host is matched by the FUNCTIONAL form `:host(<selector>)`, and the
 * suffix form `:host[data-theme="dark"]` is invalid — the browser drops the whole
 * rule, so the pinned palette silently never applies.
 */
function withCondition(root: string, condition: string): string {
  return root.trim() === ":host" ? `:host(${condition})` : `${root}${condition}`;
}

/**
 * Builds the CSS block that paints a test's per-theme colour overrides.
 *
 * @param design   Stored design settings (`params`, `paramsByTheme`, `theme`).
 * @param manifest Template manifest — `params[]` maps keys to CSS variables,
 *                 `themes[]` says which palettes exist.
 * @returns CSS text, or `""` when the template has no themes or the author has
 *          overridden no colour (then there is nothing to print).
 */
export function buildTemplateThemeCss(
  design: StoredDesignSettings | null | undefined,
  manifest: ThemeCssManifest | null | undefined,
  options?: ThemeCssOptions,
): string {
  const resolved = resolveThemeParams(design, manifest);
  if (!resolved.themed) return "";

  const root = options?.rootSelector || ":root";
  const manifestParams = manifest?.params ?? [];
  const ids = declaredThemes(manifest).map((t) => t.id);

  // Only what the author actually set for THIS palette. Two exclusions matter:
  // `paramsForTheme` would fold in the base params (already applied once, and they
  // do not change with the palette), and the param definitions are narrowed to the
  // keys present — otherwise `buildTemplateCssVars` falls back to each manifest
  // `default` and prints every defaulted param, colour or not, into every theme.
  const varsOf = (id: ThemeId): Record<string, string> => {
    const values = resolved.byTheme[id] ?? {};
    const defs = manifestParams.filter((def) => values[def.key] !== undefined);
    return buildTemplateCssVars(values, defs);
  };

  const out: string[] = [];
  if (ids.includes("light")) {
    const light = varsOf("light");
    if (Object.keys(light).length > 0) out.push(`${root} { ${declarations(light)} }`);
  }
  if (ids.includes("dark")) {
    const dark = varsOf("dark");
    if (Object.keys(dark).length > 0) {
      const body = declarations(dark);
      out.push(
        `@media (prefers-color-scheme: dark) { ${withCondition(root, ':not([data-theme="light"])')} { ${body} } }`,
      );
      out.push(`${withCondition(root, '[data-theme="dark"]')} { ${body} }`);
    }
  }
  return out.join("\n");
}

/**
 * The value of `data-theme` on the scene root, or `null` when the test follows the
 * viewer's system setting («Авто») — then the attribute must be ABSENT, otherwise
 * the template's own `prefers-color-scheme` rules never get their turn.
 */
export function sceneThemeAttribute(
  design: StoredDesignSettings | null | undefined,
  manifest: ThemeCssManifest | null | undefined,
): ThemeId | null {
  const resolved = resolveThemeParams(design, manifest);
  if (!resolved.themed || resolved.theme === "auto") return null;
  return resolved.theme;
}

/**
 * Params that paint regardless of the palette — what the host still applies as
 * inline custom properties. For a template without themes this is every param, so
 * nothing changes for it.
 */
export function baseParams(
  design: StoredDesignSettings | null | undefined,
  manifest: ThemeCssManifest | null | undefined,
): Record<string, unknown> {
  return resolveThemeParams(design, manifest).base;
}

/**
 * Params of ONE palette, base included — for a consumer that renders a single
 * fixed theme (a pinned test rendered server-side, one pane of the preview).
 */
export function paramsOfTheme(
  design: StoredDesignSettings | null | undefined,
  manifest: ThemeCssManifest | null | undefined,
  themeId: ThemeId,
): Record<string, unknown> {
  return paramsForTheme(resolveThemeParams(design, manifest), themeId);
}
