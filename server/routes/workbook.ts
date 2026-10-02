/**
 * @module server/routes/workbook
 * @description Workbook-level Excel endpoints for the «Импорт» section (PRD-14
 * FR-15), mounted under /api/workbook. These complement the per-test workbook
 * routes ({@link module:server/routes/tests-workbook}) with the two operations
 * the section page needs before a target test is known:
 *
 * - POST /inspect — read an uploaded .xlsx (or a users-list .csv) and report
 *   its kind: an LMS report export (PRD-54), a users list, or a workbook with
 *   its role sheets («Вопросы»/«Шкалы»/«Показатели»/«Вклады вопросов»/«Оценка»/
 *   «Структура»/«Квоты») WITHOUT a testId, so the client can decide whether a
 *   «Целевой тест» is required (only test-scoped sheets need one). Open to any
 *   import right; a kind the caller may not import is refused with 403 (Э6).
 *   No writes.
 * - POST /import-new?dryRun= — create a NEW (sectionless, draft) test from a
 *   title and import the workbook into it. `dryRun` validates and counts the plan
 *   against an empty target without creating anything. The title comes from the
 *   FORM: the «Название» parameter of the book is ignored here (PRD-48 §4.1).
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
import { logger } from "../logger";
import {
  addAoaSheet,
  readTableFromBuffer,
  readWorkbookFromBuffer,
  sheetToObjects,
  workbookToBuffer,
} from "../utils/excel";
import { detectUsersList, isZipUpload } from "../utils/users-list";
import { storage } from "../storage";
import { requireAnyPermission, requirePermission } from "../middleware/auth";
import { canReadTestAnalytics } from "../services/test-access";
import {
  hasPermission,
  IMPORT_CAPABILITIES,
  IMPORT_KIND_CAPABILITY,
  type ImportKind,
} from "@shared/access";
import { respondWorkbookReadError, workbookUploadSingle } from "../middleware/upload";
import { DOC_NOT_BUILT_ERROR, findDoc, resolveDocPath, sendDocDownload } from "../services/doc-downloads";
import { importWorkbook } from "../services/workbook-import";
import { looksLikeLmsExport, parseLmsExport, type LmsExportBook } from "@shared/lms-export/parse";
import { resolveTestByQuestionIds } from "../services/lms-test-resolver";
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

/**
 * Лист как массив строк: `parseLmsExport` намеренно не знает про exceljs (PRD-54 раздел 10).
 *
 * ГОЧА ДАТ, найденная при прогоне на реальной выгрузке. Ячейки дат exceljs отдаёт объектами `Date`,
 * и голый `String(date)` даёт ЛОКАЛИЗОВАННУЮ строку вида
 * «Wed Sep 09 2026 16:39:00 GMT+0300 (Москва, стандартное время)». На машине разработчика она
 * разбирается обратно, на хосте с другой локалью — может и не разобраться, и тогда дата
 * прохождения молча станет Invalid Date. Поэтому дата приводится к ISO явно.
 *
 * @param sheet лист книги
 * @returns строки листа, значения приведены к строкам
 */
function sheetToMatrix(sheet: ExcelJS.Worksheet): string[][] {
  const out: string[][] = [];
  sheet.eachRow({ includeEmpty: true }, (row) => {
    const values = (row.values as unknown[]).slice(1);
    out.push(values.map((v) => {
      if (v === null || v === undefined) return "";
      if (v instanceof Date) return v.toISOString();
      return String(v);
    }));
  });
  return out;
}

/**
 * Опознать выгрузку отчёта LMS (PRD-54 раздел 6.1).
 *
 * Отпечаток однозначен и ни с одним книжным форматом не пересекается: четвёрка подписей
 * «Тип / Продолжительность (сек.) / Результат / Полученный ответ» во второй строке шапки плюс
 * хотя бы один блок с нашим префиксом (`q_`, `scale_`, `var_`) в первой.
 *
 * @param sheet лист-кандидат
 * @returns разобранная книга или `null`, если лист выгрузкой не является
 */
export function detectLmsExport(sheet: ExcelJS.Worksheet): LmsExportBook | null {
  const matrix = sheetToMatrix(sheet);
  return looksLikeLmsExport(matrix) ? parseLmsExport(matrix) : null;
}

/**
 * Отказ разбора по виду файла, на который у пользователя нет права (Э6, решение владельца
 * 2026-10-02: «без пояснений — просто отсутствие прав на выполнение операции»). `kind` в ответе
 * остаётся: клиенту он нужен, чтобы не предлагать форму этого вида, а пользователю не
 * показывается.
 */
export const IMPORT_DENIED_ERROR = "Недостаточно прав для выполнения операции";

/**
 * Разрешён ли пользователю вид файла; при отказе отвечает 403 сам.
 *
 * @returns `true`, если разбор можно продолжать
 */
function allowKind(req: Request, res: Response, kind: ImportKind): boolean {
  if (hasPermission(req.effectiveRoles ?? [], IMPORT_KIND_CAPABILITY[kind])) return true;
  res.status(403).json({ kind, error: IMPORT_DENIED_ERROR });
  return false;
}

// ─── POST /api/workbook/inspect ──────────────────────────────────────────────
// Report what the file is so the «Импорт» section can show the form of its kind. No testId, no
// writes. Open to ANY import right (Э6: «единая точка импорта»); a kind the caller has no right
// to is refused only after it is recognised, because the right depends on what the file is.
router.post(
  "/inspect",
  requireAnyPermission(IMPORT_CAPABILITIES),
  workbookUploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) return res.status(400).json({ error: "File required" });

      // .csv is a users list only — the other kinds are books, so a text file is read as one
      // sheet and must pass the users-list fingerprint below.
      const workbook = await readTableFromBuffer(req.file.buffer);

      // PRD-54: выгрузка отчёта LMS проверяется ПЕРВОЙ. Её отпечаток с ролевыми листами книги не
      // пересекается, но и искать в ней листы «Вопросы»/«Шкалы» бессмысленно — это другой формат,
      // и ответ у него другой формы.
      const lms = workbook.worksheets.map(detectLmsExport).find(Boolean) ?? null;
      if (lms) {
        if (!allowKind(req, res, "lmsExport")) return;
        const resolved = await resolveTestByQuestionIds(lms.questionIds, storage);
        const test = resolved.testId ? await storage.getTest(resolved.testId) : null;
        // Тест берётся из файла, поэтому и область проверяется здесь: менеджер, которому тест
        // не виден в аналитике, не узнаёт даже его названия.
        if (test && !(await canReadTestAnalytics(req.effectiveRoles!, req.currentUser!.id, test))) {
          return res.status(403).json({ kind: "lmsExport", error: IMPORT_DENIED_ERROR });
        }
        return res.json({
          kind: "lmsExport",
          sheets: workbook.worksheets.map((w) => w.name),
          testId: resolved.testId,
          testTitle: test?.title ?? null,
          foreignQuestionIds: resolved.foreign,
          rows: lms.rows.length,
          questionIds: lms.questionIds.length,
          scaleKeys: lms.scaleKeys,
          variableNames: lms.variableNames,
          unknownColumns: lms.unknownColumns,
        });
      }

      const usersRows = detectUsersList(workbook);
      if (usersRows !== null) {
        if (!allowKind(req, res, "users")) return;
        return res.json({
          kind: "users",
          sheets: workbook.worksheets.map((w) => w.name),
          rows: usersRows,
        });
      }

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

      // A CSV that is not a users list is not a book either: keep the "not an .xlsx" answer the
      // section has always given for it, rather than call it an empty book.
      if (!hasQuestions && !requiresTest && !isZipUpload(req.file.buffer)) {
        return res.status(400).json({ error: "Failed to read file", code: "not_a_zip" });
      }
      if (!allowKind(req, res, "workbook")) return;

      res.json({
        // PRD-54: клиент ветвится по ОДНОМУ полю, а не по набору признаков.
        kind: "workbook",
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
        const result = await importWorkbook(DRYRUN_NEW_TEST_ID, workbook, {
          dryRun: true,
          actor,
          keepTitle: true,
        });
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

      // PRD-48 §4.1: `keepTitle` — the title comes from the FORM the author has just
      // filled in; the book's «Название» is ignored here (silently, per the spec).
      // Without it the response said one name and the database held another.
      const result = await importWorkbook(test.id, workbook, {
        dryRun: false,
        actor,
        keepTitle: true,
      });
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
 * Section-local ids of the import documents, mapped to the shared registry
 * (`server/services/doc-downloads`). The short `guide` URL is kept: the button
 * on the «Импорт» empty state links to it.
 */
const SECTION_DOCS: Record<string, string> = {
  guide: "import-workbook",
};

router.get(
  "/docs/:doc",
  requirePermission("questions.importExport"),
  async (req: Request, res: Response) => {
    try {
      const doc = findDoc(SECTION_DOCS[req.params.doc] ?? "");
      if (!doc) return res.status(404).json({ error: "Unknown document" });
      const abs = resolveDocPath(doc.file);
      if (!abs) return res.status(404).json({ error: DOC_NOT_BUILT_ERROR });
      await sendDocDownload(res, doc, abs);
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
