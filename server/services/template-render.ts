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
import type { AttemptResult } from "@shared/schema";

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
function resolveLogoUrl(designParams: Record<string, unknown> | null | undefined): string | undefined {
  const logo = designParams?.logoUrl;
  if (typeof logo === "string") return logo || undefined;
  if (logo && typeof logo === "object" && typeof (logo as { url?: unknown }).url === "string") {
    return (logo as { url: string }).url || undefined;
  }
  return undefined;
}

/** Extract a CSS custom property value (e.g. `--background`) from a stylesheet. */
function cssVar(css: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*([^;}]+)`).exec(css);
  return m ? m[1].trim() : "";
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
  try {
    const raw = readFileSafe(path.join(dir, "manifest.json"));
    if (!raw) return [];
    const manifest = JSON.parse(raw) as { params?: TemplateParamDef[] };
    return Array.isArray(manifest.params) ? manifest.params : [];
  } catch {
    return [];
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
  designParams?: Record<string, unknown> | null,
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
    const cssVars = buildTemplateCssVars(designParams, readManifestParams(paramsDir || dir));
    const logoUrl = resolveLogoUrl(designParams);
    return {
      layout,
      css,
      theme: { background: cssVar(css, "background"), foreground: cssVar(css, "foreground") },
      ...(Object.keys(cssVars).length > 0 ? { cssVars } : {}),
      ...(logoUrl ? { design: { logoUrl } } : {}),
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
  designParams?: Record<string, unknown> | null,
  paramsDir?: string,
): ScreenRenderPayload | null {
  try {
    const isAdaptive = (result as { mode?: string }).mode === "adaptive";
    const base = readScreenTemplate(
      dir,
      isAdaptive ? "results.adaptive.html" : "results.html",
      designParams,
      paramsDir,
    );
    if (!base) return null;
    const context = isAdaptive
      ? buildAdaptiveResultContext(result, testTitle)
      : buildResultContext(result as AttemptResult, testTitle);
    // The results context is server-built, so merge branding straight in (the
    // client passes `render.context` verbatim to the renderer).
    if (base.design) (context as { design?: { logoUrl?: string } }).design = base.design;
    return { ...base, context };
  } catch {
    return null;
  }
}
