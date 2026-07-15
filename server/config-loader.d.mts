/**
 * Type declarations for the ESM config loader (server/config-loader.mjs).
 */

/**
 * Load the env file for the current NODE_ENV (`.env.<NODE_ENV>` then `.env`) into
 * process.env. Call before loadConfiguration; returns the file used or null.
 */
export declare function loadEnv(): string | null;

/**
 * Load the config file via the standard `@vvlad1973/utils` `getConfig`, with
 * `{ env }` references resolved from process.env. Cached after the first call.
 */
export declare function loadConfiguration(): Promise<Record<string, unknown>>;
