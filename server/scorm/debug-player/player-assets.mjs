/**
 * @module scorm/debug-player/player-assets
 * @description Single source of the debug-player BROWSER assets — the SCORM 2004
 * RTE shim (`assets/shim.js`), the inspector COMPUTE layer
 * (`assets/inspector-compute.js`, exposed as `window.TBInspector`) and the CLI
 * inspector RENDER (`assets/inspector.js`). Both the CLI player
 * (`scripts/scorm/scorm-player.mjs`) and the in-service debug player (PRD-18) draw from
 * these SAME bytes so the RTE behaviour and the inspector's correctness-critical
 * compute never drift between hosts (FR-13, R-1). The in-service player renders the
 * compute data as DS components instead of the CLI's HTML; the page chrome
 * (toolbar, package loader, mock bar) stays host-specific.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "assets");

const read = (name) => fs.readFileSync(path.join(ASSETS_DIR, name), "utf8");

/**
 * Read the shared browser assets for inlining into a player page's `<script>`.
 * `computeJs` MUST be inlined before `inspectorJs` (the render reads
 * `window.TBInspector`).
 * @returns {{ shimJs: string, computeJs: string, inspectorJs: string }}
 */
export function readDebugPlayerAssets() {
  return {
    shimJs: read("shim.js"),
    computeJs: read("inspector-compute.js"),
    inspectorJs: read("inspector.js"),
  };
}
