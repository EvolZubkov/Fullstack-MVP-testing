/**
 * @module server/routes/templates
 * @description REST API for the template registry.
 *
 * GET /api/templates      - list all active templates (for gallery UI)
 * GET /api/templates/:id  - single template with full manifest and metadata
 */
import { Router } from "express";
import { db } from "../db";
import { templates } from "@shared/schema";
import { and, eq } from "drizzle-orm";
import { requireAuth } from "../middleware/auth";
import { logger } from "../logger";
import { isSupportedTemplateApiVersion } from "../template-registry";

const router = Router();

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
