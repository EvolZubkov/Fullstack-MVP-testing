import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { analyticsScope, attemptPackage, buildIndicatorViews } from "./helpers";
import { loadScoringConfig } from "../../services/scoring-config";
import { computeAttemptResult, type AttemptResultBase } from "../../services/result-compute";
import { computeAnswerContributions, type Answer, type QuestionType } from "@shared/scales/engine";
import { computeBreakdowns } from "@shared/breakdown/compute";
import type { BreakdownItem } from "@shared/breakdown/types";
import type { AttemptDetailOutcome } from "./attempts";
import { sendAttemptProtocol } from "../../services/analytics/attempt-protocol";
import { indicatorValuesOf } from "../../services/analytics/indicator-values";

const router = Router();

/**
 * PRD-50: breakdown items of ONE telemetry attempt.
 *
 * Telemetry carries no tags and never will (FR-41), so the axis keys come from the
 * question bank as it stands TODAY, while the points come from the answer row as it was
 * DELIVERED. That split is not new: this route already recomputes scale contributions
 * against today's configuration and says so. Without it a `tag()` indicator read zero on
 * the analytics screen while the package had reported a real value for the same attempt.
 *
 * Exported for its own test: the route around it needs a DB, this does not.
 *
 * @param answers Telemetry answer rows of the attempt.
 * @param tagsByQuestion Live tags per question id.
 * @returns Items for {@link computeBreakdowns}; questions without a topic or a tag are skipped.
 */
export function scormBreakdownItems(
  // PRD-54: баллы стали необязательными — у измерительного ответа их нет вовсе. Для разрезов
  // отсутствие балла и ноль баллов означают одно и то же («нечего складывать»), поэтому `null`
  // здесь допустим и приводится к нулю на месте, а не запрещается типом.
  answers: ReadonlyArray<{ questionId: string; topicId: string | null; points: number | null; maxPoints: number | null }>,
  tagsByQuestion: ReadonlyMap<string, string[] | null | undefined>,
): BreakdownItem[] {
  const items: BreakdownItem[] = [];
  for (const a of answers) {
    const tags = tagsByQuestion.get(a.questionId);
    if (!a.topicId || !Array.isArray(tags) || tags.length === 0) continue;
    items.push({
      sectionId: a.topicId,
      axisKeys: { tag: tags },
      earned: a.points ?? 0,
      possible: a.maxPoints ?? 0,
      // A telemetry row exists BECAUSE the learner answered: there is no «delivered but
      // untouched» row to tell apart here.
      answered: true,
    });
  }
  return items;
}

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
      scope.has(attemptPackage(a, packageMap)?.testId ?? null),
    );

    const enrichedAttempts = await Promise.all(scopedAttempts.map(async (attempt) => {
      const pkg = attemptPackage(attempt, packageMap);
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

/**
 * Разбор ОДНОГО прохождения из LMS — то, что видит окно «Детали попытки».
 *
 * Вынесен из обработчика по той же причине, что разбор веб-попытки: его же выгружает протокол
 * (`attempt-protocol`), и второй сбор разошёлся бы с окном.
 *
 * @param req запрос: область видимости теста читается по нему
 * @param attemptId строка `scorm_attempts`
 */
export async function loadScormAttemptDetail(req: Request, attemptId: string): Promise<AttemptDetailOutcome> {
    const attempt = await storage.getScormAttempt(attemptId);
    if (!attempt) {
      return { status: 404, error: "Attempt not found" };
    }

    // PRD-54: у импортированного прохождения пакета нет — тест берётся не отсюда.
    const pkg = attempt.packageId ? await storage.getScormPackage(attempt.packageId) : undefined;
    // Тест строки — её собственный `test_id` (PRD-54); у старых строк телеметрии его нет, и тест
    // известен только через пакет — тот же порядок, что в слое наблюдений. Раньше тест брался
    // ТОЛЬКО через пакет: импортированное прохождение автору отвечало 403, а администратору
    // показывалось «Удалённым тестом» (дефект D5, найден приёмкой D3).
    const testId = attempt.testId ?? pkg?.testId ?? null;
    const test = testId ? await storage.getTest(testId) : undefined;

    // PRD-15 FR-08 (audit F-5): a single LMS attempt is readable only within
    // the analytics scope of its test.
    const scope = await analyticsScope(req);
    if (!scope.has(testId)) {
      return { status: 403, error: "Forbidden" };
    }

    const answers = await storage.getScormAnswersByAttempt(attempt.id);

    // Scale config (PRD-5) for per-answer contributions and the attempt-level scale
    // summary. Recomputed from the test's CURRENT config from the stored answers — may
    // drift if the test changed after the attempt (unlike baked points, contributions are
    // not persisted). Empty for a deleted test. Indicators are NOT recomputed: see below.
    const scoringConfig = testId
      ? await loadScoringConfig(testId)
      : { scales: [], measurements: [], resultVariables: [], budgets: {} };
    const rawAnswers: Record<string, Answer> = {};
    const questionTypes: Record<string, QuestionType> = {};
    for (const a of answers) {
      rawAnswers[a.questionId] = a.userAnswerJson as Answer;
      questionTypes[a.questionId] = a.questionType as QuestionType;
    }

    // PRD-50: живые теги выданных вопросов — единственный источник ключей для
    // телеметрийной попытки (см. `scormBreakdownItems`). Один запрос; пустой для
    // удалённых вопросов, и тогда разрезов просто нет.
    const answeredQuestions = answers.length
      ? await storage.getQuestionsByIds(answers.map((a) => a.questionId))
      : [];
    const tagsByQuestion = new Map(answeredQuestions.map((q) => [q.id, q.tags]));
    const breakdowns = computeBreakdowns(scormBreakdownItems(answers, tagsByQuestion));
    const questionById = new Map(answeredQuestions.map((q) => [q.id, q]));
    // Темы читаются один раз: и подпись строки ответа, и код темы для показателей ниже.
    const topics = (await storage.getTopics()) as Array<{ id: string; name: string; code?: string | null }>;
    const topicNameById = new Map(topics.map((t) => [t.id, t.name] as const));

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

      // PRD-5: how this answer moved each scale; PRD-18: graded ratio from the
      // baked points (contributions are recomputed, points/ratio are as delivered).
      const contribs = computeAnswerContributions(scoringConfig.measurements, a.questionId, a.userAnswerJson as Answer, a.questionType as QuestionType);
      const ratio = (a.maxPoints || 0) > 0 ? (a.points || 0) / (a.maxPoints as number) : (a.isCorrect ? 1 : 0);
      // Варианты, с которыми участник отвечал, — снимок, приехавший с ответом. Импорт выгрузки
      // его не несёт (в отчёте LMS вариантов нет), и тогда ответ переводится в слова по вопросу,
      // как он лежит сейчас, — иначе окно и протокол показывали «0» вместо варианта.
      const question = questionById.get(a.questionId);
      const hasSnapshot = !!(a.optionsJson || a.leftItemsJson || a.itemsJson);

      return {
        questionId: a.questionId,
        questionPrompt: a.questionPrompt,
        questionType: a.questionType,
        topicId: a.topicId,
        topicName: a.topicName ?? (a.topicId ? topicNameById.get(a.topicId) ?? null : null),
        difficulty: a.difficulty,
        userAnswer: a.userAnswerJson,
        correctAnswer: a.correctAnswerJson ?? question?.correctJson ?? null,
        ...(!hasSnapshot && question ? { questionData: question.dataJson } : {}),
        isCorrect: a.isCorrect,
        // PRD-54: измерительный ответ — третье состояние, а не «неверно».
        measurementOnly: a.result === "neutral",
        ratio,
        earnedPoints: a.points,
        possiblePoints: a.maxPoints,
        contribs,
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

    // PRD-2 §4.2 / PRD-50 FR-36: the topic's author-defined code keys `topicById("<code>")`
    // and the section half of a composite tag key «<код-темы>::<ключ>». Telemetry stores only
    // the topic id, so the code is read from the topic bank as it stands TODAY — the same
    // drift this route already accepts for scale contributions. Was hardcoded to null, which
    // left `tag("law::ПДн")` at zero even once the breakdowns were fed in.
    const topicCodeById = new Map(topics.map((t) => [t.id, t.code ?? null] as const));

    // PRD-5/PRD-2: attempt-level scale results + result variables (показатели).
    const gradedBase: AttemptResultBase = {
      percent: attempt.resultPercent || 0,
      topicResults: topicResults.map(tr => ({
        topicId: tr.topicId,
        percent: tr.percent,
        passed: tr.passed,
        earnedPoints: tr.earnedPoints,
        topicName: tr.topicName,
        code: topicCodeById.get(tr.topicId) ?? null,
      })),
      // PRD-50: без этого `tag()` в показателе давал бы здесь ноль, тогда как пакет на той
      // же попытке посчитал настоящее значение.
      breakdowns,
    };
    const graded = scoringConfig.scales.length || scoringConfig.resultVariables.length
      ? computeAttemptResult(scoringConfig, rawAnswers, questionTypes, gradedBase)
      : { scaleResults: {}, resultVariables: {}, status: {} };

    // PRD-56 FR-21e: indicators are the values the LMS REPORTED (`variables_json` — telemetry or
    // the `var_*` blocks of an imported export), never a replay of the formulas against today's
    // config: that would present as the participant's result a number the package never sent.
    // An indicator the run did not report stays empty.
    const rvRows = testId ? await storage.getResultVariables(testId) : [];
    const resultVariables = indicatorValuesOf(
      rvRows,
      attempt.variablesJson as Record<string, unknown> | null,
    );

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

    return { detail: {
      attemptId: attempt.id,
      lmsUserId: attempt.lmsUserId,
      lmsUserName: attempt.lmsUserName,
      lmsUserEmail: attempt.lmsUserEmail,
      testId,
      // Название и режим — у самого теста; снимок в пакете — запасной путь для удалённого теста.
      testTitle: test?.title ?? pkg?.testTitle ?? "Удалённый тест",
      testMode: test?.mode ?? pkg?.testMode ?? "standard",
      startedAt: attempt.startedAt?.toISOString() || null,
      finishedAt: attempt.finishedAt?.toISOString() || null,
      duration,
      overallPercent: attempt.resultPercent || 0,
      earnedPoints: attempt.totalPoints || 0,
      possiblePoints: attempt.maxPoints || 0,
      passed: attempt.resultPassed || false,
      // `passed` выше сводит «вердикта нет» к «не сдал»; протоколу нужна разница (PRD-29 §6.7).
      // Вердикт строки LMS вынесен, когда пакет его прислал; оценивалось — когда есть баллы
      // или процент (то же правило оценённости, что в слое наблюдений).
      scored: (attempt.maxPoints ?? 0) > 0 || attempt.resultPercent !== null,
      verdictPronounced: attempt.resultPassed !== null && attempt.resultPassed !== undefined,
      answers: detailedAnswers,
      topicResults,
      scaleResults: graded.scaleResults,
      resultVariables,
      indicatorViews: buildIndicatorViews(rvRows, resultVariables),
      achievedLevels,
      source: "lms",
    } };
}

// GET /api/analytics/scorm-attempts/:attemptId - Детали SCORM попытки
router.get("/scorm-attempts/:attemptId", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const outcome = await loadScormAttemptDetail(req, req.params.attemptId);
    if ("error" in outcome) return res.status(outcome.status).json({ error: outcome.error });
    res.json(outcome.detail);
  } catch (error) {
    logger.error("Get SCORM attempt details error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to get attempt details" });
  }
});

// GET /api/analytics/scorm-attempts/:attemptId/export/excel — протокол прохождения книгой (D3)
router.get(
  "/scorm-attempts/:attemptId/export/excel",
  requirePermission("analytics.export"),
  async (req: Request, res: Response) => {
    try {
      const outcome = await loadScormAttemptDetail(req, req.params.attemptId);
      if ("error" in outcome) return res.status(outcome.status).json({ error: outcome.error });
      await sendAttemptProtocol(res, outcome.detail, "lms");
    } catch (error) {
      logger.error("SCORM attempt protocol export error: " + (error as Error).message);
      res.status(500).json({ error: "Failed to export attempt" });
    }
  },
);

export default router;