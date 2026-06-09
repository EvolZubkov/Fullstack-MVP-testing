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
import { and, eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { templates } from "@shared/schema";
import { requireAuth, requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { logger } from "../logger";
import {
  sanitizeHtmlWithDiagnostics,
  sanitizeValuesWithDiagnostics,
  type SanitizeDiagnostics,
} from "../utils/html-sanitizer";
import { encodeJsonForScript, injectIntoPreview } from "../scorm/preview-embed";

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the set of valid topic IDs for a given test. */
async function getTestTopicIds(testId: string): Promise<Set<string>> {
  const sections = await storage.getTestSections(testId);
  return new Set(sections.map((s) => s.topicId));
}

type PlaceholderDefinition = {
  key: string;
  type: string;
  textFit?: { allowAuthorFontSize?: boolean };
  allowedPaths?: string[];
  allowedRenderers?: string[];
  defaultPath?: string;
  defaultRenderer?: string;
};

type ContentTemplateEntry = {
  key: string;
  label?: string;
  kind?: "questions" | "router" | "summary" | "intro" | "info";
  placeholders?: PlaceholderDefinition[];
};

/**
 * Returns the contentTemplates array a test's content pages validate against.
 *
 * Prefers `overrideTemplateId` — the in-progress «Оформление» DRAFT the editor
 * sends as `?templateId=` — but ONLY when it resolves to an ACTIVE template, so
 * structure edits (add / replace-variant / value validation) work against the
 * chosen template before the design is saved. Otherwise falls back to the test's
 * saved design template, then the built-in "default".
 */
async function getTestContentTemplates(
  test: { designSettingsJson: unknown },
  overrideTemplateId?: string,
): Promise<ContentTemplateEntry[] | null> {
  const settings = test.designSettingsJson as { templateId?: string } | null;
  const savedId = settings?.templateId || "default";

  const readTemplates = (id: string, activeOnly: boolean) =>
    db
      .select()
      .from(templates)
      .where(activeOnly ? and(eq(templates.id, id), eq(templates.isActive, true)) : eq(templates.id, id));

  // Draft override wins only when it points to a different, ACTIVE template.
  if (overrideTemplateId && overrideTemplateId !== savedId) {
    const [draftTpl] = await readTemplates(overrideTemplateId, true);
    if (draftTpl) {
      const manifest = draftTpl.manifest as { contentTemplates?: ContentTemplateEntry[] };
      return manifest.contentTemplates ?? null;
    }
  }

  const [template] = await readTemplates(savedId, false);
  if (!template) return null;
  const manifest = template.manifest as { contentTemplates?: ContentTemplateEntry[] };
  return manifest.contentTemplates ?? null;
}

/** The draft «Оформление» template id the editor sends as `?templateId=`, if any. */
function draftTemplateIdFrom(req: { query: Record<string, unknown> }): string | undefined {
  const v = req.query.templateId;
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

/**
 * Sanitises arbitrary string values without a template manifest (used for
 * mode='custom' / free-form payloads). Aggregates diagnostics so the PUT
 * route can surface them to the UI alongside the cleaned payload.
 */
function sanitizeAllStringValuesWithDiagnostics(
  values: Record<string, unknown> | undefined,
): { values: Record<string, unknown>; diagnostics: SanitizeDiagnostics } {
  const result: Record<string, unknown> = {};
  const diagnostics: SanitizeDiagnostics = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    if (typeof value === "string") {
      const { value: cleaned, removed } = sanitizeHtmlWithDiagnostics(value);
      result[key] = cleaned;
      if (removed.length > 0) diagnostics[key] = removed;
    } else {
      result[key] = value;
    }
  }
  return { values: result, diagnostics };
}

/** Back-compat wrapper - used by POST route that does not yet surface diagnostics. */
function sanitizeAllStringValues(values: Record<string, unknown> | undefined): Record<string, unknown> {
  return sanitizeAllStringValuesWithDiagnostics(values).values;
}

function normalizeValuesForTemplate(
  valuesJson: { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> } | undefined,
  placeholders: PlaceholderDefinition[],
): { values: Record<string, unknown>; placeholderStyles: Record<string, unknown>; sanitizeDiagnostics: SanitizeDiagnostics } {
  const { values, diagnostics: sanitizeDiagnostics } = sanitizeValuesWithDiagnostics(
    valuesJson?.values ?? {},
    placeholders,
  );
  const placeholderStyles: Record<string, unknown> = {};

  for (const ph of placeholders) {
    const style = valuesJson?.placeholderStyles?.[ph.key] as { fontSize?: unknown } | undefined;
    if (ph.textFit?.allowAuthorFontSize && typeof style?.fontSize === "number" && Number.isFinite(style.fontSize)) {
      placeholderStyles[ph.key] = { fontSize: style.fontSize };
    }

    if (ph.type === "resultField") {
      const raw = values[ph.key] as { path?: unknown; renderer?: unknown; rendererOptions?: unknown; label?: unknown } | undefined;
      if (!raw || typeof raw !== "object") continue;

      const path = typeof raw.path === "string" ? raw.path : ph.defaultPath;
      if (path && ph.allowedPaths && !ph.allowedPaths.includes(path)) {
        throw Object.assign(new Error("path is not allowed for resultField"), { status: 422, field: `valuesJson.values.${ph.key}.path` });
      }

      const renderer = typeof raw.renderer === "string" ? raw.renderer : ph.defaultRenderer;
      if (renderer && ph.allowedRenderers && !ph.allowedRenderers.includes(renderer)) {
        throw Object.assign(new Error("renderer is not allowed for resultField"), { status: 422, field: `valuesJson.values.${ph.key}.renderer` });
      }

      values[ph.key] = {
        ...raw,
        path: path ?? raw.path,
        renderer: renderer ?? raw.renderer,
        rendererOptions:
          raw.rendererOptions && typeof raw.rendererOptions === "object" && !Array.isArray(raw.rendererOptions)
            ? raw.rendererOptions
            : {},
      };
    }
  }

  return { values, placeholderStyles, sanitizeDiagnostics };
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
    const contentTemplates = await getTestContentTemplates(test, draftTemplateIdFrom(req));
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

    const { topicId, position, mode, type, templateKey, valuesJson, autoAdvance, autoAdvanceDelayMs, sortOrder } = req.body as {
      topicId?: string;
      position?: string;
      mode?: string;
      type?: string;
      templateKey?: string;
      valuesJson?: { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> };
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
    if (mode === "template" || (!mode && templateKey)) {
      const contentTemplates = await getTestContentTemplates(test, draftTemplateIdFrom(req));
      if (contentTemplates !== null) {
        const ct = contentTemplates.find((c) => c.key === templateKey);
        if (!ct) {
          return res.status(422).json({ error: "templateKey not found in current template", field: "templateKey" });
        }
        normalizedValues = normalizeValuesForTemplate(valuesJson, ct.placeholders ?? []);
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
      autoAdvance: autoAdvance ?? false,
      autoAdvanceDelayMs: autoAdvanceDelayMs ?? null,
    });

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

    const { topicId, position, mode, type, templateKey, valuesJson, autoAdvance, autoAdvanceDelayMs, sortOrder } = req.body as {
      topicId?: string;
      position?: string;
      mode?: string;
      type?: string;
      templateKey?: string;
      valuesJson?: { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> };
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
    const effectiveMode = mode ?? existing.mode;
    const effectiveTemplateKey = templateKey !== undefined ? templateKey : existing.templateKey;

    if (effectiveMode === "template" && effectiveTemplateKey && valuesJson?.values !== undefined) {
      const contentTemplates = await getTestContentTemplates(test, draftTemplateIdFrom(req));
      if (contentTemplates !== null) {
        const ct = contentTemplates.find((c) => c.key === effectiveTemplateKey);
        if (!ct) {
          return res.status(422).json({ error: "templateKey not found in current template", field: "templateKey" });
        }
        const normalized = normalizeValuesForTemplate(valuesJson, ct.placeholders ?? []);
        normalizedValues = { values: normalized.values, placeholderStyles: normalized.placeholderStyles };
        sanitizeDiagnostics = normalized.sanitizeDiagnostics;
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

    const updated = await storage.updateContentPage(pageId, updates as Parameters<typeof storage.updateContentPage>[1]);
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

    const contentTemplates = await getTestContentTemplates(test, draftTemplateIdFrom(req));
    if (!contentTemplates) {
      return res.status(422).json({ error: "Test has no resolvable template" });
    }

    const currentVariant = contentTemplates.find((ct) => ct.key === existing.templateKey);
    const newVariant = contentTemplates.find((ct) => ct.key === newTemplateKey);

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

    await storage.updateContentPage(pageId, {
      templateKey: newTemplateKey,
      valuesJson: normalized,
    });

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
    res.json({ ok: true });
  } catch (error) {
    logger.error("Delete content page error: " + (error as Error).message, "content-pages");
    res.status(500).json({ error: "Failed to delete content page" });
  }
});

export default router;
