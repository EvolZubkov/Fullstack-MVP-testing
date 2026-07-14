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

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Resolve a debug-player browser asset in dev AND in the bundled production server.
 *
 * In dev this module lives at `server/scorm/debug-player/assets.ts`, so its sibling
 * `assets/<name>` is the source. In production the server is bundled into
 * `dist/index.cjs`, so `import.meta.url` collapses to `dist/` and that sibling path
 * does not exist — fall back to the build-copied `dist/scorm/debug-player/assets/`
 * (script/build.ts copies it), and finally to the source tree if the deploy ships it.
 * Mirrors the multi-path resolution of {@link module:scorm/assets/read-asset} so the
 * in-service player works wherever SCORM export already does.
 */
function assetPath(name: string): string {
  const candidates = [
    path.join(here, "assets", name),
    path.resolve(process.cwd(), "dist", "scorm", "debug-player", "assets", name),
    path.resolve(process.cwd(), "server", "scorm", "debug-player", "assets", name),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? candidates[1];
}

/** The SCORM 2004 RTE shim (browser JS) the player window hosts so the SCO finds `API_1484_11` (FR-06). */
export function readShimJs(): string {
  return fs.readFileSync(assetPath("shim.js"), "utf8");
}

/** The inspector COMPUTE layer (browser JS) exposing `window.TBInspector`; the player window renders its data as DS. */
export function readInspectorComputeJs(): string {
  return fs.readFileSync(assetPath("inspector-compute.js"), "utf8");
}
