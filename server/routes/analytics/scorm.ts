import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { analyticsScope } from "./helpers";

const router = Router();

// GET /api/analytics/scorm-attempts - Все SCORM попытки
router.get("/scorm-attempts", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const attempts = await storage.getAllScormAttempts();
    const packages = await storage.getScormPackages();

    const packageMap = new Map(packages.map(p => [p.id, p]));

    // PRD-15 FR-08 (audit F-5): only attempts of readable tests; packages of
    // deleted tests remain visible to administrators only.
    const scope = await analyticsScope(req);
    const scopedAttempts = attempts.filter((a) =>
      scope.has(packageMap.get(a.packageId)?.testId ?? null),
    );

    const enrichedAttempts = await Promise.all(scopedAttempts.map(async (attempt) => {
      const pkg = packageMap.get(attempt.packageId);
      const answers = await storage.getScormAnswersByAttempt(attempt.id);

      return {
        id: attempt.id,
        packageId: attempt.packageId,
        sessionId: attempt.sessionId,
        testId: pkg?.testId || null,
        testTitle: pkg?.testTitle || "Удалённый тест",
        testMode: pkg?.testMode || "standard",
        lmsUserId: attempt.lmsUserId,
        lmsUserName: attempt.lmsUserName,
        lmsUserEmail: attempt.lmsUserEmail,
        lmsUserOrg: attempt.lmsUserOrg,
        startedAt: attempt.startedAt,
        finishedAt: attempt.finishedAt,
        resultPercent: attempt.resultPercent,
        resultPassed: attempt.resultPassed,
        totalPoints: attempt.totalPoints,
        maxPoints: attempt.maxPoints,
        totalQuestions: attempt.totalQuestions,
        correctAnswers: attempt.correctAnswers,
        achievedLevels: attempt.achievedLevelsJson,
        answersCount: answers.length,
        source: "lms" as const,
      };
    }));

    res.json(enrichedAttempts);
  } catch (error) {
    logger.error("Get SCORM attempts error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get SCORM attempts" });
  }
});

// GET /api/analytics/scorm-attempts/:attemptId - Детали SCORM попытки
router.get("/scorm-attempts/:attemptId", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const attempt = await storage.getScormAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    const pkg = await storage.getScormPackage(attempt.packageId);

    // PRD-15 FR-08 (audit F-5): a single LMS attempt is readable only within
    // the analytics scope of its test.
    const scope = await analyticsScope(req);
    if (!scope.has(pkg?.testId ?? null)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const answers = await storage.getScormAnswersByAttempt(attempt.id);

    const duration = attempt.startedAt && attempt.finishedAt
      ? (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000
      : null;

    const topicResultsMap = new Map<string, {
      topicId: string;
      topicName: string;
      earnedPoints: number;
      possiblePoints: number;
      correct: number;
      total: number;
    }>();

    const detailedAnswers = answers.map(a => {
      if (a.topicId) {
        const existing = topicResultsMap.get(a.topicId) || {
          topicId: a.topicId,
          topicName: a.topicName || "Unknown",
          earnedPoints: 0,
          possiblePoints: 0,
          correct: 0,
          total: 0,
        };
        existing.total++;
        existing.possiblePoints += a.maxPoints || 1;
        // PRD-18: accrue the BAKED partial points unconditionally — a tiered/weighted
        // row can be isCorrect=false with points>0 (points = scoreRatio*q.points,
        // baked at delivery). Gating earnedPoints behind isCorrect dropped that partial
        // credit, so the topic rollup under-counted vs the stored attempt total.
        existing.earnedPoints += a.points || 0;
        if (a.isCorrect) {
          existing.correct++;
        }
        topicResultsMap.set(a.topicId, existing);
      }

      return {
        questionId: a.questionId,
        questionPrompt: a.questionPrompt,
        questionType: a.questionType,
        topicId: a.topicId,
        topicName: a.topicName,
        difficulty: a.difficulty,
        userAnswer: a.userAnswerJson,
        correctAnswer: a.correctAnswerJson,
        isCorrect: a.isCorrect,
        earnedPoints: a.points,
        possiblePoints: a.maxPoints,
        options: a.optionsJson,
        leftItems: a.leftItemsJson,
        rightItems: a.rightItemsJson,
        items: a.itemsJson,
        levelIndex: a.levelIndex,
        levelName: a.levelName,
        answeredAt: a.answeredAt,
      };
    });

    const topicResults = Array.from(topicResultsMap.values()).map(tr => ({
      topicId: tr.topicId,
      topicName: tr.topicName,
      percent: tr.possiblePoints > 0 ? (tr.earnedPoints / tr.possiblePoints) * 100 : 0,
      passed: null,
      earnedPoints: tr.earnedPoints,
      possiblePoints: tr.possiblePoints,
    }));

    let achievedLevels = null;
    if (attempt.achievedLevelsJson) {
      try {
        achievedLevels = typeof attempt.achievedLevelsJson === 'string'
          ? JSON.parse(attempt.achievedLevelsJson as string)
          : attempt.achievedLevelsJson;
      } catch (e) {
        achievedLevels = null;
      }
    }

    res.json({
      attemptId: attempt.id,
      lmsUserId: attempt.lmsUserId,
      lmsUserName: attempt.lmsUserName,
      lmsUserEmail: attempt.lmsUserEmail,
      testId: pkg?.testId || null,
      testTitle: pkg?.testTitle || "Удалённый тест",
      testMode: pkg?.testMode || "standard",
      startedAt: attempt.startedAt?.toISOString() || null,
      finishedAt: attempt.finishedAt?.toISOString() || null,
      duration,
      overallPercent: attempt.resultPercent || 0,
      earnedPoints: attempt.totalPoints || 0,
      possiblePoints: attempt.maxPoints || 0,
      passed: attempt.resultPassed || false,
      answers: detailedAnswers,
      topicResults,
      achievedLevels,
      source: "lms",
    });
  } catch (error) {
    logger.error("Get SCORM attempt details error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get attempt details" });
  }
});

export default router;