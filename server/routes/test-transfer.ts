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
import {
  inspectParsedPackage,
  readTransferPackage,
  type InspectPorts,
} from "../services/test-transfer/inspect";
import {
  createTransferSession,
  dropTransferSession,
  getTransferSession,
} from "../services/test-transfer/session-store";
import { buildTargetSnapshot } from "../services/test-transfer/target";
import { diffTransfer, type TransferOptions } from "../services/test-transfer/diff";
import { applyTransfer, TransferForbiddenError } from "../services/test-transfer/apply";
import { canManageTopicContent } from "../services/topic-access";

const router = Router();

/**
 * Binds the inventory to THIS actor.
 *
 * Topic rights come from the ordinary `topic-access` rule — the same one the questions API
 * obeys — so the form cannot offer a policy that `apply` will refuse.
 */
function inspectPortsFor(req: Request): InspectPorts {
  const roles = req.effectiveRoles ?? [];
  const userId = req.currentUser?.id ?? "";
  return {
    testExists: async (id) => Boolean(await storage.getTest(id)),
    existingTopics: async (ids) => {
      const found = [];
      for (const id of ids) {
        const topic = await storage.getTopic(id);
        if (topic) found.push(topic);
      }
      return found;
    },
    canManageTopic: (topic) => canManageTopicContent(roles, userId, topic),
  };
}

/** The options as the form sends them, with the safe defaults of PRD-48 §3. */
function readOptions(body: unknown): TransferOptions {
  const raw = (body ?? {}) as Partial<TransferOptions> & { parts?: Partial<TransferOptions["parts"]> };
  return {
    parts: {
      structure: raw.parts?.structure ?? true,
      scoring: raw.parts?.scoring ?? true,
      scales: raw.parts?.scales ?? true,
      results: raw.parts?.results ?? true,
      media: raw.parts?.media ?? true,
    },
    // Upsert is the default everywhere: the mode that cannot erase is the one chosen for you.
    modes: {
      scoring: raw.modes?.scoring === "replace" ? "replace" : "upsert",
      scales: raw.modes?.scales === "replace" ? "replace" : "upsert",
    },
    topics: raw.topics ?? {},
  };
}

/** Answers the session-store's three outcomes; `null` means the handler already replied. */
function requireSession(req: Request, res: Response) {
  const token = String((req.body as { token?: unknown })?.token ?? "");
  const userId = req.session.userId ?? "";
  const session = getTransferSession(token, userId);
  if (session === "expired") {
    res.status(410).json({ error: "Загруженный пакет устарел, загрузите файл заново" });
    return null;
  }
  if (!session) {
    res.status(404).json({ error: "Пакет не найден: загрузите файл заново" });
    return null;
  }
  return session;
}

/** One place turning a package failure into an answer, so the three steps agree. */
function packageError(error: unknown, res: Response): boolean {
  if (error instanceof InvalidPackageError || error instanceof UnsupportedPackageError) {
    res.status(422).json({ error: error.message });
    return true;
  }
  if (error instanceof TransferForbiddenError) {
    res.status(403).json({ error: error.message, topicId: error.topicId });
    return true;
  }
  return false;
}

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

// ─── POST /api/tests/transfer/inspect ────────────────────────────────────────
//
// Step one: read the package, write NOTHING, and keep it under a one-time token so the plan
// and the application that follow come from the SAME bytes.
router.post(
  "/transfer/inspect",
  requirePermission("tests.create"),
  transferUploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });

      const { pkg } = await readTransferPackage(req.file.buffer);
      const summary = await inspectParsedPackage(pkg, inspectPortsFor(req));
      const token = createTransferSession(userId, req.file.buffer, pkg);

      res.json({ token, summary });
    } catch (error) {
      if (packageError(error, res)) return;
      logger.error("Transfer inspect error: " + (error as Error).message, "test-transfer");
      res.status(500).json({ error: "Failed to read transfer package" });
    }
  },
);

// ─── POST /api/tests/transfer/plan ───────────────────────────────────────────
//
// Step two: what the chosen options WOULD do. Recomputed on every change of an option — the
// list of deletions depends on the mode, and a plan the author has not seen must never run.
router.post(
  "/transfer/plan",
  requirePermission("tests.create"),
  async (req: Request, res: Response) => {
    try {
      const session = requireSession(req, res);
      if (!session) return;

      const options = readOptions(req.body);
      const target = await buildTargetSnapshot(session.pkg, { ownerId: session.userId });
      const operations = diffTransfer(session.pkg, target, options);

      res.json({
        operations,
        summary: await inspectParsedPackage(session.pkg, inspectPortsFor(req)),
      });
    } catch (error) {
      if (packageError(error, res)) return;
      logger.error("Transfer plan error: " + (error as Error).message, "test-transfer");
      res.status(500).json({ error: "Failed to plan transfer import" });
    }
  },
);

// ─── POST /api/tests/transfer/apply ──────────────────────────────────────────
//
// Step three. The plan is recomputed inside `applyTransfer` from the package and a freshly
// read target: what the client sends is the author's CHOICE, never the list of writes.
router.post(
  "/transfer/apply",
  requirePermission("tests.create"),
  async (req: Request, res: Response) => {
    try {
      const session = requireSession(req, res);
      if (!session) return;

      const roles = req.effectiveRoles ?? [];
      const userId = session.userId;
      const options = readOptions(req.body);
      const target = await buildTargetSnapshot(session.pkg, { ownerId: userId });

      const report = await applyTransfer({
        archive: session.archive,
        pkg: session.pkg,
        target,
        options,
        ownerId: userId,
        canManageTopic: async (topicId) => {
          const topic = await storage.getTopic(topicId);
          return topic ? canManageTopicContent(roles, userId, topic) : false;
        },
      });

      // The upload has done its work; holding it longer only keeps bytes in memory.
      dropTransferSession(String((req.body as { token?: unknown })?.token ?? ""), userId);

      logger.info(
        `Transfer applied: test=${report.testId} created=${JSON.stringify(report.created)} ` +
          `updated=${JSON.stringify(report.updated)} deleted=${JSON.stringify(report.deleted)} by user=${userId}`,
        "test-transfer",
      );
      res.status(200).json(report);
    } catch (error) {
      if (packageError(error, res)) return;
      logger.error("Transfer apply error: " + (error as Error).message, "test-transfer");
      res.status(500).json({ error: "Failed to apply transfer import" });
    }
  },
);

export default router;
