/**
 * @module server/routes/analytics/scales
 * @description PRD-56 FR-21, FR-21c - FR-21f: профиль теста по шкалам и показателям — вкладка
 * «Шкалы и показатели».
 *
 * Отдельной ручкой, а не внутри сводки теста: вкладка есть только у теста со шкалами или
 * показателями, и платить за её расчёт тому, кто смотрит обзор оцениваемого теста, незачем.
 *
 * Цвета полос решаются ЗДЕСЬ, а не на экране: они выводятся из тона уровня и рампы оформления
 * теста (FR-21a), а экран о рампе не знает и знать не должен — иначе один и тот же уровень
 * окажется одного цвета в итогах участника и другого в аналитике.
 *
 * The page filter (source, group, period) narrows both halves (FR-21f): the tab sits under the
 * same filter bar as every other tab, and a number computed over a different selection than the
 * one on screen is a defect, not a feature (FR-25).
 */
import { Router, type Request, type Response } from "express";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { indicatorRanges, summariseIndicators } from "../../services/analytics/indicator-profile";
import { loadObservations } from "../../services/analytics/observations";
import { summariseScales } from "../../services/analytics/scale-profile";
import { scaleRampOf } from "../../services/analytics/scale-ramp";
import { narrowsSelection, readTestFilterQuery } from "./observation-query";

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

      // Every attempt counts here: the attempt rule (PRD-66 FR-51) belongs to psychometrics.
      const { filter } = readTestFilterQuery(req, testId, "all");
      const [scales, indicators, scaleRows, indicatorRows] = await Promise.all([
        storage.getScales(testId),
        storage.getResultVariables(testId),
        storage.selectScaleValuesForTest(testId),
        storage.selectIndicatorValuesForTest(testId),
      ]);

      // The selection of the page filter; without a narrowing condition — every run of the test.
      let selects = (_attemptId: string) => true;
      if (narrowsSelection(filter)) {
        const observations = await loadObservations(filter, { all: true, ids: new Set([testId]) });
        const inScope = new Set(observations.rows.map(row => row.id));
        selects = attemptId => inScope.has(attemptId);
      }
      const scaleSelection = scaleRows.filter(row => selects(row.attemptId));
      const indicatorSelection = indicatorRows.filter(row => selects(row.attemptId));

      // Рампа уровней — одна функция со сравнением срезов (FR-07l): цвет уровня не расходится.
      const ramp = await scaleRampOf(test);

      // Runs that produced at least one scale value OR one indicator value: the card captions
      // take the number from here, not from the test summary, whose denominator is different.
      const measured = new Set([
        ...scaleSelection.filter(row => Object.keys(row.values).length > 0).map(row => row.attemptId),
        ...indicatorSelection.filter(row => Object.keys(row.values).length > 0).map(row => row.attemptId),
      ]);

      res.json({
        testId,
        observations: measured.size,
        scales: summariseScales(scaleSelection, scales, { ramp }),
        indicators: summariseIndicators(indicatorSelection, indicators, {
          ramp,
          // A string indicator often stores scale keys: they read as the scales' names.
          scaleLabels: Object.fromEntries(scales.map(scale => [scale.key, scale.label || scale.key])),
          // Intervals of an indicator without a domain: from ALL runs, so the filter does not move them.
          ranges: indicatorRanges(indicatorRows, indicators),
        }),
      });
    } catch (error) {
      logger.error("Scale analytics error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to fetch scale analytics" });
    }
  },
);

export default router;
