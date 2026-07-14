/**
 * @module server/routes/admin-templates
 * @description Admin lifecycle API for the SCORM template registry (PRD-3).
 * Built-in and uploaded templates share one table (NFR-07); these routes manage
 * the uploaded/admin side: upload + structural validation, the
 * draft/active/inactive/invalid state machine, deactivation cascade to the
 * `default` template, delete, re-upload (update) and ZIP export.
 *
 * The server never executes template HTML/JS (NFR-02). The browser smoke-test
 * (NFR-03) is client-side and lands in Phase 2; here `activate` gates on the
 * persisted structural validation only.
 *
 * Mounted at `/api/admin/templates`. All routes require the `author` role.
 *
 * GET    /                  - list every template (incl. draft/invalid)
 * POST   /                  - upload a ZIP: validate, then create as `draft`
 * GET    /:id               - details + usage count
 * PUT    /:id/activate      - draft/inactive -> active (gated on validation)
 * PUT    /:id/deactivate    - -> inactive; switch dependent tests to `default`
 * DELETE /:id               - delete an uploaded, unused, non-active template
 * PUT    /:id/update        - re-upload a ZIP for an existing id
 * GET    /:id/export        - download the template as a ZIP
 * POST   /:id/validate      - re-run structural validation against stored files
 * GET    /:id/smoke-bundle  - (Phase 2) files the browser needs to render + smoke-test
 * POST   /:id/smoke-test    - (Phase 2) browser smoke-test result intake
 */
import { Router } from "express";
import fsp from "node:fs/promises";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { templates, tests, type Template } from "@shared/schema";
import { requirePermission } from "../middleware/auth";
import { memoryUpload } from "../middleware/upload";
import { logger } from "../logger";
import {
  readZipEntries,
  readDirEntries,
  writeTemplateFiles,
  buildTemplateExportZip,
  ZipSlipError,
} from "../services/template-package";
import {
  validateTemplatePackage,
  MAX_TEMPLATE_ZIP_BYTES,
  type TemplateValidationReport,
} from "../services/template-validation";
import {
  rebindToDefault,
  manifestParamKeys,
  DEFAULT_TEMPLATE_ID,
  type DefaultTemplateInfo,
  type DesignSlepok,
} from "../services/template-rebind";
// Type-only: the smoke-runner is a browser/jsdom module; the server never executes
// it (NFR-02), it only persists and gates on the report the admin browser produces.
import type { SmokeReport } from "@shared/template/smoke-runner";

const router = Router();

/** Loads a single template row by id, or null. */
async function loadTemplate(id: string): Promise<Template | null> {
  const [row] = await db.select().from(templates).where(eq(templates.id, id));
  return row ?? null;
}

/** Counts tests bound to a template via design_settings_json.templateId. */
async function usageCount(id: string): Promise<number> {
  const rows = await db
    .select({ id: tests.id })
    .from(tests)
    .where(sql`${tests.designSettingsJson}->>'templateId' = ${id}`);
  return rows.length;
}

/** GET /api/admin/templates — every template, newest activity first. */
router.get("/", requirePermission("adminTemplates.manage"), async (_req, res) => {
  try {
    const rows = await db.select().from(templates);
    res.json(rows);
  } catch (error) {
    logger.error("Admin list templates error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to list templates" });
  }
});

/**
 * POST /api/admin/templates — upload a template ZIP (field `file`). The package
 * is validated in memory; a package with blocking errors is rejected (422) and
 * nothing is persisted. On success the files are extracted and a `draft` row is
 * created with the validation report.
 */
router.post("/", requirePermission("adminTemplates.manage"), memoryUpload.single("file"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Файл ZIP не передан (поле file)" });
    }

    let entries;
    try {
      entries = await readZipEntries(req.file.buffer);
    } catch (err) {
      if (err instanceof ZipSlipError) {
        return res.status(422).json({ error: "ZIP содержит небезопасный путь", entry: err.entryName });
      }
      return res.status(422).json({ error: "Не удалось прочитать ZIP-архив" });
    }

    const existingIds = (await db.select({ id: templates.id }).from(templates)).map((r) => r.id);
    const report = validateTemplatePackage(entries, {
      mode: "create",
      existingIds,
      zipSizeBytes: req.file.size,
      maxSizeBytes: MAX_TEMPLATE_ZIP_BYTES,
    });

    if (!report.ok || !report.manifest) {
      return res.status(422).json({ error: "Шаблон не прошёл структурную валидацию", report });
    }

    const manifest = report.manifest;
    const id = String(manifest.id);
    const sourcePath = await writeTemplateFiles(id, entries);

    const [row] = await db
      .insert(templates)
      .values({
        id,
        name: String(manifest.name),
        description: manifest.description != null ? String(manifest.description) : null,
        version: String(manifest.version),
        templateApiVersion: String(manifest.templateApiVersion),
        isBuiltin: false,
        isActive: false,
        status: "draft",
        sourceType: "uploaded",
        sourcePath,
        manifest,
        validationJson: report,
      })
      .returning();

    logger.info(`Uploaded template "${id}" v${manifest.version} (draft)`);
    res.status(201).json({ template: row, report });
  } catch (error) {
    logger.error("Upload template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to upload template" });
  }
});

/** GET /api/admin/templates/:id — details + usage count. */
router.get("/:id", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    res.json({ template: row, usageCount: await usageCount(row.id) });
  } catch (error) {
    logger.error("Admin get template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get template" });
  }
});

/**
 * PUT /api/admin/templates/:id/activate — promote to `active`. Gated on BOTH the
 * persisted structural validation and the browser smoke-test (NFR-01). Built-ins
 * are validated at sync time and need no smoke-test; uploaded templates must carry
 * a passing structural report AND a passing smoke report.
 */
router.put("/:id/activate", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });

    const validation = row.validationJson as TemplateValidationReport | null;
    const smoke = row.smokeTestJson as SmokeReport | null;
    if (!row.isBuiltin && !(validation?.ok ?? false)) {
      return res.status(409).json({ error: "Активация запрещена: структурная валидация не пройдена" });
    }
    if (!row.isBuiltin && !(smoke?.ok ?? false)) {
      return res.status(409).json({ error: "Активация запрещена: проверка работоспособности не пройдена" });
    }

    const [updated] = await db
      .update(templates)
      .set({ status: "active", isActive: true, updatedAt: new Date() })
      .where(eq(templates.id, row.id))
      .returning();
    res.json(updated);
  } catch (error) {
    logger.error("Activate template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to activate template" });
  }
});

/**
 * PUT /api/admin/templates/:id/deactivate — hide from authors and switch every
 * dependent test to the `default` template, preserving the saved params
 * (PRD-3 §5.3). Runs in one transaction (NFR-04).
 */
router.put("/:id/deactivate", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    if (row.id === DEFAULT_TEMPLATE_ID) {
      return res.status(409).json({ error: "Нельзя деактивировать шаблон по умолчанию" });
    }

    const switched = await db.transaction(async (tx) => {
      // Load `default` so each dependent's slepok can be made consistent with it
      // (§5.3): keep only params whose keys still exist in `default`'s manifest
      // and re-stamp the version fields. Leaving the removed template's params /
      // version behind made `default` render with foreign params and forced
      // authors to manually reset a test before a re-uploaded template took.
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
        const next = rebindToDefault(dep.designSettingsJson as DesignSlepok, defaultInfo);
        await tx
          .update(tests)
          .set({ designSettingsJson: next })
          .where(eq(tests.id, dep.id));
      }

      await tx
        .update(templates)
        .set({ status: "inactive", isActive: false, updatedAt: new Date() })
        .where(eq(templates.id, row.id));

      return dependents.length;
    });

    res.json({ id: row.id, status: "inactive", switchedTests: switched });
  } catch (error) {
    logger.error("Deactivate template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to deactivate template" });
  }
});

/**
 * DELETE /api/admin/templates/:id — remove an uploaded template. Allowed only
 * when it is not built-in, not active, and used by no test (PRD-3 §5.4).
 */
router.delete("/:id", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    if (row.isBuiltin || row.sourceType === "builtin") {
      return res.status(409).json({ error: "Встроенный шаблон удалить нельзя" });
    }
    if (row.isActive || row.status === "active") {
      return res.status(409).json({ error: "Сначала деактивируйте шаблон" });
    }
    const used = await usageCount(row.id);
    if (used > 0) {
      return res.status(409).json({ error: `Шаблон используется тестами: ${used}`, usageCount: used });
    }

    await db.delete(templates).where(eq(templates.id, row.id));
    if (row.sourcePath) await fsp.rm(row.sourcePath, { recursive: true, force: true });

    logger.info(`Deleted uploaded template "${row.id}"`);
    res.json({ id: row.id, deleted: true });
  } catch (error) {
    logger.error("Delete template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete template" });
  }
});

/**
 * PUT /api/admin/templates/:id/update — re-upload a ZIP for an existing
 * uploaded template (field `file`). The package id must match. On a passing
 * validation the files are replaced and the manifest/version refreshed; on a
 * failing validation the template is flagged `invalid`.
 */
router.put("/:id/update", requirePermission("adminTemplates.manage"), memoryUpload.single("file"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    if (row.isBuiltin || row.sourceType === "builtin") {
      return res.status(409).json({ error: "Встроенный шаблон нельзя обновить загрузкой" });
    }
    if (!req.file?.buffer) {
      return res.status(400).json({ error: "Файл ZIP не передан (поле file)" });
    }

    let entries;
    try {
      entries = await readZipEntries(req.file.buffer);
    } catch (err) {
      if (err instanceof ZipSlipError) {
        return res.status(422).json({ error: "ZIP содержит небезопасный путь", entry: err.entryName });
      }
      return res.status(422).json({ error: "Не удалось прочитать ZIP-архив" });
    }

    const report = validateTemplatePackage(entries, {
      mode: "update",
      expectedId: row.id,
      zipSizeBytes: req.file.size,
      maxSizeBytes: MAX_TEMPLATE_ZIP_BYTES,
    });

    if (!report.ok || !report.manifest) {
      const [invalidated] = await db
        .update(templates)
        .set({ status: "invalid", isActive: false, validationJson: report, updatedAt: new Date() })
        .where(eq(templates.id, row.id))
        .returning();
      return res.status(422).json({ error: "Обновление не прошло валидацию", report, template: invalidated });
    }

    const manifest = report.manifest;
    const sourcePath = await writeTemplateFiles(row.id, entries);
    const [updated] = await db
      .update(templates)
      .set({
        name: String(manifest.name),
        description: manifest.description != null ? String(manifest.description) : null,
        version: String(manifest.version),
        templateApiVersion: String(manifest.templateApiVersion),
        manifest,
        sourcePath,
        validationJson: report,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, row.id))
      .returning();

    logger.info(`Updated uploaded template "${row.id}" -> v${manifest.version}`);
    res.json({ template: updated, report });
  } catch (error) {
    logger.error("Update template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update template" });
  }
});

/**
 * GET /api/admin/templates/:id/export — download the template (built-in or
 * uploaded) as a ZIP that is valid as a starter template (PRD-3 §7).
 */
router.get("/:id/export", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    if (!row.sourcePath) {
      return res.status(409).json({ error: "У шаблона нет файлового источника" });
    }
    const zip = await buildTemplateExportZip(row.sourcePath);
    res.setHeader("Content-Type", "application/zip");
    res.setHeader("Content-Disposition", `attachment; filename="${row.id}-${row.version}.zip"`);
    res.send(zip);
  } catch (error) {
    logger.error("Export template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to export template" });
  }
});

/**
 * POST /api/admin/templates/:id/validate — re-run structural validation against
 * the files currently on disk and persist the fresh report.
 */
router.post("/:id/validate", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    if (!row.sourcePath) {
      return res.status(409).json({ error: "У шаблона нет файлового источника" });
    }
    const entries = await readDirEntries(row.sourcePath);
    const report = validateTemplatePackage(entries, { mode: "update", expectedId: row.id });

    const nextStatus = report.ok ? row.status : "invalid";
    const [updated] = await db
      .update(templates)
      .set({
        validationJson: report,
        status: nextStatus,
        isActive: report.ok ? row.isActive : false,
        updatedAt: new Date(),
      })
      .where(eq(templates.id, row.id))
      .returning();
    res.json({ template: updated, report });
  } catch (error) {
    logger.error("Validate template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to validate template" });
  }
});

/** Manifest subset the smoke-bundle reads (paths into the package). */
interface BundleManifest {
  layouts?: Record<string, string>;
  assets?: { styles?: string[]; scripts?: string[]; preview?: string };
  preview?: { demoData?: string };
}

/** Content types for the preview asset, by extension. */
const PREVIEW_MIME: Record<string, string> = {
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/**
 * GET /api/admin/templates/:id/preview-image — streams the manifest's
 * `assets.preview` thumbnail from the package, for the admin card grid (§3.2).
 * The path comes from the manifest and is resolved strictly inside the template
 * root (defence against traversal). 404 when absent.
 */
router.get("/:id/preview-image", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    const manifest = (row.manifest ?? {}) as BundleManifest;
    const rel = manifest.assets?.preview;
    if (!row.sourcePath || !rel) return res.status(404).json({ error: "No preview asset" });

    const root = path.resolve(row.sourcePath);
    const target = path.resolve(root, rel);
    if (target !== root && !target.startsWith(root + path.sep)) {
      return res.status(400).json({ error: "Unsafe preview path" });
    }
    let buf: Buffer;
    try {
      buf = await fsp.readFile(target);
    } catch {
      return res.status(404).json({ error: "Preview asset not found" });
    }
    res.setHeader("Content-Type", PREVIEW_MIME[path.extname(rel).toLowerCase()] ?? "application/octet-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.send(buf);
  } catch (error) {
    logger.error("Preview-image error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to read preview image" });
  }
});

/** A rules file is conventional, not declared in the manifest; probed by path. */
const RULES_ENTRY_CANDIDATES = ["template-rules.json", "rules.json"];

/**
 * GET /api/admin/templates/:id/smoke-bundle — returns everything the admin
 * browser needs to render preview screens and run the smoke-test (NFR-03)
 * entirely client-side: the manifest, the demo dataset, the layout HTML keyed by
 * `manifest.layouts` key, the concatenated CSS, and (when present) the
 * `template.js` and rules sources for the compile/parse checks. The server only
 * reads files here — it never executes them (NFR-02).
 */
router.get("/:id/smoke-bundle", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });
    if (!row.sourcePath) {
      return res.status(409).json({ error: "У шаблона нет файлового источника" });
    }

    const entries = await readDirEntries(row.sourcePath);
    const read = (rel: string): string | undefined => entries.get(rel)?.toString("utf8");

    const manifest = (row.manifest ?? {}) as BundleManifest;
    const layoutPaths = manifest.layouts ?? {};

    // Layout HTML keyed by manifest layout key (skip the shell — per-screen
    // rendering uses the inner layouts, mirroring the unified web host).
    const layouts: Record<string, string> = {};
    for (const [key, rel] of Object.entries(layoutPaths)) {
      if (key === "shell") continue;
      const html = read(rel);
      if (html != null) layouts[key] = html;
    }

    const demoRel = manifest.preview?.demoData;
    let demo: unknown = null;
    if (demoRel) {
      const raw = read(demoRel);
      if (raw != null) {
        try {
          demo = JSON.parse(raw);
        } catch {
          return res.status(422).json({ error: "Демонстрационные данные шаблона повреждены (невалидный JSON)" });
        }
      }
    }

    const css = (manifest.assets?.styles ?? [])
      .map((rel) => read(rel))
      .filter((s): s is string => s != null)
      .join("\n");

    const scriptRel = manifest.assets?.scripts?.[0];
    const templateJs = scriptRel ? read(scriptRel) : undefined;

    let rulesJson: string | undefined;
    for (const cand of RULES_ENTRY_CANDIDATES) {
      const raw = read(cand);
      if (raw != null) {
        rulesJson = raw;
        break;
      }
    }

    res.json({ manifest, demo, layouts, css, templateJs, rulesJson });
  } catch (error) {
    logger.error("Smoke-bundle error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to build smoke bundle" });
  }
});

/**
 * POST /api/admin/templates/:id/smoke-test — intake for the client-side browser
 * smoke-test (NFR-03). The admin browser runs `runSmokeChecks` and posts the
 * resulting {@link SmokeReport}; the server validates its shape and persists it as
 * `smoke_test_json`. The `activate` gate then enforces `ok` (NFR-01). The server
 * never runs the smoke-test itself (NFR-02).
 */
router.post("/:id/smoke-test", requirePermission("adminTemplates.manage"), async (req, res) => {
  try {
    const row = await loadTemplate(req.params.id);
    if (!row) return res.status(404).json({ error: "Template not found" });

    const report = req.body as Partial<SmokeReport> | undefined;
    if (!report || typeof report.ok !== "boolean" || !Array.isArray(report.routes)) {
      return res.status(400).json({ error: "Некорректный отчёт проверки работоспособности" });
    }

    const [updated] = await db
      .update(templates)
      .set({ smokeTestJson: report, updatedAt: new Date() })
      .where(eq(templates.id, row.id))
      .returning();
    res.json({ template: updated, report });
  } catch (error) {
    logger.error("Smoke-test intake error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to record smoke test" });
  }
});

export default router;
