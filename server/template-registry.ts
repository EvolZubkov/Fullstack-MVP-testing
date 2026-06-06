/**
 * @module server/template-registry
 * @description Syncs built-in SCORM templates from the filesystem into the templates table.
 * Called once at server startup; safe to call repeatedly (upsert by id).
 */
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  templates,
  templateManifestSchema,
  defaultTemplateManifestSchema,
  SUPPORTED_TEMPLATE_API_VERSIONS,
  isSupportedTemplateApiVersion,
} from "@shared/schema";
import { logger } from "./logger";

// API-version helpers live in @shared/schema (db-free, shared with the validator);
// re-exported here so existing `../template-registry` import sites keep working.
export { SUPPORTED_TEMPLATE_API_VERSIONS, isSupportedTemplateApiVersion };

const TEMPLATES_DIR = path.resolve(process.cwd(), "server", "scorm", "templates");
// Only `default` ships on disk. `corporate`/`minimal` were never bundled and
// were dead entries (skipped at sync) — removed in PRD-3. Uploaded templates are
// not synced from disk: they live in the DB from the moment of a successful upload.
const BUILTIN_IDS = ["default"] as const;
const DEFAULT_TEMPLATE_ID = "default";

/**
 * Validates a parsed manifest object against the variant-binding contract
 * (PRD-1 §4.3). The `default` built-in is held to the stricter
 * `defaultTemplateManifestSchema` because it is the system-wide fallback for
 * the `questions` variant kind. Returns `null` on success or a human-readable
 * reason string on failure.
 */
export function validateManifest(manifest: unknown, templateId: string): string | null {
  const schema = templateId === DEFAULT_TEMPLATE_ID
    ? defaultTemplateManifestSchema
    : templateManifestSchema;
  const result = schema.safeParse(manifest);
  if (result.success) return null;
  return result.error.issues
    .map((i) => `${i.path.join(".") || "<root>"}: ${i.message}`)
    .join("; ");
}

/**
 * Reads each built-in template manifest from disk and upserts it into the database.
 * Skips templates whose manifest is missing, unparseable, or has an unsupported API version.
 */
export async function syncBuiltinTemplates(): Promise<void> {
  for (const id of BUILTIN_IDS) {
    const manifestPath = path.join(TEMPLATES_DIR, id, "manifest.json");

    if (!fs.existsSync(manifestPath)) {
      logger.warn(`Built-in template manifest not found, skipping: ${id}`);
      continue;
    }

    let manifest: Record<string, unknown>;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    } catch (err) {
      logger.error(`Failed to parse manifest for template "${id}": ${(err as Error).message}`);
      continue;
    }

    const apiVersion = String(manifest.templateApiVersion ?? "");
    if (!isSupportedTemplateApiVersion(apiVersion)) {
      logger.warn(`Skipping template "${id}": unsupported templateApiVersion "${apiVersion}"`);
      continue;
    }

    const validationError = validateManifest(manifest, id);
    if (validationError) {
      logger.error(`Skipping template "${id}": manifest validation failed — ${validationError}`);
      continue;
    }

    await db
      .insert(templates)
      .values({
        id: String(manifest.id),
        name: String(manifest.name),
        description: manifest.description != null ? String(manifest.description) : null,
        version: String(manifest.version),
        templateApiVersion: apiVersion,
        isBuiltin: true,
        isActive: true,
        status: "active",
        sourceType: "builtin",
        sourcePath: path.join(TEMPLATES_DIR, id),
        manifest,
      })
      // status/is_active are intentionally NOT in the conflict-update set: an
      // admin may have deactivated a built-in (PRD-3 §5.3), and a re-sync on
      // restart must not silently re-activate it.
      .onConflictDoUpdate({
        target: templates.id,
        set: {
          name: String(manifest.name),
          description: manifest.description != null ? String(manifest.description) : null,
          version: String(manifest.version),
          templateApiVersion: apiVersion,
          sourceType: "builtin",
          sourcePath: path.join(TEMPLATES_DIR, id),
          manifest,
          updatedAt: new Date(),
        },
      });

    logger.info(`Synced built-in template: ${id} v${manifest.version}`);
  }
}

/**
 * Startup integrity check for uploaded templates (PRD-3): uploaded packages live
 * in the DB and on disk under their `source_path`. If the extracted files have
 * gone missing, the template can no longer be exported or rendered, so it is
 * flagged `invalid` and hidden from authors. Safe to call repeatedly.
 */
export async function reconcileUploadedTemplates(): Promise<void> {
  const rows = await db.select().from(templates).where(eq(templates.sourceType, "uploaded"));
  for (const row of rows) {
    const present = !!row.sourcePath && fs.existsSync(row.sourcePath);
    if (!present && row.status !== "invalid") {
      await db
        .update(templates)
        .set({ status: "invalid", isActive: false, updatedAt: new Date() })
        .where(eq(templates.id, row.id));
      logger.warn(`Uploaded template "${row.id}" marked invalid: source path missing (${row.sourcePath})`);
    }
  }
}
