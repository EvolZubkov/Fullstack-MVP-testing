/**
 * @module server/template-registry
 * @description Syncs built-in SCORM templates from the filesystem into the templates table.
 * Called once at server startup; safe to call repeatedly (upsert by id).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "./db";
import {
  templates,
  tests,
  templateManifestSchema,
  defaultTemplateManifestSchema,
  SUPPORTED_TEMPLATE_API_VERSIONS,
  isSupportedTemplateApiVersion,
} from "@shared/schema";
import { readDirEntries } from "./services/template-package";
import { validateTemplatePackage, type TemplateValidationReport } from "./services/template-validation";
import {
  rebindToDefault,
  manifestParamKeys,
  type DefaultTemplateInfo,
  type DesignSlepok,
} from "./services/template-rebind";
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
 * Computes a cheap source fingerprint for a template directory: a SHA-1 over each
 * file's POSIX-relative path, byte size and modification time (`stat` only — no
 * content reads). Any added/removed/edited file changes the hash, so the startup
 * reconcile can skip the expensive structural re-validation when it is unchanged.
 */
function computeSourceFingerprint(rootDir: string): string {
  const parts: string[] = [];
  const walk = (dir: string): void => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        walk(full);
      } else if (ent.isFile()) {
        const st = fs.statSync(full);
        const rel = path.relative(rootDir, full).split(path.sep).join("/");
        parts.push(`${rel}:${st.size}:${Math.floor(st.mtimeMs)}`);
      }
    }
  };
  walk(rootDir);
  parts.sort();
  return crypto.createHash("sha1").update(parts.join("\n")).digest("hex");
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
 * Startup template-integrity gate (PRD-3, NFR-01/02). For every template that is
 * NOT a currently shipped built-in, it verifies the template is safe to expose:
 * the source files must exist AND pass the same structural validation as an upload
 * ({@link validateTemplatePackage}; files are read, never executed — NFR-02). It:
 *
 *   - REMOVES orphaned built-ins — ids that were built-in in a previous build but
 *     are no longer shipped (e.g. `corporate`/`minimal`) and have no source dir.
 *     These are system-managed phantom rows, so they are deleted and any dependent
 *     test is repointed to `default` first (mirrors the deactivate cascade, §5.3);
 *   - DEACTIVATES uploaded packages whose files went missing or fail validation
 *     (flagged `invalid`, not deleted — uploaded packages are author data, removed
 *     only via the admin UI).
 *
 * Idempotent and boot-safe (the caller wraps it in try/catch). Valid templates are
 * never auto-(de)activated — an admin re-enables a fixed template through the UI,
 * which re-runs validation and the browser health check. Shipped built-ins
 * ({@link BUILTIN_IDS}) are validated by {@link syncBuiltinTemplates} and skipped.
 */
export async function reconcileTemplates(): Promise<void> {
  const shipped = new Set<string>(BUILTIN_IDS);
  const rows = await db.select().from(templates);

  for (const row of rows) {
    // Currently shipped built-ins are validated + upserted by syncBuiltinTemplates.
    if (row.sourceType === "builtin" && shipped.has(row.id)) continue;

    const present = !!row.sourcePath && fs.existsSync(row.sourcePath);

    // ── Orphaned built-in (phantom from an old build): remove it ───────────────
    // No longer shipped and no files on disk → not a real template. Repoint any
    // dependent tests to `default` (with a slepok consistent with `default` —
    // same §5.3 rebind as the deactivate cascade), then delete, transactionally
    // (NFR-04).
    if (row.sourceType === "builtin" && !present) {
      await db.transaction(async (tx) => {
        const [def] = await tx
          .select()
          .from(templates)
          .where(eq(templates.id, DEFAULT_TEMPLATE_ID));
        const defaultInfo: DefaultTemplateInfo = {
          version: def?.version ?? null,
          templateApiVersion: def?.templateApiVersion ?? null,
          paramKeys: manifestParamKeys(def?.manifest),
        };
        const dependents = await tx
          .select({ id: tests.id, designSettingsJson: tests.designSettingsJson })
          .from(tests)
          .where(sql`${tests.designSettingsJson}->>'templateId' = ${row.id}`);
        for (const dep of dependents) {
          await tx
            .update(tests)
            .set({ designSettingsJson: rebindToDefault(dep.designSettingsJson as DesignSlepok, defaultInfo) })
            .where(eq(tests.id, dep.id));
        }
        await tx.delete(templates).where(eq(templates.id, row.id));
      });
      logger.warn(`Removed orphaned built-in template "${row.id}" (no longer shipped, source missing); dependent tests repointed to default`);
      continue;
    }

    // ── Uploaded with missing source: deactivate once (keep the row — user data) ─
    if (!present) {
      if (row.status === "invalid" && !row.isActive) continue; // already handled
      await db
        .update(templates)
        .set({ status: "invalid", isActive: false, sourceFingerprint: null, updatedAt: new Date() })
        .where(eq(templates.id, row.id));
      logger.warn(`Template "${row.id}" deactivated on startup: source files missing (${row.sourcePath ?? "—"})`);
      continue;
    }

    // ── Change-detection: skip re-validation when files are unchanged ──────────
    const fingerprint = computeSourceFingerprint(row.sourcePath!);
    if (fingerprint === row.sourceFingerprint) continue; // unchanged since last reconcile

    // ── Source new/changed: re-run the same structural validation as an upload ─
    let report: TemplateValidationReport | null = null;
    let reason: string | null = null;
    try {
      const entries = await readDirEntries(row.sourcePath!);
      report = validateTemplatePackage(entries, { mode: "update", expectedId: row.id });
      if (!report.ok) {
        reason = "structural validation failed: " + report.blocking.map((b) => b.code).join(", ");
      }
    } catch (err) {
      reason = `validation error: ${(err as Error).message}`;
    }

    if (reason) {
      await db
        .update(templates)
        .set({
          status: "invalid",
          isActive: false,
          validationJson: report ?? row.validationJson,
          sourceFingerprint: fingerprint,
          updatedAt: new Date(),
        })
        .where(eq(templates.id, row.id));
      logger.warn(`Template "${row.id}" deactivated on startup (invalid): ${reason}`);
    } else {
      // Valid: persist the fresh report + fingerprint but do NOT auto-activate —
      // an admin re-enables a fixed template through the UI (re-runs the health check).
      await db
        .update(templates)
        .set({ validationJson: report, sourceFingerprint: fingerprint, updatedAt: new Date() })
        .where(eq(templates.id, row.id));
      logger.info(`Template "${row.id}" re-validated on startup: ok`);
    }
  }
}
