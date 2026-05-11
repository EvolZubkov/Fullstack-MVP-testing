/**
 * @module server/template-registry
 * @description Syncs built-in SCORM templates from the filesystem into the templates table.
 * Called once at server startup; safe to call repeatedly (upsert by id).
 */
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";
import { templates } from "@shared/schema";
import { logger } from "./logger";

/** API versions this server accepts. Reject templates with any other version. */
export const SUPPORTED_TEMPLATE_API_VERSIONS = ["1.0"] as const;

const TEMPLATES_DIR = path.resolve(process.cwd(), "server", "scorm", "templates");
const BUILTIN_IDS = ["default", "corporate", "minimal"] as const;

/** Returns true when the given templateApiVersion is accepted by this server. */
export function isSupportedTemplateApiVersion(version: string): boolean {
  return (SUPPORTED_TEMPLATE_API_VERSIONS as readonly string[]).includes(version);
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
        manifest,
      })
      .onConflictDoUpdate({
        target: templates.id,
        set: {
          name: String(manifest.name),
          description: manifest.description != null ? String(manifest.description) : null,
          version: String(manifest.version),
          templateApiVersion: apiVersion,
          manifest,
          updatedAt: new Date(),
        },
      });

    logger.info(`Synced built-in template: ${id} v${manifest.version}`);
  }
}
