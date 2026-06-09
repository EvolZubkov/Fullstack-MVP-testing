import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import ExcelJS from "exceljs";
import { addAoaSheet, workbookToBuffer } from "../../utils/excel";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { checkAnswer } from "../../utils/check-answer";
import {
  formatQuestionType,
  formatAllOptions,
  formatCorrectAnswerText,
  formatUserAnswerText,
} from "./helpers";

const router = Router();

// GET /api/analytics/tests/:testId/export/excel - Экспорт теста в Excel
router.get("/tests/:testId/export/excel", requirePermission("analytics.export"), requireTestScope("analytics", "testId"), async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId;
    const test = await storage.getTest(testId);

    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const allAttempts = await storage.getAllAttempts();
    const testAttempts = allAttempts.filter(a => a.testId === testId);
    const completedAttempts = testAttempts.filter(a => a.resultJson !== null);

    const userIds = Array.from(new Set(testAttempts.map(a => a.userId)));
    const users = await Promise.all(userIds.map(id => storage.getUser(id)));
    const userMap = new Map<string, string>();
    for (const u of users) {
      if (u) userMap.set(u.id, u.name || u.email || "Unknown");
    }

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

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

    // ЛИСТ 1: Сводка
    const summaryData: any[][] = [
      ["Аналитика теста"],
      [],
      ["Название теста", test.title],
      ["Режим", test.mode === "adaptive" ? "Адаптивный" : "Стандартный"],
      ["Дата экспорта", new Date().toLocaleString("ru-RU")],
      [],
      ["Показатель", "Значение"],
      ["Всего попыток", testAttempts.length],
      ["Завершённых попыток", completedAttempts.length],
      ["Уникальных пользователей", new Set(completedAttempts.map(a => a.userId)).size],
    ];

    if (completedAttempts.length > 0) {
      const avgPercent = completedAttempts.reduce((sum, a) => {
        const result = a.resultJson as any;
        return sum + (result?.overallPercent || 0);
      }, 0) / completedAttempts.length;

      const passedCount = completedAttempts.filter(a => {
        const result = a.resultJson as any;
        return result?.overallPassed;
      }).length;

      summaryData.push(
        ["Средний результат", `${avgPercent.toFixed(1)}%`],
        ["Процент прохождения", `${((passedCount / completedAttempts.length) * 100).toFixed(1)}%`]
      );
    }

    // ЛИСТ 2: Попытки
    const attemptsHeaders = [
      "ID попытки", "Пользователь", "Дата начала", "Дата завершения",
      "Время (сек)", "Результат (%)", "Баллы", "Макс. баллы", "Статус",
    ];

    if (test.mode === "adaptive") {
      attemptsHeaders.push("Достигнутые уровни");
    }

    const attemptsData: any[][] = [attemptsHeaders];

    for (const attempt of testAttempts) {
      const result = attempt.resultJson as any;
      const duration = attempt.startedAt && attempt.finishedAt
        ? Math.round((new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000)
        : null;

      const row: any[] = [
        attempt.id,
        userMap.get(attempt.userId) || "Unknown",
        attempt.startedAt ? new Date(attempt.startedAt).toLocaleString("ru-RU") : "",
        attempt.finishedAt ? new Date(attempt.finishedAt).toLocaleString("ru-RU") : "",
        duration ?? "",
        result?.overallPercent?.toFixed(1) ?? "",
        result?.totalEarnedPoints ?? "",
        result?.totalPossiblePoints ?? "",
        result ? (result.overallPassed ? "Сдан" : "Не сдан") : "В процессе",
      ];

      if (test.mode === "adaptive" && result?.topicResults) {
        const levels = result.topicResults
          .map((tr: any) => `${tr.topicName}: ${tr.achievedLevelName || "—"}`)
          .join("; ");
        row.push(levels);
      }

      attemptsData.push(row);
    }

    // ЛИСТ 3: Детальные ответы
    const answersHeaders = [
      "ID попытки", "Пользователь", "Время начала", "Вопрос", "Тема",
      "Тип вопроса", "Сложность", "Варианты ответа", "Правильный ответ",
      "Ответ пользователя", "Результат", "Баллы",
    ];

    if (test.mode === "adaptive") {
      answersHeaders.push("Уровень");
    }

    const answersData: any[][] = [answersHeaders];

    const sortedAttempts = [...completedAttempts].sort((a, b) => {
      const userA = userMap.get(a.userId) || "";
      const userB = userMap.get(b.userId) || "";
      if (userA !== userB) return userA.localeCompare(userB);
      const dateA = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const dateB = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return dateA - dateB;
    });

    for (const attempt of sortedAttempts) {
      const answers = (attempt.answersJson || {}) as Record<string, unknown>;
      const variant = attempt.variantJson as any;
      const username = userMap.get(attempt.userId) || "Unknown";
      const startDateStr = attempt.startedAt
        ? new Date(attempt.startedAt).toLocaleString("ru-RU")
        : "";

      for (const [qId, userAnswer] of Object.entries(answers)) {
        const question = questionMap.get(qId);
        if (!question) continue;

        const isCorrect = checkAnswer(question, userAnswer) === 1;
        const dataJson = question.dataJson as any;
        const correctJson = question.correctJson as any;

        let levelName = "";
        if (variant?.topics) {
          for (const topic of variant.topics) {
            for (const level of topic.levelsState || []) {
              if (level.answeredQuestionIds?.includes(qId)) {
                levelName = level.levelName;
                break;
              }
            }
          }
        }

        const row: any[] = [
          attempt.id,
          username,
          startDateStr,
          question.prompt,
          topicMap.get(question.topicId) || "Unknown",
          formatQuestionType(question.type),
          question.difficulty || 50,
          formatAllOptions(question.type, dataJson),
          formatCorrectAnswerText(question.type, dataJson, correctJson),
          formatUserAnswerText(question.type, dataJson, userAnswer),
          isCorrect ? "Верно" : "Неверно",
          isCorrect ? (question.points || 1) : 0,
        ];

        if (test.mode === "adaptive") {
          row.push(levelName);
        }

        answersData.push(row);
      }
    }

    // ЛИСТ 4: Статистика по вопросам
    const questionStatsMap = new Map<string, { total: number; correct: number }>();

    for (const attempt of completedAttempts) {
      const answers = (attempt.answersJson || {}) as Record<string, unknown>;
      for (const [qId, answer] of Object.entries(answers)) {
        const question = questionMap.get(qId);
        if (!question) continue;

        const stats = questionStatsMap.get(qId) || { total: 0, correct: 0 };
        stats.total++;
        if (checkAnswer(question, answer) === 1) {
          stats.correct++;
        }
        questionStatsMap.set(qId, stats);
      }
    }

    const questionStatsData: any[][] = [
      ["Вопрос", "Тема", "Тип", "Сложность", "Варианты ответа", "Правильный ответ", "Всего ответов", "Правильных", "% правильных"]
    ];

    for (const [qId, stats] of questionStatsMap.entries()) {
      const question = questionMap.get(qId);
      if (!question) continue;

      const dataJson = question.dataJson as any;
      const correctJson = question.correctJson as any;

      questionStatsData.push([
        question.prompt,
        topicMap.get(question.topicId) || "Unknown",
        formatQuestionType(question.type),
        question.difficulty || 50,
        formatAllOptions(question.type, dataJson),
        formatCorrectAnswerText(question.type, dataJson, correctJson),
        stats.total,
        stats.correct,
        stats.total > 0 ? `${((stats.correct / stats.total) * 100).toFixed(1)}%` : "0%",
      ]);
    }

    const header = questionStatsData.shift();
    questionStatsData.sort((a, b) => {
      const pctA = parseFloat(String(a[8]).replace("%", "")) || 0;
      const pctB = parseFloat(String(b[8]).replace("%", "")) || 0;
      return pctA - pctB;
    });
    questionStatsData.unshift(header!);

    // Создаём Excel
    const workbook = new ExcelJS.Workbook();
    addAoaSheet(workbook, "Сводка", summaryData);
    addAoaSheet(workbook, "Попытки", attemptsData, [36, 20, 18, 18, 12, 12, 10, 12, 12, 40]);
    addAoaSheet(workbook, "Ответы", answersData, [36, 15, 18, 50, 20, 15, 10, 50, 30, 30, 10, 8, 15]);
    addAoaSheet(workbook, "Статистика вопросов", questionStatsData, [50, 20, 15, 10, 50, 30, 12, 12, 12]);

    const buffer = await workbookToBuffer(workbook);

    const filename = `analytics_${test.title.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_")}_${new Date().toISOString().split("T")[0]}.xlsx`;

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);

  } catch (error) {
    logger.error("Excel export error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to export Excel" });
  }
});

// GET /api/export/filters - Данные для фильтров экспорта
router.get("/export/filters", requirePermission("analytics.export"), async (_req: Request, res: Response) => {
  try {
    const tests = await storage.getTests();
    const allAttempts = await storage.getAllAttempts();
    const allScormAttempts = await storage.getAllScormAttempts();
    const scormPackages = await storage.getScormPackages();

    const webTestIds = new Set(allAttempts.filter(a => a.finishedAt).map(a => a.testId));
    const lmsTestIds = new Set<string>();
    for (const attempt of allScormAttempts) {
      if (attempt.finishedAt) {
        const pkg = scormPackages.find(p => p.id === attempt.packageId);
        if (pkg?.testId) lmsTestIds.add(pkg.testId);
      }
    }

    const testOptions = tests.map(t => ({
      id: t.id,
      title: t.title,
      mode: t.mode || "standard",
      hasWebAttempts: webTestIds.has(t.id),
      hasLmsAttempts: lmsTestIds.has(t.id),
    }));

    const userIds = Array.from(new Set(allAttempts.map(a => a.userId)));
    const users = await Promise.all(userIds.map(id => storage.getUser(id)));

    const webUserOptions = users
      .filter((u): u is NonNullable<typeof u> => u !== undefined)
      .map(u => ({
        id: u.id,
        username: u.name || u.email || "Unknown",
        source: "web" as const,
      }));

    const lmsUserMap = new Map<string, { id: string; username: string; email?: string }>();
    for (const attempt of allScormAttempts) {
      if (!attempt.finishedAt) continue;
      const odataUserId = attempt.lmsUserId || attempt.sessionId;
      if (odataUserId && !lmsUserMap.has(odataUserId)) {
        let displayName = attempt.lmsUserName || attempt.lmsUserEmail;
        if (!displayName) {
          displayName = `LMS User (${odataUserId.slice(0, 8)}...)`;
        }
        lmsUserMap.set(odataUserId, {
          id: odataUserId,
          username: displayName,
          email: attempt.lmsUserEmail || undefined,
        });
      }
    }

    const lmsUserOptions = Array.from(lmsUserMap.values()).map(u => ({
      id: u.id,
      username: u.username,
      email: u.email,
      source: "lms" as const,
    }));

    const userOptions = [...webUserOptions, ...lmsUserOptions]
      .sort((a, b) => (a.username || "").localeCompare(b.username || ""));

    const groups = await storage.getGroups();
    const groupOptions = await Promise.all(groups.map(async g => {
      const groupUsers = await storage.getGroupUsers(g.id);
      return {
        id: g.id,
        name: g.name,
        userCount: groupUsers.length,
        userIds: groupUsers.map(u => u.id),
      };
    }));

    const scormOptions = scormPackages.map(p => ({
      id: p.id,
      testId: p.testId,
      testTitle: p.testTitle,
      exportedAt: p.exportedAt,
      isActive: p.isActive,
    }));

    res.json({
      tests: testOptions,
      users: userOptions,
      groups: groupOptions,
      scormPackages: scormOptions,
    });
  } catch (error) {
    logger.error("Export filters error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch export filters" });
  }
});

// POST /api/export/excel - Экспорт отчёта в Excel
router.post("/export/excel", requirePermission("analytics.export"), async (req: Request, res: Response) => {
  try {
    const config = req.body as any;

    const testIds: string[] = Array.isArray(config?.testIds) ? config.testIds : [];
    const userIds: string[] = Array.isArray(config?.userIds) ? config.userIds : [];
    const groupIds: string[] = Array.isArray(config?.groupIds) ? config.groupIds : [];
    const dateFrom: string = config?.dateFrom || "";
    const dateTo: string = config?.dateTo || "";
    const bestAttemptOnly: boolean = !!config?.bestAttemptOnly;
    const bestAttemptCriteria: "percent" | "level_sum" | "level_count" = config?.bestAttemptCriteria || "percent";
    const includeSheets = config?.includeSheets || {
      summary: true, attempts: true, answers: true, questionStats: true, levelStats: true, recommendations: true,
    };

    if (!testIds.length) {
      return res.status(400).json({ error: "testIds is required" });
    }

    const tests = await storage.getTests();
    const selectedTests = tests.filter(t => testIds.includes(t.id));
    const testTitleMap = new Map(selectedTests.map(t => [t.id, t.title]));
    const testModeMap = new Map(selectedTests.map(t => [t.id, t.mode || "standard"]));

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    const allAttempts = await storage.getAllAttempts();

    // Filter attempts
    let attempts = allAttempts.filter(a => testIds.includes(a.testId));

    // Filter by groups
    let effectiveUserIds = [...userIds];

    if (groupIds.length > 0) {
      const groupUserIds = new Set<string>();
      for (const groupId of groupIds) {
        const groupUsers = await storage.getGroupUsers(groupId);
        groupUsers.forEach(u => groupUserIds.add(u.id));
      }

      if (userIds.length > 0) {
        effectiveUserIds = userIds.filter(id => groupUserIds.has(id));
      } else {
        effectiveUserIds = Array.from(groupUserIds);
      }
    }

    if (effectiveUserIds.length > 0) {
      const set = new Set(effectiveUserIds);
      attempts = attempts.filter(a => set.has(a.userId));
    }

    // Filter by dates
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    if (from || to) {
      attempts = attempts.filter(a => {
        const dt = a.finishedAt ? new Date(a.finishedAt) : (a.startedAt ? new Date(a.startedAt) : null);
        if (!dt) return false;
        if (from && dt < from) return false;
        if (to && dt > to) return false;
        return true;
      });
    }

    // Only completed
    let completed = attempts.filter(a => a.resultJson !== null);

    // Best attempt only
    if (bestAttemptOnly) {
      const best = new Map<string, any>();

      const scoreKey = (a: any) => {
        const mode = testModeMap.get(a.testId) || "standard";
        const r = a.resultJson as any;

        if (mode !== "adaptive") {
          return { primary: r?.overallPercent ?? 0, secondary: 0 };
        }

        const trs = r?.topicResults || [];
        const levelSum = trs.reduce((s: number, tr: any) => s + (typeof tr.achievedLevelIndex === "number" ? tr.achievedLevelIndex : -1), 0);
        const levelCount = trs.filter((tr: any) => tr.achievedLevelIndex !== null && tr.achievedLevelIndex !== undefined).length;
        const percent = r?.overallPercent ?? 0;

        if (bestAttemptCriteria === "level_sum") return { primary: levelSum, secondary: percent };
        if (bestAttemptCriteria === "level_count") return { primary: levelCount, secondary: percent };
        return { primary: percent, secondary: levelSum };
      };

      for (const a of completed) {
        const k = `${a.testId}:${a.userId}`;
        const prev = best.get(k);
        if (!prev) { best.set(k, a); continue; }

        const A = scoreKey(a);
        const P = scoreKey(prev);

        const aTime = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
        const pTime = prev.finishedAt ? new Date(prev.finishedAt).getTime() : 0;

        if (A.primary > P.primary) best.set(k, a);
        else if (A.primary === P.primary && A.secondary > P.secondary) best.set(k, a);
        else if (A.primary === P.primary && A.secondary === P.secondary && aTime > pTime) best.set(k, a);
      }

      completed = Array.from(best.values());
    }

    // Users map
    const uniqUserIds = Array.from(new Set(completed.map(a => a.userId)));
    const users = await Promise.all(uniqUserIds.map(id => storage.getUser(id)));
    const userMap = new Map<string, string>();
    for (const u of users) if (u) userMap.set(u.id, u.name || u.email || "Unknown");

    // Collect questions
    const allQuestionIds = new Set<string>();
    for (const attempt of completed) {
      const variant = attempt.variantJson as any;
      if (variant?.sections) {
        for (const s of variant.sections) for (const qId of (s.questionIds || [])) allQuestionIds.add(qId);
      }
      if (variant?.topics) {
        for (const t of variant.topics) for (const lvl of (t.levelsState || [])) for (const qId of (lvl.questionIds || [])) allQuestionIds.add(qId);
      }
    }

    const questions = await storage.getQuestionsByIds(Array.from(allQuestionIds));
    const questionMap = new Map(questions.map(q => [q.id, q]));

    const wb = new ExcelJS.Workbook();

    // Sheet: Summary
    if (includeSheets.summary) {
      const rows: any[][] = [
        ["Отчёт по аналитике"],
        ["Дата экспорта", new Date().toLocaleString("ru-RU")],
        ["Тестов", selectedTests.length],
        ["Попыток (завершённых)", completed.length],
        ["Пользователей", new Set(completed.map(a => a.userId)).size],
        ["bestAttemptOnly", bestAttemptOnly ? "Да" : "Нет"],
        ["Период", `${dateFrom || "—"} .. ${dateTo || "—"}`],
        [],
        ["Тест", "Попыток", "Средний %", "Процент сдачи"],
      ];

      for (const t of selectedTests) {
        const ta = completed.filter(a => a.testId === t.id);
        const avg = ta.length ? (ta.reduce((s, a) => s + ((a.resultJson as any)?.overallPercent ?? 0), 0) / ta.length) : 0;
        const passed = ta.filter(a => ((a.resultJson as any)?.overallPassed)).length;
        rows.push([t.title, ta.length, `${avg.toFixed(1)}%`, ta.length ? `${(passed / ta.length * 100).toFixed(1)}%` : "0%"]);
      }

      addAoaSheet(wb, "Сводка", rows);
    }

    // Sheet: Attempts
    if (includeSheets.attempts) {
      const rows: any[][] = [[
        "Тест", "ID попытки", "Пользователь", "Дата начала", "Дата завершения",
        "Время (сек)", "Результат (%)", "Баллы", "Макс. баллы", "Статус",
      ]];

      for (const a of completed) {
        const r = a.resultJson as any;
        const dur = a.startedAt && a.finishedAt
          ? Math.round((new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)
          : "";

        rows.push([
          testTitleMap.get(a.testId) || a.testId,
          a.id,
          userMap.get(a.userId) || "Unknown",
          a.startedAt ? new Date(a.startedAt).toLocaleString("ru-RU") : "",
          a.finishedAt ? new Date(a.finishedAt).toLocaleString("ru-RU") : "",
          dur,
          r?.overallPercent?.toFixed(1) ?? "",
          r?.totalEarnedPoints ?? "",
          r?.totalPossiblePoints ?? "",
          r ? (r.overallPassed ? "Сдан" : "Не сдан") : "—",
        ]);
      }

      addAoaSheet(wb, "Попытки", rows, [24, 36, 18, 18, 18, 12, 12, 10, 12, 10]);
    }

    // Sheet: Answers
    if (includeSheets.answers) {
      const rows: any[][] = [[
        "Тест", "ID попытки", "Пользователь", "Время начала", "Вопрос", "Тема", "Тип", "Сложность",
        "Варианты ответа", "Правильный ответ", "Ответ пользователя", "Результат", "Баллы",
      ]];

      for (const attempt of completed) {
        const answers = (attempt.answersJson || {}) as Record<string, unknown>;
        const username = userMap.get(attempt.userId) || "Unknown";
        const startStr = attempt.startedAt ? new Date(attempt.startedAt).toLocaleString("ru-RU") : "";

        for (const [qId, userAnswer] of Object.entries(answers)) {
          const q = questionMap.get(qId);
          if (!q) continue;

          const isCorrect = checkAnswer(q, userAnswer) === 1;
          const dataJson = q.dataJson as any;
          const correctJson = q.correctJson as any;

          rows.push([
            testTitleMap.get(attempt.testId) || attempt.testId,
            attempt.id,
            username,
            startStr,
            q.prompt,
            topicMap.get(q.topicId) || "Unknown",
            formatQuestionType(q.type),
            q.difficulty || 50,
            formatAllOptions(q.type, dataJson),
            formatCorrectAnswerText(q.type, dataJson, correctJson),
            formatUserAnswerText(q.type, dataJson, userAnswer),
            isCorrect ? "Верно" : "Неверно",
            isCorrect ? (q.points || 1) : 0,
          ]);
        }
      }

      addAoaSheet(wb, "Ответы", rows, [24, 36, 15, 18, 50, 20, 15, 10, 50, 30, 30, 10, 8]);
    }

    // Sheet: Question stats
    if (includeSheets.questionStats) {
      const stat = new Map<string, { total: number; correct: number; testId: string }>();

      for (const attempt of completed) {
        const answers = (attempt.answersJson || {}) as Record<string, unknown>;
        for (const [qId, ans] of Object.entries(answers)) {
          const q = questionMap.get(qId);
          if (!q) continue;

          const key = `${attempt.testId}:${qId}`;
          const s = stat.get(key) || { total: 0, correct: 0, testId: attempt.testId };
          s.total++;
          if (checkAnswer(q, ans) === 1) s.correct++;
          stat.set(key, s);
        }
      }

      const rows: any[][] = [["Тест", "Вопрос", "Тема", "Тип", "Сложность", "Всего", "Правильных", "% правильных"]];
      for (const [key, s] of stat.entries()) {
        const qId = key.split(":")[1];
        const q = questionMap.get(qId);
        if (!q) continue;

        rows.push([
          testTitleMap.get(s.testId) || s.testId,
          q.prompt,
          topicMap.get(q.topicId) || "Unknown",
          formatQuestionType(q.type),
          q.difficulty || 50,
          s.total,
          s.correct,
          s.total ? `${((s.correct / s.total) * 100).toFixed(1)}%` : "0%",
        ]);
      }

      addAoaSheet(wb, "Статистика вопросов", rows, [24, 50, 20, 15, 10, 10, 12, 12]);
    }

    // Sheet: Level stats — кто какой уровень достиг
    if (includeSheets.levelStats) {
      const rows: any[][] = [["Пользователь", "Email", "Тест", "Тема", "Достигнутый уровень", "Дата"]];

      for (const attempt of completed) {
        const result = attempt.resultJson as any;
        if (result?.mode !== "adaptive") continue;

        const userName = userMap.get(attempt.userId) || attempt.userId;
        const testTitle = testTitleMap.get(attempt.testId) || attempt.testId;
        const date = attempt.finishedAt
          ? new Date(attempt.finishedAt).toLocaleDateString("ru-RU")
          : "—";

        for (const tr of result?.topicResults || []) {
          rows.push([
            userName,
            "—",
            testTitle,
            tr.topicName || "—",
            tr.achievedLevelName || "Не достигнут",
            date,
          ]);
        }
      }

      if (rows.length > 1) {
        addAoaSheet(wb, "Статистика уровней", rows, [25, 30, 30, 25, 20, 15]);
      }
    }

    // Sheet: Recommendations (web — и адаптивные и стандартные)
    if (includeSheets.recommendations) {
      const userCourses = new Map<string, Set<string>>();

      for (const attempt of completed) {
        const result = attempt.resultJson as any;
        const userName = userMap.get(attempt.userId) || attempt.userId;

        if (result?.mode === "adaptive") {
          // Адаптивный — берём recommendedLinks из topicResults
          for (const tr of result?.topicResults || []) {
            for (const link of tr.recommendedLinks || []) {
              if (!userCourses.has(userName)) userCourses.set(userName, new Set());
              userCourses.get(userName)!.add(link.title);
            }
          }
        } else {
          // Стандартный — берём recommendedCourses из проваленных тем
          for (const tr of result?.topicResults || []) {
            if (tr.passed === false) {
              for (const course of tr.recommendedCourses || []) {
                if (!userCourses.has(userName)) userCourses.set(userName, new Set());
                userCourses.get(userName)!.add(course.title);
              }
            }
          }
        }
      }

      if (userCourses.size > 0) {
        const rows: any[][] = [["Пользователь", "Рекомендуемый курс"]];
        for (const [userName, courses] of userCourses.entries()) {
          for (const course of courses) {
            rows.push([userName, course]);
          }
        }
        addAoaSheet(wb, "Рекомендации", rows, [30, 50]);
      }
    }

    const buffer = await workbookToBuffer(wb);

    const filename = `report_${new Date().toISOString().split("T")[0]}.xlsx`;
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);

  } catch (e) {
    logger.error("POST /api/export/excel error: " + (e as Error).message);
    res.status(500).json({ error: "Failed to export Excel" });
  }
});

// POST /api/export/excel-lms - Экспорт LMS данных в Excel
router.post("/export/excel-lms", requirePermission("analytics.export"), async (req: Request, res: Response) => {
  try {
    const config = req.body as any;

    const testIds: string[] = Array.isArray(config?.testIds) ? config.testIds : [];
    const userIds: string[] = Array.isArray(config?.userIds) ? config.userIds : [];
    const dateFrom: string = config?.dateFrom || "";
    const dateTo: string = config?.dateTo || "";
    const bestAttemptOnly: boolean = !!config?.bestAttemptOnly;
    const includeSheets = config?.includeSheets || {
      summary: true, attempts: true, answers: true, questionStats: true, levelStats: true, recommendations: true,
    };

    if (!testIds.length) {
      return res.status(400).json({ error: "testIds is required" });
    }

    const tests = await storage.getTests();
    const selectedTests = tests.filter(t => testIds.includes(t.id));
    const testTitleMap = new Map(selectedTests.map(t => [t.id, t.title]));

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    const packages = await storage.getScormPackages();
    const packageMap = new Map(packages.map(p => [p.id, p]));

    const relevantPackages = packages.filter(p => p.testId && testIds.includes(p.testId));
    const relevantPackageIds = new Set(relevantPackages.map(p => p.id));

    const allAttempts = await storage.getAllScormAttempts();

    let attempts = allAttempts.filter(a => relevantPackageIds.has(a.packageId));

    // Filter by dates
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`) : null;
    const to = dateTo ? new Date(`${dateTo}T23:59:59`) : null;

    if (from || to) {
      attempts = attempts.filter(a => {
        const dt = a.finishedAt ? new Date(a.finishedAt) : (a.startedAt ? new Date(a.startedAt) : null);
        if (!dt) return false;
        if (from && dt < from) return false;
        if (to && dt > to) return false;
        return true;
      });
    }

    let completed = attempts.filter(a => a.finishedAt !== null);

    // Filter by LMS users
    if (userIds.length > 0) {
      const userSet = new Set(userIds);
      completed = completed.filter(a => {
        const odataUserId = a.lmsUserId || a.sessionId;
        return userSet.has(odataUserId);
      });
    }

    // Best attempt only
    if (bestAttemptOnly) {
      const best = new Map<string, any>();

      for (const a of completed) {
        const pkg = packageMap.get(a.packageId);
        if (!pkg) continue;

        const odataUserId = a.lmsUserId || a.sessionId;
        const k = `${pkg.testId}:${odataUserId}`;
        const prev = best.get(k);

        if (!prev) { best.set(k, a); continue; }

        const aPercent = a.resultPercent || 0;
        const pPercent = prev.resultPercent || 0;
        const aTime = a.finishedAt ? new Date(a.finishedAt).getTime() : 0;
        const pTime = prev.finishedAt ? new Date(prev.finishedAt).getTime() : 0;

        if (aPercent > pPercent) best.set(k, a);
        else if (aPercent === pPercent && aTime > pTime) best.set(k, a);
      }

      completed = Array.from(best.values());
    }

    // Load answers
    const attemptAnswers = new Map<string, any[]>();
    for (const attempt of completed) {
      const answers = await storage.getScormAnswersByAttempt(attempt.id);
      attemptAnswers.set(attempt.id, answers);
    }

    // Load questions
    const allQuestionIds = new Set<string>();
    for (const answers of attemptAnswers.values()) {
      for (const ans of answers) {
        if (ans.questionId) allQuestionIds.add(ans.questionId);
      }
    }
    const questions = await storage.getQuestionsByIds(Array.from(allQuestionIds));
    const questionMap = new Map(questions.map(q => [q.id, q]));

    const wb = new ExcelJS.Workbook();

    // Sheet: Summary
    if (includeSheets.summary) {
      const rows: any[][] = [
        ["Отчёт по LMS аналитике"],
        ["Дата экспорта", new Date().toLocaleString("ru-RU")],
        ["Источник", "LMS (SCORM)"],
        ["Тестов", selectedTests.length],
        ["Попыток (завершённых)", completed.length],
        ["Уникальных пользователей", new Set(completed.map(a => a.lmsUserId || a.sessionId)).size],
        ["bestAttemptOnly", bestAttemptOnly ? "Да" : "Нет"],
        ["Период", `${dateFrom || "—"} .. ${dateTo || "—"}`],
        [],
        ["Тест", "Попыток", "Средний %", "Процент сдачи"],
      ];

      for (const t of selectedTests) {
        const relevantPkgIds = relevantPackages.filter(p => p.testId === t.id).map(p => p.id);
        const ta = completed.filter(a => relevantPkgIds.includes(a.packageId));
        const avg = ta.length ? (ta.reduce((s, a) => s + (a.resultPercent || 0), 0) / ta.length) : 0;
        const passed = ta.filter(a => a.resultPassed).length;
        rows.push([
          t.title, ta.length, `${avg.toFixed(1)}%`,
          ta.length ? `${(passed / ta.length * 100).toFixed(1)}%` : "0%"
        ]);
      }

      addAoaSheet(wb, "Сводка", rows);
    }

    // Sheet: Attempts
    if (includeSheets.attempts) {
      const rows: any[][] = [[
        "Тест", "ID попытки", "LMS User ID", "ФИО", "Email", "Организация",
        "Дата начала", "Дата завершения", "Время (сек)",
        "Результат (%)", "Баллы", "Макс. баллы", "Статус",
      ]];

      for (const a of completed) {
        const pkg = packageMap.get(a.packageId);
        const dur = a.startedAt && a.finishedAt
          ? Math.round((new Date(a.finishedAt).getTime() - new Date(a.startedAt).getTime()) / 1000)
          : "";

        rows.push([
          pkg?.testTitle || "—",
          a.id,
          a.lmsUserId || "—",
          a.lmsUserName || "—",
          a.lmsUserEmail || "—",
          a.lmsUserOrg || "—",
          a.startedAt ? new Date(a.startedAt).toLocaleString("ru-RU") : "",
          a.finishedAt ? new Date(a.finishedAt).toLocaleString("ru-RU") : "",
          dur,
          a.resultPercent?.toFixed(1) ?? "",
          a.totalPoints ?? "",
          a.maxPoints ?? "",
          a.resultPassed ? "Сдан" : "Не сдан",
        ]);
      }

      addAoaSheet(wb, "Попытки", rows, [24, 36, 20, 25, 25, 20, 18, 18, 12, 12, 10, 12, 10]);
    }

    // Sheet: Answers
    if (includeSheets.answers) {
      const rows: any[][] = [[
        "Тест", "ID попытки", "ФИО", "Email", "Время начала",
        "Вопрос", "Тема", "Тип", "Сложность",
        "Варианты ответа", "Правильный ответ", "Ответ пользователя",
        "Результат", "Баллы", "Уровень (адапт.)",
      ]];

      for (const attempt of completed) {
        const pkg = packageMap.get(attempt.packageId);
        const answers = attemptAnswers.get(attempt.id) || [];
        const startStr = attempt.startedAt ? new Date(attempt.startedAt).toLocaleString("ru-RU") : "";

        for (const ans of answers) {
          const q = questionMap.get(ans.questionId);
          const dataJson = q?.dataJson as any;

          rows.push([
            pkg?.testTitle || "—",
            attempt.id,
            attempt.lmsUserName || "—",
            attempt.lmsUserEmail || "—",
            startStr,
            ans.questionPrompt || q?.prompt || "—",
            ans.topicName || topicMap.get(ans.topicId || "") || "—",
            formatQuestionType(ans.questionType || q?.type || "unknown"),
            ans.difficulty || q?.difficulty || 50,
            formatAllOptions(ans.questionType || q?.type, dataJson),
            formatCorrectAnswerText(ans.questionType || q?.type, dataJson, ans.correctAnswerJson || q?.correctJson),
            formatUserAnswerText(ans.questionType || q?.type, dataJson, ans.userAnswerJson),
            ans.isCorrect ? "Верно" : "Неверно",
            ans.points || 0,
            ans.levelName || "—",
          ]);
        }
      }

      addAoaSheet(wb, "Ответы", rows, [24, 36, 25, 25, 18, 50, 20, 15, 10, 50, 30, 30, 10, 8, 15]);
    }

    // Sheet: Question stats
    if (includeSheets.questionStats) {
      const stat = new Map<string, { prompt: string; testId: string; total: number; correct: number; topicName: string; type: string; difficulty: number }>();

      for (const attempt of completed) {
        const pkg = packageMap.get(attempt.packageId);
        if (!pkg) continue;

        const answers = attemptAnswers.get(attempt.id) || [];
        for (const ans of answers) {
          const q = questionMap.get(ans.questionId);
          const testId = pkg.testId || "";
          const key = `${testId}:${ans.questionId}`;
          const s = stat.get(key) || {
            prompt: ans.questionPrompt || q?.prompt || "—",
            testId,
            total: 0,
            correct: 0,
            topicName: ans.topicName || topicMap.get(ans.topicId || q?.topicId || "") || "—",
            type: ans.questionType || q?.type || "—",
            difficulty: ans.difficulty || q?.difficulty || 50,
          };
          s.total++;
          if (ans.isCorrect) s.correct++;
          stat.set(key, s);
        }
      }

      const rows: any[][] = [["Тест", "Вопрос", "Тема", "Тип", "Сложность", "Всего", "Правильных", "% правильных"]];
      for (const [_, s] of stat.entries()) {
        rows.push([
          testTitleMap.get(s.testId) || s.testId,
          s.prompt,
          s.topicName,
          formatQuestionType(s.type),
          s.difficulty,
          s.total,
          s.correct,
          s.total ? `${((s.correct / s.total) * 100).toFixed(1)}%` : "0%",
        ]);
      }

      addAoaSheet(wb, "Статистика вопросов", rows, [24, 50, 20, 15, 10, 10, 12, 12]);
    }

    // Sheet: Level stats — кто какой уровень достиг (LMS)
    if (includeSheets.levelStats) {
      const rows: any[][] = [["Пользователь", "Email", "Тест", "Тема", "Достигнутый уровень", "Дата"]];

      for (const attempt of completed) {
        const pkg = packageMap.get(attempt.packageId);
        if (pkg?.testMode !== "adaptive") continue;

        const achievedLevels = attempt.achievedLevelsJson as any[] | null;
        if (!achievedLevels || achievedLevels.length === 0) continue;

        const date = attempt.finishedAt
          ? new Date(attempt.finishedAt).toLocaleDateString("ru-RU")
          : "—";

        for (const level of achievedLevels) {
          rows.push([
            attempt.lmsUserName || attempt.lmsUserId || "—",
            attempt.lmsUserEmail || "—",
            pkg?.testTitle || "—",
            level.topicName || "—",
            level.levelName || "Не достигнут",
            date,
          ]);
        }
      }

      if (rows.length > 1) {
        addAoaSheet(wb, "Статистика уровней", rows, [25, 30, 30, 25, 20, 15]);
      }
    }

    // Sheet: Recommendations
    if (includeSheets.recommendations) {
      const rows: any[][] = [["lms_user_id", "Название рекомендованного курса"]];

      const userCourses = new Map<string, Set<string>>();

      for (const attempt of completed) {
        const odataUserId = attempt.lmsUserId || attempt.sessionId || "—";

        let courses: any[] = [];
        if (attempt.failedTopicCoursesJson) {
          try {
            courses = typeof attempt.failedTopicCoursesJson === 'string'
              ? JSON.parse(attempt.failedTopicCoursesJson as string)
              : (attempt.failedTopicCoursesJson as any[]);
          } catch {
            courses = [];
          }
        }

        for (const course of courses) {
          if (!userCourses.has(odataUserId)) {
            userCourses.set(odataUserId, new Set());
          }
          userCourses.get(odataUserId)!.add(course.title);
        }
      }

      for (const [odataUserId, courseNames] of userCourses.entries()) {
        for (const courseName of courseNames) {
          rows.push([odataUserId, courseName]);
        }
      }

      if (rows.length > 1) {
        addAoaSheet(wb, "Рекомендации", rows, [25, 50]);
      }
    }

    const buffer = await workbookToBuffer(wb);

    const filename = `report_lms_${new Date().toISOString().split("T")[0]}.xlsx`;
    const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_");

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="${safe}"; filename*=UTF-8''${encodeURIComponent(filename)}`);
    res.send(buffer);

  } catch (e) {
    logger.error("POST /api/export/excel-lms error: " + (e as Error).message);
    res.status(500).json({ error: "Failed to export LMS Excel" });
  }
});

export default router;