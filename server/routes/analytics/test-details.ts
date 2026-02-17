import { Router, Request, Response } from "express";
import { storage } from "../../storage";
import { requireAuthor } from "../../middleware/auth";
import { checkAnswer } from "../../utils/check-answer";
import type { AttemptResult } from "@shared/schema";

const router = Router();

// GET /api/analytics/tests/:testId - Детальная аналитика теста
router.get("/:testId", requireAuthor, async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId;
    const test = await storage.getTest(testId);

    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const allAttempts = await storage.getAllAttempts();
    const testAttempts = allAttempts.filter(a => a.testId === testId);
    const completedAttempts = testAttempts.filter(a => a.resultJson !== null);

    const uniqueUsers = new Set(completedAttempts.map(a => a.userId)).size;

    let totalPercent = 0;
    let totalPassed = 0;
    let totalScore = 0;
    let maxScore = 0;
    let totalDuration = 0;
    let durationCount = 0;

    for (const attempt of completedAttempts) {
      const result = attempt.resultJson as AttemptResult | null;
      if (result) {
        totalPercent += result.overallPercent || 0;
        if (result.overallPassed) totalPassed++;
        totalScore += result.totalEarnedPoints || 0;
        if ((result.totalPossiblePoints || 0) > maxScore) {
          maxScore = result.totalPossiblePoints || 0;
        }

        if (attempt.startedAt && attempt.finishedAt) {
          const duration = (new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000;
          totalDuration += duration;
          durationCount++;
        }
      }
    }

    const summary = {
      totalAttempts: testAttempts.length,
      completedAttempts: completedAttempts.length,
      uniqueUsers,
      avgPercent: completedAttempts.length > 0 ? totalPercent / completedAttempts.length : 0,
      avgDuration: durationCount > 0 ? totalDuration / durationCount : null,
      passRate: completedAttempts.length > 0 ? (totalPassed / completedAttempts.length) * 100 : 0,
      avgScore: completedAttempts.length > 0 ? totalScore / completedAttempts.length : 0,
      maxScore,
    };

    // Topic stats
    interface TopicStatsEntry {
      topicId: string;
      topicName: string;
      totalAnswers: number;
      correctAnswers: number;
      earnedPoints: number;
      possiblePoints: number;
      passedCount: number;
      failedCount: number;
    }

    const topicStatsMap = new Map<string, TopicStatsEntry>();

    for (const attempt of completedAttempts) {
      const result = attempt.resultJson as any;
      if (!result?.topicResults) continue;

      for (const tr of result.topicResults) {
        const existing = topicStatsMap.get(tr.topicId) || {
          topicId: tr.topicId,
          topicName: tr.topicName,
          totalAnswers: 0,
          correctAnswers: 0,
          earnedPoints: 0,
          possiblePoints: 0,
          passedCount: 0,
          failedCount: 0,
        };

        existing.totalAnswers += tr.total || tr.totalQuestionsAnswered || 0;
        existing.correctAnswers += tr.correct || tr.totalCorrect || 0;
        existing.earnedPoints += tr.earnedPoints || 0;
        existing.possiblePoints += tr.possiblePoints || 0;

        if (tr.passed === true || (tr.achievedLevelIndex !== undefined && tr.achievedLevelIndex !== null)) {
          existing.passedCount++;
        } else if (tr.passed === false || tr.achievedLevelIndex === null) {
          existing.failedCount++;
        }

        topicStatsMap.set(tr.topicId, existing);
      }
    }

    const topicStats = Array.from(topicStatsMap.values()).map(ts => ({
      topicId: ts.topicId,
      topicName: ts.topicName,
      totalAnswers: ts.totalAnswers,
      correctAnswers: ts.correctAnswers,
      avgPercent: ts.possiblePoints > 0 ? (ts.earnedPoints / ts.possiblePoints) * 100 : 0,
      passRate: (ts.passedCount + ts.failedCount) > 0
        ? (ts.passedCount / (ts.passedCount + ts.failedCount)) * 100
        : null,
    }));

    // Question stats
    const allQuestionIds = new Set<string>();
    for (const attempt of testAttempts) {
      const variant = attempt.variantJson as any;
      if (variant?.sections) {
        for (const section of variant.sections) {
          for (const qId of section.questionIds || []) {
            allQuestionIds.add(qId);
          }
        }
      }
      if (variant?.topics) {
        for (const topic of variant.topics) {
          for (const level of topic.levelsState || []) {
            for (const qId of level.questionIds || []) {
              allQuestionIds.add(qId);
            }
          }
        }
      }
    }

    const questions = await storage.getQuestionsByIds(Array.from(allQuestionIds));
    const questionMap = new Map(questions.map(q => [q.id, q]));
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    interface QuestionStatsEntry {
      questionId: string;
      questionPrompt: string;
      questionType: string;
      topicId: string;
      topicName: string;
      difficulty: number;
      totalAnswers: number;
      correctAnswers: number;
    }

    const questionStatsMap = new Map<string, QuestionStatsEntry>();

    for (const attempt of completedAttempts) {
      const answers = (attempt.answersJson || {}) as Record<string, unknown>;

      for (const [qId, answer] of Object.entries(answers)) {
        const question = questionMap.get(qId);
        if (!question) continue;

        const existing = questionStatsMap.get(qId) || {
          questionId: qId,
          questionPrompt: question.prompt,
          questionType: question.type,
          topicId: question.topicId,
          topicName: topicMap.get(question.topicId) || "Unknown",
          difficulty: question.difficulty || 50,
          totalAnswers: 0,
          correctAnswers: 0,
        };

        existing.totalAnswers++;
        if (checkAnswer(question, answer) === 1) {
          existing.correctAnswers++;
        }

        questionStatsMap.set(qId, existing);
      }
    }

    const questionStats = Array.from(questionStatsMap.values()).map(qs => ({
      ...qs,
      correctPercent: qs.totalAnswers > 0 ? (qs.correctAnswers / qs.totalAnswers) * 100 : 0,
    })).sort((a, b) => a.correctPercent - b.correctPercent);

    // Level stats (adaptive)
    interface LevelStatsEntry {
      levelIndex: number;
      levelName: string;
      topicId: string;
      topicName: string;
      achievedCount: number;
      attemptedCount: number;
      passedCount: number;
      failedCount: number;
      totalCorrect: number;
      totalAnswered: number;
    }

    let levelStats: Array<LevelStatsEntry & { avgCorrectPercent: number }> = [];

    if (test.mode === "adaptive") {
      const levelStatsMap = new Map<string, LevelStatsEntry>();

      for (const attempt of completedAttempts) {
        const result = attempt.resultJson as any;
        if (!result?.topicResults) continue;

        for (const tr of result.topicResults) {
          if (tr.achievedLevelIndex !== undefined && tr.achievedLevelIndex !== null) {
            const key = `${tr.topicId}-${tr.achievedLevelIndex}`;
            const existing = levelStatsMap.get(key) || {
              levelIndex: tr.achievedLevelIndex,
              levelName: tr.achievedLevelName || `Level ${tr.achievedLevelIndex}`,
              topicId: tr.topicId,
              topicName: tr.topicName,
              achievedCount: 0,
              attemptedCount: 0,
              passedCount: 0,
              failedCount: 0,
              totalCorrect: 0,
              totalAnswered: 0,
            };
            existing.achievedCount++;
            levelStatsMap.set(key, existing);
          }

          for (const la of tr.levelsAttempted || []) {
            const key = `${tr.topicId}-${la.levelIndex}`;
            const existing = levelStatsMap.get(key) || {
              levelIndex: la.levelIndex,
              levelName: la.levelName,
              topicId: tr.topicId,
              topicName: tr.topicName,
              achievedCount: 0,
              attemptedCount: 0,
              passedCount: 0,
              failedCount: 0,
              totalCorrect: 0,
              totalAnswered: 0,
            };

            existing.attemptedCount++;
            existing.totalCorrect += la.correctCount || 0;
            existing.totalAnswered += la.questionsAnswered || 0;

            if (la.status === "passed") existing.passedCount++;
            else if (la.status === "failed") existing.failedCount++;

            levelStatsMap.set(key, existing);
          }
        }
      }

      levelStats = Array.from(levelStatsMap.values()).map(ls => ({
        ...ls,
        avgCorrectPercent: ls.totalAnswered > 0 ? (ls.totalCorrect / ls.totalAnswered) * 100 : 0,
      })).sort((a, b) => {
        if (a.topicId !== b.topicId) return a.topicId.localeCompare(b.topicId);
        return a.levelIndex - b.levelIndex;
      });
    }

    // Score distribution
    const scoreRanges = [
      { range: "0-10", min: 0, max: 10, count: 0 },
      { range: "11-20", min: 11, max: 20, count: 0 },
      { range: "21-30", min: 21, max: 30, count: 0 },
      { range: "31-40", min: 31, max: 40, count: 0 },
      { range: "41-50", min: 41, max: 50, count: 0 },
      { range: "51-60", min: 51, max: 60, count: 0 },
      { range: "61-70", min: 61, max: 70, count: 0 },
      { range: "71-80", min: 71, max: 80, count: 0 },
      { range: "81-90", min: 81, max: 90, count: 0 },
      { range: "91-100", min: 91, max: 100, count: 0 },
    ];

    for (const attempt of completedAttempts) {
      const result = attempt.resultJson as AttemptResult | null;
      const percent = result?.overallPercent || 0;
      for (const range of scoreRanges) {
        if (percent >= range.min && percent <= range.max) {
          range.count++;
          break;
        }
      }
    }

    const scoreDistribution = scoreRanges.map(r => ({ range: r.range, count: r.count }));

    // Daily trends
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyMap = new Map<string, { date: string; attempts: number; totalPercent: number; passed: number }>();

    for (const attempt of completedAttempts) {
      if (!attempt.finishedAt) continue;
      const finishedDate = new Date(attempt.finishedAt);
      if (finishedDate < thirtyDaysAgo) continue;

      const dateStr = finishedDate.toISOString().split("T")[0];
      const result = attempt.resultJson as AttemptResult | null;

      const existing = dailyMap.get(dateStr) || { date: dateStr, attempts: 0, totalPercent: 0, passed: 0 };
      existing.attempts++;
      existing.totalPercent += result?.overallPercent || 0;
      if (result?.overallPassed) existing.passed++;
      dailyMap.set(dateStr, existing);
    }

    const dailyTrends = Array.from(dailyMap.values())
      .map(d => ({
        date: d.date,
        attempts: d.attempts,
        avgPercent: d.attempts > 0 ? d.totalPercent / d.attempts : 0,
        passRate: d.attempts > 0 ? (d.passed / d.attempts) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      summary,
      topicStats,
      questionStats,
      levelStats: test.mode === "adaptive" ? levelStats : undefined,
      scoreDistribution,
      dailyTrends,
    });

  } catch (error) {
    console.error("Test analytics error:", error);
    res.status(500).json({ error: "Failed to fetch test analytics" });
  }
});

export default router;