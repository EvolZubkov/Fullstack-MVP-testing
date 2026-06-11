import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { checkAnswer } from "../../utils/check-answer";
import { analyticsScope } from "./helpers";

const router = Router();

// GET /api/analytics/combined - Комбинированная аналитика (Web + LMS)
router.get("/combined", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const source = req.query.source as string || "all";
    const testId = req.query.testId as string || null;
    // PRD-15 FR-08 (audit F-5): aggregates only over readable tests.
    const scope = await analyticsScope(req);

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
        .filter(a => scope.has(a.testId))
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
            userEmail: user?.email || null,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            resultPercent: result?.mode === "adaptive"
              ? (result?.overallPassed ? 100 : 0)
              : result?.overallPercent || 0,
            resultPassed: result?.overallPassed || false,
            totalPoints: result?.totalEarnedPoints || 0,
            maxPoints: result?.totalPossiblePoints || 0,
            isAdaptive: result?.mode === "adaptive",
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
        .filter(a => scope.has(packageMap.get(a.packageId)?.testId ?? null))
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

    // SUMMARY
    const totalAttempts = combined.length;
    const passedAttempts = combined.filter(a => a.resultPassed).length;

    // Средний балл считаем только по стандартным тестам — у адаптивных нет процента
    const standardAttempts = combined.filter(a => !a.isAdaptive);
    const avgPercent = standardAttempts.length > 0
      ? standardAttempts.reduce((sum, a) => sum + (a.resultPercent || 0), 0) / standardAttempts.length
      : 0;

    // Для адаптивных — отдельная метрика
    const adaptiveAttempts = combined.filter(a => a.isAdaptive);
    const adaptivePassed = adaptiveAttempts.filter(a => a.resultPassed).length;

    const uniqueWebUsers = new Set(webAttempts.map(a => a.userId)).size;
    const uniqueLmsUsers = new Set(lmsAttempts.map(a => a.lmsUserId).filter(Boolean)).size;

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
        adaptiveAttempts: adaptiveAttempts.length,
        adaptivePassed,
      },
      attempts: combined,
    });
  } catch (error) {
    logger.error("Get combined analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get combined analytics" });
  }
});

// GET /api/analytics/summary - Только сводка (быстрый запрос)
router.get("/summary", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const source = (req.query.source as string) || "all";
    const testIdFilter = req.query.testId as string | undefined;
    // PRD-15 FR-08 (audit F-5): aggregates only over readable tests.
    const scope = await analyticsScope(req);

    let webCount = 0, webPassed = 0, webPercent = 0, webAdaptive = 0, webAdaptivePassed = 0;
    let lmsCount = 0, lmsPassed = 0, lmsPercent = 0;
    const webUserIds = new Set<string>();
    const lmsUserIds = new Set<string>();

    if (source === "all" || source === "web") {
      const attempts = await storage.getAllAttempts();
      const filtered = attempts
        .filter(a => !testIdFilter || a.testId === testIdFilter)
        .filter(a => scope.has(a.testId))
        .filter(a => a.finishedAt);

      for (const a of filtered) {
        const result = a.resultJson as any;
        const isAdaptive = result?.mode === "adaptive";
        webCount++;
        webUserIds.add(a.userId);
        if (result?.overallPassed) webPassed++;
        if (isAdaptive) {
          webAdaptive++;
          if (result?.overallPassed) webAdaptivePassed++;
        } else {
          webPercent += result?.overallPercent || 0;
        }
      }
    }

    if (source === "all" || source === "lms") {
      const attempts = await storage.getAllScormAttempts();
      const packages = await storage.getScormPackages();
      const packageMap = new Map(packages.map(p => [p.id, p]));

      const filtered = attempts
        .filter(a => {
          if (!testIdFilter) return true;
          const pkg = packageMap.get(a.packageId);
          return pkg?.testId === testIdFilter;
        })
        .filter(a => scope.has(packageMap.get(a.packageId)?.testId ?? null))
        .filter(a => a.finishedAt);

      for (const a of filtered) {
        lmsCount++;
        if (a.lmsUserId) lmsUserIds.add(a.lmsUserId);
        if (a.resultPassed) lmsPassed++;
        lmsPercent += a.resultPercent || 0;
      }
    }

    const totalAttempts = webCount + lmsCount;
    const passedAttempts = webPassed + lmsPassed;
    const standardCount = webCount - webAdaptive + lmsCount;
    const avgPercent = standardCount > 0
      ? (webPercent + lmsPercent) / standardCount
      : 0;

    res.json({
      totalAttempts,
      passedAttempts,
      passRate: totalAttempts > 0 ? (passedAttempts / totalAttempts) * 100 : 0,
      avgPercent,
      webAttempts: webCount,
      lmsAttempts: lmsCount,
      uniqueWebUsers: webUserIds.size,
      uniqueLmsUsers: lmsUserIds.size,
      adaptiveAttempts: webAdaptive,
      adaptivePassed: webAdaptivePassed,
    });
  } catch (error) {
    logger.error("Summary analytics error: " + (error as Error).message, "analytics");
    res.status(500).json({ error: "Failed to get summary" });
  }
});

// GET /api/analytics/combined-full - Полная комбинированная аналитика
router.get("/combined-full", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const source = (req.query.source as string) || "all";
    const testIdFilter = req.query.testId as string | undefined;
    // PRD-15 FR-08 (audit F-5): aggregates only over readable tests.
    const scope = await analyticsScope(req);

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
        .filter(a => scope.has(a.testId))
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
            userEmail: user?.email || null,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            duration,
            resultPercent: result?.mode === "adaptive"
              ? (result?.overallPassed ? 100 : 0)
              : result?.overallPercent || 0,
            resultPassed: result?.overallPassed || false,
            totalPoints: result?.earnedPoints || result?.totalEarnedPoints || 0,
            maxPoints: result?.possiblePoints || result?.totalPossiblePoints || 0,
            isAdaptive: result?.mode === "adaptive",
            achievedTopics: result?.mode === "adaptive"
              ? result?.topicResults?.filter((tr: any) => tr.achievedLevelIndex !== null).length ?? 0
              : null,
            totalTopics: result?.mode === "adaptive"
              ? result?.topicResults?.length ?? 0
              : null,
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
        .filter(a => scope.has(packageMap.get(a.packageId)?.testId ?? null))
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

    // Загружаем все ответы параллельно — один Promise.all вместо N запросов
    const [lmsAnswersAll, webAttemptsFullAll] = await Promise.all([
      Promise.all(lmsAttempts.map(a => storage.getScormAnswersByAttempt(a.id))),
      Promise.all(webAttempts.map(a => storage.getAttempt(a.id))),
    ]);

    // LMS ответы
    for (let i = 0; i < lmsAttempts.length; i++) {
      const answers = lmsAnswersAll[i];
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

    // Web попытки — один проход по уже загруженным данным
    const questionIdsAll = new Set<string>();
    const webAnswersMaps: Record<string, any>[] = [];

    for (let i = 0; i < webAttempts.length; i++) {
      const fullAttempt = webAttemptsFullAll[i];
      const answers = (fullAttempt?.answersJson || {}) as Record<string, any>;
      webAnswersMaps.push(answers);
      Object.keys(answers).forEach(qId => questionIdsAll.add(qId));

      // Адаптивные — берём из resultJson
      if (webAttempts[i].isAdaptive && fullAttempt?.resultJson) {
        const result = fullAttempt.resultJson as any;
        if (result?.mode === "adaptive") {
          for (const tr of result.topicResults || []) {
            const existing = topicStatsMap.get(tr.topicId) || {
              topicId: tr.topicId,
              topicName: tr.topicName || topicMap.get(tr.topicId) || "Unknown",
              totalAnswers: 0,
              correctAnswers: 0,
              totalPercent: 0,
              failureCount: 0,
            };
            existing.totalAnswers += tr.totalQuestionsAnswered || 0;
            existing.correctAnswers += tr.totalCorrect || 0;
            existing.failureCount += (tr.totalQuestionsAnswered || 0) - (tr.totalCorrect || 0);
            topicStatsMap.set(tr.topicId, existing);
          }
        }
      }
    }

    // Загружаем все вопросы одним запросом
    const allQuestions = await storage.getQuestionsByIds(Array.from(questionIdsAll));
    const questionMap = new Map(allQuestions.map(q => [q.id, q]));

    // Стандартные web попытки — считаем по ответам
    for (let i = 0; i < webAttempts.length; i++) {
      if (webAttempts[i].isAdaptive) continue;
      const answers = webAnswersMaps[i];
      for (const [qId, userAnswer] of Object.entries(answers)) {
        const q = questionMap.get(qId);
        if (!q) continue;
        const existing = topicStatsMap.get(q.topicId) || {
          topicId: q.topicId,
          topicName: topicMap.get(q.topicId) || "Unknown",
          totalAnswers: 0,
          correctAnswers: 0,
          totalPercent: 0,
          failureCount: 0,
        };
        existing.totalAnswers++;
        const isCorrect = checkAnswer(q, userAnswer) === 1;
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

    // Собираем топ-5 тестов по количеству попыток для трендов
    const top5TestIds = Array.from(testStatsMap.values())
      .sort((a, b) => b.totalAttempts - a.totalAttempts)
      .slice(0, 5)
      .map(t => t.testId);

    // Добавляем счётчики по тестам в каждый день
    for (const [dateStr, entry] of trendsMap.entries()) {
      (entry as any).byTest = {};
      for (const testId of top5TestIds) {
        (entry as any).byTest[testId] = 0;
      }
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
          if (a.testId && top5TestIds.includes(a.testId)) {
            (existing as any).byTest[a.testId] = ((existing as any).byTest[a.testId] || 0) + 1;
          }
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
        ...(t as any).byTest,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const top5Tests = Array.from(testStatsMap.values())
      .sort((a, b) => b.totalAttempts - a.totalAttempts)
      .slice(0, 5)
      .map(t => ({ testId: t.testId, testTitle: t.testTitle }));

    // ALERTS — тесты с резким падением pass rate
    const now = new Date();
    const day7ago = new Date(now); day7ago.setDate(now.getDate() - 7);
    const day14ago = new Date(now); day14ago.setDate(now.getDate() - 14);

    const alertMap = new Map<string, { testTitle: string; recent: number[]; prev: number[] }>();

    for (const a of combined) {
      if (!a.finishedAt || !a.testId) continue;
      const dt = new Date(a.finishedAt);
      const entry = alertMap.get(a.testId) || { testTitle: a.testTitle, recent: [] as number[], prev: [] as number[] };
      if (dt >= day7ago) entry.recent.push(a.resultPassed ? 1 : 0);
      else if (dt >= day14ago) entry.prev.push(a.resultPassed ? 1 : 0);
      alertMap.set(a.testId, entry);
    }

    const alerts: { testId: string; testTitle: string; recentPassRate: number; prevPassRate: number; drop: number }[] = [];

    for (const [testId, entry] of alertMap.entries()) {
      if (entry.recent.length < 3 || entry.prev.length < 3) continue;
      const recentRate = (entry.recent.reduce((s, v) => s + v, 0) / entry.recent.length) * 100;
      const prevRate = (entry.prev.reduce((s, v) => s + v, 0) / entry.prev.length) * 100;
      const drop = prevRate - recentRate;
      if (drop >= 20) {
        alerts.push({ testId, testTitle: entry.testTitle, recentPassRate: recentRate, prevPassRate: prevRate, drop });
      }
    }

    alerts.sort((a, b) => b.drop - a.drop);

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
      top5Tests, 
      alerts,
    });
  } catch (error) {
    logger.error("Combined analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get analytics" });
  }
});

export default router;
