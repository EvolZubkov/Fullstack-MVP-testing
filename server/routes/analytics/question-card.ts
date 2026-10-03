/**
 * @module server/routes/analytics/question-card
 * @description Э3.3: сам вопрос и его настройки в тесте — блок «Вопрос в этом тесте» на уровне
 * вопроса — и «Этот вопрос в других тестах» (эскиз approved/e3-test-and-question.html, состояние
 * question; решение владельца 2026-10-03: подробности о вопросе — на его странице, без похода в
 * ящик теста).
 *
 * Только чтение. Цена, правило начисления и сложность — из той же цепочки, что «Оценка» теста
 * (\`loadTestScoringContext\`): заданное в тесте помечено, чтобы было видно, откуда число. Верный
 * ответ словами — тем же форматтером, что выгрузки, — для типов, у которых таблицы вариантов
 * нет (сопоставление, ранжирование, текстовые ответы).
 *
 * Трудность в других тестах — той же функцией психометрики (\`difficulty\`) по ответам на этот
 * вопрос в каждом тесте; ниже порога наблюдений инстанса — «мало данных», а не число.
 */
import { Router, type Request, type Response } from "express";

import { difficulty as difficultyOf } from "@shared/psychometrics/item-metrics";
import { config } from "../../config";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { loadTestScoringContext } from "../../services/effective-scoring";
import { loadTestAnswerFacts } from "../../services/analytics/test-answer-facts";
import { analyticsScope, formatCorrectAnswerText } from "./helpers";

const router = Router();

/** Типы, у которых в разборе есть таблица «Варианты ответа»: верный ответ виден там. */
const OPTION_TYPES = new Set(["single", "multiple", "scale", "allocation"]);

/** Строка «Этот вопрос в других тестах». */
export interface OtherTestRow {
  testId: string;
  title: string;
  /** Сколько раз вопрос выдавался в тесте за окно экспозиции. */
  delivered: number;
  /** Сколько оценённых ответов на вопрос в тесте. */
  observations: number;
  /** Трудность (доля балла); \`null\` — наблюдений меньше порога инстанса. */
  difficulty: number | null;
}

/**
 * Трудность вопроса в тесте по фактам ответов — той же функцией, что психометрика.
 *
 * @returns объём оценённых ответов и трудность (\`null\` ниже порога)
 */
async function difficultyInTest(testId: string, questionId: string): Promise<{ observations: number; difficulty: number | null }> {
  const { web } = await storage.selectObservations({ testIds: [testId], sources: ["web"] });
  const { facts } = await loadTestAnswerFacts(testId, web.filter(attempt => attempt.resultJson !== null));
  const scored = facts.filter(fact => fact.questionId === questionId
    && fact.earnedPoints !== null && fact.possiblePoints !== null && fact.possiblePoints > 0);
  const observations = scored.length;
  if (observations < config.analytics.minObservations) return { observations, difficulty: null };
  return {
    observations,
    difficulty: difficultyOf(scored.map(fact => ({
      respondentId: fact.attemptId,
      itemId: questionId,
      ratio: (fact.earnedPoints as number) / (fact.possiblePoints as number),
    }))),
  };
}

// GET /api/analytics/tests/:testId/questions/:questionId/card
router.get(
  "/tests/:testId/questions/:questionId/card",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const question = await storage.getQuestion(questionId);
      if (!question) return res.status(404).json({ error: "Вопрос не найден" });
      const sections = await storage.getTestSections(testId);
      if (!sections.some(section => section.topicId === question.topicId)) {
        return res.status(404).json({ error: "Вопрос не входит в этот тест" });
      }

      const [topic, scoring] = await Promise.all([
        storage.getTopic(question.topicId),
        loadTestScoringContext(testId, storage),
      ]);
      const effective = scoring.resolve(question);
      const override = scoring.overrideFor(questionId);

      // Другие тесты — только те, что читателю видны: о чужом тесте нельзя сказать даже имя.
      const windowStart = new Date();
      windowStart.setMonth(windowStart.getMonth() - config.delivery.exposureWindowMonths);
      const scope = await analyticsScope(req);
      const others = (await storage.getOtherTests(questionId, testId, windowStart))
        .filter(row => scope.has(row.testId));
      const otherTests: OtherTestRow[] = await Promise.all(others.map(async row => {
        const [test, measured] = await Promise.all([
          storage.getTest(row.testId),
          difficultyInTest(row.testId, questionId),
        ]);
        return {
          testId: row.testId,
          title: test?.title ?? "Удалённый тест",
          delivered: row.delivered,
          ...measured,
        };
      }));

      res.json({
        questionId,
        prompt: question.prompt,
        questionType: question.type,
        topicName: topic?.name ?? null,
        tags: question.tags ?? [],
        media: question.mediaUrl ? { url: question.mediaUrl, type: question.mediaType ?? "image" } : null,
        excluded: override?.excludedFromDelivery === true,
        points: effective.points,
        pointsInTest: effective.source.points === "override",
        scoringKind: effective.scoring.kind,
        scoringInTest: effective.source.scoring === "override",
        difficulty: scoring.difficultyOf(question),
        difficultyInTest: override?.difficulty !== null && override?.difficulty !== undefined,
        correctAnswer: OPTION_TYPES.has(question.type)
          ? null
          : formatCorrectAnswerText(question.type, question.dataJson, question.correctJson) || null,
        otherTests,
        // Окно экспозиции — для подписи «за последние N мес.»: клиент инстанса его не знает.
        windowMonths: config.delivery.exposureWindowMonths,
      });
    } catch (error) {
      logger.error("Question card error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Failed to load question card" });
    }
  },
);

export default router;
