/**
 * @module server/services/template-dir
 * @description Resolves the on-disk directory holding a design template's files
 * by id. Built-in templates ship under `server/scorm/templates/<id>` while
 * uploaded (PRD-3) templates are extracted under `uploads/templates/<id>`; the
 * `templates` table's `sourcePath` column is the SINGLE source of truth for both.
 *
 * The rendering hosts (web learner screens, web results, SCORM export) must
 * resolve through this helper instead of assuming the built-in templates root —
 * otherwise an uploaded template connected to a test silently renders as
 * `default` (the built-in convention `server/scorm/templates/<id>` never exists
 * for uploaded ids, so a naive `existsSync` check falls back to default).
 *
 * This module imports `db`, so it must only be used from layers that already
 * depend on the database (route handlers). The pure file-reading services
 * ({@link module:server/services/template-render}, the SCORM exporter) stay
 * db-free and receive an already-resolved directory.
 */

import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../db";
import { templates } from "@shared/schema";
import { getTemplatesRootDir } from "../scorm/builders/template-copy";

/** Options for {@link resolveTemplateDir}. */
export interface ResolveTemplateDirOptions {
  /**
   * When true, an inactive/draft/invalid template does NOT resolve to its own
   * files — resolution falls through to `default`. Learner-facing render paths
   * pass this so a template that has not passed the activation gate (NFR-01)
   * never reaches a learner; author-facing preview routes leave it false so a
   * specific template can still be previewed by id.
   */
  activeOnly?: boolean;
}

/**
 * Last-resort computed path to the built-in `default` directory. Only used when
 * the DB has no usable `default` row; note `getTemplatesRootDir()` is `__dirname`-
 * relative, so in a bundled build it may not match the on-disk layout — the DB
 * `sourcePath` (process.cwd-based, set by syncBuiltinTemplates) is preferred.
 */
export function defaultTemplateDir(): string {
  return path.join(getTemplatesRootDir(), "default");
}

/**
 * Returns the template row's `sourcePath` if it exists on disk, else null.
 * When `activeOnly` is set, an inactive row resolves to null so the caller
 * falls back to `default` (the activation status is filtered in JS, not SQL,
 * to keep the resolver unit-testable without a live database).
 */
async function lookupSourcePath(
  templateId: string,
  activeOnly = false,
): Promise<string | null> {
  try {
    const [row] = await db
      .select({ sourcePath: templates.sourcePath, isActive: templates.isActive })
      .from(templates)
      .where(eq(templates.id, templateId));
    if (activeOnly && row && !row.isActive) return null;
    if (row?.sourcePath && fs.existsSync(row.sourcePath)) return row.sourcePath;
  } catch {
    // DB unavailable / query failed — caller falls back.
  }
  return null;
}

/**
 * Resolves the directory holding `templateId`'s files via the `templates` table
 * `sourcePath` — the SINGLE source of truth for both built-in and uploaded (PRD-3)
 * templates. Resolution order: the requested template's `sourcePath`, then the
 * `default` template's `sourcePath`, then a computed last resort. `default` is
 * resolved through the DB too (NOT a `__dirname`-relative guess), so it works in a
 * bundled production build where `getTemplatesRootDir()` would point at a path that
 * does not exist on disk.
 */
export async function resolveTemplateDir(
  templateId: string | null | undefined,
  opts: ResolveTemplateDirOptions = {},
): Promise<string> {
  if (templateId && templateId !== "default") {
    const dir = await lookupSourcePath(templateId, opts.activeOnly);
    if (dir) return dir;
  }
  // The `default` fallback always resolves regardless of `activeOnly` — it is the
  // system-wide safety net and cannot be deactivated.
  const def = await lookupSourcePath("default");
  if (def) return def;
  return defaultTemplateDir();
}

/**
 * True when the template's manifest declares ≥1 `contentTemplate` of `kind`.
 *
 * Fails SAFE: a template whose manifest cannot be read owns nothing, so the screen
 * falls back to the standard template rather than rendering from a template that may
 * not define it. The opposite (fail-open) chose a broken screen over a working one
 * whenever the DB hiccuped. A manifest with NO `contentTemplates` at all is treated
 * the same way — it declares no kinds, so every system screen falls back.
 */
async function templateOwnsKind(templateId: string, kind: string): Promise<boolean> {
  try {
    const [row] = await db
      .select({ manifest: templates.manifest })
      .from(templates)
      .where(eq(templates.id, templateId));
    const cts = (row?.manifest as { contentTemplates?: Array<{ kind?: string }> } | null | undefined)
      ?.contentTemplates;
    return Array.isArray(cts) && cts.some((c) => c?.kind === kind);
  } catch {
    return false;
  }
}

/**
 * Resolves the on-disk directory for a learner-facing SYSTEM screen of variant
 * `kind` (`start`/`results`/…), honoring the variant-binding fallback
 * (PRD-1 §4.3.2 / PRD-7 G21): when the active template declares NO
 * `contentTemplate` of `kind`, the planner binds the screen to the built-in
 * `default`, so its layout AND css must come from `default` too. This keeps the
 * learner runtime consistent with the editor preview and the «Из стандартного
 * шаблона» badge in «Структура» — otherwise «Структура» says "standard" while the
 * learner sees the active template's own (or empty) screen.
 *
 * For kinds the active template DOES own, this is identical to
 * {@link resolveTemplateDir}.
 */
export async function resolveSystemScreenDir(
  templateId: string | null | undefined,
  kind: string,
  opts: ResolveTemplateDirOptions = {},
): Promise<string> {
  if (templateId && templateId !== "default" && !(await templateOwnsKind(templateId, kind))) {
    return resolveTemplateDir("default", opts);
  }
  return resolveTemplateDir(templateId, opts);
}
