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
import type { AttemptResult } from "@shared/schema";

/** What the web host needs to render one screen via the unified renderer. */
export interface ScreenRenderPayload {
  layout: string;
  css: string;
  context: unknown;
  /** Resolved theme tokens so the embedding host can match the template surface. */
  theme: { background: string; foreground: string };
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
    return { layout, css, theme: { background: cssVar(css, "background"), foreground: cssVar(css, "foreground") } };
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
): ScreenRenderPayload | null {
  try {
    const isAdaptive = (result as { mode?: string }).mode === "adaptive";
    const base = readScreenTemplate(dir, isAdaptive ? "results.adaptive.html" : "results.html");
    if (!base) return null;
    const context = isAdaptive
      ? buildAdaptiveResultContext(result, testTitle)
      : buildResultContext(result as AttemptResult, testTitle);
    return { ...base, context };
  } catch {
    return null;
  }
}
