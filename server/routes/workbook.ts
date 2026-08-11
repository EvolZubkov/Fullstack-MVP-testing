/**
 * @module server/routes/workbook
 * @description Workbook-level Excel endpoints for the «Импорт» section (PRD-14
 * FR-15), mounted under /api/workbook. These complement the per-test workbook
 * routes ({@link module:server/routes/tests-workbook}) with the two operations
 * the section page needs before a target test is known:
 *
 * - POST /inspect — read an uploaded .xlsx and report which role sheets it holds
 *   («Вопросы»/«Шкалы»/«Показатели»/«Вклады вопросов»/«Оценка»/«Структура»/
 *   «Квоты») WITHOUT a testId, so the client can decide whether a «Целевой
 *   тест» is required (only test-scoped sheets need one). No writes.
 * - POST /import-new?dryRun= — create a NEW (sectionless, draft) test from a
 *   title and import the workbook into it. `dryRun` validates and counts the plan
 *   against an empty target without creating anything.
 * - GET /template — an empty 4-sheet workbook (headers only) plus a reference
 *   sheet, the download for the section's «Скачать шаблон».
 * - GET /docs/:doc — the beginner's guide to filling that template, as PDF. The
 *   artifact is pre-built by `npm run docs:pdf` into `docs/dist` and committed,
 *   so the running service ships it without needing Chrome at runtime.
 *
 * Questions-only files and existing-test imports are handled by the existing
 * /api/questions/import and /api/tests/:id/workbook/import routes; the client
 * branches by the inspect result.
 */
import { Router, Request, Response } from "express";
import ExcelJS from "exceljs";
import { existsSync } from "fs";
import fsp from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "../logger";
import {
  addAoaSheet,
  readWorkbookFromBuffer,
  sheetToObjects,
  workbookToBuffer,
} from "../utils/excel";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { respondWorkbookReadError, workbookUploadSingle } from "../middleware/upload";
import { importWorkbook } from "../services/workbook-import";
import { testSettingsService } from "../services/test-settings";
// The role-sheet names and the template itself live in one module, so /inspect
// and the download can never disagree about what a role sheet is called.
import {
  buildWorkbookTemplate,
  SHEET_QUESTIONS,
  SHEET_SCALES,
  SHEET_RESULT_VARS,
  SHEET_MEASUREMENTS,
  SHEET_STRUCTURE,
  SHEET_QUOTAS,
  SHEET_SCORING,
} from "../services/workbook-template";

const router = Router();

/** Synthetic target id for a new-test dry-run: every DB read returns empty. */
const DRYRUN_NEW_TEST_ID = "__workbook_new__";

/** Find a worksheet by role name (case-insensitive, trimmed). */
function findSheet(wb: ExcelJS.Workbook, name: string): ExcelJS.Worksheet | undefined {
  const target = name.trim().toLowerCase();
  return wb.worksheets.find((w) => (w.name ?? "").trim().toLowerCase() === target);
}

/** Data-row count of a sheet (objects below the header), 0 when absent. */
function rowCount(sheet: ExcelJS.Worksheet | undefined): number {
  return sheet ? sheetToObjects(sheet).length : 0;
}

// ─── POST /api/workbook/inspect ──────────────────────────────────────────────
// Report which role sheets the file holds so the client can decide whether a
// target test is required. No testId, no writes — the lightweight nav-level gate.
router.post(
  "/inspect",
  requirePermission("questions.importExport"),
  workbookUploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });

      const workbook = await readWorkbookFromBuffer(req.file.buffer);
      const questions = findSheet(workbook, SHEET_QUESTIONS);
      const scales = findSheet(workbook, SHEET_SCALES);
      const resultVars = findSheet(workbook, SHEET_RESULT_VARS);
      const measurements = findSheet(workbook, SHEET_MEASUREMENTS);
      const structure = findSheet(workbook, SHEET_STRUCTURE);
      const quotas = findSheet(workbook, SHEET_QUOTAS);
      const scoring = findSheet(workbook, SHEET_SCORING);

      const hasQuestions = !!questions;
      const hasScales = !!scales;
      const hasResultVariables = !!resultVars;
      const hasMeasurements = !!measurements;
      const hasStructure = !!structure;
      const hasQuotas = !!quotas;
      const hasScoring = !!scoring;
      // Test-scoped sheets need a target test; «Вопросы» alone goes to the bank.
      const requiresTest =
        hasScales || hasResultVariables || hasMeasurements || hasStructure || hasQuotas || hasScoring;

      res.json({
        sheets: workbook.worksheets.map((w) => w.name),
        hasQuestions,
        hasScales,
        hasResultVariables,
        hasMeasurements,
        hasStructure,
        hasQuotas,
        hasScoring,
        requiresTest,
        counts: {
          questions: rowCount(questions),
          scales: rowCount(scales),
          resultVariables: rowCount(resultVars),
          measurements: rowCount(measurements),
          structure: rowCount(structure),
          quotas: rowCount(quotas),
          scoring: rowCount(scoring),
        },
      });
    } catch (error) {
      logger.error("Workbook inspect error: " + (error as Error).message, "workbook");
      // The reason code separates "this is not an .xlsx at all" from "it is a
      // package we could not parse": the advice to the author differs (pick
      // another file vs re-save the book).
      if (respondWorkbookReadError(res, error)) return;
      res.status(400).json({ error: "Failed to read file" });
    }
  },
);

// ─── POST /api/workbook/import-new?dryRun=true ───────────────────────────────
// Create a new (sectionless, draft) test from a title and import the workbook
// into it. `dryRun` returns the plan against an empty target without writing.
router.post(
  "/import-new",
  requirePermission("tests.create"),
  workbookUploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });

      const title = String(req.body?.newTestTitle ?? "").trim();
      if (!title) return res.status(400).json({ error: "newTestTitle required" });

      const dryRun = String(req.query.dryRun ?? "").toLowerCase() === "true";
      const workbook = await readWorkbookFromBuffer(req.file.buffer);

      // FR-28: questions/topics created during import are owned by the importer;
      // under dryRun the actor still scopes topic-name matching for an accurate plan.
      const actor = req.currentUser
        ? { id: req.currentUser.id, roles: req.effectiveRoles ?? [] }
        : undefined;

      if (dryRun) {
        // Plan against an empty target — nothing is created, so the synthetic id
        // is never persisted; every test-scoped DB read resolves to empty.
        const result = await importWorkbook(DRYRUN_NEW_TEST_ID, workbook, { dryRun: true, actor });
        return res.json({ ...result, test: { id: null, title } });
      }

      // A workbook-imported test is a scoring shell: scales/variables/measurements
      // but no sections yet (the author adds structure in the editor afterwards).
      // FR-28/FR-36: the importer OWNS it — set the owner INSIDE the create INSERT
      // (atomic) so an imported test is never ownerless («Владелец» «—»). Use
      // req.currentUser.id (same as the import actor); requirePermission("tests.create")
      // guarantees it is non-null here.
      const importerId = req.currentUser?.id ?? req.session.userId ?? null;
      const test = await testSettingsService.create({
        test: { title, mode: "standard", status: "draft", ownerId: importerId },
        sections: [],
      });
      // Redundant safety net — the INSERT above already owns the row; kept idempotent.
      await storage.setTestOwner(test.id, importerId);

      const result = await importWorkbook(test.id, workbook, { dryRun: false, actor });
      res.status(201).json({ ...result, test: { id: test.id, title: test.title } });
    } catch (error) {
      logger.error("Workbook import-new error: " + (error as Error).message, "workbook");
      if (respondWorkbookReadError(res, error)) return;
      res.status(500).json({ error: "Failed to import workbook into a new test" });
    }
  },
);

// ─── GET /api/workbook/docs/:doc ─────────────────────────────────────────────
// Registered BEFORE /template only for readability — the paths do not collide.

/**
 * Import documents offered for download in the «Импорт» section, keyed by URL id.
 * PDFs are pre-generated by `npm run docs:pdf` into `docs/dist`.
 */
const DOC_DOWNLOADS: Record<string, { file: string; filename: string }> = {
  guide: {
    file: "import-workbook-guide.pdf",
    filename: "Как заполнить шаблон импорта.pdf",
  },
};

/**
 * Absolute path to a generated doc PDF. Tried at the process CWD first (dev and
 * repo-rooted deploys), then relative to this module — the `__dirname` fallback
 * covers a launch from another working directory.
 */
function resolveDocPath(file: string): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "docs", "dist", file),
    path.resolve(here, "..", "..", "docs", "dist", file),
  ];
  return candidates.find((p) => existsSync(p)) ?? null;
}

router.get(
  "/docs/:doc",
  requirePermission("questions.importExport"),
  async (req: Request, res: Response) => {
    try {
      const entry = DOC_DOWNLOADS[req.params.doc];
      if (!entry) return res.status(404).json({ error: "Unknown document" });
      const abs = resolveDocPath(entry.file);
      if (!abs) {
        return res.status(404).json({ error: "Документ не собран. Выполните `npm run docs:pdf`." });
      }
      const pdf = await fsp.readFile(abs);
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(entry.filename)}`,
      );
      res.setHeader("Cache-Control", "no-cache");
      res.send(pdf);
    } catch (error) {
      logger.error("Workbook doc download error: " + (error as Error).message, "workbook");
      res.status(500).json({ error: "Failed to read document" });
    }
  },
);

// ─── GET /api/workbook/template ──────────────────────────────────────────────
// Empty role sheets (headers only) + the per-column reference + a filled example.
router.get(
  "/template",
  requirePermission("questions.importExport"),
  async (_req: Request, res: Response) => {
    try {
      const wb = await buildWorkbookTemplate();
      const buffer = await workbookToBuffer(wb);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent("workbook_template.xlsx")}"`);
      res.send(buffer);
    } catch (error) {
      logger.error("Workbook template error: " + (error as Error).message, "workbook");
      res.status(500).json({ error: "Failed to build template" });
    }
  },
);

export default router;
