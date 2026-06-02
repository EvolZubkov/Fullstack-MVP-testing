/**
 * @module server/routes/scales
 * @description CRUD/reorder routes for measurement scales and per-question
 * measurement contributions (PRD-5, B3). All test-scoped under /api/tests:
 *
 * - GET    /:id/scales
 * - POST   /:id/scales
 * - PUT    /:id/scales/reorder
 * - PUT    /:id/scales/:scaleId
 * - DELETE /:id/scales/:scaleId
 * - GET    /:id/measurements                  (whole-test matrix)
 * - PUT    /:id/measurements/:questionId       (replace one question's rows)
 *
 * Authorization: GET requires auth; all mutations require author role. The
 * reorder route is registered before /:scaleId so "reorder" is not parsed as an
 * id. Measurement rows are validated without testId/questionId — those come from
 * the path.
 */
import { Router } from "express";
import { storage } from "../storage";
import { requireAuth, requireAuthor } from "../middleware/auth";
import { logger } from "../logger";
import { insertScaleSchema, insertQuestionMeasurementSchema } from "@shared/schema";

const router = Router();

/** True when another scale in the test already uses `key` (excluding `excludeId`). */
async function keyConflict(testId: string, key: string, excludeId?: string): Promise<boolean> {
  const existing = await storage.getScales(testId);
  return existing.some((s) => s.key === key && s.id !== excludeId);
}

const measurementRowSchema = insertQuestionMeasurementSchema.omit({ testId: true, questionId: true });

// ─── GET /api/tests/:id/scales ───────────────────────────────────────────────
router.get("/:id/scales", requireAuth, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    res.json(await storage.getScales(req.params.id));
  } catch (error) {
    logger.error("Get scales error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to get scales" });
  }
});

// ─── POST /api/tests/:id/scales ──────────────────────────────────────────────
router.post("/:id/scales", requireAuthor, async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const existing = await storage.getScales(testId);
    const parsed = insertScaleSchema.safeParse({
      ...req.body,
      testId,
      sortOrder: (req.body as { sortOrder?: number })?.sortOrder ?? existing.length,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(422).json({ error: first.message, field: first.path.join(".") });
    }
    const data = parsed.data;
    if (await keyConflict(testId, data.key)) {
      return res.status(422).json({ error: `Шкала с ключом «${data.key}» уже существует`, field: "key" });
    }
    const created = await storage.createScale(data);
    res.status(201).json(created);
  } catch (error) {
    logger.error("Create scale error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to create scale" });
  }
});

// ─── PUT /api/tests/:id/scales/reorder ───────────────────────────────────────
router.put("/:id/scales/reorder", requireAuthor, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const updates = req.body as Array<{ id: string; sortOrder: number }>;
    if (!Array.isArray(updates)) {
      return res.status(422).json({ error: "Body must be an array of { id, sortOrder }", field: "body" });
    }
    await storage.reorderScales(updates);
    res.json({ ok: true });
  } catch (error) {
    logger.error("Reorder scales error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to reorder scales" });
  }
});

// ─── PUT /api/tests/:id/scales/:scaleId ──────────────────────────────────────
router.put("/:id/scales/:scaleId", requireAuthor, async (req, res) => {
  try {
    const { id: testId, scaleId } = req.params;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const existing = await storage.getScales(testId);
    const current = existing.find((s) => s.id === scaleId);
    if (!current) return res.status(404).json({ error: "Scale not found" });

    const parsed = insertScaleSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(422).json({ error: first.message, field: first.path.join(".") });
    }
    const updates = parsed.data;
    if (updates.key && (await keyConflict(testId, updates.key, scaleId))) {
      return res.status(422).json({ error: `Шкала с ключом «${updates.key}» уже существует`, field: "key" });
    }
    const saved = await storage.updateScale(scaleId, updates);
    res.json(saved);
  } catch (error) {
    logger.error("Update scale error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to update scale" });
  }
});

// ─── DELETE /api/tests/:id/scales/:scaleId ───────────────────────────────────
router.delete("/:id/scales/:scaleId", requireAuthor, async (req, res) => {
  try {
    const { id: testId, scaleId } = req.params;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const existing = await storage.getScales(testId);
    if (!existing.some((s) => s.id === scaleId)) {
      return res.status(404).json({ error: "Scale not found" });
    }
    await storage.deleteScale(scaleId);
    res.json({ ok: true });
  } catch (error) {
    logger.error("Delete scale error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to delete scale" });
  }
});

// ─── GET /api/tests/:id/measurements ─────────────────────────────────────────
router.get("/:id/measurements", requireAuth, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    res.json(await storage.getQuestionMeasurements(req.params.id));
  } catch (error) {
    logger.error("Get measurements error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to get measurements" });
  }
});

// ─── PUT /api/tests/:id/measurements/:questionId ─────────────────────────────
router.put("/:id/measurements/:questionId", requireAuthor, async (req, res) => {
  try {
    const { id: testId, questionId } = req.params;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const body = req.body;
    if (!Array.isArray(body)) {
      return res.status(422).json({ error: "Body must be an array of measurement rows", field: "body" });
    }
    const rows = [];
    for (let i = 0; i < body.length; i++) {
      const parsed = measurementRowSchema.safeParse(body[i]);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        return res.status(422).json({ error: first.message, field: `[${i}].${first.path.join(".")}` });
      }
      rows.push({ ...parsed.data, testId, questionId });
    }
    const saved = await storage.upsertQuestionMeasurements(testId, questionId, rows);
    res.json(saved);
  } catch (error) {
    logger.error("Upsert measurements error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to save measurements" });
  }
});

export default router;
