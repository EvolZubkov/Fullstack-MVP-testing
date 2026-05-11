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
import { eq } from "drizzle-orm";
import { storage } from "../storage";
import { db } from "../db";
import { templates } from "@shared/schema";
import { requireAuth, requireAuthor } from "../middleware/auth";
import { logger } from "../logger";
import { sanitizeValues } from "../utils/html-sanitizer";

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

type ContentTemplateEntry = { key: string; placeholders?: PlaceholderDefinition[] };

/**
 * Returns the contentTemplates array for the template currently selected in a test.
 * Falls back to the built-in "default" template.
 */
async function getTestContentTemplates(test: { designSettingsJson: unknown }): Promise<ContentTemplateEntry[] | null> {
  const settings = test.designSettingsJson as { templateId?: string } | null;
  const templateId = settings?.templateId || "default";

  const [template] = await db.select().from(templates).where(eq(templates.id, templateId));
  if (!template) return null;

  const manifest = template.manifest as { contentTemplates?: ContentTemplateEntry[] };
  return manifest.contentTemplates ?? null;
}

function sanitizeAllStringValues(values: Record<string, unknown> | undefined): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values ?? {})) {
    result[key] = typeof value === "string" ? sanitizeValues({ value }, [{ key: "value", type: "html" }]).value : value;
  }
  return result;
}

function normalizeValuesForTemplate(
  valuesJson: { values?: Record<string, unknown>; placeholderStyles?: Record<string, unknown> } | undefined,
  placeholders: PlaceholderDefinition[],
) {
  const values = sanitizeValues(valuesJson?.values ?? {}, placeholders);
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

  return { values, placeholderStyles };
}

// ─── GET /api/tests/:id/content-pages ────────────────────────────────────────

router.get("/:id/content-pages", requireAuth, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const pages = await storage.getContentPages(req.params.id);
    const contentTemplates = await getTestContentTemplates(test);
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

router.post("/:id/content-pages", requireAuthor, async (req, res) => {
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

    if (!topicId) {
      return res.status(422).json({ error: "topicId is required", field: "topicId" });
    }
    if (!position || !["before_topic", "after_topic"].includes(position)) {
      return res.status(422).json({ error: "position must be before_topic or after_topic", field: "position" });
    }
    if (!type || !["intro", "info", "summary", "html"].includes(type)) {
      return res.status(422).json({ error: "type must be intro, info, summary, or html", field: "type" });
    }

    // Validate topicId belongs to test
    const validTopicIds = await getTestTopicIds(testId);
    if (!validTopicIds.has(topicId)) {
      return res.status(422).json({ error: "topicId does not belong to this test", field: "topicId" });
    }

    // Validate templateKey against current design template
    let normalizedValues = {
      values: sanitizeAllStringValues(valuesJson?.values),
      placeholderStyles: {},
    } as { values: Record<string, unknown>; placeholderStyles: Record<string, unknown> };
    if (mode === "template" || (!mode && templateKey)) {
      const contentTemplates = await getTestContentTemplates(test);
      if (contentTemplates !== null) {
        const ct = contentTemplates.find((c) => c.key === templateKey);
        if (!ct) {
          return res.status(422).json({ error: "templateKey not found in current template", field: "templateKey" });
        }
        normalizedValues = normalizeValuesForTemplate(valuesJson, ct.placeholders ?? []);
      }
    }

    const page = await storage.createContentPage({
      testId,
      topicId,
      position: position as "before_topic" | "after_topic",
      mode: (mode as "template" | "standard" | "html") ?? "template",
      type: type as "intro" | "info" | "summary" | "html",
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

router.put("/:id/content-pages/reorder", requireAuthor, async (req, res) => {
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

router.put("/:id/content-pages/:pageId", requireAuthor, async (req, res) => {
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

    // Validate topicId if provided
    if (topicId !== undefined) {
      const validTopicIds = await getTestTopicIds(testId);
      if (!validTopicIds.has(topicId)) {
        return res.status(422).json({ error: "topicId does not belong to this test", field: "topicId" });
      }
    }

    // Validate and sanitize values if templateKey is being set
    let normalizedValues: { values: Record<string, unknown>; placeholderStyles: Record<string, unknown> } | undefined;
    const effectiveMode = mode ?? existing.mode;
    const effectiveTemplateKey = templateKey !== undefined ? templateKey : existing.templateKey;

    if (effectiveMode === "template" && effectiveTemplateKey && valuesJson?.values !== undefined) {
      const contentTemplates = await getTestContentTemplates(test);
      if (contentTemplates !== null) {
        const ct = contentTemplates.find((c) => c.key === effectiveTemplateKey);
        if (!ct) {
          return res.status(422).json({ error: "templateKey not found in current template", field: "templateKey" });
        }
        normalizedValues = normalizeValuesForTemplate(valuesJson, ct.placeholders ?? []);
      }
    } else if (valuesJson !== undefined) {
      normalizedValues = {
        values: sanitizeAllStringValues(valuesJson.values),
        placeholderStyles: {},
      };
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
    res.json(updated);
  } catch (error) {
    const err = error as Error & { status?: number; field?: string };
    if (err.status === 422) {
      return res.status(422).json({ error: err.message, field: err.field });
    }
    logger.error("Update content page error: " + (error as Error).message, "content-pages");
    res.status(500).json({ error: "Failed to update content page" });
  }
});

// ─── DELETE /api/tests/:id/content-pages/:pageId ─────────────────────────────

router.delete("/:id/content-pages/:pageId", requireAuthor, async (req, res) => {
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
