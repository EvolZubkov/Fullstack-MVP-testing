/**
 * @module server/routes/docs
 *
 * `GET /api/docs/:doc` — the consolidated download endpoint for the service's
 * documentation PDFs, backing the «Материалы» block on the home page.
 *
 * Access is decided PER DOCUMENT, not per route: the required capability lives
 * in the registry ({@link module:server/services/doc-downloads}) next to the file
 * name, so the list the home page shows and the check this route performs can
 * never drift apart. A user who asks for a document outside their rights gets
 * 403 — the same answer they would get from the section-local routes.
 *
 * The older section-local routes (`/api/admin/templates/docs/:doc` in «Шаблоны»
 * and `/api/workbook/docs/:doc` in «Импорт») keep working and now read the same
 * registry; they exist because those buttons sit inside their own sections.
 */
import { Router } from "express";
import { requireUserContext } from "../middleware/auth";
import { hasPermission } from "@shared/access";
import { DOC_NOT_BUILT_ERROR, findDoc, resolveDocPath, sendDocDownload } from "../services/doc-downloads";
import { logger } from "../logger";

const router = Router();

/**
 * GET /api/docs/:doc — download a documentation PDF by its registry id.
 *
 * 404 for an unknown id or a missing artifact, 403 when the caller lacks the
 * document's capability.
 */
router.get("/:doc", requireUserContext, async (req, res) => {
  try {
    const doc = findDoc(req.params.doc);
    if (!doc) return res.status(404).json({ error: "Unknown document" });
    if (!hasPermission(req.effectiveRoles ?? [], doc.capability)) {
      return res.status(403).json({ error: "Forbidden" });
    }
    const abs = resolveDocPath(doc.file);
    if (!abs) return res.status(404).json({ error: DOC_NOT_BUILT_ERROR });
    await sendDocDownload(res, doc, abs);
  } catch (error) {
    logger.error("Doc download error: " + (error as Error).message, "docs");
    res.status(500).json({ error: "Failed to read document" });
  }
});

export default router;
