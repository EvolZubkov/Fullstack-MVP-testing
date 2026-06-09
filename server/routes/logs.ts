import { Router } from "express";
import { requirePermission } from "../middleware/auth";
import { getAvailableLogDates, readLogFile } from "../logger";

const router = Router();

// Только author имеет доступ
// GET /api/logs/dates — список доступных дат
router.get("/dates", requirePermission("logs.read"), (_req, res) => {
  res.json(getAvailableLogDates());
});

// GET /api/logs?date=2026-03-19&level=error&search=database
router.get("/", requirePermission("logs.read"), (req, res) => {
  const date = (req.query.date as string) || new Date().toISOString().slice(0, 10);
  const level = req.query.level as string | undefined;
  const search = req.query.search as string | undefined;

  let lines = readLogFile(date);

  if (level && level !== "all") {
    lines = lines.filter(l => l.includes(`[${level.toUpperCase()}`));
  }
  if (search) {
    const q = search.toLowerCase();
    lines = lines.filter(l => l.toLowerCase().includes(q));
  }

  const LIMIT = 100;
  const trimmed = lines.slice(-LIMIT);
  res.json({ date, total: lines.length, shown: trimmed.length, lines: trimmed });
});

export default router;