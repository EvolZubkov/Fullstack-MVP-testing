/**
 * @module scorm/debug-player/assets
 * @description Server-side reader of the shared debug-player browser assets — the
 * SAME `assets/*.js` the CLI player inlines via `player-assets.mjs`. Kept as a
 * tiny separate reader because the in-service player is TypeScript while the CLI
 * is a plain `.mjs`; both read the ONE source of the RTE shim, so the hosts never
 * drift (PRD-18 FR-13, R-1).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "assets");

/** The SCORM 2004 RTE shim (browser JS) the player window hosts so the SCO finds `API_1484_11` (FR-06). */
export function readShimJs(): string {
  return fs.readFileSync(path.join(ASSETS_DIR, "shim.js"), "utf8");
}

/** The inspector COMPUTE layer (browser JS) exposing `window.TBInspector`; the player window renders its data as DS. */
export function readInspectorComputeJs(): string {
  return fs.readFileSync(path.join(ASSETS_DIR, "inspector-compute.js"), "utf8");
}
