/**
 * @module server/routes/logs
 * @description API over the in-memory ring buffer of recent server events: a
 * read side for the author area («Логи») and a narrow write side for failures the
 * BROWSER detected and the server could not otherwise learn about.
 *
 * There is no historical/file-based log access here by design: rotation, retention
 * and full-log search are handled outside the application (container log driver /
 * logrotate). This endpoint only surfaces the last N events kept in memory.
 */
import { Router } from "express";
import { requireAuth, requirePermission } from "../middleware/auth";
import { getRecentLogs, logger, type LogFilter } from "../logger";

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

/** Longest accepted report body — anything beyond is truncated, not rejected. */
const MAX_MESSAGE = 500;
/** Longest accepted area tag. */
const MAX_SCOPE = 40;
/** Reports accepted per user per {@link BUDGET_WINDOW_MS}. */
const BUDGET_PER_WINDOW = 20;
const BUDGET_WINDOW_MS = 60_000;

/**
 * Per-user report budget. The ring buffer is a shared, finite resource: without a
 * cap any signed-in browser (or a runaway retry loop in one) could evict every
 * real event from it. Kept in memory deliberately — it guards a memory buffer, so
 * it may reset with the process.
 */
const budget = new Map<string, { count: number; resetAt: number }>();

/** True when this user may spend one more report right now. */
function withinBudget(userId: string, now: number): boolean {
  const b = budget.get(userId);
  if (!b || b.resetAt <= now) {
    budget.set(userId, { count: 1, resetAt: now + BUDGET_WINDOW_MS });
    return true;
  }
  if (b.count >= BUDGET_PER_WINDOW) return false;
  b.count += 1;
  return true;
}

/**
 * Collapse to a single log line: a line break inside a report would otherwise let
 * it forge extra entries in a line-oriented sink.
 */
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

// POST /api/logs/client — a failure the browser detected (see
// client/src/lib/report-error.ts). Any signed-in user may report: the learner
// hitting the broken screen is exactly who needs to be heard, and learners hold
// no `logs.*` capability. The payload is bounded, flattened and rate-limited, and
// the entry is attributed to the reporting user.
router.post("/client", requireAuth, (req, res) => {
  const userId = req.session.userId!;
  if (!withinBudget(userId, Date.now())) {
    return res.status(429).json({ error: "Too many reports" });
  }
  const body = (req.body ?? {}) as { scope?: unknown; message?: unknown };
  const message = typeof body.message === "string" ? oneLine(body.message).slice(0, MAX_MESSAGE) : "";
  if (!message) return res.status(400).json({ error: "message required" });
  const scope = typeof body.scope === "string" ? oneLine(body.scope).slice(0, MAX_SCOPE) : "";

  logger.error(`[client:${scope || "unknown"}] ${message} (user=${userId})`, "client");
  res.status(204).end();
});

export default router;
