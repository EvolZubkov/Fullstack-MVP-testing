/**
 * @module routes/debug-player
 * @description PRD-18 — the in-service debug-player API. Builds the test's SCORM
 * package from LIVE state (D-4) with telemetry OFF (FR-02/08) and serves it
 * VERBATIM same-origin under a one-time token (R-7). The SCORM 2004 RTE shim is
 * NOT injected into the package: the player window loads it via `GET .../shim.js`
 * into ITS OWN window, and the SCO discovers `API_1484_11` by walking up to the
 * parent window (FR-06) — the same discovery a real LMS frame relies on, so the
 * inspector can read the live `window.__scorm` traffic in the player window. Runs
 * are throwaway: no `attempts`, no telemetry (R-2). Gated by the SAME edit-scope
 * as SCORM export (D-2 / FR-01), but by its OWN capability `tests.debug.play`, so
 * an author who may not generate an LMS package still debugs their own test.
 *
 * The run itself — build, unpack, serve, drop — lives in
 * {@link module:server/scorm/debug-player/run-session}, shared with the PRD-52
 * reviewer window. The two differ only in who is let in and what the inspector
 * shows; the run must stay identical, or an argument about a test's content turns
 * into an argument about who saw what.
 */
import { Router } from "express";
import { requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { openRunSession, servePackageFile, closeRunSession } from "../scorm/debug-player/run-session";
import { readShimJs, readInspectorComputeJs } from "../scorm/debug-player/assets";

const router = Router();

// Same SCOPE as SCORM export — edit-scope of the test (D-2, FR-01) — under the
// dedicated `tests.debug.play` capability (SCORM generation is developer-only).
const gate = [requirePermission("tests.debug.play"), requireTestScope("edit")];

// GET /api/tests/:id/debug/shim.js — the SCORM 2004 RTE shim the player window
// hosts in its OWN window (FR-06). The SCO inside the iframe finds `API_1484_11`
// by walking up to this parent window, so the inspector can read `window.__scorm`.
router.get("/:id/debug/shim.js", ...gate, (_req, res) => {
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.send(readShimJs());
});

// GET /api/tests/:id/debug/inspector-compute.js — the inspector COMPUTE layer
// (window.TBInspector) the player window loads; React renders its data as DS.
router.get("/:id/debug/inspector-compute.js", ...gate, (_req, res) => {
  res.setHeader("Content-Type", "text/javascript; charset=utf-8");
  res.send(readInspectorComputeJs());
});

// POST /api/tests/:id/debug/session — build a throwaway package and open a session.
router.post("/:id/debug/session", ...gate, (req, res) => openRunSession(req, res, "debug"));

// GET /api/tests/:id/debug/play/:token[/*] — serve the package files same-origin.
// The splat is an OPTIONAL group so a bare session URL (no path) serves the launch.
router.get("/:id/debug/play/:token{/*splat}", ...gate, servePackageFile);

// DELETE /api/tests/:id/debug/session/:token — drop a run.
router.delete("/:id/debug/session/:token", ...gate, closeRunSession);

export default router;
