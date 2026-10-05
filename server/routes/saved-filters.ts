/**
 * @module server/routes/saved-filters
 * @description Сохранённые фильтры списков — «Темы и вопросы», «Тесты», «Пользователи» (решение
 * владельца 2026-10-05: сохранение — везде, где есть фильтр).
 *
 * Набор личный и хранит только условия, но экран, к которому он относится, должен быть виден
 * читателю: каждая ручка проверяет право на сам список (`topics.read`, `tests.read`,
 * `users.read`). Аналитика сюда не входит — её фильтры живут рядом со срезами
 * (`/api/analytics/filters`).
 *
 * - `GET    /api/saved-filters?scope=…` — наборы владельца для экрана;
 * - `POST   /api/saved-filters` — `{ scope, name, conditions }`;
 * - `PUT    /api/saved-filters/:id` — `{ name?, conditions? }`;
 * - `DELETE /api/saved-filters/:id`.
 */
import { Router, type Request, type Response } from "express";

import { hasPermission, type Capability } from "@shared/access";
import { SAVED_FILTER_SCOPES, type SavedFilterScope, type SavedListFilter } from "@shared/schema";
import { logger } from "../logger";
import { requireAnyPermission } from "../middleware/auth";
import { storage } from "../storage";
import { isUniqueViolation } from "../utils/pg-error";

/** Право на список экрана: набор открывается там же, где сам список. */
const SCOPE_CAPABILITY: Record<SavedFilterScope, Capability> = {
  content: "topics.read",
  tests: "tests.read",
  users: "users.read",
};

/** Длина имени: имя — подпись на кнопке и в меню, а не описание. */
const NAME_MAX = 120;
/** Объём условий в байтах JSON: условия — несколько списков значений, а не данные. */
const CONDITIONS_MAX = 16_384;

/** Id набора — uuid: иное база отвергла бы ошибкой, а для читателя это просто «нет такого». */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const router = Router();
router.use(requireAnyPermission(Object.values(SCOPE_CAPABILITY)));

/** Экран из запроса, если он известен. */
function scopeOf(value: unknown): SavedFilterScope | null {
  return typeof value === "string" && (SAVED_FILTER_SCOPES as readonly string[]).includes(value)
    ? (value as SavedFilterScope)
    : null;
}

/** Может ли читатель видеть список экрана. */
function canUse(req: Request, scope: SavedFilterScope): boolean {
  return hasPermission(req.effectiveRoles ?? [], SCOPE_CAPABILITY[scope]);
}

/**
 * Имя из тела запроса.
 *
 * @returns обрезанное имя или текст ошибки
 */
function nameOf(value: unknown): { name: string } | { error: string } {
  const name = typeof value === "string" ? value.trim() : "";
  // Безымянный набор неотличим в меню от соседнего: выбор между ними стал бы случайным.
  if (!name) return { error: "Нужно имя фильтра" };
  if (name.length > NAME_MAX) return { error: `Имя длиннее ${NAME_MAX} символов` };
  return { name };
}

/**
 * Условия из тела запроса: объект, не пустой и не огромный.
 *
 * @returns условия или текст ошибки
 */
function conditionsOf(value: unknown): { conditions: Record<string, unknown> } | { error: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return { error: "Нужны условия отбора" };
  const conditions = value as Record<string, unknown>;
  const hasConditions = Object.values(conditions).some(item =>
    Array.isArray(item) ? item.length > 0 : item !== undefined && item !== null && item !== "");
  // Набор без условий — это весь список: его и так показывает «Сбросить фильтры».
  if (!hasConditions) return { error: "Нужно хотя бы одно условие отбора" };
  if (JSON.stringify(conditions).length > CONDITIONS_MAX) return { error: "Слишком много условий" };
  return { conditions };
}

/** Запись в ответе: то, что нужно меню «Сохранённые». */
function view(row: SavedListFilter) {
  return { id: row.id, scope: row.scope, name: row.name, conditions: row.conditionsJson };
}

router.get("/", async (req: Request, res: Response) => {
  const scope = scopeOf(req.query.scope);
  if (!scope) return res.status(400).json({ error: "Unknown scope" });
  if (!canUse(req, scope)) return res.status(403).json({ error: "Forbidden" });
  try {
    const rows = await storage.getSavedFilters(req.currentUser!.id, scope);
    res.json({ filters: rows.map(view) });
  } catch (error) {
    logger.error("List saved filters error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to list saved filters" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const scope = scopeOf(body.scope);
  if (!scope) return res.status(400).json({ error: "Unknown scope" });
  if (!canUse(req, scope)) return res.status(403).json({ error: "Forbidden" });
  const name = nameOf(body.name);
  if ("error" in name) return res.status(400).json({ error: name.error });
  const conditions = conditionsOf(body.conditions);
  if ("error" in conditions) return res.status(400).json({ error: conditions.error });
  try {
    const row = await storage.createSavedFilter({
      scope,
      name: name.name,
      conditionsJson: conditions.conditions,
      createdBy: req.currentUser!.id,
    });
    res.status(201).json({ filter: view(row) });
  } catch (error) {
    if (isUniqueViolation(error)) return res.status(409).json({ error: "Фильтр с таким именем уже есть" });
    logger.error("Save saved filter error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to save filter" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: "Filter not found" });
  const body = (req.body ?? {}) as Record<string, unknown>;
  const patch: { name?: string; conditionsJson?: Record<string, unknown> } = {};
  if (body.name !== undefined) {
    const name = nameOf(body.name);
    if ("error" in name) return res.status(400).json({ error: name.error });
    patch.name = name.name;
  }
  if (body.conditions !== undefined) {
    const conditions = conditionsOf(body.conditions);
    if ("error" in conditions) return res.status(400).json({ error: conditions.error });
    patch.conditionsJson = conditions.conditions;
  }
  if (!patch.name && !patch.conditionsJson) return res.status(400).json({ error: "Нечего менять" });
  try {
    const row = await storage.updateSavedFilter(String(req.params.id), req.currentUser!.id, patch);
    // Чужой набор для владельца не существует: 404, а не 403 — id не подтверждается.
    if (!row) return res.status(404).json({ error: "Filter not found" });
    res.json({ filter: view(row) });
  } catch (error) {
    if (isUniqueViolation(error)) return res.status(409).json({ error: "Фильтр с таким именем уже есть" });
    logger.error("Update saved filter error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update filter" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  if (!UUID.test(String(req.params.id))) return res.status(404).json({ error: "Filter not found" });
  try {
    const deleted = await storage.deleteSavedFilter(String(req.params.id), req.currentUser!.id);
    if (!deleted) return res.status(404).json({ error: "Filter not found" });
    res.status(204).end();
  } catch (error) {
    logger.error("Delete saved filter error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to delete filter" });
  }
});

export default router;
