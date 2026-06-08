import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { readableTestScope } from "../../services/test-access";
import type { AttemptResult } from "@shared/schema";

const router = Router();

// GET /api/analytics - Общая аналитика
router.get("/", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const allTests = await storage.getTests();
    // PRD-13: limit analytics to the tests this user may read.
    const scope = await readableTestScope(req.effectiveRoles ?? [], req.currentUser?.id ?? "");
    const tests = scope.all ? allTests : allTests.filter((t) => scope.ids.has(t.id));
    const scopedTestIds = new Set(tests.map((t) => t.id));
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));
    const allAttempts = await storage.getAllAttempts();

    const completedAttempts = allAttempts.filter(
      (a) => a.resultJson !== null && scopedTestIds.has(a.testId),
    );

    // Aggregate stats per test
    const testStats = tests.map((test) => {
      const testAttempts = completedAttempts.filter((a) => a.testId === test.id);
      const totalAttempts = testAttempts.length;

      if (totalAttempts === 0) {
        return {
          testId: test.id,
          testTitle: test.title,
          totalAttempts: 0,
          passRate: 0,
          avgScore: 0,
          avgPercent: 0,
        };
      }

      const passedAttempts = testAttempts.filter((a) => {
        const result = a.resultJson as AttemptResult | null;
        return result?.overallPassed === true;
      }).length;

      const avgPercent = testAttempts.reduce((sum, a) => {
        const result = a.resultJson as AttemptResult | null;
        return sum + (result?.overallPercent || 0);
      }, 0) / totalAttempts;

      const avgScore = testAttempts.reduce((sum, a) => {
        const result = a.resultJson as AttemptResult | null;
        return sum + (result?.totalEarnedPoints || 0);
      }, 0) / totalAttempts;

      return {
        testId: test.id,
        testTitle: test.title,
        totalAttempts,
        passRate: (passedAttempts / totalAttempts) * 100,
        avgScore,
        avgPercent,
      };
    });

    // Aggregate stats per topic
    const topicStatsMap = new Map<string, {
      topicId: string;
      topicName: string;
      totalAppearances: number;
      totalEarnedPoints: number;
      totalPossiblePoints: number;
      passedCount: number;
      failedCount: number;
    }>();

    for (const topic of topics) {
      topicStatsMap.set(topic.id, {
        topicId: topic.id,
        topicName: topic.name,
        totalAppearances: 0,
        totalEarnedPoints: 0,
        totalPossiblePoints: 0,
        passedCount: 0,
        failedCount: 0,
      });
    }

    for (const attempt of completedAttempts) {
      const result = attempt.resultJson as AttemptResult | null;
      if (!result?.topicResults) continue;

      for (const tr of result.topicResults) {
        const stats = topicStatsMap.get(tr.topicId);
        if (stats) {
          stats.totalAppearances++;
          stats.totalEarnedPoints += tr.earnedPoints;
          stats.totalPossiblePoints += tr.possiblePoints;
          if (tr.passed === true) stats.passedCount++;
          else if (tr.passed === false) stats.failedCount++;
        }
      }
    }

    const topicStats = Array.from(topicStatsMap.values()).map((stats) => {
      const topicWithPassRuleCount = stats.passedCount + stats.failedCount;
      const hasPassRule = topicWithPassRuleCount > 0;
      return {
        topicId: stats.topicId,
        topicName: stats.topicName,
        totalAppearances: stats.totalAppearances,
        avgPercent: stats.totalPossiblePoints > 0
          ? (stats.totalEarnedPoints / stats.totalPossiblePoints) * 100
          : 0,
        passRate: hasPassRule
          ? (stats.passedCount / topicWithPassRuleCount) * 100
          : null,
        hasPassRule,
        failureCount: stats.failedCount,
      };
    });

    // Trends (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const recentAttempts = completedAttempts.filter(
      (a) => a.finishedAt && new Date(a.finishedAt) >= thirtyDaysAgo
    );

    const trendsMap = new Map<string, { date: string; count: number; avgPercent: number; passed: number }>();

    for (const attempt of recentAttempts) {
      const dateStr = new Date(attempt.finishedAt!).toISOString().split("T")[0];
      const result = attempt.resultJson as AttemptResult | null;
      const existing = trendsMap.get(dateStr) || { date: dateStr, count: 0, avgPercent: 0, passed: 0 };

      existing.count++;
      existing.avgPercent += result?.overallPercent || 0;
      if (result?.overallPassed) existing.passed++;

      trendsMap.set(dateStr, existing);
    }

    const trends = Array.from(trendsMap.values())
      .map((t) => ({
        date: t.date,
        attempts: t.count,
        avgPercent: t.avgPercent / t.count,
        passRate: (t.passed / t.count) * 100,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Summary
    const summary = {
      totalTests: tests.length,
      totalAttempts: completedAttempts.length,
      overallPassRate: completedAttempts.length > 0
        ? (completedAttempts.filter((a) => (a.resultJson as AttemptResult | null)?.overallPassed).length / completedAttempts.length) * 100
        : 0,
      overallAvgPercent: completedAttempts.length > 0
        ? completedAttempts.reduce((sum, a) => sum + ((a.resultJson as AttemptResult | null)?.overallPercent || 0), 0) / completedAttempts.length
        : 0,
    };

    res.json({ summary, testStats, topicStats, trends });
  } catch (error) {
    logger.error("Analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch analytics" });
  }
});

export default router;