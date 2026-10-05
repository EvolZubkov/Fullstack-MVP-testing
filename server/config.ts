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
  /** PRD-54: поведение импорта выгрузок отчётов LMS. */
  analytics: {
    lmsImport: {
      /**
       * Хранить ли человекочитаемые поля участника. При `true` в базу идёт только псевдоним
       * `participant_key`; `lms_user_name`/`lms_user_email`/`lms_user_org` остаются пустыми.
       *
       * Псевдоним считается ВСЕГДА, в любом режиме: на нём держатся ключ идемпотентности импорта
       * и подсчёт уникальных участников. Параметр решает не то, есть ли псевдоним, а то, лежит ли
       * рядом с ним имя — поэтому переключение не меняет идентичность участника и не рвёт уже
       * накопленные ключи.
       *
       * На живую телеметрию НЕ распространяется: она продолжает хранить ФИО, почту и организацию.
       */
      anonymizeParticipants: boolean;
    };
    /**
     * PRD-56 FR-06d: сколько прохождений должно быть в срезе, чтобы показывать ПРОЦЕНТ.
     *
     * Ниже порога экран печатает «мало данных» и само число прохождений. Причина
     * арифметическая: половина 95-процентного доверительного интервала для доли около
     * половины — это ±44 п.п. на пяти прохождениях, ±31 на десяти и ±22 на двадцати. «33 %
     * сдали» на группе из трёх — не статистика, а шум, на котором принимают решения о людях.
     *
     * Умолчание 10 — решение владельца 2026-09-14: на пяти процент не несёт информации вовсе,
     * а двадцать отсекают типовую учебную группу в 8–15 человек, то есть ровно тех, ради кого
     * инструмент и делается. Порог касается ПОКАЗА, а не расчёта: внутри всё считается как есть.
     *
     * Для анализа вопросов (трудность, различающая способность) этот порог не годится — там
     * приличный минимум начинается от тридцати; настройка заведётся отдельно.
     */
    minObservations: number;
    /**
     * PRD-70 §3.2: во сколько раз доля прохождений с вопросом должна превысить ожидаемую (квота
     * раздела / размер пула), чтобы вопрос считался переэкспонированным. Свойство эксплуатации
     * банка — одно на инстанс, как окно счётчика выдач.
     */
    overexposureRatio: number;
  };
  /** PRD-55: поведение выдачи заданий. */
  delivery: {
    /**
     * Окно наблюдения экспозиции в месяцах (FR-04).
     *
     * Живёт в конфигурации инстанса, а не в настройках теста, потому что описывает ЭКСПЛУАТАЦИЮ
     * банка — как быстро сменяется поток обучающихся, — и одинаково для всех тестов установки.
     * Выдачи старше окна в расчёт весов не идут: утечка стареет вместе с потоком.
     */
    exposureWindowMonths: number;
  };
  /** Пакет SCORM: то, что относится к установке, а не к отдельному тесту. */
  scorm: {
    /**
     * Базовый адрес, на который пакет с включённой телеметрией отправляет данные
     * (`<адрес>/api/scorm-telemetry/...`). Пустая строка — берётся `server.appUrl`.
     *
     * Живёт в конфигурации установки, а не в настройках теста: принимает телеметрию эта
     * система, и адрес у неё один для всех тестов. Тест решает только, включена ли она.
     */
    telemetryBaseUrl: string;
  };
  /** Operational ceilings that an installation may tune without a code change. */
  limits: {
    /** Maximum rows accepted from one uploaded workbook (participants and users import). */
    participantsImportMaxRows: number;
    /** Password-setup letters per person per hour, shared by recovery and invitation. */
    passwordEmailsPerHour: number;
    /**
     * PRD-57 FR-28v: how many characters a short answer holds.
     *
     * 250 is the SCORM 2004 recommendation for a `fill-in` interaction, and the author's
     * own limit is set inside it. It lives in configuration rather than in code because
     * how WebTutor behaves at that boundary is not measured yet (#51): the measurement
     * must change a NUMBER, not the editor and not questions that are already saved.
     */
    shortAnswerMaxLength: number;
    /**
     * PRD-57 FR-28q: how long ONE comparison may block before the answer is left
     * unchecked. An author's regular expression runs on OUR server, and Node is single
     * threaded — the budget is what keeps one bad expression from stopping everyone.
     */
    answerCheckBudgetMs: number;
    /**
     * PRD-57 FR-28o: when the author is told their expression is slow. A warning, never a
     * refusal — the rule saves either way (FR-28p1).
     */
    answerCheckWarnMs: number;
  };
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

/**
 * Целое БОЛЬШЕ НУЛЯ или запасное значение. Отличается от {@link asNumber} тем, что не пропускает
 * ноль и отрицательные: у величин вроде окна наблюдения такое значение не «настройка», а тихая
 * поломка расчёта.
 */
function asPositiveInt(value: unknown, fallback: number): number {
  const n = asNumber(value, Number.NaN);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
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

/**
 * Shape a raw (getConfig-resolved) object into a typed AppConfig with defaults.
 *
 * Exported for its own test: every branch here is a default that a misconfigured instance falls
 * back to, and those are worth asserting without booting the service.
 */
export function shape(raw: Record<string, unknown>): AppConfig {
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
  const limits = asRecord(raw.limits);
  const analytics = asRecord(raw.analytics);
  const lmsImport = asRecord(analytics.lmsImport);
  const delivery = asRecord(raw.delivery);
  const scorm = asRecord(raw.scorm);

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
      appName: asString(server.appName, "Skill'Ум"),
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
    analytics: {
      lmsImport: {
        // По умолчанию ВКЛЮЧЕНО: инстанс, где про параметр не знают, не должен копить ФИО.
        anonymizeParticipants: asBool(lmsImport.anonymizeParticipants, true),
      },
      // Ноль или отрицательный порог означал бы «показывать процент всегда», включая срез из
      // одного человека, — такое значение не принимается, а не «работает как задано».
      minObservations: asPositiveInt(analytics.minObservations, 10),
      // Множитель не больше единицы назвал бы переэкспонированным любой вопрос с ожидаемой долей
      // — такое значение не принимается, а не «работает как задано».
      overexposureRatio: (() => {
        const ratio = asNumber(analytics.overexposureRatio, 1.5);
        return ratio > 1 ? ratio : 1.5;
      })(),
    },
    delivery: {
      // Ноль или отрицательное окно прочитали бы счётчик пустым и молча выключили поправку
      // целиком — такое значение не принимается, а не «работает как задано».
      exposureWindowMonths: asPositiveInt(delivery.exposureWindowMonths, 12),
    },
    scorm: {
      telemetryBaseUrl: asString(scorm.telemetryBaseUrl, "").trim().replace(/\/$/, ""),
    },
    limits: {
      participantsImportMaxRows: asNumber(limits.participantsImportMaxRows, 500),
      passwordEmailsPerHour: asNumber(limits.passwordEmailsPerHour, 3),
      shortAnswerMaxLength: asNumber(limits.shortAnswerMaxLength, 250),
      answerCheckBudgetMs: asNumber(limits.answerCheckBudgetMs, 1000),
      answerCheckWarnMs: asNumber(limits.answerCheckWarnMs, 200),
    },
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

/**
 * Адрес приёма телеметрии SCORM: `scorm.telemetryBaseUrl`, иначе `server.appUrl`.
 *
 * `null` — адрес не задан. Запасного `localhost`, как у {@link appBaseUrl}, здесь нет
 * намеренно: пакет уходит в LMS на чужой машине, и запечённый туда `localhost` молча
 * отправлял бы данные в никуда.
 */
export function telemetryBaseUrl(): string | null {
  return config.scorm.telemetryBaseUrl || config.server.appUrl || null;
}
