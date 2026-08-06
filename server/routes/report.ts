/**
 * @module routes/report
 * @description Serves what the WEB host needs to build the attempt report (PDF).
 *
 * The report itself is produced in the browser by `shared/report/*` — the SAME markup
 * and pipeline the SCORM package runs, so both hosts hand the learner the same file.
 * What the browser cannot get by itself are the two ingredients the package carries
 * inside its ZIP:
 *
 *  - the rasterizer + PDF writer (`vendor/html2canvas.min.js`, `vendor/jspdf.umd.min.js`).
 *    Served from the repo's vendored builds instead of being added to the client bundle:
 *    the package must work offline in an LMS and therefore vendors them anyway, and
 *    serving those exact files keeps ONE library version behind both hosts. They are
 *    also ~560 KB the learner should only pay for when a report is actually requested.
 *  - the report's background plates and brand logo (`assets/media/*.png`).
 *
 * Both are static and allowlisted by file name — never a caller-supplied path.
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { readAsset, readBinaryAsset } from "../scorm/assets/read-asset";
import { REPORT_BACKGROUND_FILES, REPORT_LOGO_FILE } from "@shared/report/export-pdf";
import { logger } from "../logger";

const router = Router();

// Nothing here is user data, but only a signed-in learner ever needs it — a session
// gate keeps these from becoming an open CDN for the vendored libraries.
router.use(requireAuth);

/** Vendored browser libraries the report pipeline needs, by request name. */
const LIBS: Record<string, string> = {
  "html2canvas.min.js": "vendor/html2canvas.min.js",
  "jspdf.umd.min.js": "vendor/jspdf.umd.min.js",
};

/** Image assets of the report page, by request name (the shared module names them). */
const ASSETS = new Set<string>([...REPORT_BACKGROUND_FILES, REPORT_LOGO_FILE]);

// A year: these are immutable build artefacts, and the learner pays for them once.
const IMMUTABLE = "public, max-age=31536000, immutable";

// GET /api/report/lib/:file — a vendored library (the same build the package ships).
router.get("/lib/:file", (req, res) => {
  const rel = LIBS[req.params.file];
  if (!rel) return res.status(404).json({ error: "Unknown report library" });
  try {
    res.setHeader("Content-Type", "text/javascript; charset=utf-8");
    res.setHeader("Cache-Control", IMMUTABLE);
    return res.send(readAsset(rel));
  } catch (error) {
    logger.error("Report lib read error: " + (error as Error).message);
    return res.status(500).json({ error: "Failed to read report library" });
  }
});

// GET /api/report/asset/:file — a report background plate or the brand logo.
router.get("/asset/:file", (req, res) => {
  const name = req.params.file;
  if (!ASSETS.has(name)) return res.status(404).json({ error: "Unknown report asset" });
  const bytes = readBinaryAsset("media/" + name);
  // A deploy without the plates is not an error: the report falls back to its gradient
  // background and drops the logo row (see shared/report/report-html).
  if (!bytes) return res.status(404).json({ error: "Report asset not available" });
  res.setHeader("Content-Type", "image/png");
  res.setHeader("Cache-Control", IMMUTABLE);
  return res.send(bytes);
});

export default router;
