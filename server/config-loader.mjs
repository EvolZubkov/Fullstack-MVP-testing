/**
 * @module server/config-loader
 *
 * Configuration loader built on the standard package `@vvlad1973/utils` (the same
 * `getConfig` used by the reference service). It mirrors the reference's
 * `loadConfiguration`: first load the environment file for the current NODE_ENV
 * (`.env.<NODE_ENV>` then `.env`), then load the config file via `getConfig`,
 * which parses JSONC and resolves every `{ "env": "VAR" }` reference from
 * process.env. Selection is by NODE_ENV (first existing wins — no merge):
 *   config/<NODE_ENV>.config.jsonc, <NODE_ENV>.config.jsonc,
 *   config/config.jsonc, config.jsonc
 * `CONFIG_FILE` overrides the search with an explicit path.
 *
 * Authored as ESM (`.mjs`) because `@vvlad1973/utils` is an ES module. It is
 * bundled into the server for the app, imported directly by ESM tools, and
 * dynamically imported (`await import`) by the CommonJS deploy runner
 * (script/run-sql.cjs runs on Node 20, which cannot `require` ESM). It lives next
 * to server/config.ts (its typed wrapper); `config/` holds only config DATA.
 *
 * `loadConfiguration()` is async by design (getConfig awaits file I/O) — the app
 * awaits it once at startup and passes the result to `initConfig()`.
 */

import { config as loadDotenv } from "dotenv";
import { getConfig } from "@vvlad1973/utils";
import fs from "node:fs";
import path from "node:path";

/**
 * Load the environment file for the current NODE_ENV (`.env.<NODE_ENV>` then
 * `.env`) into process.env. Called explicitly by the app bootstrap and CLI tools
 * BEFORE loadConfiguration — NOT during config loading, so tests (which set
 * process.env themselves and never call this) stay isolated from any local .env.
 * @returns {string|null} the file loaded, or null if none exists.
 */
export function loadEnv() {
  const env = process.env.NODE_ENV?.trim();
  const candidates = env ? [`.env.${env}`, ".env"] : [".env"];
  for (const rel of candidates) {
    const abs = path.resolve(process.cwd(), rel);
    if (fs.existsSync(abs)) {
      loadDotenv({ path: abs, quiet: true });
      // eslint-disable-next-line no-console
      console.log(`[config] Loaded environment from ${rel}`);
      return rel;
    }
  }
  return null;
}

/** Ordered config-file candidates for the current NODE_ENV (first existing wins). */
function configScope() {
  const explicit = process.env.CONFIG_FILE?.trim();
  if (explicit) return [explicit];

  const env = process.env.NODE_ENV?.trim();
  const exts = [".jsonc", ".json"];
  const scope = [];
  if (env) {
    for (const e of exts) scope.push(`config/${env}.config${e}`);
    for (const e of exts) scope.push(`${env}.config${e}`);
  }
  for (const e of exts) scope.push(`config/config${e}`);
  for (const e of exts) scope.push(`config${e}`);
  return scope;
}

let cached;

/**
 * Load the configuration file once (cached) via the standard `getConfig`, with all
 * `{ env }` references resolved from the CURRENT process.env. The caller is
 * responsible for having loaded the environment first (see {@link loadEnv}). A
 * missing config file yields `{}` (the typed wrapper then applies defaults).
 * @returns {Promise<Record<string, unknown>>}
 */
export async function loadConfiguration() {
  if (cached) return cached;
  const raw = await getConfig("./", configScope());
  // eslint-disable-next-line no-console
  console.log(`[config] Loaded configuration from ${raw?.fileName ?? "none"}`);
  cached = raw ?? {};
  return cached;
}
