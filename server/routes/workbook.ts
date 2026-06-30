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
  readWorkbookFromBuffer,
  sheetToObjects,
  workbookToBuffer,
} from "../utils/excel";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { memoryUpload } from "../middleware/upload";
import { importWorkbook } from "../services/workbook-import";
import { testSettingsService } from "../services/test-settings";
import { QUESTION_HEADERS, QUESTION_WIDTHS } from "../services/questions-export";
import {
  SCALE_HEADERS,
  SCALE_WIDTHS,
  RESULT_VAR_HEADERS,
  RESULT_VAR_WIDTHS,
  MEASUREMENT_HEADERS,
  MEASUREMENT_WIDTHS,
  STRUCTURE_HEADERS,
  STRUCTURE_WIDTHS,
  QUOTA_HEADERS,
  QUOTA_WIDTHS,
  SCORING_OVERRIDE_HEADERS,
  SCORING_OVERRIDE_WIDTHS,
} from "../utils/workbook-sheets";

const router = Router();

/** Canonical role-sheet names (must match the importer/exporter). */
const SHEET_QUESTIONS = "Вопросы";
const SHEET_SCALES = "Шкалы";
const SHEET_RESULT_VARS = "Показатели";
const SHEET_MEASUREMENTS = "Вклады вопросов";
const SHEET_STRUCTURE = "Структура";
const SHEET_QUOTAS = "Квоты";
const SHEET_SCORING = "Оценка";

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
  memoryUpload.single("file"),
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
  memoryUpload.single("file"),
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
      const test = await testSettingsService.create({
        test: { title, mode: "standard", status: "draft" },
        sections: [],
      });
      await storage.setTestOwner(test.id, req.session.userId ?? null);

      const result = await importWorkbook(test.id, workbook, { dryRun: false, actor });
      res.status(201).json({ ...result, test: { id: test.id, title: test.title } });
    } catch (error) {
      logger.error("Workbook import-new error: " + (error as Error).message, "workbook");
      res.status(500).json({ error: "Failed to import workbook into a new test" });
    }
  },
);

// ─── GET /api/workbook/template ──────────────────────────────────────────────
// Empty 4-sheet workbook (headers only) + a reference sheet.
router.get(
  "/template",
  requirePermission("questions.importExport"),
  async (_req: Request, res: Response) => {
    try {
      const wb = new ExcelJS.Workbook();
      // «Вопросы» and «Вклады вопросов» carry a leading «Ключ строки» (local
      // alias) so measurements can reference questions created in the same file.
      addAoaSheet(wb, SHEET_QUESTIONS, [["Ключ строки", ...QUESTION_HEADERS]], [12, ...QUESTION_WIDTHS]);
      addAoaSheet(wb, SHEET_STRUCTURE, [STRUCTURE_HEADERS], STRUCTURE_WIDTHS);
      addAoaSheet(wb, SHEET_QUOTAS, [QUOTA_HEADERS], QUOTA_WIDTHS);
      addAoaSheet(wb, SHEET_SCORING, [SCORING_OVERRIDE_HEADERS], SCORING_OVERRIDE_WIDTHS);
      addAoaSheet(wb, SHEET_SCALES, [SCALE_HEADERS], SCALE_WIDTHS);
      addAoaSheet(wb, SHEET_RESULT_VARS, [RESULT_VAR_HEADERS], RESULT_VAR_WIDTHS);
      addAoaSheet(wb, SHEET_MEASUREMENTS, [MEASUREMENT_HEADERS], MEASUREMENT_WIDTHS);

      const help: string[][] = [
        ["Лист", "Назначение"],
        [SHEET_QUESTIONS, "Банк вопросов (глобальный). Можно импортировать отдельным файлом — целевой тест не нужен"],
        [SHEET_STRUCTURE, "Разделы теста: тема, «Вопросов в выборке», порог (Тип/Порог), обязательность. Требует целевого теста"],
        [SHEET_QUOTAS, "Квоты выдачи по тегам (PRD-11): Раздел, Тег, Количество, Режим («Ровно»/«Не менее»). Σ количеств ≤ «Вопросов в выборке» раздела"],
        [SHEET_SCORING, "Оценка вопросов в этом тесте: Балл, Цена ответа, Сложность — переопределения теста. Пустая ячейка = переопределения нет. Требует целевого теста"],
        [SHEET_SCALES, "Шкалы теста. Требуют выбора целевого теста"],
        [SHEET_RESULT_VARS, "Показатели результата (формулы). Требуют выбора целевого теста"],
        [SHEET_MEASUREMENTS, "Вклады вопросов в шкалы. Требуют выбора целевого теста"],
        ["", ""],
        ["«Ключ строки»", "Локальный алиас вопроса в пределах файла; на него ссылаются листы «Вклады вопросов» и «Оценка»"],
        ["«Тип порога»", "«Сумма баллов» (порог в баллах) / «Процент» / «Нет» / «Как у теста». Для сертификации — «Сумма баллов»"],
        ["«Режим» квоты", "«Ровно» = ровно N вопросов с тегом; «Не менее» = не менее N (остаток добирается случайно)"],
        ["«Цена ответа»", "Грамматика PRD-10: пусто = нет переопределения; «точное» = точное совпадение; «веса: …» / «ступени: …» — частичный зачёт"],
        ["Поток", "Структура импортируется с режимом «со страницей-маршрутизатором» (router_by_topics)"],
        ["Порядок импорта", "Вопросы → Шкалы → Вклады вопросов + Показатели → Оценка → Структура + Квоты"],
        ["Справка по колонкам", "См. лист «Справка» в шаблоне вопросов (Вопросы → Скачать шаблон)"],
      ];
      addAoaSheet(wb, "Справка", help, [22, 96]);

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
