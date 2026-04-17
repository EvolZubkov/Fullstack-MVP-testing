import fs from "fs";
import path from "path";
import { AsyncLocalStorage } from "async_hooks";

// ─── Константы ────────────────────────────────────────────────────────────────
const LOG_DIR = path.resolve(process.cwd(), "logs");
const MAX_LOG_DAYS = 14;
const MAX_AUDIT_DAYS = 90;
const SLOW_REQUEST_MS = 1000;

// ─── Типы ─────────────────────────────────────────────────────────────────────
type LogLevel = "debug" | "info" | "warn" | "error" | "fatal";

export interface RequestContext {
  reqId: string;
  userId?: string;
  method?: string;
  path?: string;
}

// ─── Request context (AsyncLocalStorage) ──────────────────────────────────────
export const requestContext = new AsyncLocalStorage<RequestContext>();

// ─── Файловые утилиты ─────────────────────────────────────────────────────────
function getLogFilePath(date: Date = new Date()): string {
  return path.join(LOG_DIR, `app-${date.toISOString().slice(0, 10)}.log`);
}

function getAuditFilePath(date: Date = new Date()): string {
  return path.join(LOG_DIR, `audit-${date.toISOString().slice(0, 10)}.log`);
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
}

function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const now = Date.now();
    for (const file of files) {
      const appMatch = file.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
      const auditMatch = file.match(/^audit-(\d{4}-\d{2}-\d{2})\.log$/);
      const match = appMatch || auditMatch;
      if (!match) continue;
      const maxDays = auditMatch ? MAX_AUDIT_DAYS : MAX_LOG_DAYS;
      const fileDate = new Date(match[1]).getTime();
      if (now - fileDate > maxDays * 86400_000) {
        fs.unlinkSync(path.join(LOG_DIR, file));
      }
    }
  } catch {}
}

// ─── Дедупликация ошибок ──────────────────────────────────────────────────────
const errorCounts = new Map<string, { count: number; lastLoggedAt: number }>();
const ERROR_DEDUP_WINDOW_MS = 60_000; // 1 минута
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
  // Каждые 10 подавленных — логируем суммарно
  if (entry.count % 10 === 0) {
    writeRaw("warn", "logger", `[dedup] Suppressed ${entry.count - ERROR_DEDUP_THRESHOLD} identical errors for: ${key.slice(0, 80)}`);
  }
  return false;
}

// ─── Форматирование ───────────────────────────────────────────────────────────
function formatLine(level: LogLevel, source: string, message: string): string {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  const ctx = requestContext.getStore();
  const reqPart = ctx?.reqId ? ` [req:${ctx.reqId}]` : "";
  const userPart = ctx?.userId ? ` [user:${ctx.userId}]` : "";
  return `${ts} [${level.toUpperCase().padEnd(5)}] [${source}]${reqPart}${userPart} ${message}`;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.stack ? `${err.message}\n${err.stack}` : err.message;
  }
  return String(err);
}

// ─── Запись ───────────────────────────────────────────────────────────────────
function writeRaw(level: LogLevel, source: string, message: string) {
  const line = formatLine(level, source, message);

  if (level === "fatal" || level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  try {
    ensureLogDir();
    fs.appendFileSync(getLogFilePath(), line + "\n", "utf8");
  } catch (e) {
    process.stderr.write(`[logger write failed] ${(e as Error).message}\n`);
  }
}

function write(level: LogLevel, source: string, message: string) {
  // Дедупликация только для error/fatal
  if (level === "error" || level === "fatal") {
    const key = `${source}:${message.slice(0, 120)}`;
    if (!shouldLog(key)) return;
  }
  writeRaw(level, source, message);
}

// ─── Audit log ────────────────────────────────────────────────────────────────
function writeAudit(action: string, details: Record<string, unknown>) {
  try {
    ensureLogDir();
    const ctx = requestContext.getStore();
    const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
    const line = JSON.stringify({
      ts,
      action,
      reqId: ctx?.reqId,
      userId: ctx?.userId,
      ...details,
    });
    fs.appendFileSync(getAuditFilePath(), line + "\n", "utf8");
    writeRaw("info", "audit", `${action} ${JSON.stringify(details)}`);
  } catch (e) {
    process.stderr.write(`[audit write failed] ${(e as Error).message}\n`);
  }
}

// ─── Heartbeat ────────────────────────────────────────────────────────────────
function logHeartbeat() {
  const mem = process.memoryUsage();
  const uptime = Math.floor(process.uptime());
  writeRaw("info", "heartbeat", [
    `uptime=${uptime}s`,
    `rss=${Math.round(mem.rss / 1024 / 1024)}MB`,
    `heapUsed=${Math.round(mem.heapUsed / 1024 / 1024)}MB`,
    `heapTotal=${Math.round(mem.heapTotal / 1024 / 1024)}MB`,
  ].join(" "));
}

// ─── Init ─────────────────────────────────────────────────────────────────────
setInterval(cleanOldLogs, 86400_000);
cleanOldLogs();
setInterval(logHeartbeat, 5 * 60_000); // каждые 5 минут

// ─── Экспорт ─────────────────────────────────────────────────────────────────
export const logger = {
  debug: (message: string, source = "app") => {
    if (process.env.NODE_ENV !== "production") write("debug", source, message);
  },
  info:  (message: string, source = "app") => write("info",  source, message),
  warn:  (message: string, source = "app") => write("warn",  source, message),
  error: (message: string | Error | unknown, source = "app") => {
    write("error", source, typeof message === "string" ? message : formatError(message));
  },
  fatal: (message: string | Error | unknown, source = "app") => {
    write("fatal", source, typeof message === "string" ? message : formatError(message));
  },
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
  bulkImport:     (created: number, updated: number, skipped: number) =>
    writeAudit("user.bulkImport", { created, updated, skipped }),
  attemptsReset:  (targetUserId: string, testId: string | null) =>
    writeAudit("attempts.reset", { targetUserId, testId }),
};

export { SLOW_REQUEST_MS };

// ─── Утилиты для API страницы логов ──────────────────────────────────────────
export function getAvailableLogDates(): string[] {
  try {
    ensureLogDir();
    return fs.readdirSync(LOG_DIR)
      .map(f => f.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/)?.[1])
      .filter(Boolean)
      .sort()
      .reverse() as string[];
  } catch {
    return [];
  }
}

export function readLogFile(date: string): string[] {
  try {
    const filePath = getLogFilePath(new Date(date));
    if (!fs.existsSync(filePath)) return [];
    return fs.readFileSync(filePath, "utf8").split("\n").filter(Boolean);
  } catch {
    return [];
  }
}
