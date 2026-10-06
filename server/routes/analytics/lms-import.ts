/**
 * @module server/routes/analytics/lms-import
 * @description Загрузка выгрузки отчёта LMS и партии импорта (PRD-54 раздел 9).
 *
 * Область доступа проверяется ВНУТРИ обработчика, а не мидлварью `requireTestScope`: тест
 * становится известен только после разбора файла, и повесить проверку заранее не на что —
 * в маршруте его идентификатора нет и быть не может.
 */
import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { config } from "../../config";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { respondWorkbookReadError, workbookUploadSingle } from "../../middleware/upload";
import { readWorkbookFromBuffer } from "../../utils/excel";
import { canReadTestAnalytics } from "../../services/test-access";
import { detectLmsExport, IMPORT_DENIED_ERROR } from "../workbook";
import { chooseTest, resolveTestByQuestionIds, type TestChoice } from "../../services/lms-test-resolver";
import { runImport } from "../../services/lms-export-import";

const router = Router();

/** Отказ сверки теста — по причине. */
const CHOICE_ERRORS: Record<Extract<TestChoice, { ok: false }>["reason"], string> = {
  none: "Не удалось определить тест по вопросам из файла.",
  ambiguous: "Вопросы файла стоят в нескольких тестах — выберите, в какой загрузить.",
  "not-candidate": "Выбранный тест не содержит вопросов из файла.",
};

/** Флажок из multipart-формы: там всё приезжает строками. */
function flag(value: unknown): boolean {
  return value === true || value === "true";
}

/**
 * Общий путь загрузки: разобрать, определить тест, свериться с областью доступа, прогнать импорт.
 *
 * Сухой прогон и запись идут ОДНИМ обработчиком: разведи их по двум — и план начнёт расходиться с
 * тем, что импорт делает на самом деле.
 *
 * @param req запрос с файлом и параметрами формы
 * @param res ответ
 * @param dryRun считать, но не писать
 */
async function handleUpload(req: Request, res: Response, dryRun: boolean) {
  if (!req.file) return res.status(400).json({ error: "Файл обязателен" });

  const workbook = await readWorkbookFromBuffer(req.file.buffer);
  const book = workbook.worksheets.map(detectLmsExport).find(Boolean) ?? null;
  if (!book) return res.status(422).json({ error: "Файл не похож на выгрузку отчёта LMS." });

  // Тест определяет ФАЙЛ, а не страница, с которой пришли (Э6, 2026-10-02): выгрузка другого теста
  // ложится в свой тест, а не отвергается. Человек выбирает только тогда, когда вопросы файла стоят
  // в нескольких тестах, и только из них (2026-10-06).
  const resolved = await resolveTestByQuestionIds(book.questionIds, storage);
  const choice = chooseTest(resolved, req.body?.testId ? String(req.body.testId) : null);
  if (!choice.ok) {
    return res.status(422).json({
      error: CHOICE_ERRORS[choice.reason],
      foreignQuestionIds: resolved.foreign,
    });
  }

  const test = await storage.getTest(choice.testId);
  if (!test) return res.status(404).json({ error: "Тест не найден" });
  if (!(await canReadTestAnalytics(req.effectiveRoles!, req.currentUser!.id, test))) {
    return res.status(403).json({ error: IMPORT_DENIED_ERROR });
  }

  // Новая группа заводится ДО импорта: строки должны лечь уже с меткой, иначе при отказе на
  // полпути часть партии осталась бы без группы. При сухом прогоне не заводится ничего.
  let groupId: string | null = String(req.body?.groupId ?? "").trim() || null;
  const newGroupName = String(req.body?.newGroupName ?? "").trim();
  if (!groupId && newGroupName && !dryRun) {
    const group = await storage.createGroup({ name: newGroupName, createdBy: req.currentUser!.id });
    groupId = group.id;
  }

  const result = await runImport(
    book,
    {
      anonymize: config.analytics.lmsImport.anonymizeParticipants,
      linkUsers: flag(req.body?.linkUsers),
    },
    {
      testId: choice.testId,
      groupId,
      fileName: req.file.originalname,
      fileBuffer: req.file.buffer,
      userId: req.currentUser!.id,
      dryRun,
    },
    storage,
  );

  res.json({ testId: choice.testId, testTitle: test.title, ...result });
}

// POST /api/analytics/lms-import?dryRun=true — план импорта либо сам импорт
router.post(
  "/lms-import",
  requirePermission("analytics.import"),
  workbookUploadSingle("file"),
  async (req: Request, res: Response) => {
    try {
      await handleUpload(req, res, String(req.query.dryRun ?? "").toLowerCase() === "true");
    } catch (error) {
      logger.error("LMS import error: " + (error as Error).message, "analytics");
      if (respondWorkbookReadError(res, error)) return;
      res.status(400).json({ error: "Не удалось прочитать файл" });
    }
  },
);

// GET /api/analytics/lms-import/batches/:testId — партии теста
router.get(
  "/lms-import/batches/:testId",
  requirePermission("analytics.import"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      res.json(await storage.getLmsImportBatches(req.params.testId));
    } catch (error) {
      logger.error("LMS batches error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось получить список загрузок" });
    }
  },
);

// Переключателя «В расчётах» (PRD-66 FR-12) больше нет — снят владельцем 2026-10-02 («повышаем
// цену ошибки»): сомнительную выгрузку откатывают целиком и загружают заново, а не держат в базе
// невидимой для расчётов.

// DELETE /api/analytics/lms-import/batches/:id — откат партии целиком
router.delete(
  "/lms-import/batches/:id",
  requirePermission("analytics.import"),
  async (req: Request, res: Response) => {
    try {
      // Область берётся от ТЕСТА партии: идентификатор в маршруте — партия, а не тест, поэтому
      // мидлварь здесь не годится.
      const batches = await storage.getLmsImportBatchById(req.params.id);
      if (!batches) return res.status(404).json({ error: "Загрузка не найдена" });
      const test = await storage.getTest(batches.testId);
      if (!test) return res.status(404).json({ error: "Тест не найден" });
      if (!(await canReadTestAnalytics(req.effectiveRoles!, req.currentUser!.id, test))) {
        return res.status(403).json({ error: "Forbidden" });
      }

      await storage.deleteLmsImportBatch(req.params.id);
      // PRD-55 FR-08: откат вычитает вклад партии в экспозицию — тем же пересчётом среза теста,
      // которым загрузка его внесла.
      await storage.rebuildImportExposure(batches.testId);
      res.json({ ok: true });
    } catch (error) {
      logger.error("LMS batch delete error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось откатить загрузку" });
    }
  },
);

export default router;
