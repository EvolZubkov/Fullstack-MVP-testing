/**
 * @module server/routes/analytics/question-bank
 * @description PRD-70 FR-13, FR-14: ось банка вопросов — качество вопросов для дерева «Темы и
 * вопросы» и ориентир сложности для ящика вопроса.
 *
 * Обе ручки только читают готовое: качество каждого теста считает фоновый пересчёт
 * (`suspicious-refresh`), и открытие банка расчёта не запускает (FR-05). До первого прохода после
 * старта сервера сказать нечего — ручки отвечают пустотой, а не ошибкой.
 */
import { Router, type Request, type Response } from "express";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { bankQuality, difficultyLandmark } from "../../services/analytics/question-bank-quality";
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

export default router;
