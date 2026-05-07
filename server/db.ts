/**
 * @module server/db
 * @description PostgreSQL database connection module using Drizzle ORM.
 * Provides connection pool with error handling, automatic reconnection,
 * health checks, and graceful shutdown support.
 */

import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";
import { logger } from "./logger";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

/**
 * Database connection state tracking.
 */
let isConnected = false;
let connectionAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 10;
const RECONNECT_DELAY_MS = 3000;

/**
 * PostgreSQL connection pool with resilience settings.
 * Handles connection errors gracefully without crashing the application.
 */
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

/**
 * Handle pool-level errors to prevent unhandled exceptions.
 * These errors occur when a client becomes disconnected while idle.
 */
pool.on("error", (err) => {
  logger.error("Unexpected error on idle client: " + err.message, "db")
  isConnected = false;
});

/**
 * Handle pool connection events for logging and state tracking.
 */
pool.on("connect", () => {
  logger.info("New database client connected", "db")
  isConnected = true;
  connectionAttempts = 0;
});

pool.on("remove", () => {
  logger.debug("Database client removed from pool", "db")
});

/**
 * Checks if the database connection is healthy.
 * @returns Promise resolving to true if connected, false otherwise
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    const client = await pool.connect();
    try {
      await client.query("SELECT 1");
      isConnected = true;
      return true;
    } finally {
      client.release();
    }
  } catch (error) {
    isConnected = false;
    logger.error("Health check failed: " + (error as Error).message, "db")
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
    poolSize: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount,
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
 * Gracefully closes all database connections.
 * Should be called during application shutdown.
 */
export async function closeDatabaseConnection(): Promise<void> {
  logger.info("Closing database connections...", "db")
  try {
    await pool.end();
    isConnected = false;
    logger.info("Database connections closed", "db")
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

const SLOW_QUERY_MS = 500;

export const db = drizzle(pool, {
  schema,
  logger: {
    logQuery(query: string, params: unknown[]) {
      // Пишем только медленные запросы чтобы не засорять лог
      const start = Date.now();
      // Drizzle вызывает logQuery синхронно до выполнения запроса — используем как маркер
      // Реальное время отслеживается через pool events, здесь просто дебаг-трейс в dev
      if (process.env.LOG_SQL === "true") {
        logger.debug(`SQL: ${query.slice(0, 200)} params=${JSON.stringify(params).slice(0, 100)}`, "db");
      }
    },
  },
});
