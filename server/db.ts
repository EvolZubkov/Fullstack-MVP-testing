/**
 * @module server/db
 * @description PostgreSQL database connection module using Drizzle ORM.
 * Provides a lazily-created connection pool with error handling, automatic
 * reconnection, health checks, and graceful shutdown support.
 *
 * The pool and the Drizzle instance are created on first use (not at import),
 * reading `config.database.url` after `initConfig()` has populated it — the
 * dependency-injection model, so nothing connects while modules are importing.
 */

import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { logger } from "./logger";
import { config } from "./config";

const { Pool } = pg;

/** Database connection state tracking. */
let isConnected = false;
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 3000;

// ─── Lazy pool ────────────────────────────────────────────────────────────────
let poolInstance: pg.Pool | undefined;

/** Get (creating on first call) the resilient connection pool. */
function getPool(): pg.Pool {
  if (poolInstance) return poolInstance;
  if (!config.database.url) {
    throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
  }
  const pool = new Pool({
    connectionString: config.database.url,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });
  // Prevent unhandled exceptions when an idle client disconnects.
  pool.on("error", (err) => {
    logger.error("Unexpected error on idle client: " + err.message, "db");
    isConnected = false;
  });
  pool.on("connect", () => {
    logger.info("New database client connected", "db");
    isConnected = true;
    connectionAttempts = 0;
  });
  pool.on("remove", () => {
    logger.debug("Database client removed from pool", "db");
  });
  poolInstance = pool;
  return pool;
}

/**
 * Checks if the database connection is healthy.
 * @returns Promise resolving to true if connected, false otherwise
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await getPool().connect();
    try {
      await client.query("SELECT 1");
      isConnected = true;
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    isConnected = false;
    logger.error("Health check failed: " + (error as Error).message, "db");
    return false;
  }
}

/**
 * Returns current database connection status.
 * @returns Connection status object
 */
export function getDatabaseStatus(): {
  isConnected: boolean;
  poolSize: number;
  idleCount: number;
  waitingCount: number;
} {
  return {
    isConnected,
    poolSize: poolInstance?.totalCount ?? 0,
    idleCount: poolInstance?.idleCount ?? 0,
    waitingCount: poolInstance?.waitingCount ?? 0,
  };
}

/**
 * Executes a database operation with retry logic.
 * @param operation - Async function to execute
 * @param maxRetries - Maximum number of retry attempts (default: 3)
 * @param delayMs - Delay between retries in milliseconds (default: 1000)
 * @returns Result of the operation
 * @throws Error if all retries fail
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries = 3,
  delayMs = 1000
): Promise<T> {
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;
      const isConnectionError =
        lastError.message.includes("connection") ||
        lastError.message.includes("ECONNREFUSED") ||
        lastError.message.includes("terminating connection") ||
        lastError.message.includes("Connection terminated");

      if (!isConnectionError || attempt === maxRetries) {
        throw lastError;
      }

      logger.warn(`DB retry attempt ${attempt}/${maxRetries}: ${lastError.message}`, "db");
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  throw lastError;
}

/**
 * Gracefully closes all database connections. No-op if the pool was never opened.
 */
export async function closeDatabaseConnection(): Promise<void> {
  if (!poolInstance) return;
  logger.info("Closing database connections...", "db");
  try {
    await poolInstance.end();
    isConnected = false;
    poolInstance = undefined;
    logger.info("Database connections closed", "db");
  } catch (error) {
    logger.error("Error closing database connections: " + (error as Error).message, "db");
    throw error;
  }
}

/**
 * Waits for database to become available with exponential backoff.
 * Useful during application startup.
 * @returns Promise resolving to true when connected
 * @throws Error if max attempts exceeded
 */
export async function waitForDatabase(): Promise<boolean> {
  logger.info("Waiting for database connection...", "db");

  while (connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
    connectionAttempts++;
    const delay = Math.min(RECONNECT_DELAY_MS * connectionAttempts, 30000);

    try {
      const healthy = await checkDatabaseHealth();
      if (healthy) {
        logger.info("Database connection established", "db");
        return true;
      }
    } catch (error) {
      logger.warn(`Database connection attempt ${connectionAttempts}/${MAX_RECONNECT_ATTEMPTS} failed: ${(error as Error).message}`, "db");
    }

    if (connectionAttempts < MAX_RECONNECT_ATTEMPTS) {
      logger.info(`Retrying in ${delay}ms...`, "db");
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw new Error(
    `Failed to connect to database after ${MAX_RECONNECT_ATTEMPTS} attempts`
  );
}

// ─── Lazy Drizzle instance ──────────────────────────────────────────────────────
let dbInstance: NodePgDatabase<typeof schema> | undefined;

function getDb(): NodePgDatabase<typeof schema> {
  if (dbInstance) return dbInstance;
  dbInstance = drizzle(getPool(), {
    schema,
    logger: {
      logQuery(query: string, params: unknown[]) {
        // SQL query tracing is the `db` subsystem at `trace`. Gate on pino's own
        // isLevelEnabled so the strings are built only when trace is enabled for
        // db (config.log.level.objects: { "db": "trace" }).
        if (logger.isLevelEnabled("trace", "db")) {
          logger.trace(`SQL: ${query.slice(0, 200)} params=${JSON.stringify(params).slice(0, 100)}`, "db");
        }
      },
    },
  });
  return dbInstance;
}

/**
 * The Drizzle database. Backed by a lazily-created pool/instance so importing
 * this module does not open a connection; the first property access initializes
 * it from `config.database.url`.
 */
export const db: NodePgDatabase<typeof schema> = new Proxy(
  {} as NodePgDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const instance = getDb();
      const value = Reflect.get(instance as object, prop, receiver);
      return typeof value === "function" ? value.bind(instance) : value;
    },
  }
);
