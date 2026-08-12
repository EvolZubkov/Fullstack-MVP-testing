/**
 * @module server/logger
 * @description Application logging facade built on a hierarchical Pino logger tree
 * (`@vvlad1973/pino-logger-tree`).
 *
 * Sinks mirror the reference service (see botapp-service.new/src/init/logger.js):
 * a pino-pretty console sink and an optional pino-pretty file sink, each with its
 * own level. Configuration comes from {@link config.log}: `level.common` is the
 * base level the logger processes, `level.console`/`level.file` gate the two sinks,
 * `level.objects` holds per-subsystem (per-source) overrides, and `fileName` (when
 * set) enables the file sink. The app writes to a fixed file and never rotates it —
 * rotation/retention are the runtime's responsibility.
 *
 * The most recent events are additionally retained in an in-memory ring buffer that
 * backs the in-app "recent events" view.
 *
 * The audit trail is a separate concern and remains app-managed: it is written to a
 * dedicated file (`audit-YYYY-MM-DD.log`) with its own retention window.
 */
import fs from "fs";
import path from "path";
import { AsyncLocalStorage } from "async_hooks";
import pino, { type Logger, type LogFn } from "pino";
import pretty from "pino-pretty";
import { LoggerTree, type LoggerLevel } from "@vvlad1973/pino-logger-tree";
import { config } from "./config";

// ─── Constants ──────────────────────────────────────────────────────────────────
const LOG_DIR = path.resolve(process.cwd(), "logs");
const MAX_AUDIT_DAYS = 90;
const SLOW_REQUEST_MS = 1000;
const RING_BUFFER_SIZE = 2000;
const ROOT_PATH = "app";

// ─── Types ──────────────────────────────────────────────────────────────────────
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export interface RequestContext {
  reqId: string;
  userId?: string;
  method?: string;
  path?: string;
}

/**
 * A single structured log event retained in the in-memory ring buffer.
 *
 * @public
 */
export interface LogEntry {
  /** Human-readable timestamp, `YYYY-MM-DD HH:mm:ss`. */
  ts: string;
  level: LogLevel;
  source: string;
  message: string;
  reqId?: string;
  userId?: string;
}

/** Filter applied when reading recent events from the ring buffer. */
export interface LogFilter {
  level?: LogLevel | "all";
  search?: string;
  limit?: number;
}

// ─── Request context (AsyncLocalStorage) ──────────────────────────────────────────
export const requestContext = new AsyncLocalStorage<RequestContext>();

// ─── Shared helpers ───────────────────────────────────────────────────────────────
function formatTs(date: Date = new Date()): string {
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ? `${err.message}\n${err.stack}` : err.message;
  }
  return String(err);
}

// ─── Logger tree (Pino) ─────────────────────────────────────────────────────────────
// Build the destination: a pino-pretty console sink plus an optional pino-pretty
// file sink, each with its own level (config.log.level.console / .file). A
// single-thread pino.multistream is used instead of pino's worker transports
// because the server is bundled (esbuild) and worker transports do not resolve
// reliably from a bundle; the on-disk/console formatting still matches the
// reference's pino-pretty targets.
function buildDestination(): pino.MultiStreamRes {
  const { fileName, level } = config.log;
  // Cast: StreamEntry.level excludes "silent"; at runtime a "silent" stream level
  // is inert (nothing routes to it), which is the intended "sink off" behaviour.
  const streams: pino.StreamEntry[] = [
    { level: level.console as pino.Level, stream: pretty({ translateTime: "SYS:standard" }) },
  ];
  if (fileName && level.file) {
    streams.push({
      level: level.file as pino.Level,
      stream: pretty({
        colorize: false,
        translateTime: "SYS:standard",
        destination: fileName,
        mkdir: true,
      }),
    });
  }
  return pino.multistream(streams);
}

// The tree and its sinks are built lazily on first use, reading config.log AFTER
// initConfig() has populated it (the DI model) — so importing this module does
// not touch config. Base level is `common`; per-object (per-source) overrides
// come from `log.level.objects`.
let tree: LoggerTree | undefined;
let levelOverrides = new Map<string, LoggerLevel>();
function ensureTree(): LoggerTree {
  if (tree) return tree;
  tree = new LoggerTree(
    {
      level: config.log.level.common,
      name: ROOT_PATH,
      redact: { paths: ["password", "token", "secret", "secretToken"], remove: true },
    },
    buildDestination()
  );
  levelOverrides = new Map<string, LoggerLevel>(
    Object.entries(config.log.level.objects) as Array<[string, LoggerLevel]>
  );
  return tree;
}

// Per-source Pino loggers, one tree node per source, created and cached on demand.
const nodeCache = new Map<string, Logger>();
function nodeFor(source: string): Logger {
  const t = ensureTree();
  let node = nodeCache.get(source);
  if (node === undefined) {
    const options: Record<string, unknown> = { name: source };
    const override = levelOverrides.get(source);
    if (override !== undefined) options.level = override;
    node = t.createLogger(`${ROOT_PATH}.${source}`, options) as unknown as Logger;
    nodeCache.set(source, node);
  }
  return node;
}

// ─── Error deduplication ───────────────────────────────────────────────────────────
const errorCounts = new Map<string, { count: number; lastLoggedAt: number }>();
const ERROR_DEDUP_WINDOW_MS = 60_000; // 1 minute
const ERROR_DEDUP_THRESHOLD = 3;

function shouldLog(key: string): boolean {
  const now = Date.now();
  const entry = errorCounts.get(key);
  if (!entry || now - entry.lastLoggedAt > ERROR_DEDUP_WINDOW_MS) {
    errorCounts.set(key, { count: 1, lastLoggedAt: now });
    return true;
  }
  entry.count++;
  if (entry.count <= ERROR_DEDUP_THRESHOLD) return true;
  // Every 10 suppressed occurrences, emit a summary line.
  if (entry.count % 10 === 0) {
    emit("warn", "logger", `[dedup] Suppressed ${entry.count - ERROR_DEDUP_THRESHOLD} identical errors for: ${key.slice(0, 80)}`);
  }
  return false;
}

// ─── In-memory ring buffer ─────────────────────────────────────────────────────────
const ring: (LogEntry | undefined)[] = new Array<LogEntry | undefined>(RING_BUFFER_SIZE);
let ringHead = 0; // index of the next write
let ringCount = 0; // number of live entries (<= RING_BUFFER_SIZE)

function pushRing(entry: LogEntry): void {
  ring[ringHead] = entry;
  ringHead = (ringHead + 1) % RING_BUFFER_SIZE;
  if (ringCount < RING_BUFFER_SIZE) ringCount++;
}

/** Snapshot the ring buffer oldest-to-newest. */
function snapshotRing(): LogEntry[] {
  const out: LogEntry[] = [];
  const start = ringCount < RING_BUFFER_SIZE ? 0 : ringHead;
  for (let i = 0; i < ringCount; i++) {
    const entry = ring[(start + i) % RING_BUFFER_SIZE];
    if (entry) out.push(entry);
  }
  return out;
}

// ─── Emit ───────────────────────────────────────────────────────────────────────────
function emit(level: LogLevel, source: string, message: string): void {
  const node = nodeFor(source);

  // Respect the node's effective level for both the Pino sink and the ring buffer.
  if (!node.isLevelEnabled(level)) return;

  // Deduplicate repeated error/fatal within a short window.
  if (level === "error" || level === "fatal") {
    const key = `${source}:${message.slice(0, 120)}`;
    if (!shouldLog(key)) return;
  }

  const ctx = requestContext.getStore();
  const fields: Record<string, unknown> = {};
  if (ctx?.reqId) fields.reqId = ctx.reqId;
  if (ctx?.userId) fields.userId = ctx.userId;

  (node[level] as LogFn)(fields, message);

  const entry: LogEntry = { ts: formatTs(), level, source, message };
  if (ctx?.reqId) entry.reqId = ctx.reqId;
  if (ctx?.userId) entry.userId = ctx.userId;
  pushRing(entry);
}

// ─── Audit log (separate, app-managed) ─────────────────────────────────────────────
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getAuditFilePath(date: Date = new Date()): string {
  return path.join(LOG_DIR, `audit-${date.toISOString().slice(0, 10)}.log`);
}

function cleanOldAuditLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    for (const file of files) {
      const match = file.match(/^audit-(\d{4}-\d{2}-\d{2})\.log$/);
      if (!match) continue;
      const fileDate = new Date(match[1]).getTime();
      if (now - fileDate > MAX_AUDIT_DAYS * 86400_000) {
        fs.unlinkSync(path.join(LOG_DIR, file));
      }
    }
  } catch {}
}

function writeAudit(action: string, details: Record<string, unknown>) {
  try {
    ensureLogDir();
    const ctx = requestContext.getStore();
    const line = JSON.stringify({
      ts: formatTs(),
      action,
      reqId: ctx?.reqId,
      userId: ctx?.userId,
      ...details,
    });
    fs.appendFileSync(getAuditFilePath(), line + "\n", "utf8");
    emit("info", "audit", `${action} ${JSON.stringify(details)}`);
  } catch (e) {
    process.stderr.write(`[audit write failed] ${(e as Error).message}\n`);
  }
}

// ─── Heartbeat ─────────────────────────────────────────────────────────────────────
function logHeartbeat() {
  const mem = process.memoryUsage();
  const uptime = Math.floor(process.uptime());
  emit("info", "heartbeat", [
    `uptime=${uptime}s`,
    `rss=${Math.round(mem.rss / 1024 / 1024)}MB`,
    `heapUsed=${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    `heapTotal=${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
  ].join(" "));
}

// ─── Init ──────────────────────────────────────────────────────────────────────────
setInterval(cleanOldAuditLogs, 86400_000);
cleanOldAuditLogs();
setInterval(logHeartbeat, 5 * 60_000); // every 5 minutes

// ─── Exports ───────────────────────────────────────────────────────────────────────
export const logger = {
  trace: (message: string, source = "app") => emit("trace", source, message),
  debug: (message: string, source = "app") => emit("debug", source, message),
  info:  (message: string, source = "app") => emit("info",  source, message),
  warn:  (message: string, source = "app") => emit("warn",  source, message),
  error: (message: string | Error | unknown, source = "app") => {
    emit("error", source, typeof message === "string" ? message : formatError(message));
  },
  fatal: (message: string | Error | unknown, source = "app") => {
    emit("fatal", source, typeof message === "string" ? message : formatError(message));
  },
  /**
   * Whether `level` is enabled for `source` — pino's own gate (delegated to the
   * source's tree node). Use it to guard construction of expensive log arguments
   * (e.g. SQL query strings) so nothing is built when the level is disabled.
   */
  isLevelEnabled: (level: LogLevel, source = "app"): boolean =>
    nodeFor(source).isLevelEnabled(level),
};

export const audit = {
  login:          (email: string, success: boolean, ip: string) =>
    writeAudit("auth.login", { email, success, ip }),
  logout:         () =>
    writeAudit("auth.logout", {}),
  passwordChange: (targetUserId: string) =>
    writeAudit("auth.passwordChange", { targetUserId }),
  passwordReset:  (targetUserId: string) =>
    writeAudit("auth.passwordReset", { targetUserId }),
  userCreate:     (email: string, role: string) =>
    writeAudit("user.create", { email, role }),
  userDeactivate: (targetUserId: string) =>
    writeAudit("user.deactivate", { targetUserId }),
  userActivate:   (targetUserId: string) =>
    writeAudit("user.activate", { targetUserId }),
  /**
   * PRD-28: an external participant became an ordinary account. Recorded on its
   * own because the change is one-way — there is no endpoint back — so the audit
   * trail is the only place the previous kind of the account survives.
   */
  userPromote:    (targetUserId: string) =>
    writeAudit("user.promote", { targetUserId }),
  userInvite:     (targetUserId: string) =>
    writeAudit("user.invite", { targetUserId }),
  bulkImport:     (created: number, updated: number, skipped: number) =>
    writeAudit("user.bulkImport", { created, updated, skipped }),
  attemptsReset:  (targetUserId: string, testId: string | null) =>
    writeAudit("attempts.reset", { targetUserId, testId }),
};

export { SLOW_REQUEST_MS };

/**
 * Read recent events from the in-memory ring buffer, applying optional level/text
 * filters. Backs the in-app "recent events" view; not a source of historical logs.
 *
 * @param filter - Optional level, case-insensitive text search, and result limit.
 * @returns The matching events (newest last), plus total-before-limit and shown counts.
 */
export function getRecentLogs(filter: LogFilter = {}): {
  total: number;
  shown: number;
  entries: LogEntry[];
} {
  let entries = snapshotRing();

  if (filter.level && filter.level !== "all") {
    entries = entries.filter((e) => e.level === filter.level);
  }
  if (filter.search) {
    const q = filter.search.toLowerCase();
    entries = entries.filter(
      (e) => e.message.toLowerCase().includes(q) || e.source.toLowerCase().includes(q)
    );
  }

  const total = entries.length;
  const limit = filter.limit ?? 100;
  const shown = entries.slice(-limit);
  return { total, shown: shown.length, entries: shown };
}
