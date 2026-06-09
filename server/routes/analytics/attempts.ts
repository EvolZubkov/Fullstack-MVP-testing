import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { checkAnswer } from "../../utils/check-answer";

const router = Router();

// GET /api/analytics/tests/:testId/attempts - Список попыток теста
router.get("/tests/:testId/attempts", requirePermission("analytics.read"), requireTestScope("analytics", "testId"), async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId;
    const test = await storage.getTest(testId);

    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const allAttempts = await storage.getAllAttempts();
    const testAttempts = allAttempts.filter(a => a.testId === testId);

    const userIds = Array.from(new Set(testAttempts.map(a => a.userId)));
    const users = await Promise.all(userIds.map(id => storage.getUser(id)));
    const userMap = new Map<string, string>();
    for (const u of users) {
      if (u) userMap.set(u.id, u.name || u.email || "Unknown");
    }

    const attemptsList = testAttempts.map(attempt => {
      const result = attempt.resultJson as any;
      const duration = attempt.startedAt && attempt.finishedAt
        ? (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000
        : null;

      let achievedLevels: Array<{ topicName: string; levelName: string | null }> | undefined;
      if (test.mode === "adaptive" && result?.topicResults) {
        achievedLevels = result.topicResults.map((tr: any) => ({
          topicName: tr.topicName,
          levelName: tr.achievedLevelName || null,
        }));
      }

      return {
        attemptId: attempt.id,
        userId: attempt.userId,
        username: userMap.get(attempt.userId) || "Unknown",
        startedAt: attempt.startedAt?.toISOString() || null,
        finishedAt: attempt.finishedAt?.toISOString() || null,
        duration,
        overallPercent: result?.overallPercent || 0,
        earnedPoints: result?.totalEarnedPoints || 0,
        possiblePoints: result?.totalPossiblePoints || 0,
        passed: result?.overallPassed || false,
        completed: result !== null,
        achievedLevels,
      };
    }).sort((a, b) => {
      if (a.completed !== b.completed) return b.completed ? 1 : -1;
      const dateA = a.finishedAt || a.startedAt || "";
      const dateB = b.finishedAt || b.startedAt || "";
      return dateB.localeCompare(dateA);
    });

    res.json({
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      attempts: attemptsList,
    });

  } catch (error) {
    logger.error("Test attempts list error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch attempts list" });
  }
});

// GET /api/analytics/attempts/:attemptId - Детали попытки
router.get("/attempts/:attemptId", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const attemptId = req.params.attemptId;
    const attempt = await storage.getAttempt(attemptId);

    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    const test = await storage.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const user = await storage.getUser(attempt.userId);
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    const result = attempt.resultJson as any;
    const answers = (attempt.answersJson || {}) as Record<string, unknown>;
    const variant = attempt.variantJson as any;

    const questionIds: string[] = [];
    if (variant?.sections) {
      for (const section of variant.sections) {
        questionIds.push(...(section.questionIds || []));
      }
    }
    if (variant?.topics) {
      for (const topic of variant.topics) {
        for (const level of topic.levelsState || []) {
          questionIds.push(...(level.questionIds || []));
        }
      }
    }

    const uniqueQuestionIds = Array.from(new Set(questionIds));
    const questions = await storage.getQuestionsByIds(uniqueQuestionIds);
    const questionMap = new Map(questions.map(q => [q.id, q]));

    const detailedAnswers: any[] = [];

    for (const [qId, userAnswer] of Object.entries(answers)) {
      const question = questionMap.get(qId);
      if (!question) continue;

      const isCorrect = checkAnswer(question, userAnswer) === 1;

      let levelName: string | undefined;
      let levelIndex: number | undefined;

      if (variant?.topics) {
        for (const topic of variant.topics) {
          for (const level of topic.levelsState || []) {
            if (level.answeredQuestionIds?.includes(qId)) {
              levelName = level.levelName;
              levelIndex = level.levelIndex;
              break;
            }
          }
        }
      }

      const dataJson = question.dataJson as any;
      const correctJson = question.correctJson as any;

      let formattedUserAnswer: any = userAnswer;
      let formattedCorrectAnswer: any = correctJson;

      if (question.type === "single" && dataJson?.options) {
        formattedUserAnswer = dataJson.options[userAnswer as number] || userAnswer;
        formattedCorrectAnswer = dataJson.options[correctJson?.correctIndex] || correctJson;
      } else if (question.type === "multiple" && dataJson?.options) {
        const userIndices = (userAnswer as number[]) || [];
        formattedUserAnswer = userIndices.map(i => dataJson.options[i]).filter(Boolean);
        formattedCorrectAnswer = (correctJson?.correctIndices || []).map((i: number) => dataJson.options[i]).filter(Boolean);
      } else if (question.type === "matching" && dataJson?.left && dataJson?.right) {
        const userPairs = userAnswer as Record<number, number> || {};
        formattedUserAnswer = Object.entries(userPairs).map(([l, r]) => ({
          left: dataJson.left[parseInt(l)],
          right: dataJson.right[r as number],
        }));
        formattedCorrectAnswer = (correctJson?.pairs || []).map((p: { left: number, right: number }) => ({
          left: dataJson.left[p.left],
          right: dataJson.right[p.right],
        }));
      } else if (question.type === "ranking" && dataJson?.items) {
        const userOrder = (userAnswer as number[]) || [];
        formattedUserAnswer = userOrder.map(i => dataJson.items[i]).filter(Boolean);
        formattedCorrectAnswer = (correctJson?.correctOrder || []).map((i: number) => dataJson.items[i]).filter(Boolean);
      }

      detailedAnswers.push({
        questionId: qId,
        questionPrompt: question.prompt,
        questionType: question.type,
        topicId: question.topicId,
        topicName: topicMap.get(question.topicId) || "Unknown",
        userAnswer: formattedUserAnswer,
        userAnswerRaw: userAnswer,
        correctAnswer: formattedCorrectAnswer,
        correctAnswerRaw: correctJson,
        isCorrect,
        earnedPoints: isCorrect ? (question.points || 1) : 0,
        possiblePoints: question.points || 1,
        difficulty: question.difficulty || 50,
        levelName,
        levelIndex,
        questionData: dataJson,
      });
    }

    let trajectory: any[] | undefined;
    let achievedLevels: any[] | undefined;

    if (test.mode === "adaptive" && variant?.topics) {
      achievedLevels = variant.topics.map((t: any) => ({
        topicId: t.topicId,
        topicName: t.topicName,
        levelIndex: t.finalLevelIndex,
        levelName: t.finalLevelIndex !== null && t.levelsState[t.finalLevelIndex]
          ? t.levelsState[t.finalLevelIndex].levelName
          : null,
      }));

      trajectory = [];
      for (const topic of variant.topics) {
        for (const level of topic.levelsState || []) {
          if (level.status === "passed" || level.status === "failed") {
            trajectory.push({
              action: level.status === "passed" ? "level_up" : "level_down",
              topicId: topic.topicId,
              topicName: topic.topicName,
              levelIndex: level.levelIndex,
              levelName: level.levelName,
              message: level.status === "passed"
                ? `Уровень "${level.levelName}" пройден`
                : `Уровень "${level.levelName}" не пройден`,
            });
          }
        }
      }
    }

    const duration = attempt.startedAt && attempt.finishedAt
      ? (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000
      : null;

    res.json({
      attemptId: attempt.id,
      userId: attempt.userId,
      username: user?.name || user?.email || "Unknown",
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      startedAt: attempt.startedAt?.toISOString() || null,
      finishedAt: attempt.finishedAt?.toISOString() || null,
      duration,
      overallPercent: result?.overallPercent || 0,
      earnedPoints: result?.totalEarnedPoints || 0,
      possiblePoints: result?.totalPossiblePoints || 0,
      passed: result?.overallPassed || false,
      answers: detailedAnswers,
      topicResults: result?.topicResults || [],
      trajectory,
      achievedLevels,
    });

  } catch (error) {
    logger.error("Attempt detail error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch attempt details" });
  }
});

export default router;