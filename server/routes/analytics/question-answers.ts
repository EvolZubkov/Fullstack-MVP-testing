/**
 * @module server/routes/analytics/question-answers
 * @description PRD-57 FR-32: ответы одного задания списком и выгрузкой.
 *
 * Свободный текст участника — самое личное, что есть в прохождении, поэтому маршрут закрыт
 * тем же гейтом, что и вся аналитика теста: право плюс область видимости теста. Выгрузка
 * требует отдельного права (`analytics.export`) — как и всякий файл, который уносят из
 * системы.
 *
 * Данные берутся общим сбором ответов (`test-answer-facts`) и слоем наблюдений: свой запрос
 * к таблицам означал бы второе мнение о том, что такое ответ на задание.
 */
import { Router, type Request, type Response } from "express";
import ExcelJS from "exceljs";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { addAoaSheet, workbookToBuffer } from "../../utils/excel";
import { loadObservations } from "../../services/analytics/observations";
import { loadTestAnswerFacts } from "../../services/analytics/test-answer-facts";
import {
  buildQuestionAnswerRows,
  type AnswerObservation,
  type QuestionAnswerRow,
} from "../../services/analytics/question-answers";

const router = Router();

/** Как источник прохождения подписывается человеку. */
const SOURCE_TITLE: Record<string, string> = {
  web: "Веб",
  telemetry: "Телеметрия LMS",
  import: "Импорт",
};

/** Исход ответа словами: у неоценённого ответа «неверно» было бы ложью. */
const RESULT_TITLE: Record<string, string> = {
  correct: "Верно",
  partial: "Частично",
  incorrect: "Неверно",
  neutral: "Без оценки",
};

/** Собрать список ответов задания; `null` — задания в этом тесте нет. */
async function collect(testId: string, questionId: string): Promise<{
  question: { id: string; type: string; prompt: string };
  rows: QuestionAnswerRow[];
} | null> {
  const attempts = (await storage.getAllAttempts())
    .filter((attempt) => attempt.testId === testId && attempt.resultJson !== null);

  const { facts, questionById } = await loadTestAnswerFacts(testId, attempts);
  const question = questionById.get(questionId);
  if (!question) return null;

  // Область видимости уже проверена гейтом маршрута, поэтому здесь она открыта — ровно как
  // на странице теста.
  const observations = await loadObservations(
    { testIds: [testId] },
    { all: true, ids: new Set([testId]) },
  );
  const byAttempt = new Map<string, AnswerObservation>(
    observations.rows.map((row) => [row.id, {
      participant: row.participant,
      finishedAt: row.finishedAt,
      startedAt: row.startedAt,
      source: row.source,
    }]),
  );

  return {
    question: { id: question.id, type: question.type, prompt: question.prompt },
    rows: buildQuestionAnswerRows({ questionId, question, facts, observations: byAttempt }),
  };
}

// GET /api/analytics/tests/:testId/questions/:questionId/answers — ответы задания списком
router.get(
  "/tests/:testId/questions/:questionId/answers",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const found = await collect(testId, questionId);
      if (!found) return res.status(404).json({ error: "Задание не входит в этот тест" });
      // Э4а: страница вопроса читает ответы порциями при прокрутке. Без `limit` — все разом,
      // как раньше: так ответ остаётся совместимым с прежними читателями.
      const offset = Math.max(0, Number.parseInt(String(req.query.offset ?? "0"), 10) || 0);
      const limitRaw = Number.parseInt(String(req.query.limit ?? ""), 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 200) : null;
      res.json({
        questionId,
        questionType: found.question.type,
        total: found.rows.length,
        offset,
        rows: limit === null ? found.rows.slice(offset) : found.rows.slice(offset, offset + limit),
      });
    } catch (error) {
      logger.error("GET question answers error: " + (error as Error).message);
      res.status(500).json({ error: "Не удалось собрать ответы задания" });
    }
  },
);

// GET .../answers/export/excel — та же выборка книгой
router.get(
  "/tests/:testId/questions/:questionId/answers/export/excel",
  requirePermission("analytics.export"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const found = await collect(testId, questionId);
      if (!found) return res.status(404).json({ error: "Задание не входит в этот тест" });

      const data: unknown[][] = [
        ["Участник", "Источник", "Когда", "Ответ", "Длина", "Исход", "Время на задании, с"],
        ...found.rows.map((row) => [
          row.participant,
          SOURCE_TITLE[row.source] ?? row.source,
          row.at ? new Date(row.at).toLocaleString("ru-RU") : "—",
          row.answer,
          row.length,
          RESULT_TITLE[row.outcome] ?? row.outcome,
          row.latencyMs === null ? "—" : Math.round(row.latencyMs / 1000),
        ]),
      ];

      const workbook = new ExcelJS.Workbook();
      addAoaSheet(workbook, "Ответы задания", data, [28, 18, 20, 80, 10, 14, 20]);
      const buffer = await workbookToBuffer(workbook);

      const filename = `answers_${questionId}_${new Date().toISOString().split("T")[0]}.xlsx`;
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
      res.send(buffer);
    } catch (error) {
      logger.error("Excel export of question answers error: " + (error as Error).message);
      res.status(500).json({ error: "Не удалось выгрузить ответы задания" });
    }
  },
);

export default router;
