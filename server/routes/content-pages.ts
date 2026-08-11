/**
 * @module server/routes/content-pages
 * @description CRUD and reorder routes for test content pages.
 *
 * Endpoints:
 * - GET    /api/tests/:id/content-pages
 * - POST   /api/tests/:id/content-pages
 * - PUT    /api/tests/:id/content-pages/reorder
 * - PUT    /api/tests/:id/content-pages/:pageId
 * - DELETE /api/tests/:id/content-pages/:pageId
 *
 * Authorization: GET requires auth, all mutations require author role.
 * Validates topicId membership, templateKey against current design template,
 * and sanitizes richText/html placeholder values.
 */
import { Router } from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { storage } from "../storage";
import { requireAuth, requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { syncEntityUsages } from "../services/media/usage-index";
import { logger } from "../logger";
import { type SanitizeDiagnostics } from "../utils/html-sanitizer";
// PRD-48 Э3: the field rules live in ONE place, so the Excel workbook applies the
// same normalisation and the same sanitiser this route does.
import {
  resolveContentTemplates,
  findContentTemplate,
  normalizeValuesForTemplate,
  normalizeSettingsForTemplate,
  sanitizeAllStringValues,
  sanitizeAllStringValuesWithDiagnostics,
} from "../services/content-page-fields";
import { encodeJsonForScript, injectIntoPreview } from "../scorm/preview-embed";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the set of valid topic IDs for a given test. */
async function getTestTopicIds(testId: string): Promise<Set<string>> {
  const sections = await storage.getTestSections(testId);
  return new Set(sections.map((s) => s.topicId));
}

/** The draft «Оформление» template id the editor sends as `?templateId=`, if any. */
function draftTemplateIdFrom(req: { query: Record<string, unknown> }): string | undefined {
  const v = req.query.templateId;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

// ─── GET /api/tests/:id/content-pages/:pageId/preview-page ───────────────────

/**
 * Whitelist of built-in template directory names, mirrors templates.ts. We
 * only resolve preview.html for built-in templates - third-party templates
 * would need their own preview registration before this route serves them.
 */
const BUILTIN_TEMPLATE_IDS = new Set([
  "default",
  "corporate",
  "minimal",
  "rtk-storyline",
]);

async function resolveBuiltinPreviewPath(id: string): Promise<string | null> {
  if (!BUILTIN_TEMPLATE_IDS.has(id)) return null;
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
 * GET /api/tests/:id/content-pages/:pageId/preview-page (PRD-7 S13.4 / FR-44).
 *
 * Serves the test's design-template preview.html with an override script that
 * skips the demo-navigation bootstrap and renders this single content_page via
 * the runtime-exposed `renderContentPage(page, contentTemplates)` function
 * (see preview.html line 1954). Also forwards the test's design params
 * (designSettingsJson.params) as manifest.params[].default overrides so the
 * page renders in the same colours/fonts/branding the learner would see.
 */
router.get("/:id/content-pages/:pageId/preview-page", requireAuth, async (req, res) => {
  try {
    const { id: testId, pageId } = req.params;

    const test = await storage.getTest(testId);
    if (!test) return res.status(404).type("text/plain").send("Test not found");

    const page = await storage.getContentPage(pageId);
    if (!page || page.testId !== testId) {
      return res.status(404).type("text/plain").send("Content page not found");
    }

    const settings = (test as { designSettingsJson: unknown }).designSettingsJson as
      | { templateId?: string; params?: Record<string, unknown> }
      | null;
    const templateId = settings?.templateId || "default";

    const previewPath = await resolveBuiltinPreviewPath(templateId);
    if (!previewPath) {
      return res
        .status(404)
        .type("text/plain")
        .send(`preview.html not found for template "${templateId}"`);
    }

    const html = await fs.readFile(previewPath, "utf8");

    // The runtime expects: page.kind, page.templateKey, page.values,
    // page.placeholderStyles; matches the shape contentPage.js consumes.
    const valuesJson = (page.valuesJson as
      | { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> }
      | null) ?? {};
    const previewPage = {
      id: page.id,
      kind: page.kind,
      templateKey: page.templateKey,
      values: valuesJson.values ?? {},
      placeholderStyles: valuesJson.placeholderStyles ?? {},
      autoAdvance: page.autoAdvance ?? false,
      autoAdvanceDelayMs: page.autoAdvanceDelayMs ?? null,
    };

    const designOverrides = settings?.params ?? {};

    // Override script does two things AFTER the standalone bootstrap has run
    // (it is appended just before </body>, so by then PRD1_PREVIEW_MANIFEST is
    // populated and TestBuilder has initialised CSS vars):
    //   1) Apply this test's design.params on top of manifest.params[].default
    //      so the preview reflects the customised branding (re-init via
    //      TestBuilder._init).
    //   2) Clear #app and call renderContentPage(previewPage, contentTemplates)
    //      directly. The navigation that the demo bootstrap built is left in
    //      place but irrelevant - the embed CSS hides it (.pv-sidebar / .pv-nav).
    //
    // requestAnimationFrame ensures the override fires after the bootstrap's
    // own DOMContentLoaded init that lives in the file's IIFE.
    const overrideScript = `
<script id="prd7-page-preview-override">
(function () {
  var page = ${encodeJsonForScript(previewPage)};
  var paramOverrides = ${encodeJsonForScript(designOverrides)};

  function applyDesignOverrides() {
    var m = window.PRD1_PREVIEW_MANIFEST;
    if (!m || !Array.isArray(m.params)) return;
    m.params.forEach(function (p) {
      if (paramOverrides && Object.prototype.hasOwnProperty.call(paramOverrides, p.key)) {
        p.default = paramOverrides[p.key];
      }
    });
    var tb = window.TestBuilder;
    if (tb && typeof tb._init === "function") {
      tb._init(m.params);
    }
  }

  function renderSinglePage() {
    var m = window.PRD1_PREVIEW_MANIFEST;
    var app = document.getElementById("app");
    if (!app || !m) return;
    var cts = m.contentTemplates || [];
    if (typeof renderContentPage === "function") {
      app.innerHTML = "";
      renderContentPage(page, cts);
    }
  }

  function run() {
    applyDesignOverrides();
    // Defer one frame so the standalone bootstrap's own DOMContentLoaded
    // init finishes building TEST_DATA / nav before we replace #app.
    requestAnimationFrame(function () {
      requestAnimationFrame(renderSinglePage);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", run);
  } else {
    run();
  }
})();
</script>
`;

    const out = injectIntoPreview(html, overrideScript);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.send(out);
  } catch (error) {
    logger.error("Page preview error: " + (error as Error).message, "content-pages");
    res.status(500).type("text/plain").send("page-preview failed");
  }
});

// ─── GET /api/tests/:id/content-pages ────────────────────────────────────────

router.get("/:id/content-pages", requirePermission("tests.read"), requireTestScope("read"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const pages = await storage.getContentPages(req.params.id);
    const contentTemplates = await resolveContentTemplates(test, draftTemplateIdFrom(req));
    const validKeys = contentTemplates ? new Set(contentTemplates.map((ct) => ct.key)) : null;

    const result = pages.map((page) => ({
      ...page,
      templateKeyMissing: validKeys !== null && !!page.templateKey && !validKeys.has(page.templateKey),
    }));

    res.json(result);
  } catch (error) {
    logger.error("Get content pages error: " + (error as Error).message, "content-pages");
    res.status(500).json({ error: "Failed to get content pages" });
  }
});

// ─── POST /api/tests/:id/content-pages ───────────────────────────────────────

router.post("/:id/content-pages", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const { topicId, position, mode, type, templateKey, valuesJson, settingsJson, autoAdvance, autoAdvanceDelayMs, sortOrder } = req.body as {
      topicId?: string;
      position?: string;
      mode?: string;
      type?: string;
      templateKey?: string;
      valuesJson?: { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> };
      settingsJson?: Record<string, unknown>;
      autoAdvance?: boolean;
      autoAdvanceDelayMs?: number;
      sortOrder?: number;
    };

    if (!position || !["before", "after", "before_topic", "after_topic"].includes(position)) {
      return res.status(422).json({ error: "position must be before, after, before_topic, or after_topic", field: "position" });
    }
    if (!type || !["intro", "info", "summary", "html"].includes(type)) {
      return res.status(422).json({ error: "type must be intro, info, summary, or html", field: "type" });
    }

    // `position: "before"`/`"after"` are test-scope pages (topicId = null) used
    // by the linear_flat «До теста» / «После теста» zones (schema
    // content_pages.position enum, PRD-7 closeout / PRD-1 §4.2). The
    // topic-scoped positions require a topicId that belongs to the test.
    const isTestScope = position === "before" || position === "after";
    if (!isTestScope && !topicId) {
      return res.status(422).json({ error: "topicId is required", field: "topicId" });
    }
    if (topicId) {
      const validTopicIds = await getTestTopicIds(testId);
      if (!validTopicIds.has(topicId)) {
        return res.status(422).json({ error: "topicId does not belong to this test", field: "topicId" });
      }
    }

    // Validate templateKey against current design template
    let normalizedValues = {
      values: sanitizeAllStringValues(valuesJson?.values),
      placeholderStyles: {},
    } as { values: Record<string, unknown>; placeholderStyles: Record<string, unknown> };
    // PRD-22: settings live in their own column and are normalised against the
    // variant's `settings[]`; an undeclared key never reaches the database.
    let normalizedSettings: Record<string, unknown> = {};
    if (mode === "template" || (!mode && templateKey)) {
      const contentTemplates = await resolveContentTemplates(test, draftTemplateIdFrom(req));
      if (contentTemplates !== null) {
        const ct = findContentTemplate(contentTemplates, templateKey);
        if (!ct) {
          return res.status(422).json({ error: "templateKey not found in current template", field: "templateKey" });
        }
        normalizedValues = normalizeValuesForTemplate(valuesJson, ct.placeholders ?? []);
        normalizedSettings = normalizeSettingsForTemplate(settingsJson, ct.settings);
      }
    }

    // PRD-1 §4.3: derive `kind` from legacy `type`. `html` is a render mode,
    // not a kind — author-created HTML pages take kind: "info".
    const pageType = type as "intro" | "info" | "summary" | "html";
    const kind = pageType === "html" ? "info" : pageType;

    const page = await storage.createContentPage({
      testId,
      topicId: isTestScope ? null : (topicId as string),
      position: position as "before" | "after" | "before_topic" | "after_topic",
      mode: (mode as "template" | "standard" | "html") ?? "template",
      type: pageType,
      kind,
      templateKey: templateKey ?? null,
      sortOrder: sortOrder ?? 0,
      valuesJson: normalizedValues,
      settingsJson: normalizedSettings,
      autoAdvance: autoAdvance ?? false,
      autoAdvanceDelayMs: autoAdvanceDelayMs ?? null,
    });

    // Медиатека: сбой индексации не должен стоить автору его правки. Недостающая
    // строка индекса безопасна (она отказывает в доступе, а не выдаёт лишнее) и
    // чинится пересборкой; потерянное сохранение страницы не чинится ничем.
    try {
      await syncEntityUsages("content_page", page.id, page);
    } catch (error) {
      logger.error(`Media usage sync failed for content page ${page.id}: ${(error as Error).message}`, "content-pages");
    }

    res.status(201).json(page);
  } catch (error) {
    const err = error as Error & { status?: number; field?: string };
    if (err.status === 422) {
      return res.status(422).json({ error: err.message, field: err.field });
    }
    logger.error("Create content page error: " + (error as Error).message, "content-pages");
    res.status(500).json({ error: "Failed to create content page" });
  }
});

// ─── PUT /api/tests/:id/content-pages/reorder ────────────────────────────────
// Must be registered BEFORE /:pageId to avoid "reorder" being captured as pageId.

router.put("/:id/content-pages/reorder", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const updates = req.body as Array<{ id: string; sortOrder: number }>;
    if (!Array.isArray(updates)) {
      return res.status(422).json({ error: "Body must be an array of { id, sortOrder }", field: "body" });
    }

    await storage.reorderContentPages(updates);
    res.json({ ok: true });
  } catch (error) {
    logger.error("Reorder content pages error: " + (error as Error).message, "content-pages");
    res.status(500).json({ error: "Failed to reorder content pages" });
  }
});

// ─── PUT /api/tests/:id/content-pages/:pageId ────────────────────────────────

router.put("/:id/content-pages/:pageId", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const testId = req.params.id;
    const pageId = req.params.pageId;

    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const existing = await storage.getContentPage(pageId);
    if (!existing || existing.testId !== testId) {
      return res.status(404).json({ error: "Content page not found" });
    }

    const { topicId, position, mode, type, templateKey, valuesJson, settingsJson, autoAdvance, autoAdvanceDelayMs, sortOrder } = req.body as {
      topicId?: string;
      position?: string;
      mode?: string;
      type?: string;
      templateKey?: string;
      valuesJson?: { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> };
      settingsJson?: Record<string, unknown>;
      autoAdvance?: boolean;
      autoAdvanceDelayMs?: number;
      sortOrder?: number;
    };

    // Validate topicId membership only for a non-null id. A null topicId is
    // valid: it moves the page to a test-scope zone («До теста» / «После теста»,
    // position before/after) — e.g. dragging a page out of a topic. Mirrors the
    // POST route's truthy check; `topicId !== undefined` wrongly rejected null.
    if (topicId != null) {
      const validTopicIds = await getTestTopicIds(testId);
      if (!validTopicIds.has(topicId)) {
        return res.status(422).json({ error: "topicId does not belong to this test", field: "topicId" });
      }
    }

    // Validate and sanitize values if templateKey is being set
    let normalizedValues:
      | { values: Record<string, unknown>; placeholderStyles: Record<string, unknown> }
      | undefined;
    // PRD-7 S13.4-G18: collect what the sanitiser stripped so the UI can show
    // a per-placeholder warning banner. Empty -> nothing was removed.
    let sanitizeDiagnostics: SanitizeDiagnostics = {};
    // PRD-22: settings are normalised whenever they are sent OR the variant
    // changes — the latter re-runs defaults of the new variant and preserves the
    // sequence identifier (FR-29).
    let normalizedSettings: Record<string, unknown> | undefined;
    const effectiveMode = mode ?? existing.mode;
    const effectiveTemplateKey = templateKey !== undefined ? templateKey : existing.templateKey;

    if (
      effectiveMode === "template" &&
      effectiveTemplateKey &&
      (valuesJson?.values !== undefined || settingsJson !== undefined || templateKey !== undefined)
    ) {
      const contentTemplates = await resolveContentTemplates(test, draftTemplateIdFrom(req));
      if (contentTemplates !== null) {
        const ct = findContentTemplate(contentTemplates, effectiveTemplateKey);
        if (!ct) {
          return res.status(422).json({ error: "templateKey not found in current template", field: "templateKey" });
        }
        if (valuesJson?.values !== undefined) {
          const normalized = normalizeValuesForTemplate(valuesJson, ct.placeholders ?? []);
          normalizedValues = { values: normalized.values, placeholderStyles: normalized.placeholderStyles };
          sanitizeDiagnostics = normalized.sanitizeDiagnostics;
        }
        normalizedSettings = normalizeSettingsForTemplate(
          settingsJson,
          ct.settings,
          (existing.settingsJson ?? {}) as Record<string, unknown>,
        );
      }
    } else if (valuesJson !== undefined) {
      const { values: cleaned, diagnostics } = sanitizeAllStringValuesWithDiagnostics(valuesJson.values);
      normalizedValues = { values: cleaned, placeholderStyles: {} };
      sanitizeDiagnostics = diagnostics;
    }

    const updates: Record<string, unknown> = {};
    if (topicId !== undefined) updates.topicId = topicId;
    if (position !== undefined) updates.position = position;
    if (mode !== undefined) updates.mode = mode;
    if (type !== undefined) updates.type = type;
    if (templateKey !== undefined) updates.templateKey = templateKey;
    if (sortOrder !== undefined) updates.sortOrder = sortOrder;
    if (autoAdvance !== undefined) updates.autoAdvance = autoAdvance;
    if (autoAdvanceDelayMs !== undefined) updates.autoAdvanceDelayMs = autoAdvanceDelayMs;
    if (valuesJson !== undefined) {
      updates.valuesJson = normalizedValues ?? { values: valuesJson.values ?? {}, placeholderStyles: {} };
    }
    if (normalizedSettings !== undefined) updates.settingsJson = normalizedSettings;

    const updated = await storage.updateContentPage(pageId, updates as Parameters<typeof storage.updateContentPage>[1]);

    // Медиатека: сбой индексации не должен стоить автору его правки. Недостающая
    // строка индекса безопасна (она отказывает в доступе, а не выдаёт лишнее) и
    // чинится пересборкой; потерянное сохранение страницы не чинится ничем.
    if (updated) {
      try {
        await syncEntityUsages("content_page", updated.id, updated);
      } catch (error) {
        logger.error(`Media usage sync failed for content page ${updated.id}: ${(error as Error).message}`, "content-pages");
      }
    }

    // sanitizeDiagnostics is a sibling field, not persisted - the UI consumes
    // it from the immediate PUT response and clears it on the next edit.
    res.json({ ...updated, sanitizeDiagnostics });
  } catch (error) {
    const err = error as Error & { status?: number; field?: string };
    if (err.status === 422) {
      return res.status(422).json({ error: err.message, field: err.field });
    }
    logger.error("Update content page error: " + (error as Error).message, "content-pages");
    res.status(500).json({ error: "Failed to update content page" });
  }
});

// ─── POST /api/tests/:id/content-pages/:pageId/replace-variant ──────────────
//
// PRD-7 FR-46 / PRD-1 §4.3.3: switch a content page to a different variant
// of the same `kind`. Computes the diff of placeholder names (per the
// "name = contract between variants of the same kind" rule) and applies it:
// values for placeholders that exist in both variants are preserved, values
// for placeholders that disappear are dropped. Rejects with 422 when the
// requested variant has a different kind.
router.post("/:id/content-pages/:pageId/replace-variant", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const testId = req.params.id;
    const pageId = req.params.pageId;
    const newTemplateKey = (req.body as { newTemplateKey?: unknown })?.newTemplateKey;

    if (typeof newTemplateKey !== "string" || newTemplateKey.length === 0) {
      return res.status(422).json({ error: "newTemplateKey is required", field: "newTemplateKey" });
    }

    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const existing = await storage.getContentPage(pageId);
    if (!existing || existing.testId !== testId) {
      return res.status(404).json({ error: "Content page not found" });
    }

    const contentTemplates = await resolveContentTemplates(test, draftTemplateIdFrom(req));
    if (!contentTemplates) {
      return res.status(422).json({ error: "Test has no resolvable template" });
    }

    const currentVariant = findContentTemplate(contentTemplates, existing.templateKey);
    const newVariant = findContentTemplate(contentTemplates, newTemplateKey);

    if (!newVariant) {
      return res.status(404).json({
        error: "newTemplateKey not found in current template",
        field: "newTemplateKey",
      });
    }

    // Same-kind invariant: variants are only interchangeable within one kind.
    if (newVariant.kind !== existing.kind) {
      return res.status(422).json({
        error: "variant kind mismatch",
        currentKind: existing.kind,
        newKind: newVariant.kind,
      });
    }

    if (existing.templateKey === newTemplateKey) {
      return res.status(422).json({ error: "newTemplateKey equals current templateKey" });
    }

    // Compute the diff using placeholder names.
    const currentKeys = new Set((currentVariant?.placeholders ?? []).map((p) => p.key));
    const newKeys = new Set((newVariant.placeholders ?? []).map((p) => p.key));
    const preserved: string[] = [];
    const removed: string[] = [];
    const added: string[] = [];
    for (const k of currentKeys) {
      if (newKeys.has(k)) preserved.push(k);
      else removed.push(k);
    }
    for (const k of newKeys) {
      if (!currentKeys.has(k)) added.push(k);
    }
    preserved.sort();
    removed.sort();
    added.sort();

    // Filter valuesJson down to preserved keys only. Sanitize against the
    // new placeholder set so renderers/paths are revalidated.
    const existingValues = (existing.valuesJson ?? {}) as {
      values?: Record<string, unknown>;
      placeholderStyles?: Record<string, unknown>;
    };
    const filteredValues: Record<string, unknown> = {};
    for (const k of preserved) {
      if (existingValues.values && k in existingValues.values) {
        filteredValues[k] = existingValues.values[k];
      }
    }
    const filteredStyles: Record<string, unknown> = {};
    for (const k of preserved) {
      const style = existingValues.placeholderStyles?.[k];
      if (style != null) filteredStyles[k] = style;
    }
    const normalized = normalizeValuesForTemplate(
      { values: filteredValues, placeholderStyles: filteredStyles },
      newVariant.placeholders ?? [],
    );

    const updated = await storage.updateContentPage(pageId, {
      templateKey: newTemplateKey,
      valuesJson: normalized,
    });

    // Медиатека: replace-variant rewrites valuesJson just like the PUT route
    // above — the same sync must run here, or a page saved only via variant
    // replacement would keep a stale/empty usage index.
    if (updated) {
      try {
        await syncEntityUsages("content_page", updated.id, updated);
      } catch (error) {
        logger.error(`Media usage sync failed for content page ${updated.id}: ${(error as Error).message}`, "content-pages");
      }
    }

    res.json({
      diff: { preserved, removed, added },
      applied: true,
    });
  } catch (error) {
    const e = error as Error & { status?: number; field?: string };
    if (e.status === 422) {
      return res.status(422).json({ error: e.message, field: e.field });
    }
    logger.error("Replace variant error: " + e.message, "content-pages");
    res.status(500).json({ error: "Failed to replace variant" });
  }
});

// ─── DELETE /api/tests/:id/content-pages/:pageId ─────────────────────────────

router.delete("/:id/content-pages/:pageId", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const testId = req.params.id;
    const pageId = req.params.pageId;

    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const existing = await storage.getContentPage(pageId);
    if (!existing || existing.testId !== testId) {
      return res.status(404).json({ error: "Content page not found" });
    }

    await storage.deleteContentPage(pageId);

    // Медиатека: clears the deleted page's index rows the same way a deleted
    // question does — see the try/catch note on the create/update routes above.
    try {
      await syncEntityUsages("content_page", pageId, null);
    } catch (error) {
      logger.error(`Media usage sync failed for content page ${pageId}: ${(error as Error).message}`, "content-pages");
    }

    res.json({ ok: true });
  } catch (error) {
    logger.error("Delete content page error: " + (error as Error).message, "content-pages");
    res.status(500).json({ error: "Failed to delete content page" });
  }
});

export default router;
