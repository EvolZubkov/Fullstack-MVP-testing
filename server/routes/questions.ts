import { Router, Request, Response } from "express";
import { createHash } from "crypto";
import { logger } from "../logger";
import ExcelJS from "exceljs";
import {
  addJsonSheet,
  readWorkbookFromBuffer,
  sheetToObjects,
  workbookToBuffer,
} from "../utils/excel";
import { storage } from "../storage";
import { requireAuth, requireAuthor } from "../middleware/auth";
import { memoryUpload, rejectBase64MediaUrl } from "../middleware/upload";
import { questionScoringSchema, type QuestionScoring } from "@shared/schema";
import { normalizeTags } from "@shared/tags";

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

// SHA-256 от type + prompt + нормализованные варианты ответов
function computeQuestionHash(type: string, prompt: string, dataJson: unknown): string {
  const normalized = JSON.stringify({ type, prompt: prompt.trim(), data: dataJson });
  return createHash("sha256").update(normalized).digest("hex");
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

// Маппинг типов: внутренний -> Excel
const typeToExcel: Record<string, string> = {
  single: "multiple_choice",
  multiple: "multiple_response",
  matching: "matching",
  ranking: "ranking",
};

// Маппинг типов: Excel -> внутренний
const typeFromExcel: Record<string, string> = {
  multiple_choice: "single",
  multiple_response: "multiple",
  matching: "matching",
  ranking: "ranking",
  single: "single",
  multiple: "multiple",
};

// ============================================
// GET /api/questions - Список вопросов
// ============================================
router.get("/", requireAuth, async (_req: Request, res: Response) => {
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
  requireAuthor,
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
  requireAuthor,
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
  requireAuthor,
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
  requireAuthor,
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
  requireAuthor,
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
  requireAuthor,
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

      // Формируем строки
      const rows = questions.map((q) => {
        const data = q.dataJson as any;
        const correct = q.correctJson as any;

        let optionsStr = "";
        let correctStr = "";

        if (q.type === "single" || q.type === "multiple") {
          optionsStr = (data.options || []).join("#");

          if (q.type === "single") {
            correctStr = String((correct.correctIndex ?? 0) + 1);
          } else {
            correctStr = (correct.correctIndices || [])
              .map((i: number) => i + 1)
              .join(",");
          }
        } else if (q.type === "matching") {
          const left = data.left || [];
          const right = data.right || [];
          const pairs: string[] = [];
          for (let i = 0; i < left.length; i++) {
            pairs.push(`${left[i]}#${right[i] || ""}`);
          }
          optionsStr = pairs.join("#");
          correctStr = (correct.pairs || [])
            .map((p: any) => `${p.left + 1}-${p.right + 1}`)
            .join(",");
        } else if (q.type === "ranking") {
          optionsStr = (data.items || []).join("#");
          correctStr = (correct.correctOrder || [])
            .map((i: number) => i + 1)
            .join(",");
        }

        return {
          "ID": q.id,
          "Тема": topicMap.get(q.topicId) || "",
          "Тип вопроса": typeToExcel[q.type] || q.type,
          "Текст вопроса": q.prompt,
          "Балл": q.points || 1,
          "Сложность": q.difficulty || 50,
          "Тексты вариантов ответа": optionsStr,
          "Номера правильных ответов": correctStr,
          "Следование вариантов ответов": q.shuffleAnswers === false ? "Fixed" : "Random",
          "Обратная связь": q.feedback || "",
        };
      });

      const wb = new ExcelJS.Workbook();
      addJsonSheet(wb, "Вопросы", rows, [36, 25, 18, 50, 8, 12, 60, 25, 15, 40]);

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
// POST /api/questions/import - Импорт из Excel
// ============================================
router.post(
  "/import",
  requireAuthor,
  memoryUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "File required" });
      }

      const workbook = await readWorkbookFromBuffer(req.file.buffer);
      const sheet = workbook.worksheets[0];
      if (!sheet) return res.status(400).json({ error: "File is empty" });
      const rows = sheetToObjects(sheet);

      const topics = await storage.getTopics();
      // Нормализуем ключ: убираем все виды пробелов (включая \u00a0, \r и т.д.)
      const normalizeName = (s: string) => s.replace(/[\s\u00a0\u200b\ufeff]+/g, " ").trim().toLowerCase();
      const topicByName = new Map(topics.map((t) => [normalizeName(t.name), t]));

      // Кэш хэшей по topicId — загружаем лениво при первом обращении к теме
      const hashCache = new Map<string, Set<string>>();
      const getTopicHashes = async (topicId: string): Promise<Set<string>> => {
        if (!hashCache.has(topicId)) {
          hashCache.set(topicId, await storage.getContentHashesByTopic(topicId));
        }
        return hashCache.get(topicId)!;
      };

      const results = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const rowNum = i + 2;

        try {
          // Тема — создаём если не существует
          const topicNameRaw = String(row["Тема"] || "").replace(/[\s\u00a0\u200b\ufeff]+/g, " ").trim();
          const topicNameKey = normalizeName(topicNameRaw);
          if (!topicNameKey) {
            results.errors.push(`Строка ${rowNum}: не указана тема`);
            continue;
          }
          let topic = topicByName.get(topicNameKey);
          if (!topic) {
            logger.warn(`Import строка ${rowNum}: тема "${topicNameRaw}" не найдена, создаём новую`, "questions");
            topic = await storage.createTopic({ name: topicNameRaw });
            topicByName.set(topicNameKey, topic);
          }

          // Тип вопроса
          const rawType = String(row["Тип вопроса"] || row["Тип"] || "").trim().toLowerCase();
          const type = typeFromExcel[rawType] as "single" | "multiple" | "matching" | "ranking" | undefined;
          if (!type) {
            results.errors.push(`Строка ${rowNum}: неизвестный тип "${row["Тип вопроса"] || row["Тип"]}"`);
            continue;
          }

          // Текст вопроса
          const prompt = String(row["Текст вопроса"] || row["Вопрос"] || "").trim();
          if (!prompt) {
            results.errors.push(`Строка ${rowNum}: пустой вопрос`);
            continue;
          }

          // Варианты и правильные ответы
          const optionsStr = String(row["Тексты вариантов ответа"] || row["Варианты"] || "").trim();
          const correctStr = String(row["Номера правильных ответов"] || row["Правильный ответ"] || "").trim();

          let dataJson: unknown = {};
          let correctJson: unknown = {};

          if (type === "single" || type === "multiple") {
            const separator = optionsStr.includes("#") ? "#" : "|";
            const options = optionsStr.split(separator).map((s) => s.trim()).filter(Boolean);

            if (options.length < 2) {
              results.errors.push(`Строка ${rowNum}: нужно минимум 2 варианта ответа`);
              continue;
            }
            dataJson = { options };

            if (type === "single") {
              const idx = parseInt(correctStr, 10) - 1;
              if (isNaN(idx) || idx < 0 || idx >= options.length) {
                results.errors.push(`Строка ${rowNum}: некорректный номер правильного ответа "${correctStr}"`);
                continue;
              }
              correctJson = { correctIndex: idx };
            } else {
              const indices = correctStr
                .split(/[,.\s]+/)
                .map((s) => parseInt(s.trim(), 10) - 1)
                .filter((i) => !isNaN(i));

              if (indices.length === 0) {
                results.errors.push(`Строка ${rowNum}: не указаны правильные ответы`);
                continue;
              }
              if (indices.some((i) => i < 0 || i >= options.length)) {
                results.errors.push(`Строка ${rowNum}: номера правильных ответов выходят за пределы`);
                continue;
              }
              correctJson = { correctIndices: indices };
            }
          } else if (type === "matching") {
            const left: string[] = [];
            const right: string[] = [];

            if (optionsStr.includes("→")) {
              const pairs = optionsStr.split("|").map((s) => s.trim()).filter(Boolean);
              for (const pair of pairs) {
                const [l, r] = pair.split("→").map((s) => s.trim());
                if (l && r) {
                  left.push(l);
                  right.push(r);
                }
              }
            } else {
              const parts = optionsStr.split("#").map((s) => s.trim()).filter(Boolean);
              for (let j = 0; j < parts.length - 1; j += 2) {
                left.push(parts[j]);
                right.push(parts[j + 1] || "");
              }
            }

            if (left.length < 2) {
              results.errors.push(`Строка ${rowNum}: нужно минимум 2 пары для сопоставления`);
              continue;
            }

            dataJson = { left, right };
            correctJson = { pairs: left.map((_, idx) => ({ left: idx, right: idx })) };
          } else if (type === "ranking") {
            const separator = optionsStr.includes("#") ? "#" : "|";
            const items = optionsStr.split(separator).map((s) => s.trim()).filter(Boolean);

            if (items.length < 2) {
              results.errors.push(`Строка ${rowNum}: нужно минимум 2 элемента для ранжирования`);
              continue;
            }

            dataJson = { items };
            correctJson = { correctOrder: items.map((_, idx) => idx) };
          }

          // Следование вариантов
          const shuffleStr = String(row["Следование вариантов ответов"] || "Random").trim().toLowerCase();
          const shuffleAnswers = shuffleStr !== "fixed";

          const contentHash = computeQuestionHash(type, prompt, dataJson);

          // Обновление по ID если указан
          const rowId = String(row["ID"] || "").trim();
          if (rowId) {
            const existing = await storage.getQuestion(rowId);
            if (existing) {
              await storage.updateQuestion(rowId, {
                topicId: topic.id,
                type,
                prompt,
                dataJson: dataJson as any,
                correctJson: correctJson as any,
                points: parseInt(String(row["Балл"]), 10) || 1,
                difficulty: parseInt(String(row["Сложность"]), 10) || 50,
                shuffleAnswers,
                feedback: String(row["Обратная связь"] || "").trim() || null,
                contentHash,
              } as any);
              results.updated++;
              continue;
            }
          }

          // Дедупликация: проверяем хэш контента
          const existingHashes = await getTopicHashes(topic.id);
          if (existingHashes.has(contentHash)) {
            results.skipped++;
            continue;
          }

          // Создаём вопрос
          await storage.createQuestion({
            topicId: topic.id,
            type,
            prompt,
            dataJson,
            correctJson,
            points: parseInt(String(row["Балл"]), 10) || 1,
            difficulty: parseInt(String(row["Сложность"]), 10) || 50,
            shuffleAnswers,
            feedback: String(row["Обратная связь"] || "").trim() || null,
            contentHash,
          } as any);

          // Добавляем в кэш чтобы не дублировать внутри одного файла
          existingHashes.add(contentHash);
          results.created++;
        } catch (err) {
          results.errors.push(`Строка ${rowNum}: ${(err as Error).message}`);
        }
      }

      res.json({
        created: results.created,
        updated: results.updated,
        skipped: results.skipped,
        errors: results.errors,
      });
    } catch (error) {
      logger.error("Import questions error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to import questions" });
    }
  }
);

export default router;
