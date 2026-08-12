/**
 * @module server/routes/test-transfer
 *
 * The `.tbtest` transfer API: carrying a test between installations without losses.
 *
 * Separate from `tests-workbook` on purpose. The workbook is an AUTHORING format — a human
 * edits it, and it deliberately expresses only what a human edits. The package is a
 * MACHINE format: it carries the test whole, appearance and result texts included, and is
 * never meant to be opened by hand. Mixing the two is what produced the losses this exists
 * to end (`docs/plans/2026-08-11-test-transfer-without-losses.md`).
 *
 * Rights match the WORKBOOK export (`tests.read` + read scope), not the SCORM export. The
 * package discloses nothing the workbook does not already disclose to the same reader, and
 * requiring the developer-only `tests.export.scorm` would deny an author the ability to move
 * their own test. This departs from the plan, which named the SCORM scope before that
 * comparison was made.
 */
import { Router, type Request, type Response } from "express";
import { requirePermission } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { transferUploadSingle } from "../middleware/upload";
import { logger } from "../logger";
import { storage } from "../storage";
import { buildTransferZip, TransferExportError } from "../services/test-transfer/export";
import {
  importTestPackage,
  InvalidPackageError,
  UnsupportedPackageError,
} from "../services/test-transfer/import";

const router = Router();

// ─── GET /api/tests/:id/transfer ─────────────────────────────────────────────
router.get(
  "/:id/transfer",
  requirePermission("tests.read"),
  requireTestScope("read"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.id;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Test not found" });

      const { buffer, pkg } = await buildTransferZip(testId);

      // A picture that could not be read is reported in the manifest AND in the log: a
      // loss nobody hears about is how the workbook's losses stayed invisible.
      if (pkg.missingMedia.length) {
        logger.warn(
          `Transfer export: ${pkg.missingMedia.length} media address(es) unresolved for test ${testId}: ${pkg.missingMedia.join(", ")}`,
          "test-transfer",
        );
      }

      const safeTitle =
        test.title.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") ||
        "test";
      const filename = `${safeTitle}.tbtest`;

      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(buffer);

      logger.info(
        `Transfer package exported: test="${test.title}" (${testId}) media=${pkg.media.length} by user=${req.session.userId}`,
        "test-transfer",
      );
    } catch (error) {
      if (error instanceof TransferExportError) {
        return res.status(error.status).json({ error: error.message });
      }
      logger.error("Transfer export error: " + (error as Error).message, "test-transfer");
      res.status(500).json({ error: "Failed to export transfer package" });
    }
  },
);

// ─── POST /api/tests/transfer ────────────────────────────────────────────────
//
// Creates a NEW test, so the right is `tests.create` — the same one the editor's «создать
// тест» needs. There is no object scope to check: nothing exists yet to be scoped.
router.post(
  "/transfer",
  requirePermission("tests.create"),
  transferUploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });
      const ownerId = req.session.userId;
      if (!ownerId) return res.status(401).json({ error: "Unauthorized" });

      const report = await importTestPackage(req.file.buffer, { ownerId });

      logger.info(
        `Transfer package imported: test="${report.title}" (${report.testId}) ` +
          `media=+${report.mediaCreated}/reused ${report.mediaReused} by user=${ownerId}`,
        "test-transfer",
      );
      // Renames and inherited losses are ANSWERED, not just logged: the author has to learn
      // about them at the moment of import, not when a learner meets a broken picture.
      if (report.renamedTopics.length) {
        logger.warn(`Transfer import renamed topics: ${report.renamedTopics.join("; ")}`, "test-transfer");
      }

      res.status(201).json(report);
    } catch (error) {
      if (error instanceof InvalidPackageError || error instanceof UnsupportedPackageError) {
        return res.status(422).json({ error: error.message });
      }
      logger.error("Transfer import error: " + (error as Error).message, "test-transfer");
      res.status(500).json({ error: "Failed to import transfer package" });
    }
  },
);

export default router;
