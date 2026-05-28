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
import { requireAuth } from "../middleware/auth";
import { logger } from "../logger";
import { isSupportedTemplateApiVersion } from "../template-registry";

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
 * Embedding fix-up: hides the standalone preview chrome (.pv-sidebar /
 * .pv-main / pv-overlay backdrop) and lets the dialog body fill the iframe
 * naturally. Also re-applies param defaults from the supplied overrides
 * before the bootstrap reads PRD1_PREVIEW_MANIFEST.
 */
function rewritePreviewForEmbedding(
  html: string,
  overrides: Record<string, unknown>,
): string {
  const overrideScript = `\n<script id="prd1-preview-overrides">\n(function(){\n  var overrides = ${JSON.stringify(overrides).replace(/<\/script/gi, "<\\/script")};\n  function apply() {\n    var m = window.PRD1_PREVIEW_MANIFEST;\n    if (!m || !Array.isArray(m.params)) return;\n    m.params.forEach(function (p) {\n      if (overrides && Object.prototype.hasOwnProperty.call(overrides, p.key)) {\n        p.default = overrides[p.key];\n      }\n    });\n  }\n  // Manifest is inlined as window.PRD1_PREVIEW_MANIFEST higher up in the file,\n  // so it is already defined by the time this script executes.\n  apply();\n})();\n</script>\n`;
  // Embedding stylesheet: keep the inner dialog but drop standalone-only chrome.
  // !important is used because the inlined template CSS sets `body { background: #e5e7eb }`
  // and the chrome rules carry their own specificity from being defined first.
  const embedCss = `
<style id="prd1-preview-embed-overrides">
  /* DS brand typeface (RostelecomBasis) — @font-face declarations are scoped
     per-document, so even though the host loads them via vendor/university-rt.css,
     the iframe is a separate document and needs its own registration. Files live
     in client/public/fonts/ and are served from the same origin as this iframe. */
  @font-face { font-family: 'RostelecomBasis'; src: url('/fonts/RostelecomBasis-Light.woff2') format('woff2'),   url('/fonts/RostelecomBasis-Light.woff') format('woff'),   url('/fonts/RostelecomBasis-Light.otf') format('opentype');   font-weight: 300; font-style: normal; font-display: swap; }
  @font-face { font-family: 'RostelecomBasis'; src: url('/fonts/RostelecomBasis-Regular.woff2') format('woff2'), url('/fonts/RostelecomBasis-Regular.woff') format('woff'), url('/fonts/RostelecomBasis-Regular.otf') format('opentype'); font-weight: 400; font-style: normal; font-display: swap; }
  @font-face { font-family: 'RostelecomBasis'; src: url('/fonts/RostelecomBasis-Medium.woff2') format('woff2'),  url('/fonts/RostelecomBasis-Medium.woff') format('woff'),  url('/fonts/RostelecomBasis-Medium.otf') format('opentype');  font-weight: 500; font-style: normal; font-display: swap; }
  @font-face { font-family: 'RostelecomBasis'; src: url('/fonts/RostelecomBasis-Bold.woff2') format('woff2'),    url('/fonts/RostelecomBasis-Bold.woff') format('woff'),    url('/fonts/RostelecomBasis-Bold.otf') format('opentype');    font-weight: 700; font-style: normal; font-display: swap; }
  html, body { background: transparent !important; height: 100% !important; min-height: 0 !important; overflow: hidden !important; width: 100% !important; max-width: none !important; display: block !important; }
  /* Drop the standalone shell's flex layout: hidden chrome (.pv-sidebar / .pv-main)
     would otherwise leave .pv-overlay as a content-sized flex item (~860px),
     producing whitespace to the right of the dialog in the embed iframe.
     'width: 100%; max-width: none' defends against templates that constrain
     body/shell (e.g. rtk-storyline sets 'body { max-width: 51.5625cqw }'). */
  .shell { display: block !important; min-height: 0 !important; height: 100% !important; width: 100% !important; max-width: none !important; }
  .pv-sidebar, .shell > .pv-sidebar { display: none !important; }
  .pv-main { display: none !important; }
  .pv-overlay { position: static !important; padding: 0 !important; background: transparent !important; inset: auto !important; width: 100% !important; height: 100% !important; }
  .pv-dialog { max-width: 100% !important; max-height: 100% !important; height: 100% !important; box-shadow: none !important; border-radius: 0 !important; border: 0 !important; }
  /* Hide standalone-preview chrome that duplicates host-modal UI:
     - .pv-dialog-head: inner "Шаблон «X» — элементы и их вид · Демо-данные ..."
       duplicates ModalDialog title + description AND uses the preview's own
       Inter font instead of DS font tokens, breaking the design system.
     - .pv-dialog-foot: own info line + Close button (host .tpl-preview-foot
       already provides these).
     - .pv-caption: route name under stage, redundant with left nav highlight. */
  .pv-dialog-head, .pv-dialog-foot, .pv-caption { display: none !important; }
  /* Enable vertical scrolling in the stage area. The stage uses 'overflow: hidden'
     for rounded-corner clipping, which together with flex column parent collapses
     its 'min-height: auto' to 0 and lets flex-shrink squash it below content size.
     'flex-shrink: 0' keeps the stage at its natural content height; '.pv-stage-wrap'
     already has 'overflow-y: auto' so it becomes the scroll container. */
  .pv-stage { flex-shrink: 0 !important; max-height: none !important; }
  .pv-stage-wrap { overflow-y: auto !important; }
  /* Align rail typography with the host DS font stack. The rail (.pv-nav) is
     preview-builder chrome, not template content — it should match the host
     modal, not the template. Currently preview.html hardcodes 'Inter, system-ui,
     sans-serif'; expanding to the DS stack makes the rail follow whatever font
     the DS resolves (RostelecomBasis when available, Inter as fallback). */
  .pv-nav { font-family: 'RostelecomBasis', 'Inter', 'Manrope', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif !important; }
</style>
`;
  // Insert override script right before the closing </body> so it executes
  // after the inline manifest definition but before any user interaction.
  // Insert the embed CSS into <head> so it wins on cascade order.
  let out = html.replace(
    /<\/head>/i,
    `${embedCss}</head>`,
  );
  out = out.replace(
    /<\/body>/i,
    `${overrideScript}</body>`,
  );
  return out;
}

/** GET /api/templates — returns all active templates. */
router.get("/", requireAuth, async (_req, res) => {
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
router.get("/:id/preview-page", requireAuth, async (req, res) => {
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

/** GET /api/templates/:id — returns a single active template with its manifest. */
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const [row] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, req.params.id), eq(templates.isActive, true)));

    if (!row) return res.status(404).json({ error: "Template not found" });

    res.json(row);
  } catch (error) {
    logger.error("Get template error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get template" });
  }
});

export default router;
export { isSupportedTemplateApiVersion };
