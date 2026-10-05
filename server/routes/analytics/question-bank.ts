/**
 * @module server/routes/analytics/question-bank
 * @description PRD-70 FR-10, FR-13, FR-14: ось банка вопросов — качество вопросов для дерева «Темы
 * и вопросы», ориентир сложности для ящика вопроса и статистика вопроса банка по тестам.
 *
 * Обе ручки только читают готовое: качество каждого теста считает фоновый пересчёт
 * (`suspicious-refresh`), и открытие банка расчёта не запускает (FR-05). До первого прохода после
 * старта сервера сказать нечего — ручки отвечают пустотой, а не ошибкой.
 */
import { Router, type Request, type Response } from "express";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { storage } from "../../storage";
import { bankQuestionStats } from "../../services/analytics/bank-question-stats";
import { bankQuality, difficultyLandmark } from "../../services/analytics/question-bank-quality";
import { visibleTopic } from "../../services/topic-access";
import { analyticsScope } from "./helpers";
import { testPools, testQualities } from "./suspicious-refresh";

const router = Router();

// GET /api/analytics/bank/quality — признаки вопросов банка по тестам, доступным читателю (FR-14)
router.get("/bank/quality", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const scope = await analyticsScope(req);
    const questions = [...bankQuality(testQualities(), testPools(), testId => scope.has(testId)).values()];
    res.json({ questions });
  } catch (error) {
    logger.error("Bank quality error: " + (error as Error).message, "analytics");
    res.status(500).json({ error: "Не удалось прочитать качество вопросов банка" });
  }
});

// GET /api/analytics/questions/:questionId/difficulty-landmark — ориентир «По ответам» (FR-13)
router.get(
  "/questions/:questionId/difficulty-landmark",
  requirePermission("analytics.read"),
  (req: Request, res: Response) => {
    // Решение О2: ориентир — свойство вопроса, поэтому по всем тестам; названия тестов в ответе
    // не раскрываются — только их число.
    res.json({ landmark: difficultyLandmark(testQualities(), req.params.questionId) });
  },
);

// GET /api/analytics/questions/:questionId — статистика вопроса банка по тестам читателя (FR-10)
router.get("/questions/:questionId", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const { questionId } = req.params;
    const [question] = await storage.getQuestionsByIds([questionId]);
    const topic = question ? (await storage.getTopics()).find(t => t.id === question.topicId) : undefined;
    // FR-16: вопрос темы, которую читатель не видит, для него не существует.
    if (!question || !topic || !(await visibleTopic(req.effectiveRoles ?? [], req.currentUser?.id ?? "", topic))) {
      return res.status(404).json({ error: "Вопрос не найден" });
    }
    const scope = await analyticsScope(req);
    // FR-11: редакция — смена выборки; пустая строка — серия «версия неизвестна».
    const requested = typeof req.query.version === "string"
      ? (req.query.version === "" ? null : req.query.version)
      : undefined;
    const stats = await bankQuestionStats(questionId, testQualities(), testId => scope.has(testId), requested);
    if (!stats) return res.status(404).json({ error: "Вопрос не найден" });
    res.json(stats);
  } catch (error) {
    logger.error("Bank question stats error: " + (error as Error).message, "analytics");
    res.status(500).json({ error: "Не удалось посчитать статистику вопроса" });
  }
});

export default router;
