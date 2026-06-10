import { Router, Request, Response } from "express";
import { logger } from "../logger";
import ExcelJS from "exceljs";
import {
  addAoaSheet,
  addJsonSheet,
  readWorkbookFromBuffer,
  sheetHeaders,
  sheetToObjects,
  workbookToBuffer,
} from "../utils/excel";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { memoryUpload, rejectBase64MediaUrl } from "../middleware/upload";
import { questionScoringSchema, type QuestionScoring } from "@shared/schema";
import { normalizeTags } from "@shared/tags";
import { importQuestionRows } from "../services/questions-import";
import { serializeQuestionRow, QUESTION_WIDTHS } from "../services/questions-export";

// PRD-10: validate the optional graded-scoring config (FR-13). Null/undefined =
// exact match (default); a present config must satisfy questionScoringSchema.
function validateScoring(
  scoringJson: unknown,
  res: Response,
): scoringJson is QuestionScoring | null | undefined {
  if (scoringJson == null) return true;
  const parsed = questionScoringSchema.safeParse(scoringJson);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid scoring config", details: parsed.error.flatten() });
    return false;
  }
  return true;
}

const router = Router();

// ============================================
// Типы
// ============================================

interface IdParams {
  id: string;
}

interface TopicIdParams {
  topicId: string;
}

interface CreateQuestionBody {
  topicId: string;
  type: "single" | "multiple" | "matching" | "ranking";
  prompt: string;
  dataJson: unknown;
  correctJson: unknown;
  points?: number;
  difficulty?: number;
  mediaUrl?: string;
  mediaType?: "image" | "audio" | "video" | null;
  shuffleAnswers?: boolean;
  feedback?: string;
  feedbackMode?: "general" | "conditional";
  feedbackCorrect?: string;
  feedbackIncorrect?: string;
  scoringJson?: QuestionScoring | null;
  /** PRD-11 §3a: sub-topic tags; normalized on save (trim/collapse, dedup, cap). */
  tags?: string[];
}

interface UpdateQuestionBody extends Partial<CreateQuestionBody> {}

interface BulkDeleteBody {
  ids: string[];
}

interface ExportQuery {
  topicIds?: string;
  testId?: string;
}

// Сериализация строки вопроса (экспорт) — server/services/questions-export.ts;
// разбор (импорт) — server/services/questions-import.ts.

// ============================================
// GET /api/questions - Список вопросов
// ============================================
router.get("/", requirePermission("questions.manage"), async (_req: Request, res: Response) => {
  try {
    const questions = await storage.getQuestions();
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));

    const questionsWithTopics = questions.map((q) => ({
      ...q,
      topicName: topicMap.get(q.topicId) || "Unknown",
    }));

    res.json(questionsWithTopics);
  } catch (error) {
    logger.error("Get questions error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get questions" });
  }
});

// ============================================
// POST /api/questions - Создать вопрос
// ============================================
router.post(
  "/",
  requirePermission("questions.manage"),
  async (req: Request<{}, {}, CreateQuestionBody>, res: Response) => {
    try {
      const {
        topicId,
        type,
        prompt,
        dataJson,
        correctJson,
        points,
        difficulty,
        mediaUrl,
        mediaType,
        shuffleAnswers,
        feedback,
        feedbackMode,
        feedbackCorrect,
        feedbackIncorrect,
        scoringJson,
        tags,
      } = req.body;

      if (rejectBase64MediaUrl(mediaUrl, res)) return;

      if (!topicId || !type || !prompt) {
        return res.status(400).json({ error: "TopicId, type and prompt required" });
      }

      if (!validateScoring(scoringJson, res)) return;

      const question = await storage.createQuestion({
        topicId,
        type,
        prompt,
        dataJson,
        correctJson,
        points: points || 1,
        difficulty: difficulty || 50,
        mediaUrl: mediaUrl || null,
        mediaType: mediaType || null,
        shuffleAnswers: shuffleAnswers ?? true,
        feedback: feedback || null,
        feedbackMode: feedbackMode || "general",
        feedbackCorrect: feedbackCorrect || null,
        feedbackIncorrect: feedbackIncorrect || null,
        scoringJson: scoringJson ?? null,
        tags: normalizeTags(Array.isArray(tags) ? tags : []),
      } as any);

      res.status(201).json(question);
    } catch (error) {
      logger.error("Create question error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to create question" });
    }
  }
);

// ============================================
// PUT /api/questions/:id - Обновить вопрос
// ============================================
router.put(
  "/:id",
  requirePermission("questions.manage"),
  async (req: Request, res: Response) => {
    try {
      const {
        topicId,
        type,
        prompt,
        dataJson,
        correctJson,
        points,
        difficulty,
        mediaUrl,
        mediaType,
        shuffleAnswers,
        feedback,
        feedbackMode,
        feedbackCorrect,
        feedbackIncorrect,
        scoringJson,
        tags,
      } = req.body as UpdateQuestionBody;

      if (rejectBase64MediaUrl(mediaUrl, res)) return;

      if (!validateScoring(scoringJson, res)) return;

      const updated = await storage.updateQuestion(req.params.id, {
        topicId,
        type,
        prompt,
        dataJson,
        correctJson,
        points,
        difficulty,
        mediaUrl,
        mediaType,
        shuffleAnswers,
        feedback,
        feedbackMode,
        feedbackCorrect,
        feedbackIncorrect,
        scoringJson,
        // Only touch tags when the client sent them; otherwise leave unchanged.
        tags: Array.isArray(tags) ? normalizeTags(tags) : undefined,
      } as any);

      if (!updated) {
        return res.status(404).json({ error: "Question not found" });
      }

      res.json(updated);
    } catch (error) {
      logger.error("Update question error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to update question" });
    }
  }
);

// ============================================
// DELETE /api/questions/:id - Удалить вопрос
// ============================================
router.delete(
  "/:id",
  requirePermission("questions.manage"),
  async (req: Request, res: Response) => {
    try {
      const success = await storage.deleteQuestion(req.params.id);
      if (!success) {
        return res.status(404).json({ error: "Question not found" });
      }
      res.json({ success: true });
    } catch (error) {
      logger.error("Delete question error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to delete question" });
    }
  }
);

// ============================================
// POST /api/questions/bulk-delete - Массовое удаление
// ============================================
router.post(
  "/bulk-delete",
  requirePermission("questions.manage"),
  async (req: Request<{}, {}, BulkDeleteBody>, res: Response) => {
    try {
      const { ids } = req.body;
      if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: "IDs array required" });
      }
      const deletedCount = await storage.deleteQuestionsBulk(ids);
      res.json({ success: true, deletedCount });
    } catch (error) {
      logger.error("Bulk delete questions error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to delete questions" });
    }
  }
);

// ============================================
// POST /api/questions/:id/duplicate - Дублировать вопрос
// ============================================
router.post(
  "/:id/duplicate",
  requirePermission("questions.manage"),
  async (req: Request, res: Response) => {
    try {
      const result = await (storage as any).duplicateQuestion(req.params.id);
      if (!result) {
        return res.status(404).json({ error: "Question not found" });
      }
      res.status(201).json(result);
    } catch (error) {
      logger.error("Duplicate question error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to duplicate question" });
    }
  }
);

// ============================================
// GET /api/questions/export - Экспорт в Excel
// ============================================
router.get(
  "/export",
  requirePermission("questions.importExport"),
  async (req: Request<{}, {}, {}, ExportQuery>, res: Response) => {
    try {
      let questions = await storage.getQuestions();
      const topics = await storage.getTopics();
      const topicMap = new Map(topics.map((t) => [t.id, t.name]));

      // Собираем ID тем для фильтрации
      let filterTopicIds: string[] = [];

      // Фильтр по testId
      const { testId, topicIds: topicIdsParam } = req.query;
      if (testId) {
        const sections = await storage.getTestSections(testId);
        filterTopicIds = sections.map((s) => s.topicId);
      }

      // Фильтр по topicIds
      if (topicIdsParam) {
        const topicIds = topicIdsParam.split(",").map((id) => id.trim()).filter(Boolean);
        if (topicIds.length > 0) {
          if (filterTopicIds.length > 0) {
            filterTopicIds = [...new Set([...filterTopicIds, ...topicIds])];
          } else {
            filterTopicIds = topicIds;
          }
        }
      }

      // Применяем фильтр
      if (filterTopicIds.length > 0) {
        questions = questions.filter((q) => filterTopicIds.includes(q.topicId));
      }

      // Сортировка по теме
      questions.sort((a, b) => {
        const topicA = topicMap.get(a.topicId) || "";
        const topicB = topicMap.get(b.topicId) || "";
        return topicA.localeCompare(topicB, "ru");
      });

      // Формируем строки (общая сериализация — server/services/questions-export.ts)
      const rows = questions.map((q) => serializeQuestionRow(q, topicMap.get(q.topicId) || ""));

      const wb = new ExcelJS.Workbook();
      addJsonSheet(wb, "Вопросы", rows, QUESTION_WIDTHS);

      const buffer = await workbookToBuffer(wb);

      const timestamp = new Date().toISOString().slice(0, 10);
      let filename = `questions_${timestamp}.xlsx`;
      if (testId) {
        const test = await storage.getTest(testId);
        if (test) {
          const safeName = test.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_").slice(0, 30);
          filename = `questions_${safeName}_${timestamp}.xlsx`;
        }
      }

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(buffer);
    } catch (error) {
      logger.error("Export questions error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to export questions" });
    }
  }
);

// ============================================
// GET /api/questions/template - Шаблон Excel для импорта (PRD-14 Ф2, FR-12)
// ============================================
// Canonical column order (must match the export — see спецификация формата §3).
const TEMPLATE_HEADERS = [
  "ID",
  "Тема",
  "Тип вопроса",
  "Текст вопроса",
  "Балл",
  "Сложность",
  "Тексты вариантов ответа",
  "Номера правильных ответов",
  "Следование вариантов ответов",
  "Обратная связь",
  "Теги",
  "Режим ОС",
  "ОС при верном",
  "ОС при неверном",
  "Цена ответа",
];

router.get(
  "/template",
  requirePermission("questions.importExport"),
  async (_req: Request, res: Response) => {
    try {
      const wb = new ExcelJS.Workbook();
      // Sheet 1 — headers only (the author fills rows below).
      addAoaSheet(wb, "Вопросы", [TEMPLATE_HEADERS],
        [36, 25, 18, 50, 8, 12, 60, 25, 15, 40, 25, 12, 30, 30, 40]);

      // Sheet 2 — format reference per column / question type.
      const help: string[][] = [
        ["Колонка", "Описание / формат"],
        ["ID", "Пусто — создать вопрос; заполнен и найден — обновить (см. экспорт)"],
        ["Тема", "Обязательно. Имя темы; если её нет — будет создана"],
        ["Тип вопроса", "Обязательно. multiple_choice | multiple_response | matching | ranking"],
        ["Текст вопроса", "Обязательно. Формулировка"],
        ["Балл", "Целое; по умолчанию 1"],
        ["Сложность", "Целое 0..100; по умолчанию 50"],
        ["Тексты вариантов ответа", "Разделитель вариантов — #. Для matching: «лево # ... || право # ...»"],
        ["Номера правильных ответов", "1-based. multiple_choice: «2». multiple_response: «1,3». matching: «1-1, 2-2». ranking: порядок «3,1,2»"],
        ["Следование вариантов ответов", "Random (по умолчанию) | Fixed"],
        ["Обратная связь", "Общая обратная связь (режим «общая»)"],
        ["Теги", "Список; разделители «;» и «,». Напр.: финансы; учёт"],
        ["Режим ОС", "общая (по умолчанию) | условная"],
        ["ОС при верном", "Текст; только при режиме «условная»"],
        ["ОС при неверном", "Текст; только при режиме «условная»"],
        ["Цена ответа", "Пусто/«точное» — точное совпадение. single: «веса: 2 # 0 # 1». multiple/matching/ranking: «ступени: c>=2 => 1; c==T & x==0 => 2»"],
        ["", ""],
        ["Пример (multiple_choice)", "Варианты «A # B # C», правильный «2»"],
        ["Пример (matching)", "«Кошка # Собака || Мяу # Гав # Буль», пары «1-1, 2-2»"],
        ["Пример (ranking)", "Элементы «Шаг А # Шаг Б # Шаг В», порядок «3,1,2»"],
      ];
      addAoaSheet(wb, "Справка", help, [32, 90]);

      const buffer = await workbookToBuffer(wb);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent("questions_template.xlsx")}"`);
      res.send(buffer);
    } catch (error) {
      logger.error("Questions template error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to build template" });
    }
  }
);

// ============================================
// POST /api/questions/import - Импорт из Excel
// ============================================
// `?dryRun=true` (FR-13): валидирует и считает план без записи в БД.
router.post(
  "/import",
  requirePermission("questions.importExport"),
  memoryUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "File required" });
      }

      const dryRun = String(req.query.dryRun ?? "").toLowerCase() === "true";

      const workbook = await readWorkbookFromBuffer(req.file.buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return res.status(400).json({ error: "File is empty" });

      const result = await importQuestionRows(
        sheetToObjects(sheet),
        sheetHeaders(sheet),
        { dryRun },
      );

      res.json({
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
        dryRun,
      });
    } catch (error) {
      logger.error("Import questions error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to import questions" });
    }
  }
);

export default router;
