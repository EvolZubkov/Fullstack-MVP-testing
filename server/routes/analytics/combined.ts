import { Router, Request, Response } from "express";
import { storage } from "../../storage";
import { requireAuthor } from "../../middleware/auth";
import { checkAnswer } from "../../utils/check-answer";

const router = Router();

// GET /api/analytics/combined - Комбинированная аналитика (Web + LMS)
router.get("/combined", requireAuthor, async (req: Request, res: Response) => {
  try {
    const source = req.query.source as string || "all";
    const testId = req.query.testId as string || null;

    let webAttempts: any[] = [];
    let lmsAttempts: any[] = [];

    // Web attempts
    if (source === "all" || source === "web") {
      const attempts = await storage.getAllAttempts();
      const users = await Promise.all(
        [...new Set(attempts.map(a => a.userId))].map(id => storage.getUser(id))
      );
      const userMap = new Map(users.filter(Boolean).map(u => [u!.id, u!]));

      const tests = await storage.getTests();
      const testMap = new Map(tests.map(t => [t.id, t]));

      webAttempts = attempts
        .filter(a => !testId || a.testId === testId)
        .filter(a => a.finishedAt)
        .map(a => {
          const user = userMap.get(a.userId);
          const result = a.resultJson as any;
          const test = testMap.get(a.testId);
          return {
            id: a.id,
            testId: a.testId,
            testTitle: test?.title || "Удалённый тест",
            userId: a.userId,
            username: user?.name || user?.email || "Unknown",
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            resultPercent: result?.overallPercent || 0,
            resultPassed: result?.overallPassed || false,
            totalPoints: result?.totalEarnedPoints || 0,
            maxPoints: result?.totalPossiblePoints || 0,
            source: "web" as const,
          };
        });
    }

    // LMS attempts
    if (source === "all" || source === "lms") {
      const attempts = await storage.getAllScormAttempts();
      const packages = await storage.getScormPackages();
      const packageMap = new Map(packages.map(p => [p.id, p]));

      lmsAttempts = attempts
        .filter(a => {
          if (!testId) return true;
          const pkg = packageMap.get(a.packageId);
          return pkg?.testId === testId;
        })
        .filter(a => a.finishedAt)
        .map(a => {
          const pkg = packageMap.get(a.packageId);
          return {
            id: a.id,
            testId: pkg?.testId || null,
            testTitle: pkg?.testTitle || "Удалённый тест",
            lmsUserId: a.lmsUserId,
            lmsUserName: a.lmsUserName,
            lmsUserEmail: a.lmsUserEmail,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            resultPercent: a.resultPercent || 0,
            resultPassed: a.resultPassed || false,
            totalPoints: a.totalPoints || 0,
            maxPoints: a.maxPoints || 0,
            source: "lms" as const,
          };
        });
    }

    const combined = [...webAttempts, ...lmsAttempts].sort((a, b) =>
      new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );

    const totalAttempts = combined.length;
    const passedAttempts = combined.filter(a => a.resultPassed).length;
    const avgPercent = totalAttempts > 0
      ? combined.reduce((sum, a) => sum + (a.resultPercent || 0), 0) / totalAttempts
      : 0;

    res.json({
      summary: {
        totalAttempts,
        passedAttempts,
        passRate: totalAttempts > 0 ? (passedAttempts / totalAttempts) * 100 : 0,
        avgPercent,
        webAttempts: webAttempts.length,
        lmsAttempts: lmsAttempts.length,
      },
      attempts: combined,
    });
  } catch (error) {
    console.error("Get combined analytics error:", error);
    res.status(500).json({ error: "Failed to get combined analytics" });
  }
});

// GET /api/analytics/combined-full - Полная комбинированная аналитика
router.get("/combined-full", requireAuthor, async (req: Request, res: Response) => {
  try {
    const source = (req.query.source as string) || "all";
    const testIdFilter = req.query.testId as string | undefined;

    let webAttempts: any[] = [];
    let lmsAttempts: any[] = [];
    const allTests = await storage.getTests();
    const testMap = new Map(allTests.map(t => [t.id, t]));
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    // WEB ATTEMPTS
    if (source === "all" || source === "web") {
      const attempts = await storage.getAllAttempts();
      const users = await Promise.all(
        [...new Set(attempts.map(a => a.userId))].map(id => storage.getUser(id))
      );
      const userMap = new Map(users.filter(Boolean).map(u => [u!.id, u!]));

      webAttempts = attempts
        .filter(a => !testIdFilter || a.testId === testIdFilter)
        .filter(a => a.finishedAt)
        .map(a => {
          const user = userMap.get(a.userId);
          const test = testMap.get(a.testId);
          const result = a.resultJson as any;
          const duration = a.startedAt && a.finishedAt
            ? (new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000
            : null;
          return {
            id: a.id,
            testId: a.testId,
            testTitle: test?.title || "Удалённый тест",
            testMode: test?.mode || "standard",
            userId: a.userId,
            username: user?.name || user?.email || "Unknown",
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            duration,
            resultPercent: result?.overallPercent || 0,
            resultPassed: result?.overallPassed || false,
            totalPoints: result?.earnedPoints || result?.totalEarnedPoints || 0,
            maxPoints: result?.possiblePoints || result?.totalPossiblePoints || 0,
            source: "web" as const,
          };
        });
    }

    // LMS ATTEMPTS
    if (source === "all" || source === "lms") {
      const attempts = await storage.getAllScormAttempts();
      const packages = await storage.getScormPackages();
      const packageMap = new Map(packages.map(p => [p.id, p]));

      lmsAttempts = attempts
        .filter(a => {
          if (!testIdFilter) return true;
          const pkg = packageMap.get(a.packageId);
          return pkg?.testId === testIdFilter;
        })
        .filter(a => a.finishedAt)
        .map(a => {
          const pkg = packageMap.get(a.packageId);
          const duration = a.startedAt && a.finishedAt
            ? (new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000
            : null;
          return {
            id: a.id,
            testId: pkg?.testId || null,
            testTitle: pkg?.testTitle || "Удалённый тест",
            testMode: pkg?.testMode || "standard",
            lmsUserId: a.lmsUserId,
            lmsUserName: a.lmsUserName,
            lmsUserEmail: a.lmsUserEmail,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            duration,
            resultPercent: a.resultPercent || 0,
            resultPassed: a.resultPassed || false,
            totalPoints: a.totalPoints || 0,
            maxPoints: a.maxPoints || 0,
            source: "lms" as const,
          };
        });
    }

    const combined = [...webAttempts, ...lmsAttempts].sort(
      (a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime()
    );

    // SUMMARY
    const totalAttempts = combined.length;
    const passedAttempts = combined.filter(a => a.resultPassed).length;
    const avgPercent = totalAttempts > 0
      ? combined.reduce((sum, a) => sum + (a.resultPercent || 0), 0) / totalAttempts
      : 0;

    const uniqueWebUsers = new Set(webAttempts.map(a => a.userId)).size;
    const uniqueLmsUsers = new Set(lmsAttempts.map(a => a.lmsUserId).filter(Boolean)).size;

    // TEST STATS
    const testStatsMap = new Map<string, {
      testId: string;
      testTitle: string;
      totalAttempts: number;
      webAttempts: number;
      lmsAttempts: number;
      passedCount: number;
      totalPercent: number;
    }>();

    combined.forEach(a => {
      if (!a.testId) return;
      const existing = testStatsMap.get(a.testId) || {
        testId: a.testId,
        testTitle: a.testTitle,
        totalAttempts: 0,
        webAttempts: 0,
        lmsAttempts: 0,
        passedCount: 0,
        totalPercent: 0,
      };
      existing.totalAttempts++;
      if (a.source === "web") existing.webAttempts++;
      else existing.lmsAttempts++;
      if (a.resultPassed) existing.passedCount++;
      existing.totalPercent += a.resultPercent || 0;
      testStatsMap.set(a.testId, existing);
    });

    const testStats = Array.from(testStatsMap.values()).map(ts => ({
      testId: ts.testId,
      testTitle: ts.testTitle,
      totalAttempts: ts.totalAttempts,
      webAttempts: ts.webAttempts,
      lmsAttempts: ts.lmsAttempts,
      passRate: ts.totalAttempts > 0 ? (ts.passedCount / ts.totalAttempts) * 100 : 0,
      avgPercent: ts.totalAttempts > 0 ? ts.totalPercent / ts.totalAttempts : 0,
    }));

    // TOPIC STATS
    const topicStatsMap = new Map<string, {
      topicId: string;
      topicName: string;
      totalAnswers: number;
      correctAnswers: number;
      totalPercent: number;
      failureCount: number;
    }>();

    for (const attempt of lmsAttempts) {
      const answers = await storage.getScormAnswersByAttempt(attempt.id);
      for (const ans of answers) {
        if (!ans.topicId) continue;
        const existing = topicStatsMap.get(ans.topicId) || {
          topicId: ans.topicId,
          topicName: ans.topicName || topicMap.get(ans.topicId) || "Unknown",
          totalAnswers: 0,
          correctAnswers: 0,
          totalPercent: 0,
          failureCount: 0,
        };
        existing.totalAnswers++;
        if (ans.isCorrect) existing.correctAnswers++;
        else existing.failureCount++;
        topicStatsMap.set(ans.topicId, existing);
      }
    }

    for (const attempt of webAttempts) {
      const fullAttempt = await storage.getAttempt(attempt.id);
      if (!fullAttempt?.answersJson) continue;
      const answers = fullAttempt.answersJson as Record<string, any>;

      const questionIds = Object.keys(answers);
      const questions = await storage.getQuestionsByIds(questionIds);

      for (const q of questions) {
        const existing = topicStatsMap.get(q.topicId) || {
          topicId: q.topicId,
          topicName: topicMap.get(q.topicId) || "Unknown",
          totalAnswers: 0,
          correctAnswers: 0,
          totalPercent: 0,
          failureCount: 0,
        };
        existing.totalAnswers++;
        const isCorrect = checkAnswer(q, answers[q.id]) === 1;
        if (isCorrect) existing.correctAnswers++;
        else existing.failureCount++;
        topicStatsMap.set(q.topicId, existing);
      }
    }

    const topicStats = Array.from(topicStatsMap.values()).map(ts => ({
      ...ts,
      avgPercent: ts.totalAnswers > 0 ? (ts.correctAnswers / ts.totalAnswers) * 100 : 0,
    }));

    // TRENDS (30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const trendsMap = new Map<string, {
      date: string;
      attempts: number;
      webAttempts: number;
      lmsAttempts: number;
      passedCount: number;
      totalPercent: number;
    }>();

    for (let i = 0; i < 30; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split("T")[0];
      trendsMap.set(dateStr, {
        date: dateStr,
        attempts: 0,
        webAttempts: 0,
        lmsAttempts: 0,
        passedCount: 0,
        totalPercent: 0,
      });
    }

    combined
      .filter(a => a.finishedAt && new Date(a.finishedAt) >= thirtyDaysAgo)
      .forEach(a => {
        const dateStr = new Date(a.finishedAt!).toISOString().split("T")[0];
        const existing = trendsMap.get(dateStr);
        if (existing) {
          existing.attempts++;
          if (a.source === "web") existing.webAttempts++;
          else existing.lmsAttempts++;
          if (a.resultPassed) existing.passedCount++;
          existing.totalPercent += a.resultPercent || 0;
        }
      });

    const trends = Array.from(trendsMap.values())
      .map(t => ({
        date: t.date,
        attempts: t.attempts,
        webAttempts: t.webAttempts,
        lmsAttempts: t.lmsAttempts,
        avgPercent: t.attempts > 0 ? t.totalPercent / t.attempts : 0,
        passRate: t.attempts > 0 ? (t.passedCount / t.attempts) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    res.json({
      summary: {
        totalAttempts,
        passedAttempts,
        passRate: totalAttempts > 0 ? (passedAttempts / totalAttempts) * 100 : 0,
        avgPercent,
        webAttempts: webAttempts.length,
        lmsAttempts: lmsAttempts.length,
        uniqueWebUsers,
        uniqueLmsUsers,
      },
      attempts: combined,
      testStats,
      topicStats,
      trends,
    });
  } catch (error) {
    console.error("Combined analytics error:", error);
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

export default router;