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
 * `CONFIG_FILE` overrides the search with an explicit path — and in the BUILT
 * server it is the ONLY way to select a non-production file, because the bundle
 * has NODE_ENV folded to "production" at build time (see {@link nodeEnv}).
 *
 * Authored as ESM (`.mjs`) because `@vvlad1973/utils` is an ES module. It is
 * bundled into the server for the app, imported directly by ESM tools, and
 * dynamically imported (`await import`) by the CommonJS deploy runner
 * (script/run-sql.cjs runs on Node 20, which cannot `require` ESM). It lives next
 * to server/config.ts (its typed wrapper); `config/` holds only config DATA — in
 * a container that directory is a read-only VOLUME, not part of the image, so the
 * files this loader reads are the host's (see docker/README.md).
 *
 * `loadConfiguration()` is async by design (getConfig awaits file I/O) — the app
 * awaits it once at startup and passes the result to `initConfig()`.
 */

import { config as loadDotenv } from "dotenv";
import { getConfig } from "@vvlad1973/utils";
import fs from "node:fs";
import path from "node:path";

/**
 * The environment name used to select a config file.
 *
 * CAUTION — in the BUILT server this is always `"production"`, whatever the
 * container's NODE_ENV says: script/build.ts bundles with
 * `define: { "process.env.NODE_ENV": '"production"' }` so the compiled app always
 * behaves like production (static serving, strict crypto), and esbuild folds the
 * read into a literal (bracket access is folded too — there is no way to read the
 * real value here). Selection by NODE_ENV therefore works only when running from
 * source (tsx: dev, tests, CLI tools). A deployment picks its file with
 * `CONFIG_FILE` instead — that one IS read at runtime; compose sets it for every
 * instance (docker/templates/docker-compose.yml).
 * @returns {string|undefined} trimmed environment name, or undefined when unset.
 */
function nodeEnv() {
  return process.env.NODE_ENV?.trim();
}

/**
 * Load the environment file for the current NODE_ENV (`.env.<NODE_ENV>` then
 * `.env`) into process.env. Called explicitly by the app bootstrap and CLI tools
 * BEFORE loadConfiguration — NOT during config loading, so tests (which set
 * process.env themselves and never call this) stay isolated from any local .env.
 * @returns {string|null} the file loaded, or null if none exists.
 */
export function loadEnv() {
  const env = nodeEnv();
  const candidates = env ? [`.env.${env}`, ".env"] : [".env"];
  for (const rel of candidates) {
    const abs = path.resolve(process.cwd(), rel);
    if (fs.existsSync(abs)) {
      // dotenv reports a failure (EACCES on a mount owned by another user, EISDIR,
      // ...) in its RETURN VALUE, not by throwing. Ignoring it is how an unreadable
      // .env turns into "Loaded environment" followed by an app that dies on an
      // empty DATABASE_URL — say what actually happened instead.
      const { error } = loadDotenv({ path: abs, quiet: true });
      if (error) {
        // eslint-disable-next-line no-console
        console.error(
          `[config] FAILED to read ${rel} (${error.code ?? error.message}) — ` +
            "no variables were loaded from it; every { env } reference will resolve empty.",
        );
        return null;
      }
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

  const env = nodeEnv();
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
