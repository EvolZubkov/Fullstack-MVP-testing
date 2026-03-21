import fs from "fs";
import path from "path";

const LOG_DIR = path.resolve(process.cwd(), "logs");
const MAX_DAYS = 14;

type LogLevel = "info" | "warn" | "error" | "debug";

function getLogFilePath(date: Date = new Date()): string {
  const d = date.toISOString().slice(0, 10);
  return path.join(LOG_DIR, `app-${d}.log`);
}

function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

function cleanOldLogs() {
  try {
    const files = fs.readdirSync(LOG_DIR);
    const cutoff = Date.now() - MAX_DAYS * 24 * 60 * 60 * 1000;
    for (const file of files) {
      const match = file.match(/^app-(\d{4}-\d{2}-\d{2})\.log$/);
      if (match) {
        const fileDate = new Date(match[1]).getTime();
        if (fileDate < cutoff) {
          fs.unlinkSync(path.join(LOG_DIR, file));
        }
      }
    }
  } catch {}
}

function formatLine(level: LogLevel, source: string, message: string): string {
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  return `${ts} [${level.toUpperCase().padEnd(5)}] [${source}] ${message}`;
}

function write(level: LogLevel, source: string, message: string) {
  const line = formatLine(level, source, message);

  // В консоль
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);

  // В файл
  try {
    ensureLogDir();
    fs.appendFileSync(getLogFilePath(), line + "\n", "utf8");
  } catch {}
}

// Раз в сутки чистим старые логи
setInterval(cleanOldLogs, 24 * 60 * 60 * 1000);
cleanOldLogs();

export const logger = {
  info:  (message: string, source = "app") => write("info",  source, message),
  warn:  (message: string, source = "app") => write("warn",  source, message),
  error: (message: string, source = "app") => write("error", source, message),
  debug: (message: string, source = "app") => {
    if (process.env.NODE_ENV !== "production") write("debug", source, message);
  },
};

// Утилиты для API страницы логов
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