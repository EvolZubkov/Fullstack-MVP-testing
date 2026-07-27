/**
 * @module server/services/template-render
 *
 * Assembles the render payload the web template host needs for a screen (PRD-12
 * web-host): the design template's layout HTML, its CSS, and the runtime context.
 * The server owns templates (spec §2.1) — it reads the selected template's files
 * and ships `{ layout, css, context }` to the client, which mounts the unified
 * renderer ({@link module:shared/template/render-screen}). Defensive: any read or
 * build failure yields `null`, so the result endpoint degrades to its legacy
 * (React-markup) rendering rather than erroring.
 *
 * This module is intentionally db-free: it reads files from an already-resolved
 * template DIRECTORY. The caller resolves which directory (built-in or uploaded)
 * via {@link module:server/services/template-dir}, which owns the db lookup. This
 * keeps the pure render-payload assembly testable without a database.
 */

import fs from "node:fs";
import path from "node:path";
import { buildResultContext, buildAdaptiveResultContext } from "./result-context";
import { buildTemplateCssVars, type TemplateParamDef } from "@shared/template/params-css";
import { buildPaletteBridge } from "@shared/template/palette-bridge";
import { baseParams, buildTemplateThemeCss, sceneThemeAttribute } from "@shared/template/theme-css";
import type { StoredDesignSettings } from "@shared/template/theme-params";
import type { AttemptResult } from "@shared/schema";

/**
 * The test's stored design settings, as the routes read them off the test row.
 * PRD-23 widened this from a bare param map: colours now live per theme.
 */
export type DesignSettingsInput = StoredDesignSettings;

/** What the web host needs to render one screen via the unified renderer. */
export interface ScreenRenderPayload {
  layout: string;
  css: string;
  context: unknown;
  /** Resolved theme tokens so the embedding host can match the template surface. */
  theme: { background: string; foreground: string };
  /**
   * Per-test design-param overrides as CSS custom properties (PRD-7 branding),
   * built from the test's `designSettingsJson.params` + the template manifest via
   * the SHARED {@link module:shared/template/params-css buildTemplateCssVars} —
   * the SAME mapping the SCORM runtime bakes in, so colours/font render identically
   * on both hosts. Applied on the {@link TemplateScreen} shadow host. Omitted when
   * no param resolves a CSS variable.
   */
  cssVars?: Record<string, string>;
  /**
   * PRD-23: the test's per-theme colour overrides as a CSS block, printed by the
   * SHARED {@link module:shared/template/theme-css buildTemplateThemeCss} against
   * the `:host` selector (the web host renders inside a shadow root). Injected
   * AFTER the template stylesheet so the test's palette wins. Omitted for a
   * template that declares no themes — its colours travel in `cssVars` as before.
   */
  themeCss?: string;
  /**
   * PRD-23: the palette the author pinned, put on the scene root as `data-theme`.
   * Omitted for «Авто» — the attribute must be ABSENT for the template's own
   * `prefers-color-scheme` rules to decide.
   */
  dataTheme?: "light" | "dark";
  /**
   * Per-test branding for the render context (`design.*`, PRD-7). The client spreads
   * this into the context it builds for client-built screens (start/question/blocked);
   * for the results screen the context is server-built and already carries it.
   * Omitted when the test has no logo. The logo param is stored as a media envelope
   * `{ url, name, … }`; `.url` is extracted here so the layout binds a plain string.
   */
  design?: { logoUrl?: string };
}

/**
 * Resolve the design `logoUrl` to a plain URL string. The author stores it as a
 * media envelope `{ url, name, … }` (or, for legacy/string values, a bare URL);
 * the layout binds a string, so the envelope is unwrapped here.
 */
function resolveMediaUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value || undefined;
  if (value && typeof value === "object" && typeof (value as { url?: unknown }).url === "string") {
    return (value as { url: string }).url || undefined;
  }
  return undefined;
}

/** Extract a CSS custom property value (e.g. `--background`) from a stylesheet. */
function cssVar(css: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;}]+)`).exec(css);
  return m ? m[1].trim() : "";
}

/**
 * Presence of a design custom property (e.g. `--primary`) in the resolved payload.
 * A colour param lands in the inline `cssVars` for a plain template, or in the
 * `themeCss` block for a PRD-23 themed one — the palette bridge must fire in either
 * case. Returns the resolved value (a truthy marker) or `undefined` when unset, so
 * {@link module:shared/template/palette-bridge buildPaletteBridge} overrides only the
 * DS tokens the test actually branded (an unbranded var keeps the DS default).
 */
function paletteVar(name: string, cssVars: Record<string, string>, themeCss: string): string | undefined {
  return cssVars[name] ?? (themeCss.includes(`${name}:`) ? "1" : undefined);
}

function readFileSafe(p: string): string {
  try {
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
  } catch {
    return "";
  }
}

/**
 * Read a template's manifest `params[]` (the CSS-var definitions) from its dir.
 * Empty on any read/parse failure — branding then simply falls back to theme.css.
 */
function readManifestParams(dir: string): TemplateParamDef[] {
  return readBrandingManifest(dir).params ?? [];
}

/**
 * Read the part of a template's manifest that branding needs: `params[]` (the
 * CSS-var definitions) and `themes[]` (PRD-23, which palettes exist). Empty on any
 * read/parse failure — branding then simply falls back to theme.css.
 */
function readBrandingManifest(dir: string): { params?: TemplateParamDef[]; themes?: unknown } {
  try {
    const raw = readFileSafe(path.join(dir, "manifest.json"));
    if (!raw) return {};
    const manifest = JSON.parse(raw) as { params?: TemplateParamDef[]; themes?: unknown };
    return {
      params: Array.isArray(manifest.params) ? manifest.params : [],
      themes: manifest.themes,
    };
  } catch {
    return {};
  }
}

/**
 * Read a template's manifest `contentTemplates[]` — the per-variant placeholder
 * declarations a content page is authored against.
 *
 * PRD-12 FR-6: the web host needs these to build the SAME page skeleton the SCORM
 * runtime builds (`shared/template/content-page`). In the SCORM package the array
 * ships inside the bundle; on the web it has to travel with the screen assets, or
 * the host can only ever render the untemplated fallback.
 */
export function readManifestContentTemplates(dir: string): unknown[] {
  try {
    const raw = readFileSafe(path.join(dir, "manifest.json"));
    if (!raw) return [];
    const manifest = JSON.parse(raw) as { contentTemplates?: unknown[] };
    return Array.isArray(manifest.contentTemplates) ? manifest.contentTemplates : [];
  } catch {
    return [];
  }
}

/**
 * Read the layout HTML of every variant that names one, keyed by its `layoutFile`
 * path — the key the shared resolver looks a variant-backed layout up by (spec
 * §8.2, `shared/template/content-page`).
 *
 * PRD-12 FR-6 parity: the SCORM package ships all of these, so a variant with its
 * own layout renders through it in the package. The web host was served only the
 * generic `content.html` wrapper, which meant every such variant — the whole PRD-22
 * variant grid — collapsed into one look in the web run. Reading them here is what
 * lets the two hosts render the same page the same way.
 *
 * `layoutFile` comes from a manifest, which for an uploaded template is untrusted
 * input, so a path that escapes the template directory is dropped rather than read.
 * @param dir  Resolved template directory
 * @returns layout HTML keyed by the declared `layoutFile` path (empty on failure)
 */
export function readVariantLayouts(dir: string): Record<string, string> {
  const layouts: Record<string, string> = {};
  const root = path.resolve(dir);
  for (const raw of readManifestContentTemplates(dir)) {
    const rel = (raw as { layoutFile?: unknown })?.layoutFile;
    if (typeof rel !== "string" || !rel || layouts[rel] != null) continue;
    const full = path.resolve(root, rel);
    if (full !== root && !full.startsWith(root + path.sep)) continue;
    const html = readFileSafe(full);
    if (html) layouts[rel] = html;
  }
  return layouts;
}

/**
 * Read a named screen's template ASSETS (layout HTML + css + theme tokens) without
 * building a context — for screens whose context the client assembles itself
 * (e.g. the start screen). Returns null when the layout file is missing.
 *
 * `dir` is an already-resolved template directory (see
 * {@link module:server/services/template-dir resolveTemplateDir}) — a built-in
 * (`server/scorm/templates/<id>`) or uploaded (`uploads/templates/<id>`) path.
 */
export function readScreenTemplate(
  dir: string,
  layoutFile: string,
  /**
   * The test's WHOLE design settings, not just `params`: PRD-23 splits colours
   * across `paramsByTheme` and the pinned `theme` lives beside them.
   */
  design?: DesignSettingsInput | null,
  paramsDir?: string,
): Omit<ScreenRenderPayload, "context"> | null {
  try {
    const layout = readFileSafe(path.join(dir, "layouts", layoutFile));
    if (!layout) return null;
    const css = [
      readFileSafe(path.join(dir, "styles", "base.css")),
      readFileSafe(path.join(dir, "styles", "theme.css")),
    ]
      .filter(Boolean)
      .join("\n");
    // PRD-7 branding: resolve the per-test design params against the ACTIVE
    // template's manifest into CSS-var overrides — the SAME single-source mapping
    // the SCORM runtime uses (`templateCore.buildCssVarDeclarations`), so the web
    // host applies the author's colours/font instead of only theme.css defaults.
    // The manifest comes from `paramsDir` (the active template the params were set
    // against) so a screen whose LAYOUT falls back to `default` still resolves the
    // active template's params — parity with SCORM's global cssVar application.
    //
    // PRD-23: a template with themes paints its colours per palette, so those keys
    // leave `cssVars` (inline, unscopable) and become a CSS block instead. For a
    // template without themes `baseParams` is the whole param set and `themeCss` is
    // empty — the payload is byte-identical to what it was before.
    const manifest = readBrandingManifest(paramsDir || dir);
    const base = baseParams(design, manifest);
    const cssVars = buildTemplateCssVars(base, manifest.params);
    const themeCss = buildTemplateThemeCss(design, manifest, { rootSelector: ":host" });
    const dataTheme = sceneThemeAttribute(design, manifest);
    const logoUrl = resolveMediaUrl(base?.logoUrl);
    const startImageUrl = resolveMediaUrl(base?.startImageUrl);
    const design_ = { ...(logoUrl ? { logoUrl } : {}), ...(startImageUrl ? { startImageUrl } : {}) };
    // Ревизия «Стандартный» на ui-kit: подмешать мост палитры DS. Он выводит
    // акцентную рампу --ou-purple-* из --primary теста (и поверхности из
    // --background/--card/--border), поэтому .ou-разметка ученических экранов
    // брендируется палитрой теста. Ссылки на var(--…) — живые, значение
    // подставляет активная тема (cssVars инлайном / themeCss на :host).
    const bridge = buildPaletteBridge({
      primary: paletteVar("--primary", cssVars, themeCss),
      background: paletteVar("--background", cssVars, themeCss),
      card: paletteVar("--card", cssVars, themeCss),
      border: paletteVar("--border", cssVars, themeCss),
    });
    return {
      layout,
      css: bridge ? `${css}\n${bridge}` : css,
      theme: { background: cssVar(css, "background"), foreground: cssVar(css, "foreground") },
      ...(Object.keys(cssVars).length > 0 ? { cssVars } : {}),
      ...(themeCss ? { themeCss } : {}),
      ...(dataTheme ? { dataTheme } : {}),
      ...(Object.keys(design_).length ? { design: design_ } : {}),
    };
  } catch {
    return null;
  }
}

/**
 * Build the render payload for the RESULTS screen of a completed standard attempt.
 * Returns null when the layout is missing or the result is not a standard result
 * (e.g. adaptive), so the caller can fall back to legacy rendering.
 */
export function readResultsRenderPayload(
  dir: string,
  result: AttemptResult | (Record<string, unknown> & { mode?: string }),
  testTitle: string,
  design?: DesignSettingsInput | null,
  paramsDir?: string,
  subtitle?: string,
): ScreenRenderPayload | null {
  try {
    const isAdaptive = (result as { mode?: string }).mode === "adaptive";
    const base = readScreenTemplate(
      dir,
      isAdaptive ? "results.adaptive.html" : "results.html",
      design,
      paramsDir,
    );
    if (!base) return null;
    const context = isAdaptive
      ? buildAdaptiveResultContext(result, testTitle)
      : buildResultContext(result as AttemptResult, testTitle);
    // Header subtitle «Попытка N из M» (Core-prepared by the caller), same as the
    // other learner screens — merged into the server-built course context.
    if (subtitle) (context as { course: { subtitle?: string } }).course.subtitle = subtitle;
    // The results context is server-built, so merge branding straight in (the
    // client passes `render.context` verbatim to the renderer).
    if (base.design) (context as { design?: { logoUrl?: string } }).design = base.design;
    return { ...base, context };
  } catch {
    return null;
  }
}
