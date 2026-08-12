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
 * an author who may not generate an LMS package still debugs their own test. The
 * browser UI (toolbar + status panel + iframe + inspector) is the Phase-4 client.
 */
import { Router } from "express";
import path from "node:path";
import { requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { buildScormExportData, ScormBuildError } from "../scorm/build-export-data";
import { generateScormPackage } from "../scorm-exporter";
import { createDebugSession, getDebugSession, dropDebugSession } from "../scorm/debug-player/session-store";
import { readShimJs, readInspectorComputeJs } from "../scorm/debug-player/assets";
import { logger } from "../logger";

const router = Router();

// Same SCOPE as SCORM export — edit-scope of the test (D-2, FR-01) — under the
// dedicated `tests.debug.play` capability (SCORM generation is developer-only).
const gate = [requirePermission("tests.debug.play"), requireTestScope("edit")];

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".pdf": "application/pdf",
};

function contentTypeFor(p: string): string {
  return CONTENT_TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";
}

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
router.post("/:id/debug/session", ...gate, async (req, res) => {
  try {
    const data = await buildScormExportData(req.params.id, { source: "debug" });
    const buffer = await generateScormPackage({ ...data, telemetry: null });
    const { token, launch } = await createDebugSession(req.params.id, req.session.userId!, buffer);
    logger.info(`Debug session opened: test=${req.params.id} token=${token} by user=${req.session.userId}`, "debug-player");
    // playUrl points straight at the launch file so the iframe requests a concrete
    // path (matches the CLI player); the empty-splat fallback below still serves it.
    res.json({
      token,
      launch,
      playUrl: `/api/tests/${req.params.id}/debug/play/${token}/${launch}`,
      title: data.test.title,
      template: data.designSettings?.templateId,
    });
  } catch (error) {
    if (error instanceof ScormBuildError) {
      return res
        .status(error.status)
        .json(error.field ? { error: error.message, field: error.field } : { error: error.message });
    }
    logger.error("Debug session error: " + (error as Error).message, "debug-player");
    res.status(500).json({ error: "Failed to build debug session" });
  }
});

// GET /api/tests/:id/debug/play/:token[/*] — serve the package files same-origin.
// The splat is an OPTIONAL group so a bare session URL (no path) serves the launch.
router.get("/:id/debug/play/:token{/*splat}", ...gate, (req, res) => {
  const session = getDebugSession(req.params.token, req.session.userId!);
  if (session === "expired") return res.status(410).send("Debug session expired");
  if (!session) return res.status(404).send("Unknown debug session token");

  const splat = (req.params as Record<string, unknown>).splat;
  const rel = decodeURIComponent(Array.isArray(splat) ? splat.join("/") : String(splat || "")) || session.launch;

  const buf = session.files.get(rel);
  if (!buf) return res.status(404).send("Not found in package: " + rel);

  // Served verbatim — the shim is hosted by the player window, not injected here.
  res.setHeader("Content-Type", contentTypeFor(rel));
  res.send(buf);
});

// DELETE /api/tests/:id/debug/session/:token — drop a run.
router.delete("/:id/debug/session/:token", ...gate, (req, res) => {
  res.json({ dropped: dropDebugSession(req.params.token, req.session.userId!) });
});

export default router;
