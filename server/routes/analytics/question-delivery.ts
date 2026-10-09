/**
 * @module server/routes/analytics/question-delivery
 * @description PRD-56 FR-17a, FR-17b: исключение задания из выдачи теста и возврат в неё.
 *
 * Состояние меняет тот, кто читает аналитику: именно там видно, что задание негодно. Права —
 * те же, что на чтение аналитики этого теста, плюс область видимости теста: чужой тест
 * исправлять нельзя.
 *
 * Исключение ПРОВЕРЯЕТСЯ перед записью: если после него выдать тест станет нельзя, действие
 * запрещается, а не «выполняется с предупреждением» — сломанная выдача проявится не у автора в
 * аналитике, а у участника на старте попытки. Возврат в выдачу не проверяется и подтверждения
 * не требует: он ничего не отнимает, пул от него только растёт.
 */
import { Router, type Request, type Response } from "express";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { assessTestPublish } from "../../services/draw-feasibility";
import { resetPsychometricsCache } from "./psychometrics";

const router = Router();

/** Раздел теста, стоящий на теме задания. Без него задание к тесту отношения не имеет. */
async function sectionForQuestion(testId: string, questionId: string) {
  const question = await storage.getQuestion(questionId);
  if (!question) return null;
  const sections = await storage.getTestSections(testId);
  const section = sections.find(s => s.topicId === question.topicId);
  return section ? { question, section } : null;
}

/**
 * GET .../delivery-impact — последствия исключения, которые называет окно подтверждения.
 *
 * Числа, а не общие слова: сколько заданий останется в теме и сколько тест обязан выдать.
 * Ранее исключённые в остаток не входят — иначе окно обещает запас, которого нет.
 */
router.get(
  "/tests/:testId/questions/:questionId/delivery-impact",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const found = await sectionForQuestion(testId, questionId);
      if (!found) return res.status(404).json({ error: "Задание не входит в этот тест" });

      const { section } = found;
      const excluded = new Set(
        (await storage.getTestQuestionScoring(testId))
          .filter(row => row.excludedFromDelivery)
          .map(row => row.questionId),
      );
      // Считаем пул ПОСЛЕ исключения этого задания: окно показывает будущее, а не настоящее.
      excluded.add(questionId);
      const remaining = (await storage.getQuestionsByTopic(section.topicId))
        .filter(question => !excluded.has(question.id))
        .length;

      const topic = await storage.getTopic(section.topicId);
      const drawCount = section.drawAll ? remaining : section.drawCount;
      /**
       * Выполнимость судит ТОТ ЖЕ движок, что и само действие.
       *
       * Наивный остаток («восемь заданий на семь мест») не знает о квотах по тегам (PRD-11):
       * на приёмке окно обещало «можно» там, где квота «Охрана труда» уже не набиралась, а
       * действие отказывало. Обещание и отказ обязаны приходить из одного расчёта.
       */
      const findings = await assessTestPublish(testId, [questionId]);
      /**
       * Когда исключение подействует (эскиз prd56-test-analytics, окно исключения): прохождения
       * опубликованного теста идут по снимку, где вопрос ещё есть, и автор должен знать, что
       * до новой публикации ничего не изменится. `null` — тест не публиковался, и прохождения
       * идут по живому содержанию.
       */
      const snapshot = await storage.getLatestSnapshot(testId);

      res.json({
        topicId: section.topicId,
        topicName: topic?.name ?? "Тема",
        remaining,
        drawCount,
        allowed: findings.length === 0,
        findings,
        publishedAt: snapshot?.publishedAt ?? null,
      });
    } catch (error) {
      logger.error("Delivery impact error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to assess delivery impact" });
    }
  },
);

// PUT .../delivery — включить или снять состояние «исключён из выдачи»
router.put(
  "/tests/:testId/questions/:questionId/delivery",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const excluded = (req.body ?? {}).excluded;
      if (typeof excluded !== "boolean") {
        // Состояние — то, что переключают: без явного значения запрос неотличим от опечатки.
        return res.status(400).json({ error: "Нужно состояние: excluded true или false" });
      }

      const found = await sectionForQuestion(testId, questionId);
      if (!found) return res.status(404).json({ error: "Задание не входит в этот тест" });

      if (excluded) {
        // Спрашиваем о БУДУЩЕМ состоянии, ничего не записывая: запись с откатом оставила бы
        // окно, в котором чужая попытка стартует с пулом, которого автор не утверждал.
        const findings = await assessTestPublish(testId, [questionId]);
        if (findings.length > 0) {
          return res.status(409).json({
            error: "После исключения выдачу собрать нельзя: заданий в теме не хватит",
            findings,
          });
        }
        await storage.setQuestionDelivery(testId, questionId, true);
        // Пул выдачи изменился — «Качество вопросов» строит по нему строки «ещё не выдавался»
        // (план сверки 6.1), и кэш расчёта показывал бы прежний состав до минуты.
        resetPsychometricsCache(testId);
        return res.json({ excluded: true });
      }

      await storage.setQuestionDelivery(testId, questionId, false);
      resetPsychometricsCache(testId);
      res.json({ excluded: false });
    } catch (error) {
      logger.error("Question delivery error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to change question delivery" });
    }
  },
);

export default router;
