/**
 * @module server/routes/templates
 * @description REST API for the template registry.
 *
 * GET /api/templates                          - list all active templates
 * GET /api/templates/:id                      - single template + full manifest
 * GET /api/templates/:id/preview-page         - standalone preview.html embedded
 *                                               by the design-tab preview modal
 *                                               (PRD-7 S12-G2 / FR-30)
 */
import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { templates } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth, requirePermission } from "../middleware/auth";
import { logger } from "../logger";
import { isSupportedTemplateApiVersion } from "../template-registry";
import { encodeJsonForScript, injectIntoPreview } from "../scorm/preview-embed";
import { resolveTemplateDir } from "../services/template-dir";
import { readTemplateBundle } from "../services/template-package";
import { readReportLabelKeys } from "../services/template-render";

const router = Router();

/**
 * Whitelist of built-in template directory names. We do not let the URL
 * derive a filesystem path freely — id is matched against this set first.
 */
const BUILTIN_TEMPLATE_IDS = new Set([
  "default",
  "corporate",
  "minimal",
  "rtk-storyline",
]);

/** Resolves to the absolute path of a built-in template's preview.html, or null. */
async function resolveBuiltinPreviewPath(id: string): Promise<string | null> {
  if (!BUILTIN_TEMPLATE_IDS.has(id)) return null;
  // Path is relative to the project root the server runs from.
  const candidate = path.resolve(
    process.cwd(),
    "server",
    "scorm",
    "templates",
    id,
    "preview.html",
  );
  try {
    await fs.access(candidate);
    return candidate;
  } catch {
    return null;
  }
}

/**
 * Builds the JSON of param overrides parsed from a flat query string.
 * Accepts both `?p[primaryColor]=...` and `?primaryColor=...` shapes — the
 * latter is convenient for short manual URLs, the former for nested keys
 * (e.g. `?p[brand.primaryColor]=...`).
 */
function parseParamOverrides(query: Record<string, unknown>): Record<string, unknown> {
  const overrides: Record<string, unknown> = {};
  const nested = query.p;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    for (const [k, v] of Object.entries(nested as Record<string, unknown>)) {
      if (typeof v === "string") overrides[k] = v;
    }
  }
  // Reserved keys that are not template params and must not leak through.
  const RESERVED = new Set(["p", "route"]);
  for (const [k, v] of Object.entries(query)) {
    if (RESERVED.has(k)) continue;
    if (typeof v === "string") overrides[k] = v;
  }
  return overrides;
}

/**
 * Embedding fix-up for the template-preview route (S12-G2 / FR-30): hides the
 * standalone preview chrome and re-applies param defaults from the supplied
 * overrides before the bootstrap reads PRD1_PREVIEW_MANIFEST. Embed CSS and
 * the injection mechanics live in scorm/preview-embed for reuse with the
 * page-preview route.
 */
function rewritePreviewForEmbedding(
  html: string,
  overrides: Record<string, unknown>,
): string {
  const overrideScript = `\n<script id="prd1-preview-overrides">\n(function(){\n  var overrides = ${encodeJsonForScript(overrides)};\n  function apply() {\n    var m = window.PRD1_PREVIEW_MANIFEST;\n    if (!m || !Array.isArray(m.params)) return;\n    m.params.forEach(function (p) {\n      if (overrides && Object.prototype.hasOwnProperty.call(overrides, p.key)) {\n        p.default = overrides[p.key];\n      }\n    });\n  }\n  // Manifest is inlined as window.PRD1_PREVIEW_MANIFEST higher up in the file,\n  // so it is already defined by the time this script executes.\n  apply();\n})();\n</script>\n`;
  return injectIntoPreview(html, overrideScript);
}

/** GET /api/templates — returns all active templates. */
router.get("/", requirePermission("templates.read"), async (_req, res) => {
  try {
    const rows = await db
      .select()
      .from(templates)
      .where(eq(templates.isActive, true));
    res.json(rows);
  } catch (error) {
    logger.error("Get templates error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get templates" });
  }
});

/**
 * GET /api/templates/:id/preview-page — serves the standalone preview.html
 * for a built-in template, with embedding tweaks so it can live in an iframe
 * inside the design-tab preview modal. Query string is interpreted as a flat
 * map of param overrides (e.g. `?primaryColor=217+91%25+42%25&fontFamily=Roboto`).
 * Each override replaces the manifest's `default` for the matching param key,
 * which the preview bootstrap then applies as a CSS variable on load.
 */
router.get("/:id/preview-page", requirePermission("templates.read"), async (req, res) => {
  try {
    const previewPath = await resolveBuiltinPreviewPath(req.params.id);
    if (!previewPath) {
      return res.status(404).type("text/plain").send("preview.html not found");
    }
    const html = await fs.readFile(previewPath, "utf8");
    const overrides = parseParamOverrides(req.query as Record<string, unknown>);
    const out = rewritePreviewForEmbedding(html, overrides);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    // Preview is keyed in the URL by params; avoid caching the embedded variant.
    res.setHeader("Cache-Control", "no-store");
    res.send(out);
  } catch (error) {
    logger.error("Preview-page error: " + (error as Error).message);
    res.status(500).type("text/plain").send("preview-page failed");
  }
});

/**
 * GET /api/templates/:id/bundle — render files (manifest + demo + layouts + css)
 * for the unified preview renderer (the SAME engine the runtime/«Шаблоны» use).
 * Resolves the template directory via the templates table `sourcePath` (built-in
 * OR uploaded), so uploaded templates preview too. The client applies design
 * params as CSS variables via the shared mapping — no second preview engine.
 */
router.get("/:id/bundle", requirePermission("templates.read"), async (req, res) => {
  try {
    const dir = await resolveTemplateDir(req.params.id);
    const bundle = await readTemplateBundle(dir, {
      assetsBase: `/api/templates/${encodeURIComponent(req.params.id)}/assets/`,
    });
    res.setHeader("Cache-Control", "no-store");
    res.json(bundle);
  } catch (error) {
    logger.error("Template bundle error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to read template bundle" });
  }
});

/**
 * GET /api/templates/:id/assets/* — serves a FILE of the template (image, style,
 * font) to the web host (PRD-22 FR-37).
 *
 * Author content may reference the template's own assets by a relative path
 * (`images/diagram.png`); inside a SCORM package those files sit next to the
 * page, but on the web they had nowhere to point: static hosting covers only
 * `/uploads` and `/docs`, and BUILT-IN templates live outside both. This route
 * closes that gap for both kinds of template.
 *
 * Any signed-in user may read them: a learner taking the test needs the images,
 * and an administrator previews a template BEFORE activating it — restricting to
 * active templates would leave every draft preview with broken images. These are
 * design files, not data. Path traversal is blocked by resolving against the
 * template directory and rejecting anything that escapes it.
 */
router.get("/:id/assets/*assetPath", requireAuth, async (req, res) => {
  try {
    const dir = await resolveTemplateDir(req.params.id);
    // Express 5 gives a named wildcard as an array of segments.
    const raw = (req.params as Record<string, unknown>).assetPath;
    const rel = Array.isArray(raw) ? raw.join("/") : String(raw ?? "");
    const abs = path.resolve(dir, rel);
    const root = path.resolve(dir);
    if (abs !== root && !abs.startsWith(root + path.sep)) {
      return res.status(400).json({ error: "Invalid asset path" });
    }
    // Manifest and layouts are contract, not assets: they travel through their own
    // endpoints, so serving them here would be a second, unversioned way in.
    const first = rel.split(/[\\/]/)[0];
    if (first === "manifest.json" || first === "layouts" || first === "demo") {
      return res.status(404).json({ error: "Not an asset" });
    }
    await fs.access(abs);
    res.sendFile(abs, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch {
    res.status(404).json({ error: "Asset not found" });
  }
});

/** GET /api/templates/:id — returns a single active template with its manifest. */
router.get("/:id", requirePermission("templates.read"), async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, req.params.id), eq(templates.isActive, true)));

    if (!row) return res.status(404).json({ error: "Template not found" });

    // PRD-49: перечень надписей, которые печатает ДОКУМЕНТ. Считается по макетам вариантов
    // отчёта, а не берётся из манифеста: манифест объявляет надписи на все экраны сразу, и
    // панель отчёта предлагала автору править то, чего в документе нет вовсе. Читается на
    // запрос, а не при регистрации, — иначе перечень отставал бы от файлов шаблона до
    // перезапуска, как сам манифест.
    //
    // `null` значит «шаблон не объявил ни одного варианта отчёта»: документ ему соберут
    // макетами «Стандартного» (FR-10), поэтому и перечень берётся оттуда же.
    const dir = await resolveTemplateDir(row.id, { activeOnly: true });
    const reportLabelKeys =
      readReportLabelKeys(dir) ??
      readReportLabelKeys(await resolveTemplateDir("default", { activeOnly: false }));

    res.json({ ...row, ...(reportLabelKeys ? { reportLabelKeys } : {}) });
  } catch (error) {
    logger.error("Get template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get template" });
  }
});

export default router;
export { isSupportedTemplateApiVersion };
