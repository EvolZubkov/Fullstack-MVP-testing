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
 * - POST   /:id/scales/preview                 (debug: compute scale.* on demo answers)
 *
 * Authorization: GET requires auth; all mutations and preview require author
 * role. The reorder and preview routes are registered before /:scaleId so
 * "reorder"/"preview" are not parsed as an id. Measurement rows are validated
 * without testId/questionId — those come from the path.
 */
import { Router } from "express";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { logger } from "../logger";
import { materializeScaleDomains } from "../services/scale-domain";
import { syncEntityUsages } from "../services/media/usage-index";
import { insertScaleSchema, insertQuestionMeasurementSchema, type Scale, type QuestionMeasurement } from "@shared/schema";
import {
  computeScales,
  type ScaleSpec,
  type ScaleBand,
  type MeasurementSpec,
  type QuestionType,
  type Answer,
} from "@shared/scales/engine";

const router = Router();

/**
 * PRD-35: writes the missing domains of the test's scales, never failing the request.
 *
 * The domain must EXIST by the time an attempt is taken (a radar has no radius
 * without it), but it is repair of missing data, not the operation the author asked
 * for — a failure here must not turn a successful save into an error. Idempotent, so
 * calling it after every scale or measurement write costs one read when the domains
 * are already in place.
 */
async function fillDomains(testId: string): Promise<void> {
  try {
    await materializeScaleDomains(testId);
  } catch (error) {
    logger.error("Materialize scale domains error: " + (error as Error).message, "scales");
  }
}

/**
 * Re-indexes the test's WHOLE set of scales. The unit of indexing is the set, not one scale
 * (spec §6.1): there is no `getScale(id)` in the storage contract, and a set-wide rewrite also
 * makes deletion self-healing — the removed scale's rows simply do not come back.
 *
 * Best effort, like {@link fillDomains}: a missing index row refuses a file (it never grants
 * one) and heals on the next rebuild, while a failed save costs the author the work itself.
 */
async function syncScaleFeedbackUsages(testId: string): Promise<void> {
  try {
    await syncEntityUsages("scale_feedback", testId, await storage.getScales(testId));
  } catch (error) {
    logger.error(`Media usage sync failed for scales of ${testId}: ${(error as Error).message}`, "scales");
  }
}

/** True when another scale in the test already uses `key` (excluding `excludeId`). */
async function keyConflict(testId: string, key: string, excludeId?: string): Promise<boolean> {
  const existing = await storage.getScales(testId);
  return existing.some((s) => s.key === key && s.id !== excludeId);
}

const measurementRowSchema = insertQuestionMeasurementSchema.omit({ testId: true, questionId: true });

/**
 * Keep only the fields the client actually sent. `insertScaleSchema.partial()`
 * still APPLIES the schema defaults, so a PUT touching one field would otherwise
 * silently reset every defaulted column — including `config_json`, which carries
 * the scale's interpretation (PRD-29). An update must never write what it was
 * not asked to write.
 */
function onlyProvided<T extends object>(parsed: T, body: unknown): Partial<T> {
  const sent = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Object.prototype.hasOwnProperty.call(sent, key)) out[key] = value;
  }
  return out as Partial<T>;
}

/** DB scale row -> engine {@link ScaleSpec} (bands live in config_json). */
function toScaleSpec(s: Scale): ScaleSpec {
  const config = (s.configJson as { bands?: ScaleBand[] }) ?? {};
  return {
    key: s.key,
    aggregation: s.aggregation,
    normalization: s.normalization,
    direction: s.direction,
    bands: Array.isArray(config.bands) ? config.bands : undefined,
  };
}

/** DB measurement rows -> engine {@link MeasurementSpec}[] with scaleId resolved to key. */
function toMeasurementSpecs(measurements: QuestionMeasurement[], scales: Scale[]): MeasurementSpec[] {
  const scaleKeyById = new Map(scales.map((s) => [s.id, s.key]));
  const out: MeasurementSpec[] = [];
  for (const m of measurements) {
    const scaleKey = scaleKeyById.get(m.scaleId);
    if (!scaleKey) continue; // orphan row — skip
    out.push({
      questionId: m.questionId,
      scaleKey,
      sourceType: m.sourceType,
      sourceKey: m.sourceKey ?? null,
      value: m.valueJson,
      weight: m.weight ?? 1,
    });
  }
  return out;
}

// ─── GET /api/tests/:id/scales ───────────────────────────────────────────────
router.get("/:id/scales", requirePermission("tests.read"), requireTestScope("read"), async (req, res) => {
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
router.post("/:id/scales", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
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
    await fillDomains(testId);
    await syncScaleFeedbackUsages(testId);
    res.status(201).json(created);
  } catch (error) {
    logger.error("Create scale error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to create scale" });
  }
});

// ─── PUT /api/tests/:id/scales/reorder ───────────────────────────────────────
router.put("/:id/scales/reorder", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const updates = req.body as Array<{ id: string; sortOrder: number }>;
    if (!Array.isArray(updates)) {
      return res.status(422).json({ error: "Body must be an array of { id, sortOrder }", field: "body" });
    }
    await storage.reorderScales(updates);
    // Reorder moves no attachment, but the recorded `field` path starts with the scale's
    // POSITION in the set (`0.configJson…`), so after a reorder the stored paths point at
    // the wrong band until the set is re-indexed. Access itself never depends on it (the
    // delivery rule matches on the asset id), yet «где используется» would name the wrong
    // scale — one cheap read keeps the index literally true.
    await syncScaleFeedbackUsages(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    logger.error("Reorder scales error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to reorder scales" });
  }
});

// ─── PUT /api/tests/:id/scales/:scaleId ──────────────────────────────────────
router.put("/:id/scales/:scaleId", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
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
    const updates = onlyProvided(parsed.data, req.body);
    if (updates.key && (await keyConflict(testId, updates.key, scaleId))) {
      return res.status(422).json({ error: `Шкала с ключом «${updates.key}» уже существует`, field: "key" });
    }
    const saved = await storage.updateScale(scaleId, updates);
    await fillDomains(testId);
    await syncScaleFeedbackUsages(testId);
    res.json(saved);
  } catch (error) {
    logger.error("Update scale error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to update scale" });
  }
});

// ─── DELETE /api/tests/:id/scales/:scaleId ───────────────────────────────────
router.delete("/:id/scales/:scaleId", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const { id: testId, scaleId } = req.params;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const existing = await storage.getScales(testId);
    if (!existing.some((s) => s.id === scaleId)) {
      return res.status(404).json({ error: "Scale not found" });
    }
    await storage.deleteScale(scaleId);
    await syncScaleFeedbackUsages(testId);
    res.json({ ok: true });
  } catch (error) {
    logger.error("Delete scale error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to delete scale" });
  }
});

// ─── GET /api/tests/:id/measurements ─────────────────────────────────────────
router.get("/:id/measurements", requirePermission("tests.read"), requireTestScope("read"), async (req, res) => {
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
router.put("/:id/measurements/:questionId", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
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
    // Вклады и есть источник расчётного домена, поэтому после их правки шкала без
    // собственных границ получает их здесь же.
    await fillDomains(testId);
    res.json(saved);
  } catch (error) {
    logger.error("Upsert measurements error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to save measurements" });
  }
});

// ─── POST /api/tests/:id/scales/preview ──────────────────────────────────────
// Debug helper for the editor: run the authoritative shared scale engine over a
// set of demo answers and return the resulting scale.* values + per-scale
// errors. Body: { answers: { [questionId]: Answer } } where Answer is the
// runtime encoding (index | index[] | { left: right } | null). Question types
// are resolved server-side from the measured questions.
router.post("/:id/scales/preview", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const body = (req.body ?? {}) as { answers?: Record<string, Answer> };
    const answers = body.answers ?? {};
    if (typeof answers !== "object" || Array.isArray(answers)) {
      return res.status(422).json({ error: "answers must be an object keyed by questionId", field: "answers" });
    }

    const scales = await storage.getScales(testId);
    const measurements = await storage.getQuestionMeasurements(testId);

    const questionIds = Array.from(new Set(measurements.map((m) => m.questionId)));
    const questions = questionIds.length ? await storage.getQuestionsByIds(questionIds) : [];
    const questionTypes: Record<string, QuestionType> = {};
    for (const q of questions) questionTypes[q.id] = q.type as QuestionType;

    const { values, errors } = computeScales(
      scales.map(toScaleSpec),
      toMeasurementSpecs(measurements, scales),
      answers,
      questionTypes,
    );
    res.json({ values, errors });
  } catch (error) {
    logger.error("Scales preview error: " + (error as Error).message, "scales");
    res.status(500).json({ error: "Failed to preview scales" });
  }
});

export default router;
