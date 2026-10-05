import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { config } from "../../config";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { renderBlanksText } from "@shared/questions/blanks-render";
import { stripMarkdown } from "@shared/text";
import { isTextEntry, isOpenText, hasBlanks } from "@shared/questions/question-type";
import { summariseAnswers } from "../../services/analytics/answers";
import { answerSpread, textVolume, type AnswerSpread, type TextVolume } from "../../services/analytics/answer-spread";
import { loadTestAnswerFacts, variantQuestionIds } from "../../services/analytics/test-answer-facts";
import { scoreBuckets } from "../../services/analytics/score-buckets";
import { loadObservations } from "../../services/analytics/observations";
import { passTrendByMonth } from "../../services/analytics/pass-trend";
import { reviewOf } from "../../services/analytics/review-inputs";
import { summariseTopics } from "../../services/analytics/topic-stats";
import { summariseObservations } from "../../services/analytics/test-summary";
import { declaresPassThreshold, thresholdPercentOfTest } from "./helpers";
import { plainPromptOf } from "@shared/questions/prompt-format";
import { analyseUnits, type UnitAnalysis } from "@shared/psychometrics/units";
import type { AnswerRuleSet } from "@shared/answer-check";

const router = Router();

// GET /api/analytics/tests/:testId - Детальная аналитика теста
router.get("/:testId", requirePermission("analytics.read"), requireTestScope("analytics", "testId"), async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId;
    const test = await storage.getTest(testId);

    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    /**
     * PRD-56 FR-13: экран считается по отобранному — источнику, группе и периоду.
     *
     * Условия те же, что у реестра, и разбираются так же: тест в них не входит, он задан
     * страницей. Отсутствие условий значит «все прохождения», а не «никакие».
     */
    const listOf = (value: unknown): string[] => {
      const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
      return raw.flatMap(item => String(item).split(",")).map(item => item.trim()).filter(Boolean);
    };
    const dateOf = (value: unknown, edge: "start" | "end"): Date | undefined => {
      if (typeof value !== "string" || !value.trim()) return undefined;
      const date = new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
      return Number.isNaN(date.getTime()) ? undefined : date;
    };
    // Оргструктура (FR-06b) — повтором параметра, без деления по запятой: она бывает в имени.
    const repeated = (value: unknown): string[] =>
      (Array.isArray(value) ? value : value === undefined ? [] : [value])
        .map(item => String(item).trim())
        .filter(Boolean);
    const filter = {
      ...(listOf(req.query.source).length ? { sources: listOf(req.query.source) as never } : {}),
      ...(listOf(req.query.groupId).length ? { groupIds: listOf(req.query.groupId) } : {}),
      // Э3.1: «Прохождения с ошибкой» ставят условие на уровне теста — «Обзор» и шапка обязаны
      // считать по тому же отбору, что показывает чип, иначе условие висит, а числа его не знают.
      ...(listOf(req.query.wrongQuestionId).length ? { wrongQuestionIds: listOf(req.query.wrongQuestionId) } : {}),
      ...(repeated(req.query.organization).length ? { organizations: repeated(req.query.organization) } : {}),
      ...(repeated(req.query.unit).length ? { units: repeated(req.query.unit) } : {}),
      ...(repeated(req.query.position).length ? { positions: repeated(req.query.position) } : {}),
      ...(dateOf(req.query.from, "start") ? { from: dateOf(req.query.from, "start") } : {}),
      ...(dateOf(req.query.to, "end") ? { to: dateOf(req.query.to, "end") } : {}),
    };

    // PRD-70 FR-01: the test by query, not the whole table filtered in memory.
    const testAttempts = await storage.getAttemptsByTests([testId]);
    const completedAttempts = testAttempts.filter(a => a.resultJson !== null);

    // PRD-29 §6.7: does this test grade at all? Averaged over runs that graded
    // NOTHING, «средний балл» and «процент прохождения» are not weak numbers —
    // they are false ones: a questionnaire carries the default 70% threshold and
    // an `overallPassed: true` nobody pronounced, so the screen used to headline
    // «0.0 %» beside «100 % успешно сдали тест». Counts stay (the runs happened);
    // the grade-shaped metrics answer `null` — «неприменимо», not «ноль».
    const thresholdDeclared = declaresPassThreshold(test);

    // PRD-56 FR-33: плитки считаются по ВСЕМ прохождениям теста — вебу, телеметрии и
    // импортированным выгрузкам. До этого страница читала только `attempts`, и на тесте,
    // который проходят в LMS, её числа расходились с разделом «Аналитика» (FR-25).
    // Область видимости уже проверена `requireTestScope` выше, поэтому здесь она открыта.
    const observations = await loadObservations(
      { testIds: [testId], ...filter },
      { all: true, ids: new Set([testId]) },
    );
    const stats = summariseObservations(observations.rows);
    /**
     * Что попало в выборку — по идентификаторам прохождений. Ими режутся и ответы: у
     * прохождения из LMS своей записи в `attempts` нет, и фильтровать его попыткой нечем,
     * а факт ответа знает, какому прохождению принадлежит.
     */
    const inScope = new Set(observations.rows.map(row => row.id));
    /**
     * Отбор задан — значит выборку надо резать; не задан — резать нечего.
     *
     * Разница не косметическая. Без условий выборка и так равна всем прохождениям теста, и
     * пересечение с ней ничего не меняет — но выбрасывает ответ, у которого прохождение не
     * названо (старые строки телеметрии). Резать такие следует только тогда, когда отбор
     * ДЕЙСТВИТЕЛЬНО что-то ограничивает, иначе экран молча теряет данные на ровном месте.
     */
    const narrowed = Object.keys(filter).length > 0;
    const selects = (attemptId: string) => !narrowed || inScope.has(attemptId);

    const summary = {
      totalAttempts: stats.totalAttempts,
      completedAttempts: stats.completedAttempts,
      // The two denominators, published so a reader can tell «неприменимо» (a `null`
      // metric over zero of these) from «ноль» (a real zero over a positive count).
      gradedAttempts: stats.gradedAttempts,
      judgedAttempts: stats.judgedAttempts,
      uniqueUsers: stats.uniqueParticipants,
      avgPercent: stats.avgPercent,
      // Секунды: контракт экрана не меняется от смены источника данных.
      avgDuration: stats.avgDurationMs === null ? null : stats.avgDurationMs / 1000,
      // Медиана рядом со средним — величина, которой экран будет пользоваться после Э4
      // (эскиз обзора подписывает плитку «Время, медиана»).
      medianDuration: stats.medianDurationMs === null ? null : stats.medianDurationMs / 1000,
      passRate: stats.passRate,
      avgScore: stats.avgScore,
      maxScore: stats.maxScore ?? 0,
    };


    /**
     * PRD-56 FR-25: ответы обоих источников — одним сбором, общим со срезами (FR-06e).
     *
     * Разрешение оценивания (эффективная стоимость, правило проверки, измерительный ответ
     * третьим состоянием) живёт в `test-answer-facts`: второй экземпляр этой логики разошёлся
     * бы с первым молча — расхождением чисел на двух экранах.
     */
    /** Завершённые веб-попытки ВЫБОРКИ: всё, что считается по попыткам, считается по ним. */
    const selectedAttempts = completedAttempts.filter(attempt => selects(attempt.id));

    const {
      facts: allFacts, questionById, topicNameById, topicRules, difficultyOf, pointsOf,
    } = await loadTestAnswerFacts(testId, selectedAttempts);
    // Ответы прохождений из LMS дочитываются по тесту целиком, поэтому отбор применяется и к
    // ним: иначе фильтр по группе резал бы веб, а телеметрию оставлял бы нетронутой (FR-25).
    const facts = allFacts.filter(fact => selects(fact.attemptId));
    const questionMap = questionById;
    const topicMap = topicNameById;

    interface QuestionStatsEntry {
      questionId: string;
      questionPrompt: string;
      questionType: string;
      topicId: string;
      topicName: string;
      /** Сложность, заданная автором (0–100); `null` — не задана. */
      difficulty: number | null;
      /** Сколько раз ответили — включая ответы, которым нечего было оценивать. */
      totalAnswers: number;
      /** Сколько из них оценивалось: только по ним законна доля верных. */
      gradedAnswers: number;
      correctAnswers: number;
      /** Доля верных; `null` — оценивать было нечего (измерительный вопрос). */
      correctPercent: number | null;
      answersBySource: Record<string, number>;
      /**
       * Разброс ответов (FR-22): чем доля верных заменяется у измерительного задания.
       * `null` — задание оценивается либо разбрасывать нечего.
       */
      spread: AnswerSpread | null;
      /**
       * PRD-57 FR-32: сводка свободного текста — объём и длина. Частотная таблица
       * развёрнутому ответу не годится: двух одинаковых ответов не бывает.
       */
      volume: TextVolume | null;
      /** Э4а: разбор по единицам у сопоставления, ранжирования и пропусков; иначе `null`. */
      units: UnitAnalysis | null;
    }

    const questionStatsMap = new Map<string, QuestionStatsEntry>();

    /** Ответы по заданиям — сырьё разброса (FR-22). Собираются один раз, не в цикле. */
    const answersOfQuestion = new Map<string, unknown[]>();
    /** Те же ответы с прохождением — разбору по единицам нужен ответивший (Э4а). */
    const unitResponses = new Map<string, Array<{ respondentId: string; answer: unknown }>>();
    for (const fact of facts) {
      const list = answersOfQuestion.get(fact.questionId);
      if (list) list.push(fact.answer);
      else answersOfQuestion.set(fact.questionId, [fact.answer]);
      const responses = unitResponses.get(fact.questionId);
      const response = { respondentId: fact.attemptId, answer: fact.answer };
      if (responses) responses.push(response);
      else unitResponses.set(fact.questionId, [response]);
    }

    for (const stats of summariseAnswers(facts)) {
      const question = questionMap.get(stats.questionId);
      if (!question) continue;

      /**
       * FR-22: у измерительного задания эталона нет, и вместо доли верных экран показывает
       * разброс ответов. Считается там, где он определён: у шкалы и распределения баллов —
       * вместо доли верных, у короткого ответа (PRD-57 FR-28x) — В ДОПОЛНЕНИЕ к ней, потому
       * что варианты там не заданы заранее, а написания расходятся, и автору нужно видеть,
       * какие из них правило не ловит.
       */
      // У выбора разброс — доли выбранных вариантов с пометкой верного: «куда уходят
      // ошибившиеся» видно из колонки, не открывая разбор задания.
      const spreadType =
        question.type === "scale" || question.type === "allocation" || isTextEntry(question.type)
          || question.type === "single" || question.type === "multiple"
          ? (question.type as "scale" | "allocation" | "short" | "single" | "multiple")
          : null;
      const key = (question.correctJson ?? {}) as { correctIndex?: unknown; correctIndices?: unknown };
      const spread = spreadType
        ? answerSpread({
          type: spreadType,
          options: ((question.dataJson ?? {}) as { options?: string[] }).options ?? [],
          answers: answersOfQuestion.get(stats.questionId) ?? [],
          // PRD-57 FR-28ag: у числового задания вместо частотной таблицы написаний —
          // гистограмма значений. Вид ответа лежит в наборе правил, отдельного признака
          // у задания нет и заводить его незачем.
          answerKind: ((question.correctJson ?? {}) as { answerKind?: "text" | "number" }).answerKind,
          correctIndices: typeof key.correctIndex === "number"
            ? [key.correctIndex]
            : Array.isArray(key.correctIndices) ? key.correctIndices.filter((i): i is number => typeof i === "number") : [],
          // Э4а: у короткого ответа строка разброса помечается «засчитано» его же правилами.
          rules: isTextEntry(question.type) ? (question.correctJson as AnswerRuleSet) : null,
        })
        : null;

      // Э4а: у сопоставления, ранжирования и пропусков вариантов нет — ответ складывается из
      // единиц (пар, мест, пропусков), и разброс по ним говорит, какая единица не даётся.
      // Крайние группы здесь не нужны: их показывает страница вопроса.
      const units = question.type === "matching" || question.type === "ranking" || hasBlanks(question.type)
        ? analyseUnits(
          {
            type: question.type as "matching" | "ranking" | "blanks",
            prompt: question.prompt,
            data: question.dataJson,
            correct: question.correctJson,
          },
          (unitResponses.get(stats.questionId) ?? []),
        )
        : null;

      // PRD-57 FR-32: у свободного текста вместо частот — объём и длина. Считается и у
      // задания с пропусками: написанное там тоже текст, просто разложенный по полям.
      const volume = isOpenText(question.type) || hasBlanks(question.type)
        ? textVolume(
          (answersOfQuestion.get(stats.questionId) ?? []).map((answer) =>
            typeof answer === "string"
              ? answer
              : answer && typeof answer === "object"
                ? Object.values(answer as Record<string, unknown>).filter((v) => typeof v === "string").join(" ")
                : null,
          ),
        )
        : null;

      questionStatsMap.set(stats.questionId, {
        volume,
        spread,
        units,
        questionId: stats.questionId,
        questionPrompt: plainPromptOf({
          ...question,
          prompt: renderBlanksText(question.prompt, { mode: "dash" }),
        }),
        questionType: question.type,
        topicId: question.topicId,
        topicName: topicMap.get(question.topicId) || "Unknown",
        // Э4а: незаданная сложность — `null`, а не 50: подставленная 50 неотличима от заданной.
        difficulty: difficultyOf(question),
        totalAnswers: stats.answered,
        gradedAnswers: stats.graded,
        correctAnswers: stats.correct,
        correctPercent: stats.correctPercent,
        answersBySource: stats.bySource,
      });
    }

    /**
     * PRD-56 FR-14, FR-14a: разрезы по темам и подтемам — из тех же ответов.
     *
     * Пороги тем приехали вместе с фактами (`topicRules`): их разрешает правило теста, а исход
     * считает движок PRD-50 — своего правила аналитика не заводит, иначе исход в отчёте
     * участника и исход на этом экране однажды разойдутся.
     */

    const topicStats = summariseTopics(
      facts.flatMap(fact => {
        const question = questionMap.get(fact.questionId);
        if (!question) return [];
        return [{
          attemptId: fact.attemptId,
          topicId: question.topicId,
          topicName: topicMap.get(question.topicId) || "Без темы",
          // Подтема — тег вопроса (PRD-11): ответ может попасть в несколько, и это правда
          // о данных, а не ошибка счёта.
          subtopics: question.tags ?? [],
          result: fact.result,
          earnedPoints: fact.earnedPoints,
          possiblePoints: fact.possiblePoints,
        }];
      }),
      topicRules,
    );

    // Знаменатель доли — попытки теста за окно, считая БРОШЕННЫЕ: счётчик выдач пополняется на
    // старте попытки (FR-02), потому что брошенная попытка показала задание так же, как
    // доведённая до конца. Завершённые попытки в знаменателе давали бы долю больше ста процентов
    // ровно на число брошенных — «выдано 3 из 2» на первой же приёмке.
    //
    // Ноль попыток означает «сравнивать не с чем»: доля тогда `null`, а не ноль, иначе экран
    // покажет «0%» там, где данных нет вовсе.
    //
    // Источники знаменателя — ТЕ ЖЕ, что пополняют счётчик: веб, телеметрия и импорт выгрузок
    // (PRD-55 FR-07/FR-08). Считать только веб-попытки нельзя: с выдачами из выгрузок в числителе
    // тест, пройденный в LMS, показывал «23 500 %». Отбор страницы сюда не идёт — экспозиция
    // считается по тесту целиком, как на вкладке «Выдача».
    const exposureWindowStart = new Date();
    exposureWindowStart.setMonth(exposureWindowStart.getMonth() - config.delivery.exposureWindowMonths);
    const allPassages = narrowed
      ? (await loadObservations({ testIds: [testId] }, { all: true, ids: new Set([testId]) })).rows
      : observations.rows;
    const attemptsInWindow = allPassages.filter((o) => o.startedAt >= exposureWindowStart).length;

    // PRD-55 (FR-31/FR-31a/FR-32): экспозиция задания и время на него. Три запроса на ВЕСЬ тест,
    // а не по заданию: карточек на экране десятки, и запрос в цикле превратил бы страницу в
    // сотню обращений к базе.
    //
    // Ни одна из величин не является условием работы экрана: это дополнение к статистике
    // ответов, поэтому сбой чтения уходит в лог, а страница отдаётся без них.
    const questionIds = Array.from(questionStatsMap.keys());
    let exposureOwn = new Map<string, number>();
    let exposureGlobal = new Map<string, number>();
    let otherTests = new Map<string, number>();
    let latency = new Map<string, { medianMs: number; sampleSize: number }>();
    try {
      [exposureOwn, exposureGlobal, otherTests, latency] = await Promise.all([
        storage.getDeliveryCountsForTest(questionIds, testId, exposureWindowStart),
        storage.getDeliveryCounts(questionIds, exposureWindowStart),
        storage.getOtherTestsCount(questionIds, testId, exposureWindowStart),
        storage.getLatencyStats(questionIds, testId, exposureWindowStart),
      ]);
    } catch (error) {
      logger.warn("PRD-55: экспозиция и время заданий не прочитаны — " + (error as Error).message);
    }


    /**
     * PRD-56 FR-15: доля ПРОПУСКОВ — выданных заданий, оставшихся без ответа.
     *
     * Считается по веб-попыткам: у них известен и состав выдачи (`variantJson`), и ответы.
     * Пакет состава по попытке не сообщает — он шлёт выданный набор в счётчик экспозиции
     * (PRD-55), а тот агрегирован по месяцам и с ответами построчно не сопоставляется.
     * Поэтому у теста, который проходят только в LMS, доли пропусков нет, и это честнее
     * числа, собранного из двух разных окон.
     */
    const deliveredWeb = new Map<string, number>();
    const skippedWeb = new Map<string, number>();
    for (const attempt of selectedAttempts) {
      const answers = (attempt.answersJson ?? {}) as Record<string, unknown>;
      for (const questionId of variantQuestionIds(attempt.variantJson)) {
        deliveredWeb.set(questionId, (deliveredWeb.get(questionId) ?? 0) + 1);
        if (!(questionId in answers)) {
          skippedWeb.set(questionId, (skippedWeb.get(questionId) ?? 0) + 1);
        }
      }
    }

    /** PRD-56 FR-17a: задания, исключённые из выдачи этого теста — состояние видно в таблице. */
    const excludedFromDelivery = new Set(
      (await storage.getTestQuestionScoring(testId))
        .filter(row => row.excludedFromDelivery)
        .map(row => row.questionId),
    );

    // PRD-70 FR-03: эвристики ревизии — той же функцией, что у фонового пересчёта признаков.
    const delivery = { attemptsInWindow, exposureOwn, latency };
    const questionStats = Array.from(questionStatsMap.values()).map(qs => {
      const review = reviewOf(qs, delivery);
      const delivered = deliveredWeb.get(qs.questionId) ?? 0;
      const skipped = skippedWeb.get(qs.questionId) ?? 0;

      return {
        ...qs,
        exposureCount: review.exposureCount,
        exposurePercent: review.exposurePercent,
        globalExposureCount: exposureGlobal.get(qs.questionId) ?? 0,
        otherTestsCount: otherTests.get(qs.questionId) ?? 0,
        // Цена задания в этом тесте; `null` у измерительного — баллов оно не приносит.
        points: (() => {
          const question = questionMap.get(qs.questionId);
          return question ? pointsOf(question) : null;
        })(),
        // Своя выборка: веб времени не измеряет, пакеты старше 2026-09-12 его не сообщают.
        latencyMedianMs: review.latencyMedianMs,
        latencySampleSize: review.latencySampleSize,
        excludedFromDelivery: excludedFromDelivery.has(qs.questionId),
        deliveredWeb: delivered,
        skippedWeb: skipped,
        skipShare: delivered > 0 ? (skipped / delivered) * 100 : null,
        // FR-16: признаки ревизии считает сервис — вид «требуют ревизии» это отбор по ним,
        // а не собственное правило экрана.
        reviewFlags: review.reviewFlags,
      };
      // Первыми — самые трудные; вопросы без оценивания (измерительные) уходят в конец:
      // сортировать их вместе с долей верных не по чему, доли у них нет.
    }).sort((a, b) => (a.correctPercent ?? Infinity) - (b.correctPercent ?? Infinity));

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

      for (const attempt of selectedAttempts) {
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

    /**
     * PRD-56 FR-13a: корзины одной ширины, цвет — от проходного балла.
     *
     * Считается по тем же наблюдениям, что и плитки: иначе экран противоречит сам себе —
     * «18 прохождений» сверху и гистограмма по пятнадцати веб-попыткам. Прохождения без
     * результата в корзины не попадают: у них нет процента, а не ноль.
     */
    const percents = observations.rows
      .map(observation => observation.percent)
      .filter((percent): percent is number => percent !== null);
    const scoreDistribution = scoreBuckets(
      percents,
      thresholdPercentOfTest(test),
    );

    /**
     * PRD-56 FR-13: динамика сдаваемости ПО МЕСЯЦАМ.
     *
     * Дневная линия за тридцать дней, которая была здесь, для теста нечитаема: прохождения
     * идут волнами по назначениям, и график превращался в частокол из единиц. Месяц — та
     * единица, в которой об обучении и говорят.
     */
    const passTrend = passTrendByMonth(observations.rows);

    /**
     * PRD-56 FR-21: есть ли у теста шкалы — по этому признаку экран показывает вкладку
     * «Шкалы». Признак, а не сам профиль: считать профиль тому, кто открыл обзор
     * оцениваемого теста, незачем, а прятать вкладку до первого запроса — значит мигать ею.
     */
    const hasScales = (await storage.getScales(testId)).length > 0;

    res.json({
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      hasScales,
      // The test's half of the PRD-29 §6.7 rule (see `summary` above).
      hasPassThreshold: thresholdDeclared,
      /**
       * Порог наблюдений инстанса: им экран решает, печатать ли разброс ответов задания или
       * сказать «мало данных» (FR-22, FR-06d). Отдаётся вместе с данными, потому что настройка
       * инстанса, а не клиента, и второго её значения на экране быть не должно.
       */
      minObservations: config.analytics.minObservations,
      /**
       * PRD-56 FR-13a: проходной балл В ПРОЦЕНТАХ — число, а не граница корзины.
       *
       * Выводить его на клиенте из раскраски столбиков можно только при пороге, кратном их
       * ширине: при 75 % такой вывод давал «порог 70 %» и ставил вертикаль на границу,
       * а не на её место. `null` — тест не оценивает либо порог задан в баллах.
       */
      thresholdPercent: thresholdPercentOfTest(test),
      summary,
      topicStats,
      questionStats,
      // PRD-55 (FR-31): знаменатель доли выдачи. Отдаётся явно, потому что он НЕ равен ни одному
      // числу сводки: это попытки за окно наблюдения, считая брошенные, — а сводка показывает
      // завершённые. Считая его на клиенте по сводке, экран подписал бы «выдано 3 из 2».
      exposureAttempts: attemptsInWindow,
      levelStats: test.mode === "adaptive" ? levelStats : undefined,
      scoreDistribution,
      passTrend,
    });

  } catch (error) {
    logger.error("Test analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch test analytics" });
  }
});

export default router;