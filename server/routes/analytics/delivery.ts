/**
 * @module server/routes/analytics/delivery
 * @description PRD-56 FR-18 - FR-20: вкладка «Выдача» — варианты, версии публикации и профиль
 * экспозиции банка.
 *
 * Одна ручка на три блока: все они отвечают об одном и том же наборе прохождений, и разбивать
 * их на три запроса значило бы трижды выбрать одно и то же. Профиль экспозиции строится по
 * ОДНОЙ теме (у разных тем разные квоты выдачи), поэтому тема приходит параметром; без него
 * берётся первый раздел теста.
 *
 * Права те же, что у остальных ручек теста: `analytics.read` плюс область видимости теста.
 */
import { Router, type Request, type Response } from "express";

import { config } from "../../config";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { renderBlanksText } from "@shared/questions/blanks-render";
import { plainPromptOf } from "@shared/questions/prompt-format";
import { loadObservations } from "../../services/analytics/observations";
import { loadDeliveryPool } from "../../services/delivery-pool";
import {
  exposureProfile,
  variantStats,
  versionStats,
  type SectionForms,
} from "../../services/analytics/delivery-stats";

const router = Router();

/**
 * GET /api/analytics/tests/:testId/dictionary — варианты и версии теста для окна условий.
 *
 * Лёгкий справочник, а не соседняя ручка выдачи: та считает проходимость по каждому варианту
 * и профиль банка, а форме отбора нужны только подписи. Платить за расчёт, чтобы наполнить
 * выпадающий список, значит делать открытие фильтра дороже самой выборки.
 *
 * Условия «вариант» и «версия» осмысленны ВНУТРИ одного теста (у разных тестов они свои),
 * поэтому справочник и привязан к тесту, а не отдаётся общим списком.
 */
router.get(
  "/tests/:testId/dictionary",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId } = req.params;
      // Подписи вопросов — только запрошенных: чипу «Ошибка в вопросе» (FR-17) нужен текст
      // одного вопроса, а не весь банк теста.
      const questionIds = (Array.isArray(req.query.questionId) ? req.query.questionId : [req.query.questionId])
        .filter((id): id is string => typeof id === "string" && id.trim() !== "");
      const [sections, snapshots, questions] = await Promise.all([
        storage.getTestSections(testId),
        storage.getSnapshotsForTest(testId),
        questionIds.length ? storage.getQuestionsByIds(questionIds) : Promise.resolve([]),
      ]);

      res.json({
        // Вариант принадлежит РАЗДЕЛУ, но в условии отбора он один на тест: прохождение
        // попадает в выборку, если хоть один его вариант отобран.
        forms: sections.flatMap(section => (section.formSetJson?.forms ?? []).map(form => ({
          id: form.id,
          label: form.label,
        }))),
        versions: snapshots.map(snapshot => ({
          id: snapshot.id,
          version: snapshot.version,
        })),
        questions: questions.map(question => ({
          id: question.id,
          label: plainPromptOf({
            ...question,
            prompt: renderBlanksText(question.prompt, { mode: "dash" }),
          }),
        })),
      });
    } catch (error) {
      logger.error("Test dictionary error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to load test dictionary" });
    }
  },
);

router.get(
  "/tests/:testId/delivery",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId } = req.params;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Test not found" });

      const [{ rows: observations }, sections, snapshots, topics] = await Promise.all([
        // Область видимости уже проверена `requireTestScope`, поэтому здесь она открыта —
        // тот же порядок, что на остальных ручках теста.
        loadObservations({ testIds: [testId] }, { all: true, ids: new Set([testId]) }),
        storage.getTestSections(testId),
        storage.getSnapshotsForTest(testId),
        storage.getTopics(),
      ]);
      const topicNames = new Map(topics.map(topic => [topic.id, topic.name]));
      const opts = { minObservations: config.analytics.minObservations };

      const sectionForms: SectionForms[] = sections.map(section => ({
        topicId: section.topicId,
        topicName: topicNames.get(section.topicId) ?? "Без темы",
        forms: (section.formSetJson?.forms ?? []).map(form => ({
          id: form.id,
          label: form.label,
        })),
      }));

      // Профиль — по КАЖДОМУ разделу (замечание владельца 2026-10-04: выбор темы прятал
      // остальные). Темы не складываются в один список — у них разные квоты, — а идут блоками.
      // Окно, пул выдачи и исключения общие, поэтому читаются один раз.
      const windowStart = new Date();
      windowStart.setMonth(windowStart.getMonth() - config.delivery.exposureWindowMonths);
      // Доля считается от попыток за окно счётчика выдач (PRD-55), СЧИТАЯ брошенные — они
      // показали задание так же, как доведённые до конца.
      const attemptsInWindow = observations.filter(o => o.startedAt >= windowStart).length;
      // Пул выдачи — ОДНО определение с «Качеством вопросов» и проверкой публикации
      // (`delivery-pool`): без исключённых, для раздела с вариантами — вопросы вариантов, для
      // адаптива — вопросы уровней. Банк темы читается целиком: задание, выданное раньше и
      // выпавшее из пула, свою историю выдач сохраняет строкой профиля.
      const deliveryPool = sections.length > 0 ? await loadDeliveryPool(testId) : null;
      const excluded = deliveryPool?.excluded ?? new Set<string>();

      const profiles = [];
      for (const section of sections) {
        const sectionPool = deliveryPool?.sections.find(p => p.section.id === section.id)
          ?? deliveryPool?.sections.find(p => p.section.topicId === section.topicId);
        const bank = sectionPool?.bank ?? await storage.getQuestionsByTopic(section.topicId);
        const inPool = new Set((sectionPool?.pool ?? []).map(question => question.id));
        // Сбой чтения счётчиков не имеет права уронить экран: без них профиль показывает
        // «не выдавалось ни разу», что честнее выдуманных долей.
        let deliveredCounts = new Map<string, number>();
        try {
          deliveredCounts = await storage.getDeliveryCountsForTest(
            bank.map(q => q.id),
            testId,
            windowStart,
          );
        } catch (error) {
          logger.warn("PRD-56: счётчики выдач не прочитаны — " + (error as Error).message);
        }

        profiles.push(exposureProfile({
          topicId: section.topicId,
          topicName: topicNames.get(section.topicId) ?? "Без темы",
          // Квота применяется не всегда: вариант раздела и уровни адаптива её не читают.
          drawMode: test.mode === "adaptive"
            ? "adaptive"
            : (section.formSetJson?.forms?.length ?? 0) > 0
              ? "forms"
              : section.drawAll ? "all" : "quota",
          drawCount: section.drawAll ? null : section.drawCount,
          bank: bank.map(question => ({
            id: question.id,
            prompt: question.prompt,
            type: question.type,
            tags: question.tags ?? [],
            excluded: excluded.has(question.id),
            inPool: inPool.has(question.id),
          })),
          deliveredCounts,
          attemptsInWindow,
        }));
      }

      res.json({
        testId,
        testMode: test.mode,
        variants: variantStats(observations, sectionForms, opts),
        versions: versionStats(
          observations,
          snapshots.map(s => ({ id: s.id, version: s.version, publishedAt: s.publishedAt })),
          opts,
        ),
        // По профилю на раздел, в порядке разделов теста.
        exposure: profiles,
        minObservations: opts.minObservations,
      });
    } catch (error) {
      logger.error("Delivery analytics error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to fetch delivery analytics" });
    }
  },
);

export default router;
