/**
 * @module server/routes/analytics/scales
 * @description PRD-56 FR-21: профиль измерительного теста по шкалам.
 *
 * Отдельной ручкой, а не внутри сводки теста: вкладка «Шкалы» есть только у теста со шкалами, и
 * платить за её расчёт тому, кто смотрит обзор оцениваемого теста, незачем.
 *
 * Цвета полос решаются ЗДЕСЬ, а не на экране: они выводятся из тона уровня и рампы оформления
 * теста (FR-21a), а экран о рампе не знает и знать не должен — иначе один и тот же уровень
 * окажется одного цвета в итогах участника и другого в аналитике.
 */
import { Router, type Request, type Response } from "express";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { summariseScales } from "../../services/analytics/scale-profile";
import { scaleRampOf } from "../../services/analytics/scale-ramp";

const router = Router();

router.get(
  "/tests/:testId/scales",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId } = req.params;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Test not found" });

      const [scales, rows] = await Promise.all([
        storage.getScales(testId),
        storage.selectScaleValuesForTest(testId),
      ]);

      // Рампа уровней — одна функция со сравнением срезов (FR-07l): цвет уровня не расходится.
      const ramp = await scaleRampOf(test);

      res.json({
        testId,
        // Прохождений, давших хоть одно значение шкалы: подпись карточки берёт число отсюда,
        // а не из сводки теста — там знаменатель другой.
        observations: rows.filter(row => Object.keys(row.values).length > 0).length,
        scales: summariseScales(rows, scales, { ramp }),
      });
    } catch (error) {
      logger.error("Scale analytics error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to fetch scale analytics" });
    }
  },
);

export default router;
