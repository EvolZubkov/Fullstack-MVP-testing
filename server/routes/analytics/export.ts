import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import ExcelJS from "exceljs";
import { addAoaSheet, workbookToBuffer } from "../../utils/excel";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { loadObservations } from "../../services/analytics/observations";
import { summariseObservations } from "../../services/analytics/test-summary";
// Analytics reports are read by people, not re-imported: the question text goes in
// without its markdown markers. The question-bank export is the opposite case and
// keeps the stored text verbatim, so an export/import round trip cannot lose markup.
import { stripMarkdown } from "@shared/text";
import { loadTestScoringContext, type TestScoringContext } from "../../services/effective-scoring";
import {
  analyticsScope,
  declaresPassThreshold,
  formatQuestionType,
  formatAllOptions,
  formatCorrectAnswerText,
  attemptPackage,
  attemptTestId,
  formatUserAnswerText,
  formatContributions,
  gradingOf,
  hasMeasures,
  loadMeasureCatalogue,
  measureCells,
  measureHeaders,
  NOT_APPLICABLE,
  type MeasureCatalogue,
} from "./helpers";
import { isMeasurementOnly } from "@shared/questions/question-type";
import { outcomeFor } from "../../services/analytics/answer-outcome";
import { loadScoringConfig } from "../../services/scoring-config";
import { computeAnswerContributions, type Answer, type QuestionType } from "@shared/scales/engine";
import { plainPromptOf } from "@shared/questions/prompt-format";

/** Scale key -> label, for the per-answer contribution cell. */
const scaleLabelsOf = (measures: MeasureCatalogue) =>
  new Map(measures.scales.map((s) => [s.key, s.label]));

const router = Router();

/** Как источник прохождения подписывается в книге. */
const SOURCE_TITLE: Record<string, string> = {
  web: "Веб",
  telemetry: "Телеметрия LMS",
  import: "Импорт",
};

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

    // PRD-15 block D (FR-32): recompute with the test-effective price/config.
    const scoring = await loadTestScoringContext(testId, storage);
    // PRD-5/PRD-2: what this test measures, and whether it grades at all (PRD-29 §6.7).
    const measures = await loadMeasureCatalogue(testId);
    const thresholdDeclared = declaresPassThreshold(test);
    // Loaded only when there is a scale to attribute an answer to — a control test
    // makes no extra queries and grows no extra column.
    const scoringConfig = measures.scales.length > 0
      ? await loadScoringConfig(testId, storage)
      : { measurements: [] };
    const scaleLabels = scaleLabelsOf(measures);

    // ЛИСТ 1: Сводка
    // PRD-56 FR-25: книга считает по ТЕМ ЖЕ наблюдениям, что экран — веб, телеметрия и
    // импортированные выгрузки. Иначе автор получает два разных ответа на один вопрос:
    // один в браузере, другой в файле, который отправит коллеге.
    // Область видимости проверена `requireTestScope` выше.
    const observations = await loadObservations(
      { testIds: [testId] },
      { all: true, ids: new Set([testId]) },
    );
    const stats = summariseObservations(observations.rows);

    const summaryData: any[][] = [
      ["Аналитика теста"],
      [],
      ["Название теста", test.title],
      ["Режим", test.mode === "adaptive" ? "Адаптивный" : "Стандартный"],
      ["Дата экспорта", new Date().toLocaleString("ru-RU")],
      [],
      ["Показатель", "Значение"],
      ["Всего попыток", stats.totalAttempts],
      ["Завершённых попыток", stats.completedAttempts],
      ["Уникальных пользователей", stats.uniqueParticipants],
    ];

    // PRD-29 §6.7: average and pass rate only over the runs those numbers apply to.
    // Averaging a questionnaire's runs printed «Средний результат 0.0%» beside
    // «Процент прохождения 100.0%» — two false statements about a method that grades
    // nothing. The dash says «неприменимо»; the counts above still say what happened.
    summaryData.push([
      "Средний результат",
      stats.avgPercent === null ? NOT_APPLICABLE : `${stats.avgPercent.toFixed(1)}%`,
    ]);
    summaryData.push([
      "Процент прохождения",
      stats.passRate !== null
        ? `${stats.passRate.toFixed(1)}%`
        : NOT_APPLICABLE,
    ]);

    // ЛИСТ 2: Попытки
    const attemptsHeaders = [
      "ID попытки", "Пользователь", "Дата начала", "Дата завершения",
      "Время (сек)", "Результат (%)", "Баллы", "Макс. баллы", "Статус",
    ];

    if (test.mode === "adaptive") {
      attemptsHeaders.push("Достигнутые уровни");
    }
    // PRD-5/PRD-2: one column per scale (and its level) and per indicator — what a
    // measurement run actually produced. Absent for a test that measures nothing.
    attemptsHeaders.push(...measureHeaders(measures));

    const attemptsData: any[][] = [attemptsHeaders];

    for (const attempt of testAttempts) {
      const result = attempt.resultJson as any;
      const duration = attempt.startedAt && attempt.finishedAt
        ? Math.round((new Date(attempt.finishedAt).getTime() - new Date(attempt.startedAt).getTime()) / 1000)
        : null;
      const { scored, verdictPronounced } = gradingOf(result, thresholdDeclared);

      const row: any[] = [
        attempt.id,
        userMap.get(attempt.userId) || "Unknown",
        attempt.startedAt ? new Date(attempt.startedAt).toLocaleString("ru-RU") : "",
        attempt.finishedAt ? new Date(attempt.finishedAt).toLocaleString("ru-RU") : "",
        duration ?? "",
        // PRD-29 §6.7: a run that graded nothing has no percent, no points and no
        // verdict — the dash, not «0.0» and a green «Сдан».
        result && scored ? result.overallPercent?.toFixed(1) ?? "" : result ? NOT_APPLICABLE : "",
        result && scored ? result.totalEarnedPoints ?? "" : result ? NOT_APPLICABLE : "",
        result && scored ? result.totalPossiblePoints ?? "" : result ? NOT_APPLICABLE : "",
        result
          ? verdictPronounced ? (result.overallPassed ? "Сдан" : "Не сдан") : NOT_APPLICABLE
          : "В процессе",
      ];

      if (test.mode === "adaptive" && result?.topicResults) {
        const levels = result.topicResults
          .map((tr: any) => `${tr.topicName}: ${tr.achievedLevelName || "—"}`)
          .join("; ");
        row.push(levels);
      }

      row.push(...measureCells(measures, result));

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
    // PRD-5: what this answer DID — the only outcome a measurement answer has. Without
    // it the sheet showed a questionnaire's answers with nothing but «Неверно» beside
    // them: the whole point of the question is invisible in its own answer row.
    if (measures.scales.length > 0) {
      answersHeaders.push("Вклад в шкалы");
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

        const effective = scoring.resolve(question);
        // PRD-57 (#43): исход берётся из попытки. Пересчёт по ЖИВОМУ вопросу заставлял
        // выгрузку противоречить вердикту, который засчитала сама попытка.
        const outcome = outcomeFor(attempt.resultJson, qId, question, userAnswer, effective);
        const isCorrect = outcome?.result === "correct";
        const dataJson = question.dataJson as any;
        const correctJson = question.correctJson as any;
        // PRD-26 FR-08 / PRD-44 FR-09: never checked, earns no points — «Верно/Неверно»
        // is not a weak answer here but a wrong KIND of answer.
        const measurementOnly = isMeasurementOnly(question);

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
          plainPromptOf(question),
          topicMap.get(question.topicId) || "Unknown",
          formatQuestionType(question.type),
          scoring.difficultyOf(question) || 50,
          formatAllOptions(question.type, dataJson, correctJson),
          formatCorrectAnswerText(question.type, dataJson, correctJson),
          formatUserAnswerText(question.type, dataJson, userAnswer),
          measurementOnly ? NOT_APPLICABLE : isCorrect ? "Верно" : "Неверно",
          measurementOnly ? NOT_APPLICABLE : isCorrect ? effective.points : 0,
        ];

        if (test.mode === "adaptive") {
          row.push(levelName);
        }

        if (measures.scales.length > 0) {
          row.push(formatContributions(
            computeAnswerContributions(scoringConfig.measurements, qId, userAnswer as Answer, question.type as QuestionType),
            scaleLabels,
          ));
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
        if (outcomeFor(attempt.resultJson, qId, question, answer, scoring.resolve(question))?.result === "correct") {
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
      const measurementOnly = isMeasurementOnly(question);

      questionStatsData.push([
        plainPromptOf(question),
        topicMap.get(question.topicId) || "Unknown",
        formatQuestionType(question.type),
        scoring.difficultyOf(question) || 50,
        formatAllOptions(question.type, dataJson, correctJson),
        formatCorrectAnswerText(question.type, dataJson, correctJson),
        stats.total,
        // A measurement question is never checked, so «правильных: 0 (0.0%)» ranked the
        // whole questionnaire at the top of the «hardest questions» list. The count of
        // ANSWERS stays — that one is real and is what an item analysis starts from.
        measurementOnly ? NOT_APPLICABLE : stats.correct,
        measurementOnly
          ? NOT_APPLICABLE
          : stats.total > 0 ? `${((stats.correct / stats.total) * 100).toFixed(1)}%` : "0%",
      ]);
    }

    const header = questionStatsData.shift();
    questionStatsData.sort((a, b) => {
      // Unchecked questions have no place on a «worst first» axis: they sort last
      // rather than tying with a genuinely failed question at 0%.
      const pct = (v: unknown) =>
        String(v) === NOT_APPLICABLE ? Number.POSITIVE_INFINITY : parseFloat(String(v).replace("%", "")) || 0;
      return pct(a[8]) - pct(b[8]);
    });
    questionStatsData.unshift(header!);

    // Создаём Excel
    const workbook = new ExcelJS.Workbook();
    addAoaSheet(workbook, "Сводка", summaryData);
    addAoaSheet(workbook, "Попытки", attemptsData, [36, 20, 18, 18, 12, 12, 10, 12, 12, 40]);
    addAoaSheet(workbook, "Ответы", answersData, [36, 15, 18, 50, 20, 15, 10, 50, 30, 30, 10, 8, 15, 30]);
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
router.get("/export/filters", requirePermission("analytics.export"), async (req: Request, res: Response) => {
  try {
    // PRD-15 FR-08 (audit F-5): the filter dictionary only exposes readable tests
    // and the attempts/packages belonging to them.
    const scope = await analyticsScope(req);
    const tests = (await storage.getTests()).filter((t) => scope.has(t.id));
    const allAttempts = (await storage.getAllAttempts()).filter((a) => scope.has(a.testId));
    const scormPackages = (await storage.getScormPackages()).filter((p) =>
      scope.has(p.testId ?? null),
    );
    const packageMap = new Map(scormPackages.map((p) => [p.id, p]));
    // PRD-54: область берётся по ТЕСТУ прохождения, а не по пакету. Отбор по пакетам выбросил бы
    // импортированные строки, и тест, у которого есть только загруженная выгрузка, не попал бы в
    // словарь фильтров вовсе — то есть выгрузить его данные было бы нечем.
    const allScormAttempts = (await storage.getAllScormAttempts()).filter((a) =>
      scope.has(attemptTestId(a, packageMap)),
    );

    const webTestIds = new Set(allAttempts.filter(a => a.finishedAt).map(a => a.testId));
    const lmsTestIds = new Set<string>();
    for (const attempt of allScormAttempts) {
      if (attempt.finishedAt) {
        const id = attemptTestId(attempt, packageMap);
        if (id) lmsTestIds.add(id);
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
      const odataUserId = attempt.lmsUserId || attempt.sessionId || attempt.participantKey || attempt.id;
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

    // PRD-15 FR-08 (audit F-5): export only the tests within the actor's scope.
    const scope = await analyticsScope(req);
    const tests = await storage.getTests();
    // PRD-56 FR-04: книга отдаёт то, что отфильтровано в реестре. Без условия «Тест» реестр
    // показывает прохождения ВСЕХ доступных тестов — и выгрузка обязана брать их же. Раньше
    // пустой список тестов отвергался («testIds is required»), и выборку по одной группе или
    // подразделению выгрузить было нельзя вовсе.
    const selectedTests = tests.filter(t => (testIds.length === 0 || testIds.includes(t.id)) && scope.has(t.id));
    if (selectedTests.length === 0) {
      return testIds.length > 0
        ? res.status(403).json({ error: "Forbidden" })
        : res.status(400).json({ error: "Нет доступных тестов для выгрузки" });
    }
    const testTitleMap = new Map(selectedTests.map(t => [t.id, t.title]));
    const testModeMap = new Map(selectedTests.map(t => [t.id, t.mode || "standard"]));

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    const allAttempts = await storage.getAllAttempts();

    // Filter attempts (selectedTests is already scope-filtered, FR-08).
    const selectedTestIds = new Set(selectedTests.map((t) => t.id));
    let attempts = allAttempts.filter(a => selectedTestIds.has(a.testId));

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

    // PRD-56 FR-04: что выгружается, решает фильтр реестра. Источник и исход — его условия,
    // и книга обязана понимать их так же, как экран.
    const sources = Array.isArray(config?.sources) ? config.sources : [];
    const outcomes = Array.isArray(config?.outcomes) ? config.outcomes : [];
    // Вариант выдачи и версия публикации — тоже условия реестра: срез «Вариант Б», выгруженный
    // без них, отдавал в книгу весь тест.
    const stringsOf = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const formIds = stringsOf(config?.formIds);
    const snapshotIds = stringsOf(config?.snapshotIds);
    // Оргструктура (FR-06b) — такие же условия реестра: без них срез «Отдел продаж» выгрузился
    // бы всем тестом.
    const organizations = stringsOf(config?.organizations);
    const units = stringsOf(config?.units);
    const positions = stringsOf(config?.positions);
    const observed = (await loadObservations(
      {
        testIds: [...selectedTestIds],
        ...(groupIds.length ? { groupIds } : {}),
        ...(sources.length ? { sources } : {}),
        ...(outcomes.length ? { outcomes } : {}),
        ...(formIds.length ? { formIds } : {}),
        ...(snapshotIds.length ? { snapshotIds } : {}),
        ...(organizations.length ? { organizations } : {}),
        ...(units.length ? { units } : {}),
        ...(positions.length ? { positions } : {}),
        ...(from ? { from } : {}),
        ...(to ? { to } : {}),
      },
      scope,
    )).rows;

    // Only completed
    let completed = attempts.filter(a => a.resultJson !== null);

    // Листы по веб-попыткам сужаются тем же отбором, что лист прохождений: веб-наблюдение и
    // попытка делят идентификатор, а второе толкование «варианта» в экспорте разошлось бы с
    // реестром.
    if (formIds.length || snapshotIds.length) {
      const matched = new Set(observed.filter(o => o.source === "web").map(o => o.id));
      completed = completed.filter(a => matched.has(a.id));
    }

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

    // PRD-15 block D (FR-32): the effective price/config/difficulty of the same
    // question differ between tests — one resolution context per selected test.
    const scoringByTest = new Map<string, TestScoringContext>();
    for (const t of selectedTests) {
      scoringByTest.set(t.id, await loadTestScoringContext(t.id, storage));
    }

    // PRD-5/PRD-2/PRD-29: the measurement vocabulary and the threshold flag of EACH
    // selected test — this report spans several, and neither is a property of the report.
    const measuresByTest = new Map<string, MeasureCatalogue>();
    const thresholdByTest = new Map<string, boolean | undefined>();
    for (const t of selectedTests) {
      measuresByTest.set(t.id, await loadMeasureCatalogue(t.id));
      thresholdByTest.set(t.id, declaresPassThreshold(t));
    }

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
      // PRD-56 FR-04: строки берутся из общего слоя наблюдений — веб, телеметрия и импорт.
      // До этого лист знал только `attempts`, и выгрузка молчала о половине прохождений.
      // Оргколонки — сразу за участником (план оргструктуры): книгу по срезу «Отдел продаж»
      // открывают, чтобы увидеть, кто в нём, и значение должно стоять рядом с человеком.
      // Значения — по тому же правилу, что у оси (OQ-04): своё у прохождения, иначе профиль.
      const rows: any[][] = [[
        "Тест", "ID прохождения", "Участник", "Организация", "Подразделение", "Должность",
        "Дата начала", "Дата завершения",
        "Время (сек)", "Результат (%)", "Баллы", "Макс. баллы", "Статус", "Источник",
      ]];

      for (const o of observed) {
        rows.push([
          testTitleMap.get(o.testId ?? "") || o.testId || "Удалённый тест",
          o.id,
          o.participant,
          o.organization ?? "",
          o.unit ?? "",
          o.position ?? "",
          o.startedAt ? new Date(o.startedAt).toLocaleString("ru-RU") : "",
          o.finishedAt ? new Date(o.finishedAt).toLocaleString("ru-RU") : "",
          o.durationMs === null ? "" : Math.round(o.durationMs / 1000),
          o.percent === null ? NOT_APPLICABLE : o.percent.toFixed(1),
          o.earnedPoints === null ? NOT_APPLICABLE : o.earnedPoints,
          o.possiblePoints === null ? NOT_APPLICABLE : o.possiblePoints,
          o.outcome === "passed" ? "Сдан"
            : o.outcome === "failed" ? "Не сдан"
              : o.outcome === "incomplete" ? "Не завершено" : NOT_APPLICABLE,
          SOURCE_TITLE[o.source],
        ]);
      }

      addAoaSheet(wb, "Попытки", rows, [24, 36, 22, 22, 22, 22, 18, 18, 12, 12, 10, 12, 12, 14]);
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
        const scoring = scoringByTest.get(attempt.testId);

        for (const [qId, userAnswer] of Object.entries(answers)) {
          const q = questionMap.get(qId);
          if (!q) continue;

          const effective = scoring?.resolve(q);
          // PRD-57 (#43): исход берётся из попытки — см. пояснение у выгрузки теста.
          const outcome = outcomeFor(attempt.resultJson, qId, q, userAnswer, {
            points: effective?.points ?? 1,
            scoring: effective?.scoring ?? null,
          });
          const isCorrect = outcome?.result === "correct";
          const dataJson = q.dataJson as any;
          const correctJson = q.correctJson as any;
          // PRD-26 FR-08 / PRD-44 FR-09: never checked — see the per-test export.
          const measurementOnly = isMeasurementOnly(q);

          rows.push([
            testTitleMap.get(attempt.testId) || attempt.testId,
            attempt.id,
            username,
            startStr,
            plainPromptOf(q),
            topicMap.get(q.topicId) || "Unknown",
            formatQuestionType(q.type),
            (scoring ? scoring.difficultyOf(q) : q.difficulty) || 50,
            formatAllOptions(q.type, dataJson, correctJson),
            formatCorrectAnswerText(q.type, dataJson, correctJson),
            formatUserAnswerText(q.type, dataJson, userAnswer),
            measurementOnly ? NOT_APPLICABLE : isCorrect ? "Верно" : "Неверно",
            // T-40: points come from the effective chain; the `?? 1` is the
            // system default for the defensive case of a missing scoring context.
            measurementOnly ? NOT_APPLICABLE : isCorrect ? (effective?.points ?? 1) : 0,
          ]);
        }
      }

      addAoaSheet(wb, "Ответы", rows, [24, 36, 15, 18, 50, 20, 15, 10, 50, 30, 30, 10, 8]);
    }

    // Sheet: Измерения — PRD-5 scales and PRD-2 indicators, per run.
    //
    // LONG format here and WIDE in the per-test export, on purpose: this report spans
    // several tests, whose scales have nothing in common, so a column per scale would
    // be a sparse matrix where most cells cannot apply. One row per (run, measure)
    // pivots cleanly and stays readable however many tests were selected.
    if (includeSheets.attempts) {
      const rows: any[][] = [[
        "Тест", "ID попытки", "Пользователь", "Дата завершения",
        "Вид", "Ключ", "Название", "Значение", "Уровень",
      ]];

      for (const a of completed) {
        const catalogue = measuresByTest.get(a.testId);
        if (!catalogue || !hasMeasures(catalogue)) continue;

        const r = (a.resultJson ?? {}) as {
          scaleResults?: Record<string, { raw?: number; label?: string; level?: string } | undefined>;
          resultVariables?: Record<string, unknown>;
        };
        const head = [
          testTitleMap.get(a.testId) || a.testId,
          a.id,
          userMap.get(a.userId) || "Unknown",
          a.finishedAt ? new Date(a.finishedAt).toLocaleString("ru-RU") : "",
        ];

        for (const s of catalogue.scales) {
          const v = r.scaleResults?.[s.key];
          rows.push([
            ...head, "Шкала", s.key, s.label,
            typeof v?.raw === "number" ? v.raw : NOT_APPLICABLE,
            v?.label || v?.level || NOT_APPLICABLE,
          ]);
        }
        for (const i of catalogue.indicators) {
          const v = r.resultVariables?.[i.name];
          rows.push([
            ...head, "Показатель", i.name, i.label,
            v === undefined || v === null || v === "" ? NOT_APPLICABLE : String(v),
            NOT_APPLICABLE,
          ]);
        }
      }

      if (rows.length > 1) {
        addAoaSheet(wb, "Измерения", rows, [24, 36, 18, 18, 12, 16, 24, 12, 16]);
      }
    }

    // Sheet: Question stats
    if (includeSheets.questionStats) {
      const stat = new Map<string, { total: number; correct: number; testId: string }>();

      for (const attempt of completed) {
        const answers = (attempt.answersJson || {}) as Record<string, unknown>;
        const scoring = scoringByTest.get(attempt.testId);
        for (const [qId, ans] of Object.entries(answers)) {
          const q = questionMap.get(qId);
          if (!q) continue;

          const key = `${attempt.testId}:${qId}`;
          const s = stat.get(key) || { total: 0, correct: 0, testId: attempt.testId };
          s.total++;
          const outcome = outcomeFor(attempt.resultJson, qId, q, ans, {
            points: scoring?.resolve(q).points ?? 1,
            scoring: scoring?.resolve(q).scoring ?? null,
          });
          if (outcome?.result === "correct") s.correct++;
          stat.set(key, s);
        }
      }

      const rows: any[][] = [["Тест", "Вопрос", "Тема", "Тип", "Сложность", "Всего", "Правильных", "% правильных"]];
      for (const [key, s] of stat.entries()) {
        const qId = key.split(":")[1];
        const q = questionMap.get(qId);
        if (!q) continue;
        const scoring = scoringByTest.get(s.testId);

        rows.push([
          testTitleMap.get(s.testId) || s.testId,
          plainPromptOf(q),
          topicMap.get(q.topicId) || "Unknown",
          formatQuestionType(q.type),
          (scoring ? scoring.difficultyOf(q) : q.difficulty) || 50,
          s.total,
          // A measurement question is never checked — «0 правильных» was a verdict on
          // a question that has none (see the per-test export).
          isMeasurementOnly(q) ? NOT_APPLICABLE : s.correct,
          isMeasurementOnly(q)
            ? NOT_APPLICABLE
            : s.total ? `${((s.correct / s.total) * 100).toFixed(1)}%` : "0%",
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

    // PRD-15 FR-08 (audit F-5): export only the tests within the actor's scope.
    const scope = await analyticsScope(req);
    const scopedTestIds = testIds.filter((id) => scope.has(id));
    if (scopedTestIds.length === 0) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const tests = await storage.getTests();
    const selectedTests = tests.filter(t => scopedTestIds.includes(t.id));
    const testTitleMap = new Map(selectedTests.map(t => [t.id, t.title]));

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    const packages = await storage.getScormPackages();
    const packageMap = new Map(packages.map(p => [p.id, p]));

    const relevantPackages = packages.filter(p => p.testId && scopedTestIds.includes(p.testId));
    const relevantPackageIds = new Set(relevantPackages.map(p => p.id));

    const allAttempts = await storage.getAllScormAttempts();

    // PRD-54: отбор по ТЕСТУ, а не по пакету — иначе загруженные выгрузки в отчёт не попадут.
    // Они такие же прохождения в LMS, просто приехали книгой, а не рантаймом.
    let attempts = allAttempts.filter(a => {
      const id = attemptTestId(a, packageMap);
      return id !== null && scopedTestIds.includes(id);
    });

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
        const odataUserId = a.lmsUserId || a.sessionId || a.participantKey || a.id;
        return userSet.has(odataUserId);
      });
    }

    // Best attempt only
    if (bestAttemptOnly) {
      const best = new Map<string, any>();

      for (const a of completed) {
        const pkg = attemptPackage(a, packageMap);
        if (!pkg) continue;

        const odataUserId = a.lmsUserId || a.sessionId || a.participantKey || a.id;
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
        ["Уникальных пользователей", new Set(completed.map(a => a.lmsUserId || a.sessionId || a.participantKey || a.id)).size],
        ["bestAttemptOnly", bestAttemptOnly ? "Да" : "Нет"],
        ["Период", `${dateFrom || "—"} .. ${dateTo || "—"}`],
        [],
        ["Тест", "Попыток", "Средний %", "Процент сдачи"],
      ];

      for (const t of selectedTests) {
        const ta = completed.filter(a => attemptTestId(a, packageMap) === t.id);
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
        const pkg = attemptPackage(a, packageMap);
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
        const pkg = attemptPackage(attempt, packageMap);
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
            plainPromptOf({ prompt: ans.questionPrompt || q?.prompt || "—", promptFormat: q?.promptFormat }),
            ans.topicName || topicMap.get(ans.topicId || "") || "—",
            formatQuestionType(ans.questionType || q?.type || "unknown"),
            ans.difficulty || q?.difficulty || 50,
            formatAllOptions(ans.questionType || q?.type, dataJson, ans.correctAnswerJson || q?.correctJson),
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
        const pkg = attemptPackage(attempt, packageMap);
        if (!pkg) continue;

        const answers = attemptAnswers.get(attempt.id) || [];
        for (const ans of answers) {
          const q = questionMap.get(ans.questionId);
          const testId = pkg.testId || "";
          const key = `${testId}:${ans.questionId}`;
          const s = stat.get(key) || {
            prompt: plainPromptOf({ prompt: ans.questionPrompt || q?.prompt || "—", promptFormat: q?.promptFormat }),
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
        const pkg = attemptPackage(attempt, packageMap);
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
        const odataUserId = attempt.lmsUserId || attempt.sessionId || attempt.participantKey || attempt.id || "—";

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