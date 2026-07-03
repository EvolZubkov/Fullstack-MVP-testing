/**
 * @module server/config
 *
 * Central application configuration: the SINGLE source of configuration, exposed
 * as a typed, immutable-shaped object. Loading and `{ env: "VAR" }` resolution are
 * done by the standard package `@vvlad1973/utils` (`getConfig`), via the shared
 * async loader (`server/config-loader.mjs`). Because that is asynchronous, config
 * is loaded ONCE at startup with `await initConfig()` (see server/index.ts) — the
 * reference's dependency-injection model — rather than read at import time.
 *
 * `config` starts with built-in defaults at import so types are always satisfied;
 * `initConfig()` replaces its sections with the loaded values. Consumers must read
 * `config.X` at RUNTIME (inside functions/handlers), never at module top level, so
 * they observe the populated values. Modules that previously read config eagerly
 * (db, logger, crypto, email, superadmin, outbound-link builders) are initialized
 * lazily/after `initConfig()`.
 *
 * This module has no application dependencies (no crypto, no logger), so it is safe
 * to import from `logger`. Superadmin hash resolution lives in
 * `server/superadmin.ts`.
 */

import { loadConfiguration } from "./config-loader.mjs";

// ─── Public types ─────────────────────────────────────────────────────────────
/** Pino log level names accepted by the logging configuration. */
export type LogLevelName = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

/** Application configuration shape. Secret fields are resolved from `.env`. */
export interface AppConfig {
  log: {
    fileName: string;
    level: {
      common: LogLevelName;
      console: LogLevelName;
      file: LogLevelName;
      objects: Record<string, LogLevelName>;
    };
  };
  server: {
    port: number;
    appUrl: string;
    appName: string;
    cookieSecure: boolean;
  };
  email: {
    host: string;
    port: number;
    secure: boolean;
    from: string;
    auth: { user: string; pass: string };
  };
  database: { url: string };
  session: { secret: string };
  encryption: { password: string; salt: string };
  access: { superadminEmails: readonly string[] };
}

// ─── Normalizers ──────────────────────────────────────────────────────────────
const VALID_LEVELS: readonly LogLevelName[] = [
  "trace", "debug", "info", "warn", "error", "fatal", "silent",
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asLevel(value: unknown): LogLevelName | undefined {
  if (typeof value === "string" && VALID_LEVELS.includes(value.toLowerCase() as LogLevelName)) {
    return value.toLowerCase() as LogLevelName;
  }
  return undefined;
}

function asString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return fallback;
}

function asBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") return value.toLowerCase() === "true";
  return fallback;
}

function normalizeSources(value: unknown): Record<string, LogLevelName> {
  const out: Record<string, LogLevelName> = {};
  for (const [source, raw] of Object.entries(asRecord(value))) {
    const level = asLevel(raw);
    if (source && level) out[source] = level;
  }
  return out;
}

function normalizeEmails(value: unknown): string[] {
  const parts: string[] = Array.isArray(value)
    ? value.map((v) => String(v))
    : typeof value === "string"
      ? value.split(",")
      : [];
  const seen = new Set<string>();
  for (const part of parts) {
    const email = part.trim().toLowerCase();
    if (email) seen.add(email);
  }
  return Array.from(seen);
}

/** Shape a raw (getConfig-resolved) object into a typed AppConfig with defaults. */
function shape(raw: Record<string, unknown>): AppConfig {
  const log = asRecord(raw.log);
  const logLevel = asRecord(log.level);
  const common = asLevel(logLevel.common) ?? (process.env.NODE_ENV === "production" ? "info" : "debug");
  const server = asRecord(raw.server);
  const email = asRecord(raw.email);
  const emailAuth = asRecord(email.auth);
  const database = asRecord(raw.database);
  const session = asRecord(raw.session);
  const encryption = asRecord(raw.encryption);
  const access = asRecord(raw.access);

  return {
    log: {
      fileName: asString(log.fileName, ""),
      level: {
        common,
        console: asLevel(logLevel.console) ?? common,
        file: asLevel(logLevel.file) ?? common,
        objects: normalizeSources(logLevel.objects),
      },
    },
    server: {
      port: asNumber(server.port, 5000),
      appUrl: asString(server.appUrl, "").replace(/\/$/, ""),
      appName: asString(server.appName, "СкилУм"),
      cookieSecure: asBool(server.cookieSecure, false),
    },
    email: {
      host: asString(email.host, ""),
      port: asNumber(email.port, 587),
      secure: asBool(email.secure, false),
      from: asString(email.from, ""),
      auth: { user: asString(emailAuth.user, ""), pass: asString(emailAuth.pass, "") },
    },
    database: { url: asString(database.url, "") },
    session: { secret: asString(session.secret, "") },
    encryption: {
      password: asString(encryption.password, ""),
      salt: asString(encryption.salt, ""),
    },
    access: { superadminEmails: normalizeEmails(access.superadminEmails) },
  };
}

// ─── Singleton + init ─────────────────────────────────────────────────────────
/**
 * The application configuration. Starts with built-in defaults and is populated
 * by {@link initConfig} at startup. Read its fields at RUNTIME, not at import.
 */
export const config: AppConfig = shape({});

let initialized = false;

/**
 * Load environment + configuration once via the standard `getConfig` loader and
 * populate {@link config}. Idempotent; returns the populated config.
 */
export async function initConfig(): Promise<AppConfig> {
  if (initialized) return config;
  const raw = await loadConfiguration();
  Object.assign(config, shape(raw));
  initialized = true;
  return config;
}

/** Whether {@link initConfig} has run. */
export function isConfigInitialized(): boolean {
  return initialized;
}

/**
 * Resolve the effective public base URL for building outbound links.
 * Prefers the configured `server.appUrl`, else localhost with the effective port.
 */
export function appBaseUrl(): string {
  if (config.server.appUrl) return config.server.appUrl;
  const port = process.env.PORT ?? String(config.server.port);
  return `http://localhost:${port}`;
}
