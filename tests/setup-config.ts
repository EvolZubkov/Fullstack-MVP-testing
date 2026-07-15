/**
 * @module tests/setup-config
 *
 * Global vitest setup: populate the config singleton once per test file via
 * `initConfig()` (async — the DI model). Registered as a `beforeAll` so it runs
 * AFTER each file's `vi.hoisted`/top-level `process.env` assignments, so the
 * config resolves `{ env }` references from the env the test set. It deliberately
 * does NOT load any `.env` file — tests control the environment themselves.
 */
import { beforeAll } from "vitest";
import { initConfig } from "../server/config";

beforeAll(async () => {
  await initConfig();
});
