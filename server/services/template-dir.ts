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

/**
 * Last-resort computed path to the built-in `default` directory. Only used when
 * the DB has no usable `default` row; note `getTemplatesRootDir()` is `__dirname`-
 * relative, so in a bundled build it may not match the on-disk layout — the DB
 * `sourcePath` (process.cwd-based, set by syncBuiltinTemplates) is preferred.
 */
export function defaultTemplateDir(): string {
  return path.join(getTemplatesRootDir(), "default");
}

/** Returns the template row's `sourcePath` if it exists on disk, else null. */
async function lookupSourcePath(templateId: string): Promise<string | null> {
  try {
    const [row] = await db
      .select({ sourcePath: templates.sourcePath })
      .from(templates)
      .where(eq(templates.id, templateId));
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
export async function resolveTemplateDir(templateId: string | null | undefined): Promise<string> {
  if (templateId && templateId !== "default") {
    const dir = await lookupSourcePath(templateId);
    if (dir) return dir;
  }
  const def = await lookupSourcePath("default");
  if (def) return def;
  return defaultTemplateDir();
}
