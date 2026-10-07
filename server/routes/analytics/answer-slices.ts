/**
 * @module server/routes/analytics/answer-slices
 * @description PRD-56 FR-07k - FR-07n, FR-21g: сравнение срезов «Ответы, шкалы и показатели».
 *
 * Свой механизм сравнения ручка не заводит: срезы («Тест целиком», временный отбор, сохранённые
 * срезы теста), рамка периода и пересечение периодов — те же, что у «Результата и тем» и
 * «Качества вопросов». Меняется только СОДЕРЖИМОЕ: по каждому срезу — «Разброс ответов» вкладки
 * «Вопросы» (`questionSpread`) и профиль вкладки «Шкалы» (`summariseScales`), посчитанные теми же
 * функциями по прохождениям среза. Сводит выбранные срезы экран (`shared/analytics/answer-compare`):
 * расхождение зависит от того, какие срезы стоят в слотах.
 */
import { Router, type Request, type Response } from "express";

import { config } from "../../config";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { questionSpread } from "../../services/analytics/answer-spread";
import { loadObservations } from "../../services/analytics/observations";
import { loadTestAnswerFacts } from "../../services/analytics/test-answer-facts";
import { indicatorRanges, summariseIndicators } from "../../services/analytics/indicator-profile";
import { summariseScales } from "../../services/analytics/scale-profile";
import { scaleRampOf } from "../../services/analytics/scale-ramp";
import { adhocSource, conditionsOf, dateOf, withinFrame } from "./slices";
import { listOf, narrowsSelection } from "./observation-query";
import { plainPromptOf } from "@shared/questions/prompt-format";
import { renderBlanksText } from "@shared/questions/blanks-render";

const router = Router();

// GET /api/analytics/tests/:testId/answer-slices — ответы, шкалы и показатели по сравниваемым срезам
router.get(
  "/tests/:testId/answer-slices",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Тест не найден" });

      const requested = listOf(req.query.sliceId);
      // Срезы — только свои и только этого теста (PRD-56 FR-07b, Э3).
      const saved = await storage.getSlices(req.currentUser?.id ?? "", "slice", testId);
      const sources = [
        ...(String(req.query.withWhole ?? "") === "1"
          ? [{ id: "whole", name: "Тест целиком", conditionsJson: {} as Record<string, unknown> }]
          : []),
        ...adhocSource(req.query.conditions, req.query.conditionsName),
        ...saved.filter(slice => requested.length === 0 || requested.includes(slice.id)),
      ];
      const from = dateOf(req.query.from, "start");
      const to = dateOf(req.query.to, "end");

      // Сырьё одно на все срезы: ответы и значения шкал теста читаются один раз и режутся по
      // прохождениям каждого среза — повторять сбор на каждый срез незачем.
      const testAttempts = await storage.getAttemptsByTests([testId]);
      const completed = testAttempts.filter(attempt => attempt.resultJson !== null);
      const [
        { facts, questionById, topicNameById }, sections, scales, scaleRows, indicators, indicatorRows, ramp,
      ] = await Promise.all([
        loadTestAnswerFacts(testId, completed),
        storage.getTestSections(testId),
        storage.getScales(testId),
        storage.selectScaleValuesForTest(testId),
        storage.getResultVariables(testId),
        storage.selectIndicatorValuesForTest(testId),
        scaleRampOf(test),
      ]);

      // Порядок теста: раздел, затем место вопроса в теме — по нему сортирует колонка «Вопрос».
      const sectionOrder = new Map(sections.map(section => [section.topicId, section.sortOrder ?? 0]));
      const questionIds = [...questionById.values()]
        .sort((a, b) =>
          (sectionOrder.get(a.topicId) ?? Number.MAX_SAFE_INTEGER) - (sectionOrder.get(b.topicId) ?? Number.MAX_SAFE_INTEGER)
          || (a.orderIndex ?? 0) - (b.orderIndex ?? 0))
        .map(question => question.id);

      const slices = [];
      for (const slice of sources) {
        // Тест рамки перебивает тест среза, период рамки ПЕРЕСЕКАЕТСЯ с периодом среза (FR-07b1,
        // FR-07e) — тем же `withinFrame`, что у двух других видов сравнения.
        const filter = withinFrame(conditionsOf(slice.conditionsJson), testId, from, to);
        const observations = await loadObservations(filter, { all: true, ids: new Set([testId]) });
        const inScope = new Set(observations.rows.map(row => row.id));
        const narrowed = narrowsSelection(filter);
        const selects = (attemptId: string) => !narrowed || inScope.has(attemptId);

        const answersOf = new Map<string, unknown[]>();
        for (const fact of facts) {
          if (!selects(fact.attemptId)) continue;
          const list = answersOf.get(fact.questionId);
          if (list) list.push(fact.answer);
          else answersOf.set(fact.questionId, [fact.answer]);
        }
        const questions = [];
        for (const [questionId, answers] of answersOf) {
          const question = questionById.get(questionId);
          if (!question) continue;
          const spread = questionSpread(question, answers);
          if (!spread) continue;
          questions.push({
            questionId,
            answered: spread.answered,
            options: spread.options.map(option => ({ label: option.label, share: option.share })),
          });
        }

        const rows = scaleRows.filter(row => selects(row.attemptId));
        slices.push({
          id: slice.id,
          name: slice.name,
          conditions: slice.conditionsJson,
          respondents: observations.rows.length,
          questions,
          scales: summariseScales(rows, scales, { ramp }),
          // PRD-56 FR-21g: indicators of the slice, cut by the same runs as its scales.
          indicators: summariseIndicators(indicatorRows.filter(row => selects(row.attemptId)), indicators, {
            ramp,
            scaleLabels: Object.fromEntries(scales.map(scale => [scale.key, scale.label || scale.key])),
            // Same intervals in every slice: taken from ALL runs of the test.
            ranges: indicatorRanges(indicatorRows, indicators),
          }),
        });
      }

      res.json({
        minObservations: config.analytics.minObservations,
        questions: questionIds.map(id => {
          const question = questionById.get(id)!;
          return {
            questionId: id,
            prompt: plainPromptOf({ ...question, prompt: renderBlanksText(question.prompt, { mode: "dash" }) }),
            type: question.type,
            topicName: topicNameById.get(question.topicId) ?? "",
          };
        }),
        slices,
      });
    } catch (error) {
      logger.error("Answer slices error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось сравнить ответы по срезам" });
    }
  },
);

export default router;
