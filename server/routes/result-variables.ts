/**
 * @module server/routes/result-variables
 * @description CRUD, reorder and live formula-validation routes for test result
 * variables (PRD-2 §9). Mounted under /api/tests.
 *
 * Endpoints:
 * - GET    /:id/result-variables
 * - POST   /:id/result-variables
 * - PUT    /:id/result-variables/reorder
 * - POST   /:id/result-variables/validate-formula
 * - PUT    /:id/result-variables/:varId
 * - DELETE /:id/result-variables/:varId
 *
 * Authorization: GET requires auth; all mutations and validate-formula require
 * author role. The reorder and validate-formula routes are registered before
 * /:varId so their literal segments are not captured as an id.
 */
import { Router } from "express";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { logger } from "../logger";
import { syncVariableFeedbackUsages } from "../services/media/usage-index";
import { insertResultVariableSchema } from "@shared/schema";
import type { ValueType } from "@shared/formula";

const router = Router();
const VALUE_TYPES: readonly string[] = ["boolean", "number", "string"];

/** True when another result variable already drives the same success/completion status. */
async function controlsStatusConflict(
  testId: string,
  controlsStatus: string | undefined,
  excludeId?: string,
): Promise<boolean> {
  if (controlsStatus !== "success" && controlsStatus !== "completion") return false;
  const existing = await storage.getResultVariables(testId);
  return existing.some((rv) => rv.id !== excludeId && rv.controlsStatus === controlsStatus);
}

/**
 * Keep only the fields the client actually sent. `insertResultVariableSchema
 * .partial()` still APPLIES the schema defaults, so a PUT touching one field
 * would otherwise silently reset every defaulted column — including
 * `config_json`, which carries the indicator's interpretation (PRD-29). An
 * update must never write what it was not asked to write.
 */
function onlyProvided<T extends object>(parsed: T, body: unknown): Partial<T> {
  const sent = (body ?? {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (Object.prototype.hasOwnProperty.call(sent, key)) out[key] = value;
  }
  return out as Partial<T>;
}

// ─── GET /api/tests/:id/result-variables ─────────────────────────────────────
router.get("/:id/result-variables", requirePermission("tests.read"), requireTestScope("read"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    res.json(await storage.getResultVariables(req.params.id));
  } catch (error) {
    logger.error("Get result variables error: " + (error as Error).message, "result-variables");
    res.status(500).json({ error: "Failed to get result variables" });
  }
});

// ─── POST /api/tests/:id/result-variables ────────────────────────────────────
router.post("/:id/result-variables", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const existing = await storage.getResultVariables(testId);
    const parsed = insertResultVariableSchema.safeParse({
      ...req.body,
      testId,
      sortOrder: (req.body as { sortOrder?: number })?.sortOrder ?? existing.length,
    });
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(422).json({ error: first.message, field: first.path.join(".") });
    }
    const data = parsed.data;

    if (await controlsStatusConflict(testId, data.controlsStatus)) {
      return res.status(422).json({ error: `Другой показатель уже управляет статусом «${data.controlsStatus}»`, field: "controlsStatus" });
    }

    const validation = await storage.validateResultVariableFormula(testId, data.formula, data.type as ValueType, { sortOrder: data.sortOrder });
    if (!validation.valid) {
      return res.status(422).json({ error: "Невалидная формула", field: "formula", validation });
    }

    const created = await storage.createResultVariable(data);
    await syncVariableFeedbackUsages(testId);
    res.status(201).json({ ...created, validation });
  } catch (error) {
    logger.error("Create result variable error: " + (error as Error).message, "result-variables");
    res.status(500).json({ error: "Failed to create result variable" });
  }
});

// ─── PUT /api/tests/:id/result-variables/reorder ─────────────────────────────
router.put("/:id/result-variables/reorder", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const updates = req.body as Array<{ id: string; sortOrder: number }>;
    if (!Array.isArray(updates)) {
      return res.status(422).json({ error: "Body must be an array of { id, sortOrder }", field: "body" });
    }
    await storage.reorderResultVariables(updates);
    // Reorder moves no attachment, but the recorded `field` path starts with the indicator's
    // POSITION in the set (`0.configJson…`) — see the scales counterpart: access never
    // depends on it, «где используется» does.
    await syncVariableFeedbackUsages(req.params.id);
    res.json({ ok: true });
  } catch (error) {
    logger.error("Reorder result variables error: " + (error as Error).message, "result-variables");
    res.status(500).json({ error: "Failed to reorder result variables" });
  }
});

// ─── POST /api/tests/:id/result-variables/validate-formula ───────────────────
router.post("/:id/result-variables/validate-formula", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const { formula, type, sortOrder, excludeId } = req.body as {
      formula?: string;
      type?: string;
      sortOrder?: number;
      excludeId?: string;
    };
    if (typeof formula !== "string") {
      return res.status(422).json({ error: "formula is required", field: "formula" });
    }
    const valueType: ValueType = VALUE_TYPES.includes(type ?? "") ? (type as ValueType) : "boolean";
    const validation = await storage.validateResultVariableFormula(testId, formula, valueType, { sortOrder, excludeId });
    res.json(validation);
  } catch (error) {
    logger.error("Validate formula error: " + (error as Error).message, "result-variables");
    res.status(500).json({ error: "Failed to validate formula" });
  }
});

// ─── PUT /api/tests/:id/result-variables/:varId ──────────────────────────────
router.put("/:id/result-variables/:varId", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const { id: testId, varId } = req.params;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const existing = await storage.getResultVariables(testId);
    const current = existing.find((rv) => rv.id === varId);
    if (!current) return res.status(404).json({ error: "Result variable not found" });

    const parsed = insertResultVariableSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return res.status(422).json({ error: first.message, field: first.path.join(".") });
    }
    const updates = onlyProvided(parsed.data, req.body);
    const merged = { ...current, ...updates };

    if (await controlsStatusConflict(testId, merged.controlsStatus, varId)) {
      return res.status(422).json({ error: `Другой показатель уже управляет статусом «${merged.controlsStatus}»`, field: "controlsStatus" });
    }

    const validation = await storage.validateResultVariableFormula(testId, merged.formula, merged.type as ValueType, {
      sortOrder: merged.sortOrder,
      excludeId: varId,
    });
    if (!validation.valid) {
      return res.status(422).json({ error: "Невалидная формула", field: "formula", validation });
    }

    const saved = await storage.updateResultVariable(varId, updates);
    await syncVariableFeedbackUsages(testId);
    res.json({ ...saved, validation });
  } catch (error) {
    logger.error("Update result variable error: " + (error as Error).message, "result-variables");
    res.status(500).json({ error: "Failed to update result variable" });
  }
});

// ─── DELETE /api/tests/:id/result-variables/:varId ───────────────────────────
router.delete("/:id/result-variables/:varId", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
  try {
    const { id: testId, varId } = req.params;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const existing = await storage.getResultVariables(testId);
    if (!existing.some((rv) => rv.id === varId)) {
      return res.status(404).json({ error: "Result variable not found" });
    }
    await storage.deleteResultVariable(varId);
    await syncVariableFeedbackUsages(testId);
    res.json({ ok: true });
  } catch (error) {
    logger.error("Delete result variable error: " + (error as Error).message, "result-variables");
    res.status(500).json({ error: "Failed to delete result variable" });
  }
});

export default router;
