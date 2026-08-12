import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { canReadTestAnalytics } from "../../services/test-access";
import { checkAnswer } from "../../utils/check-answer";
import { loadTestScoringContext } from "../../services/effective-scoring";
import { loadScoringConfig } from "../../services/scoring-config";
import { computeAttemptResult, type AttemptResultBase } from "../../services/result-compute";
import { computeAnswerContributions, type Answer, type QuestionType } from "@shared/scales/engine";
import { isSingleIndexChoice, distributesBudget } from "@shared/questions/question-type";
import { stripMarkdown } from "@shared/text";
import {
  buildIndicatorViews,
  declaresPassThreshold,
  gradingOf,
  loadMeasureCatalogue,
  type MeasureCatalogue,
} from "./helpers";
import { isMeasurementOnly } from "@shared/questions/question-type";

/**
 * The measurements of ONE run, as they were STORED at finish.
 *
 * Read off the attempt rather than recomputed: analytics answers «what did this
 * person get», and a recompute answers «what would they get from today's config» —
 * two different questions, and only the first one is a registration of the run. An
 * attempt finished before the test had scales simply carries nothing.
 */
function storedMeasures(result: unknown): {
  scaleValues?: Record<string, unknown>;
  indicatorValues?: Record<string, unknown>;
} {
  const r = (result ?? {}) as { scaleResults?: Record<string, unknown>; resultVariables?: Record<string, unknown> };
  return {
    ...(r.scaleResults ? { scaleValues: r.scaleResults } : {}),
    ...(r.resultVariables ? { indicatorValues: r.resultVariables } : {}),
  };
}

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

    // PRD-15 T-20 (FR-15): resolve each attempt's publication version. Attempts
    // pinned to a snapshot carry its monotonic version; legacy/transitional
    // attempts (no snapshot) report null.
    const snapshots = await storage.getSnapshotsForTest(testId);
    const versionBySnapshot = new Map(snapshots.map(s => [s.id, s.version]));

    // PRD-5/PRD-2: what this test MEASURES, so the attempts table can carry a column
    // per scale/indicator instead of registering a questionnaire run as «0.0 % / Сдан».
    const measures: MeasureCatalogue = await loadMeasureCatalogue(testId);
    const thresholdDeclared = declaresPassThreshold(test);

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
        // PRD-29 §6.7 reaches the AUTHOR too: without these two the table printed a
        // green «Сдан» over «0.0 %» for every questionnaire run — the default 70%
        // threshold every test is born with, applied to a run that grades nothing.
        // `passed` itself is left as stored so no existing reader loses its field.
        ...gradingOf(result, thresholdDeclared),
        completed: result !== null,
        // What the run actually measured (absent for a control test).
        ...storedMeasures(result),
        achievedLevels,
        // PRD-15 T-20: which published edition this attempt was taken on.
        snapshotVersion: attempt.snapshotId ? versionBySnapshot.get(attempt.snapshotId) ?? null : null,
      };
    }).sort((a, b) => {
      if (a.completed !== b.completed) return b.completed ? 1 : -1;
      const dateA = a.finishedAt || a.startedAt || "";
      const dateB = b.finishedAt || b.startedAt || "";
      return dateB.localeCompare(dateA);
    });

    // PRD-15 T-20: distribution of attempts across publication versions, so the
    // author sees which edition learners took (sorted newest version first;
    // `null` = legacy/pre-snapshot attempts).
    const versionCounts = new Map<number | null, number>();
    for (const a of attemptsList) {
      versionCounts.set(a.snapshotVersion, (versionCounts.get(a.snapshotVersion) ?? 0) + 1);
    }
    const versions = [...versionCounts.entries()]
      .map(([snapshotVersion, attemptCount]) => ({ snapshotVersion, attemptCount }))
      .sort((a, b) => (b.snapshotVersion ?? -1) - (a.snapshotVersion ?? -1));

    res.json({
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      // Whether the TEST declares an overall threshold at all — the half of the
      // PRD-29 §6.7 rule that belongs to the test rather than to a single run.
      hasPassThreshold: thresholdDeclared,
      measures,
      currentVersion: snapshots[0]?.version ?? null,
      versions,
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

    // PRD-15 FR-08 (audit F-5): a single attempt is readable only within the
    // analytics scope of its test (owner/grant/admin).
    const allowed = await canReadTestAnalytics(
      req.effectiveRoles ?? [],
      req.currentUser?.id ?? "",
      test,
    );
    if (!allowed) {
      return res.status(403).json({ error: "Forbidden" });
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

    // PRD-15 block D (FR-32): the recompute mirrors delivery — price, graded
    // config and difficulty come from the test-effective chain.
    const scoring = await loadTestScoringContext(test.id, storage);
    // Scale/indicator config (PRD-5/PRD-2) for the per-answer contributions and the
    // attempt-level scale/indicator summary in the export. Recomputed from the test's
    // CURRENT config (like the points recompute above); may drift if the test changed
    // after the attempt — persisting-at-attempt-time would be a separate follow-up.
    const scoringConfig = await loadScoringConfig(test.id, storage);
    // PRD-5/PRD-2 vocabulary + the PRD-29 §6.7 inputs, exactly as in the list route.
    const measures = await loadMeasureCatalogue(test.id);
    const thresholdDeclared = declaresPassThreshold(test);
    // The indicator ROWS themselves (not just their names): resolving what a value
    // MEANS needs each variable's interpretation config, which the catalogue drops.
    const rvRows = await storage.getResultVariables(test.id);

    const detailedAnswers: any[] = [];
    // Raw (runtime-encoded) answers + question types, for the scale engine.
    const rawAnswers: Record<string, Answer> = {};
    const questionTypes: Record<string, QuestionType> = {};

    for (const [qId, userAnswer] of Object.entries(answers)) {
      const question = questionMap.get(qId);
      if (!question) continue;

      const effective = scoring.resolve(question);
      // PRD-18: use the GRADED ratio (not a binary === 1 collapse) so weighted/tiered
      // partial answers earn partial points and the per-row totals reconcile with the
      // stored attempt aggregate. `isCorrect` stays boolean only for the UI verdict label.
      const ratio = checkAnswer(question, userAnswer, effective.scoring);
      const isCorrect = ratio === 1;

      rawAnswers[qId] = userAnswer as Answer;
      questionTypes[qId] = question.type as QuestionType;
      // PRD-5: how this answer moved each scale (value*weight of every fired unit).
      const contribs = computeAnswerContributions(scoringConfig.measurements, qId, userAnswer as Answer, question.type as QuestionType);

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

      // PRD-44: ответ распределения — «утверждение: балл» по КАЖДОМУ утверждению,
      // включая нулевые. Ноль здесь содержателен: он отличает «рассмотрел и не дал
      // веса» от «не дошёл». Правильного ответа у типа нет, поэтому эталон пуст.
      if (distributesBudget(question.type) && dataJson?.options) {
        const assigned = (userAnswer ?? {}) as Record<string, number>;
        formattedUserAnswer = (dataJson.options as string[]).map((label, i) => ({
          statement: label,
          points: Number(assigned[String(i)] ?? 0),
        }));
        formattedCorrectAnswer = null;
      } else if (isSingleIndexChoice(question.type) && dataJson?.options) {
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
        questionPrompt: stripMarkdown(question.prompt),
        questionType: question.type,
        topicId: question.topicId,
        topicName: topicMap.get(question.topicId) || "Unknown",
        userAnswer: formattedUserAnswer,
        userAnswerRaw: userAnswer,
        correctAnswer: formattedCorrectAnswer,
        correctAnswerRaw: correctJson,
        isCorrect,
        ratio,
        // PRD-26 FR-08 / PRD-44 FR-09: never checked, earns no points. The window
        // reads this to drop the tick and the points from the row — «0/1 ✗» is not a
        // low score on such a question, it is a verdict it cannot carry. Resolved
        // here and not in the client: the rule belongs to the question model.
        measurementOnly: isMeasurementOnly(question),
        earnedPoints: ratio * effective.points,
        possiblePoints: effective.points,
        difficulty: scoring.difficultyOf(question) || 50,
        contribs,
        levelName,
        levelIndex,
        questionData: dataJson,
      });
    }

    // PRD-5/PRD-2: the attempt's scale results (raw/percent/level) and result
    // variables (показатели).
    //
    // STORED FIRST. The run recorded them at finish, and that record — not a replay —
    // is what the author is asking to see: recomputing answers «what would this person
    // get from today's configuration», which silently rewrites history whenever a scale,
    // a measurement row or a formula changed after the attempt. The recompute stays as
    // the FALLBACK for attempts finished before the values were persisted (they carry
    // none), so no run loses its profile.
    const stored = storedMeasures(result);
    const measuresRecomputable = scoringConfig.scales.length || scoringConfig.resultVariables.length;
    let graded: { scaleResults: Record<string, unknown>; resultVariables: Record<string, unknown> };

    if (stored.scaleValues || stored.indicatorValues) {
      graded = {
        scaleResults: (stored.scaleValues ?? {}) as Record<string, unknown>,
        resultVariables: (stored.indicatorValues ?? {}) as Record<string, unknown>,
      };
    } else if (measuresRecomputable) {
      const gradedBase: AttemptResultBase = {
        percent: result?.overallPercent || 0,
        topicResults: (result?.topicResults || []).map((tr: any) => ({
          topicId: tr.topicId,
          percent: tr.percent || 0,
          passed: tr.passed ?? null,
          earnedPoints: tr.earnedPoints || 0,
          topicName: tr.topicName,
          code: tr.code ?? null,
        })),
      };
      graded = computeAttemptResult(scoringConfig, rawAnswers, questionTypes, gradedBase);
    } else {
      graded = { scaleResults: {}, resultVariables: {} };
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

    // PRD-15 T-20: the publication edition this attempt was delivered from.
    const snapshotVersion = attempt.snapshotId
      ? (await storage.getSnapshot(attempt.snapshotId))?.version ?? null
      : null;

    res.json({
      attemptId: attempt.id,
      userId: attempt.userId,
      username: user?.name || user?.email || "Unknown",
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      snapshotVersion,
      startedAt: attempt.startedAt?.toISOString() || null,
      finishedAt: attempt.finishedAt?.toISOString() || null,
      duration,
      overallPercent: result?.overallPercent || 0,
      earnedPoints: result?.totalEarnedPoints || 0,
      possiblePoints: result?.totalPossiblePoints || 0,
      passed: result?.overallPassed || false,
      // PRD-29 §6.7 — see the list route above. Without them the detail window
      // headlined a green «Пройден» over «0/0 баллов» for a questionnaire.
      hasPassThreshold: thresholdDeclared,
      ...gradingOf(result, thresholdDeclared),
      answers: detailedAnswers,
      topicResults: result?.topicResults || [],
      // How much of what was DELIVERED the learner actually answered. The answered
      // count alone cannot tell a full run from an abandoned one, and a measurement
      // run has no percent to say it instead.
      questionCount: uniqueQuestionIds.length,
      answeredCount: detailedAnswers.length,
      // What to CALL the scales/indicators below — their stored keys are DSL
      // identifiers, not headings.
      measures,
      scaleResults: graded.scaleResults,
      resultVariables: graded.resultVariables,
      // The indicators, resolved: value + what the author says it MEANS.
      indicatorViews: buildIndicatorViews(rvRows, graded.resultVariables),
      trajectory,
      achievedLevels,
    });

  } catch (error) {
    logger.error("Attempt detail error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch attempt details" });
  }
});

export default router;