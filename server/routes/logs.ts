/**
 * @module server/routes/logs
 * @description Read-only API over the in-memory ring buffer of recent server events.
 * There is no historical/file-based log access here by design: rotation, retention
 * and full-log search are handled outside the application (container log driver /
 * logrotate). This endpoint only surfaces the last N events kept in memory.
 */
import { Router } from "express";
import { requirePermission } from "../middleware/auth";
import { getRecentLogs, type LogFilter } from "../logger";

const router = Router();

// Author-only access.
// GET /api/logs?level=error&search=database&limit=100
router.get("/", requirePermission("logs.read"), (req, res) => {
  const level = req.query.level as LogFilter["level"] | undefined;
  const search = req.query.search as string | undefined;
  const limitRaw = Number.parseInt(req.query.limit as string, 10);

  const result = getRecentLogs({
    level: level ?? "all",
    search: search || undefined,
    limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
  });

  res.json(result);
});

export default router;
