/**
 * @module routes/report
 * @description Serves what the WEB host needs to build the attempt report (PDF).
 *
 * The report itself is produced in the browser by `shared/report/*` — the SAME markup
 * and pipeline the SCORM package runs, so both hosts hand the learner the same file.
 * What the browser cannot get by itself is the rasterizer + PDF writer
 * (`vendor/html2canvas.min.js`, `vendor/jspdf.umd.min.js`), which the package carries
 * inside its ZIP. They are served from the repo's vendored builds instead of being
 * added to the client bundle: the package must work offline in an LMS and therefore
 * vendors them anyway, so serving those exact files keeps ONE library version behind
 * both hosts — and they are ~560 KB the learner should only pay for when a report is
 * actually requested. Allowlisted by file name — never a caller-supplied path.
 *
 * The report's PICTURES are not here: since PRD-27 FR-05 the background and the logo
 * are files of the template, served by `GET /api/templates/:id/assets/*`.
 */
import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import { readAsset } from "../scorm/assets/read-asset";
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

export default router;
