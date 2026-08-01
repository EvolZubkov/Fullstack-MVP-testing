import { Router } from "express";
import path from "node:path";
import { logger } from "../logger";
import { storage } from "../storage";
import { requirePermission } from "../middleware/auth";
import { checkAnswer } from "../utils/check-answer";
import { aggregateStandardResult, aggregateAdaptiveResult, type AggregateSection } from "@shared/scoring/aggregate";
import type { CorrectData, Answer } from "@shared/scoring/engine";
import { drawSection } from "@shared/draw/blueprint";
import { selectForm } from "@shared/draw/forms";
import { loadScoringConfig } from "../services/scoring-config";
import { loadTestScoringContext } from "../services/effective-scoring";
import { computeAttemptResult } from "../services/result-compute";
import { decideRetake, lastCompletedAttemptDate, toIsoDateUTC } from "../services/retake-gate";
import { readResultsRenderPayload, readReportRenderPayload } from "../services/template-render";
import { reportKindForMode } from "@shared/report/report-variants";
import { buildReportInput, buildAdaptiveReportInput, type MeasuresSource } from "../services/result-context";
import type { ResultsBlockSettings } from "@shared/template/results-blocks";
import type { ReportInput, AdaptiveReportInput } from "@shared/report/report-html";
import { pingSection } from "../services/section-timer";
import { buildResultsNav, RESULTS_NAV_ACTIONS } from "@shared/template/results-nav";
import { resolveSystemScreenDir, resolveTemplateDir } from "../services/template-dir";
import {
  liveDataSource,
  snapshotDataSource,
  dataSourceForAttempt,
  type TestDataSource,
  type TestSnapshotContent,
} from "../services/test-snapshot";
import type { QuestionType } from "@shared/scales/engine";
import { resolveAnswerCommitScope } from "@shared/flow/answer-commit-scope";
import type {
  Test,
  TestVariant,
  AttemptResult,
  TopicResult,
  PassRule,
  RetakePolicy,
  ReportSettings,
  FeedbackContent,
} from "@shared/schema";
// Brings the `SessionData.magic` augmentation (PRD magic-link scope) into scope.
import "../middleware/magic-scope";

const router = Router();

/**
 * PRD-19 (Block B): the runtime navigation settings the web learner host reads
 * from the attempt start / resume responses (the web analogue of TEST_DATA in
 * the SCORM package). `answerCommitScope` is resolved here from mode + flow mode
 * through the SAME shared resolver the SCORM exporter uses, so both hosts agree.
 */
function prd19RuntimeSettings(test: Test) {
  return {
    allowReturnToUnanswered: test.allowReturnToUnanswered ?? true,
    allowAnswerChange: test.allowAnswerChange ?? false,
    showSectionResults: test.showSectionResults ?? true,
    answerCommitScope: resolveAnswerCommitScope({
      mode: test.mode,
      flowMode: (test.flowPolicyJson as { mode?: string } | null)?.mode,
    }),
  };
}

/**
 * PRD-12 FR-6: the author's structure — content pages in all four placements
 * («До теста» / «После теста» / перед темой / после темы) plus the flow mode —
 * delivered to the web learner host so it can build the SAME run as the SCORM
 * package (`shared/flow/page-sequence`). Without this the web host only ever saw
 * the drawn questions, and every content page the author placed was silently
 * skipped at run time while «Структура» kept promising it.
 *
 * Read through `src`, not `storage`, so a snapshot-pinned attempt (PRD-15 block B)
 * gets the PUBLISHED structure rather than today's live edits.
 */
async function flowPayload(src: TestDataSource, test: Test) {
  const contentPages = await src.getContentPages(test.id);
  return {
    flowMode: (test.flowPolicyJson as { mode?: string } | null)?.mode ?? "linear_flat",
    contentPages: contentPages.map((p) => ({
      id: p.id,
      kind: p.kind,
      type: p.type,
      topicId: p.topicId,
      position: p.position,
      sortOrder: p.sortOrder,
      mode: p.mode,
      templateKey: p.templateKey,
      valuesJson: p.valuesJson,
      // PRD-22: page PROPERTIES (sequence identifier, «Далее» caption, background).
      // The SCORM package has shipped them since FR-20; without them here the web
      // run computed no sequence at all, so a gallery lost its indicator.
      settingsJson: p.settingsJson,
      autoAdvance: p.autoAdvance,
      autoAdvanceDelayMs: p.autoAdvanceDelayMs,
    })),
  };
}

/**
 * Resolves the data source for STARTING an attempt (PRD-15 block B). A published
 * test with a snapshot is delivered frozen — the attempt is pinned to that
 * snapshot and every read (sections, questions, scales, ...) comes from it.
 * Drafts, preview and published tests without a snapshot (transitional) fall
 * back to live storage with no pin.
 */
async function sourceForStart(
  testId: string,
): Promise<{ src: TestDataSource; snapshotId: string | null; test: Test } | null> {
  const liveTest = await storage.getTest(testId);
  if (!liveTest) return null;
  if (liveTest.status === "published") {
    const snap = await storage.getLatestSnapshot(testId);
    if (snap) {
      const src = snapshotDataSource(snap.contentJson as TestSnapshotContent);
      const test = (await src.getTest(testId)) ?? liveTest;
      return { src, snapshotId: snap.id, test };
    }
  }
  return { src: liveDataSource(), snapshotId: null, test: liveTest };
}

/**
 * PRD-29: the measurement material of the results screen — the test's scale and
 * indicator ROWS, the settings of its «Итоги» variant, whether the test has a pass
 * threshold at all, and the test's own feedback block.
 *
 * Rows are read through the SAME source the attempt was graded against (the one
 * `loadScoringConfig` takes): an attempt pinned to a snapshot (PRD-15 block B) reads
 * the FROZEN scales and indicators, so an interpretation edited today cannot rewrite
 * the verdict of an attempt taken yesterday. The measured VALUES are deliberately NOT
 * gathered here — they are already in the saved `AttemptResult` and must never be
 * recomputed.
 *
 * `undefined` for a test with neither scales nor indicators: the results context then
 * gains no new field at all.
 */
async function measuresForAttempt(
  attempt: { testId: string; snapshotId: string | null },
  liveTest: Test | undefined,
): Promise<MeasuresSource | undefined> {
  try {
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const [scales, variables] = await Promise.all([
      src.getScales(attempt.testId),
      src.getResultVariables(attempt.testId),
    ]);
    if (scales.length === 0 && variables.length === 0) return undefined;
    const deliveredTest = (await src.getTest(attempt.testId)) ?? liveTest;
    const pages = await src.getContentPages(attempt.testId);
    // No `results` page, or a page with no settings: all three blocks stay on
    // «Автоматически» and the state of the test decides.
    const blockSettings = (pages.find((p) => p.kind === "results")?.settingsJson ?? {}) as ResultsBlockSettings;
    const passRule = deliveredTest?.overallPassRuleJson as PassRule | null | undefined;
    return {
      scales,
      variables,
      blockSettings,
      hasPassThreshold: !!passRule && passRule.type !== "none",
      testFeedback: (deliveredTest?.feedbackJson as Partial<FeedbackContent> | null) ?? null,
    };
  } catch (error) {
    // The results screen must not fail because the measurement material could not be
    // read: the score, the per-topic rows and the report do not depend on it. The
    // learner then sees the screen a test without measurements would produce.
    logger.warn("PRD-29: measures source unavailable — " + (error as Error).message);
    return undefined;
  }
}

/** Fisher-Yates in-place shuffle for the server-side variant draw (PRD-11). */
function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

// GET /api/learner/tests - Тесты для ученика
router.get("/learner/tests", requirePermission("attempts.self.read"), async (req, res) => {
  try {
    const allAssigned = await storage.getAssignedTestsForUser(req.session.userId!);
    // A magic-link session sees ONE test: the list is the start screen's data
    // source, and it must not enumerate the learner's other assignments.
    const magic = req.session.magic;
    const assignedTests = magic ? allAssigned.filter((t) => t.id === magic.testId) : allAssigned;

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));

    const testsWithSections = await Promise.all(
      assignedTests.map(async (test) => {
        const sections = await storage.getTestSections(test.id);
        const sectionsWithNames = sections.map((s) => ({
          ...s,
          topicName: topicMap.get(s.topicId) || "Unknown",
        }));

        const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
        const completed = userAttempts.filter((a) => a.finishedAt !== null);
        const completedAttempts = completed.length;
        const inProgressAttempt = userAttempts.find((a) => a.finishedAt === null);

        // Resume position from the in-progress variant (PRD-12 §10 start parity):
        // index = saved currentIndex, total = drawn question count.
        let resumeIndex: number | null = null;
        let resumeTotal: number | null = null;
        if (inProgressAttempt) {
          const v = inProgressAttempt.variantJson as { currentIndex?: number; sections?: Array<{ questionIds?: string[] }> } | null;
          resumeIndex = v?.currentIndex || 0;
          resumeTotal = Array.isArray(v?.sections)
            ? v!.sections.reduce((n, s) => n + (s.questionIds?.length || 0), 0)
            : 0;
        }
        // Most recent completed attempt — target of the start screen's "Мой результат".
        const lastCompleted = completed
          .slice()
          .sort((a, b) => new Date(b.finishedAt as Date).getTime() - new Date(a.finishedAt as Date).getTime())[0];

        // PRD-19 Block F (FR-19/20): resolve the retake cooldown decision up front so
        // the START screen can render the cooldown state (date + disabled button +
        // prior summary) ON the standard start page — parity with the SCORM gate's
        // `renderCooldownStart`, no separate block-wall. The date source is the
        // server's own completed attempts (no LMS plugin in the web; PRD-12). Inert
        // unless the policy is enabled, so legacy tests carry `retakeGate: null`.
        const retakePolicy = test.retakePolicyJson as RetakePolicy | null;
        const gate = decideRetake(
          retakePolicy,
          lastCompletedAttemptDate(completed.map((a) => a.finishedAt)),
          toIsoDateUTC(new Date()),
        );
        const retakeGate =
          gate.allowed
            ? null
            : {
                cooldownPeriodDays: gate.cooldownPeriodDays ?? null,
                availableDate: gate.availableDate ?? null,
                daysUntil: gate.daysUntil ?? null,
              };

        // PRD-19 Block F (FR-19/20): prior-attempt summary for the start screen.
        // The web uses the MOST RECENT completed attempt — the same one
        // `lastCompletedAttemptId` ("Мой результат") points at, so the shown
        // percent and the linked result agree. Present whenever a completed
        // attempt exists (eligible «повтор: можно» AND cooldown).
        const lastResult = lastCompleted?.resultJson as AttemptResult | null | undefined;
        const priorResult =
          lastResult && typeof lastResult.overallPercent === "number"
            ? {
                percent: lastResult.overallPercent,
                passed: lastResult.overallPassed ?? null,
                attemptNumber: completedAttempts,
                maxAttempts: test.maxAttempts ?? null,
              }
            : null;

        return {
          ...test,
          sections: sectionsWithNames,
          completedAttempts,
          inProgressAttemptId: inProgressAttempt?.id || null,
          resumeIndex,
          resumeTotal,
          lastCompletedAttemptId: lastCompleted?.id || null,
          retakeGate,
          priorResult,
        };
      })
    );

    res.json(testsWithSections);
  } catch (error) {
    logger.error("Get learner tests error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch tests" });
  }
});

// POST /api/tests/:testId/attempts/start - Начать обычный тест
router.post("/tests/:testId/attempts/start", requirePermission("attempts.take"), async (req, res) => {
  try {
    // PRD-15 block B: a published test is delivered from its snapshot; the
    // attempt is pinned to it so later bank edits do not change this attempt.
    const resolved = await sourceForStart(req.params.testId);
    if (!resolved) {
      return res.status(404).json({ error: "Test not found" });
    }
    const { src, snapshotId, test } = resolved;

    // Attempt gates: retake cooldown (PRD-6, web) + max attempts. Load the user's
    // attempts once and reuse for both checks.
    const retakePolicy = test.retakePolicyJson as RetakePolicy | null;
    if (retakePolicy?.enabled === true || test.maxAttempts !== null) {
      const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
      const completed = userAttempts.filter((a) => a.finishedAt !== null);

      // PRD-12: retake cooldown — date sourced from the server's own completed
      // attempts (no LMS plugin; the web is the authoritative date source).
      const gate = decideRetake(
        retakePolicy,
        lastCompletedAttemptDate(completed.map((a) => a.finishedAt)),
        toIsoDateUTC(new Date()),
      );
      if (!gate.allowed) {
        return res.status(403).json({ error: "Retake cooldown active", code: "RETAKE_COOLDOWN", ...gate });
      }

      if (test.maxAttempts !== null && completed.length >= test.maxAttempts) {
        return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
      }
    }

    const sections = await src.getTestSections(test.id);
    const topics = await src.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));

    // PRD-17 (FR-07): variants rotation needs the variant ids the learner already
    // saw per topic, in prior COMPLETED attempts. Load once, only when a section
    // uses variants (cheap second query, gated on variant tests).
    const usesVariants = sections.some((s) => s.formSetJson);
    const completedAttempts = usesVariants
      ? (await storage.getAttemptsByUserAndTest(req.session.userId!, test.id)).filter(
          (a) => a.finishedAt !== null,
        )
      : [];
    const previousFormIdsForTopic = (topicId: string): string[] => {
      const out: string[] = [];
      for (const a of completedAttempts) {
        const v = a.variantJson as TestVariant | null;
        for (const s of v?.sections ?? []) {
          if (s.topicId === topicId && s.formId) out.push(s.formId);
        }
      }
      return out;
    };

    const variant: TestVariant = { sections: [] };
    const allQuestionIds: string[] = [];

    for (const section of sections) {
      const questions = await src.getQuestionsByTopic(section.topicId);
      let qIds: string[];
      let formId: string | undefined;

      if (section.formSetJson) {
        // PRD-17 (BR-12): variants mode — pick one author-curated variant, deliver
        // it WHOLE in random order, rotating away from variants seen in prior
        // completed attempts. draw_count/draw_all/quotas are not applied here.
        const picked = selectForm(section.formSetJson.forms, {
          previousFormIds: previousFormIdsForTopic(section.topicId),
          availableIds: new Set(questions.map((q) => q.id)),
          shuffle: shuffleInPlace,
        });
        qIds = picked.questionIds;
        formId = picked.formId;
      } else {
        // PRD-11: stratified draw by tag quotas when a blueprint is set; otherwise
        // a uniform draw (FR-02). Shared with the SCORM runtime via shared/draw.
        const { selected } = drawSection(questions, section.drawCount, section.drawBlueprintJson, shuffleInPlace);
        qIds = selected.map((q) => q.id);
      }

      variant.sections.push({
        topicId: section.topicId,
        topicName: topicMap.get(section.topicId) || "Unknown",
        questionIds: qIds,
        // PRD-17 (FR-08): pin the chosen variant id for rotation history (omitted
        // for non-variant sections).
        ...(formId ? { formId } : {}),
        // PRD-4 v1.1 §3.2: carry the per-topic time budget so the web runtime
        // can run a per-topic timer (parity with the SCORM package).
        timeLimitMinutes: section.timeLimitMinutes ?? null,
      });

      allQuestionIds.push(...qIds);
    }

    const allQuestions = await src.getQuestionsByIds(allQuestionIds);

    const attempt = await storage.createAttempt({
      userId: req.session.userId!,
      testId: test.id,
      testVersion: test.version || 1,
      snapshotId,
      variantJson: variant,
      answersJson: null,
      resultJson: null,
      startedAt: new Date(),
      finishedAt: null,
    });

    const questionsForClient = test.showCorrectAnswers
      ? allQuestions
      : allQuestions.map((q) => ({ ...q, correctJson: undefined }));

    res.status(201).json({
      ...attempt,
      testTitle: test.title,
      showCorrectAnswers: test.showCorrectAnswers || false,
      timeLimitMinutes: test.timeLimitMinutes || null,
      // PRD-19 (Block B): runtime navigation settings for the web host.
      ...prd19RuntimeSettings(test),
      // PRD-12 (FR-6): the author's content pages + flow mode, so the web run
      // follows the same structure as the SCORM package.
      ...(await flowPayload(src, test)),
      questions: questionsForClient,
    });
  } catch (error) {
    logger.error("Start attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to start attempt" });
  }
});

// POST /api/tests/:testId/attempts/start-adaptive - Начать адаптивный тест
router.post("/tests/:testId/attempts/start-adaptive", requirePermission("attempts.take"), async (req, res) => {
  try {
    // PRD-15 block B: published adaptive tests are delivered from their snapshot.
    const resolved = await sourceForStart(req.params.testId);
    if (!resolved) {
      return res.status(404).json({ error: "Test not found" });
    }
    const { src, snapshotId, test } = resolved;

    // Attempt gates: retake cooldown (PRD-6, web) + max attempts. Load the user's
    // attempts once and reuse for both checks.
    const retakePolicy = test.retakePolicyJson as RetakePolicy | null;
    if (retakePolicy?.enabled === true || test.maxAttempts !== null) {
      const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
      const completed = userAttempts.filter((a) => a.finishedAt !== null);

      // PRD-12: retake cooldown — date sourced from the server's own completed
      // attempts (no LMS plugin; the web is the authoritative date source).
      const gate = decideRetake(
        retakePolicy,
        lastCompletedAttemptDate(completed.map((a) => a.finishedAt)),
        toIsoDateUTC(new Date()),
      );
      if (!gate.allowed) {
        return res.status(403).json({ error: "Retake cooldown active", code: "RETAKE_COOLDOWN", ...gate });
      }

      if (test.maxAttempts !== null && completed.length >= test.maxAttempts) {
        return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
      }
    }

    if (test.mode !== "adaptive") {
      return res.status(400).json({ error: "This is not an adaptive test" });
    }

    const adaptiveSettings = await src.getAdaptiveTopicSettingsByTest(test.id);
    const adaptiveLevels = await src.getAdaptiveLevelsByTest(test.id);
    const topics = await src.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));
    // PRD-4 v1.1 §3.2: per-topic time budgets live on test_sections; join them
    // onto the adaptive topics by topicId so the runtime can run a topic timer.
    const adaptiveSections = await src.getTestSections(test.id);
    const sectionLimitMap = new Map(
      adaptiveSections.map((s) => [s.topicId, s.timeLimitMinutes ?? null]),
    );

    if (adaptiveSettings.length === 0) {
      return res.status(400).json({ error: "Adaptive test has no settings configured" });
    }

    // PRD-15 block D (FR-34): level matching uses the EFFECTIVE difficulty —
    // the per-test override wins over the question's base value.
    const scoring = await loadTestScoringContext(test.id, src);

    // Build adaptive variant
    const adaptiveTopics: any[] = [];

    for (const topicSettings of adaptiveSettings) {
      const topicLevels = adaptiveLevels
        .filter((l) => l.topicId === topicSettings.topicId)
        .sort((a, b) => a.levelIndex - b.levelIndex);

      if (topicLevels.length === 0) continue;

      const allQuestions = await src.getQuestionsByTopic(topicSettings.topicId);
      const levelsState: any[] = [];

      for (const level of topicLevels) {
        const levelQuestions = allQuestions.filter((q) => {
          const difficulty = scoring.difficultyOf(q);
          // PRD-16: a question with no difficulty («не задано») can't be placed in a level band.
          if (difficulty == null) return false;
          return difficulty >= level.minDifficulty && difficulty <= level.maxDifficulty;
        });

        const shuffled = levelQuestions.sort(() => Math.random() - 0.5);
        const selected = shuffled.slice(0, level.questionsCount);
        const questionIds = selected.map((q) => q.id);

        levelsState.push({
          levelIndex: level.levelIndex,
          levelName: level.levelName,
          minDifficulty: level.minDifficulty,
          maxDifficulty: level.maxDifficulty,
          questionsCount: level.questionsCount,
          passThreshold: level.passThreshold,
          passThresholdType: level.passThresholdType,
          questionIds,
          answeredQuestionIds: [],
          correctCount: 0,
          status: "pending",
        });
      }

      const startLevelIndex = Math.floor(topicLevels.length / 2);

      adaptiveTopics.push({
        topicId: topicSettings.topicId,
        topicName: topicMap.get(topicSettings.topicId) || "Unknown",
        currentLevelIndex: startLevelIndex,
        levelsState,
        finalLevelIndex: null,
        status: "in_progress",
        // Per-topic time budget (null = no limit); read by the topic timer.
        timeLimitMinutes: sectionLimitMap.get(topicSettings.topicId) ?? null,
      });
    }

    if (adaptiveTopics.length === 0) {
      return res.status(400).json({ error: "No valid adaptive topics configured" });
    }

    const firstTopic = adaptiveTopics[0];
    const firstLevel = firstTopic.levelsState[firstTopic.currentLevelIndex];
    firstLevel.status = "in_progress";
    const firstQuestionId = firstLevel.questionIds[0] || null;

    const variant = {
      mode: "adaptive",
      topics: adaptiveTopics,
      currentTopicIndex: 0,
      currentQuestionId: firstQuestionId,
    };

    const attempt = await storage.createAttempt({
      userId: req.session.userId!,
      testId: test.id,
      testVersion: test.version || 1,
      snapshotId,
      variantJson: variant,
      answersJson: {},
      resultJson: null,
      startedAt: new Date(),
      finishedAt: null,
    });

    let firstQuestion = null;
    if (firstQuestionId) {
      const questions = await src.getQuestionsByIds([firstQuestionId]);
      firstQuestion = questions[0] || null;
    }

    res.status(201).json({
      attemptId: attempt.id,
      testTitle: test.title,
      showDifficultyLevel: test.showDifficultyLevel,
      showCorrectAnswers: test.showCorrectAnswers,
      timeLimitMinutes: test.timeLimitMinutes || null,
      currentQuestion: firstQuestion
        ? {
            id: firstQuestion.id,
            question: firstQuestion,
            topicName: firstTopic.topicName,
            topicId: firstTopic.topicId,
            sectionTimeLimitMinutes: firstTopic.timeLimitMinutes ?? null,
            levelName: firstLevel.levelName,
            questionNumber: 1,
            totalInLevel: firstLevel.questionIds.length,
          }
        : null,
      totalTopics: adaptiveTopics.length,
      currentTopicIndex: 0,
    });
  } catch (error) {
    logger.error("Start adaptive attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to start adaptive attempt" });
  }
});

// POST /api/attempts/:attemptId/answer-adaptive - Ответить на вопрос адаптивного теста
router.post("/attempts/:attemptId/answer-adaptive", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (attempt.finishedAt) {
      return res.status(400).json({ error: "Attempt already finished" });
    }

    const { questionId, answer } = req.body;
    const variant = attempt.variantJson as any;

    if (variant.mode !== "adaptive") {
      return res.status(400).json({ error: "This is not an adaptive attempt" });
    }

    // PRD-15 block B: grade against the pinned snapshot, not the live bank.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const currentTopic = variant.topics[variant.currentTopicIndex];
    const currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];

    if (variant.currentQuestionId !== questionId) {
      return res.status(400).json({ error: "Unexpected question ID" });
    }

    const questions = await src.getQuestionsByIds([questionId]);
    const question = questions[0];
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    // PRD-15 block D (FR-32): grade with the test-effective graded config.
    const scoring = await loadTestScoringContext(test.id, src);
    const isCorrect = checkAnswer(question, answer, scoring.resolve(question).scoring) === 1;
    const updatedAnswers = { ...((attempt.answersJson as any) || {}), [questionId]: answer };

    currentLevel.answeredQuestionIds.push(questionId);
    if (isCorrect) {
      currentLevel.correctCount++;
    }

    const answeredCount = currentLevel.answeredQuestionIds.length;
    const remainingQuestions = currentLevel.questionIds.length - answeredCount;
    const correctCount = currentLevel.correctCount;

    let requiredCorrect: number;
    if (currentLevel.passThresholdType === "percent") {
      requiredCorrect = Math.ceil((currentLevel.questionIds.length * currentLevel.passThreshold) / 100);
    } else {
      requiredCorrect = currentLevel.passThreshold;
    }

    const canStillPass = correctCount + remainingQuestions >= requiredCorrect;
    const alreadyPassed = correctCount >= requiredCorrect;
    const alreadyFailed = !canStillPass;
    const allAnswered = remainingQuestions === 0;

    let levelTransition: any = null;
    let topicTransition: any = null;
    let isFinished = false;
    let nextQuestionData: any = null;

    // Логика переходов между уровнями (сокращённая версия)
    if (alreadyPassed || (allAnswered && correctCount >= requiredCorrect)) {
      currentLevel.status = "passed";
      currentTopic.finalLevelIndex = currentTopic.currentLevelIndex;

      const nextLevelIndex = currentTopic.currentLevelIndex + 1;
      if (nextLevelIndex < currentTopic.levelsState.length) {
        const nextLevel = currentTopic.levelsState[nextLevelIndex];
        if (nextLevel.status === "pending") {
          levelTransition = {
            type: "up",
            fromLevel: currentLevel.levelName,
            toLevel: nextLevel.levelName,
            message: `Уровень "${currentLevel.levelName}" пройден! Переход на уровень "${nextLevel.levelName}"`,
          };
          currentTopic.currentLevelIndex = nextLevelIndex;
          nextLevel.status = "in_progress";
          variant.currentQuestionId = nextLevel.questionIds[0];
          nextQuestionData = await getNextQuestionData(nextLevel, currentTopic, 0, src);
        } else {
          ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
            variant,
            currentTopic,
            currentLevel,
            src
          ));
        }
      } else {
        ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
          variant,
          currentTopic,
          currentLevel,
          src
        ));
      }
    } else if (alreadyFailed || (allAnswered && correctCount < requiredCorrect)) {
      currentLevel.status = "failed";

      if (currentTopic.finalLevelIndex !== null) {
        ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
          variant,
          currentTopic,
          currentLevel,
          src
        ));
      } else {
        const prevLevelIndex = currentTopic.currentLevelIndex - 1;
        if (prevLevelIndex >= 0) {
          const prevLevel = currentTopic.levelsState[prevLevelIndex];
          if (prevLevel.status === "pending") {
            levelTransition = {
              type: "down",
              fromLevel: currentLevel.levelName,
              toLevel: prevLevel.levelName,
              message: `Уровень "${currentLevel.levelName}" не пройден. Переход на уровень "${prevLevel.levelName}"`,
            };
            currentTopic.currentLevelIndex = prevLevelIndex;
            prevLevel.status = "in_progress";
            variant.currentQuestionId = prevLevel.questionIds[0];
            nextQuestionData = await getNextQuestionData(prevLevel, currentTopic, 0, src);
          } else {
            currentTopic.finalLevelIndex = null;
            ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
              variant,
              currentTopic,
              currentLevel,
              src
            ));
          }
        } else {
          currentTopic.finalLevelIndex = null;
          ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
            variant,
            currentTopic,
            currentLevel,
            src
          ));
        }
      }
    } else {
      const currentQuestionIndex = currentLevel.questionIds.indexOf(questionId);
      const nextQuestionId = currentLevel.questionIds[currentQuestionIndex + 1];
      variant.currentQuestionId = nextQuestionId;
      nextQuestionData = await getNextQuestionData(currentLevel, currentTopic, currentQuestionIndex + 1, src);
    }

    let result: any = null;
    if (isFinished) {
      result = await buildAdaptiveResult(variant, test.id, src);
    }

    await storage.updateAttempt(attempt.id, {
      variantJson: variant,
      answersJson: updatedAnswers,
      resultJson: isFinished ? result : null,
      finishedAt: isFinished ? new Date() : null,
    });

    const response: any = {
      isCorrect,
      nextQuestion: nextQuestionData,
      levelTransition,
      topicTransition,
      isFinished,
      result,
    };

    if (test.showCorrectAnswers) {
      response.correctAnswer = question.correctJson;
      response.feedback = question.feedback;
    }

    res.json(response);
  } catch (error) {
    logger.error("Answer adaptive error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to process answer" });
  }
});

// POST /api/attempts/:attemptId/expire-topic-adaptive - PRD-4 v1.1 §3.2:
// the per-topic timer ran out. Force-complete the current adaptive topic (with
// whatever was answered) and move to the next topic or finish. Idempotent: a
// retried/duplicate request whose `topicId` no longer matches the current topic
// (the move already happened — e.g. the first response was lost) re-syncs the
// client to the current question instead of advancing again.
router.post("/attempts/:attemptId/expire-topic-adaptive", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }
    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { topicId } = req.body;
    const variant = attempt.variantJson as any;
    if (variant.mode !== "adaptive") {
      return res.status(400).json({ error: "This is not an adaptive attempt" });
    }

    // PRD-15 block B: this transition reads questions/adaptive config; source
    // from the pinned snapshot.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    // Already finished (possibly by a prior expiry) — idempotent finished state.
    if (attempt.finishedAt) {
      return res.json({
        nextQuestion: null,
        levelTransition: null,
        topicTransition: null,
        isFinished: true,
        result: attempt.resultJson ?? null,
      });
    }

    const currentTopic = variant.topics[variant.currentTopicIndex];
    // Idempotent: the expired topic was already advanced past. Re-send the
    // current question so a lost-response retry re-syncs without double-advancing.
    if (!currentTopic || currentTopic.topicId !== topicId) {
      const cur = await currentAdaptiveQuestion(variant, src);
      return res.json({
        nextQuestion: cur,
        levelTransition: null,
        topicTransition: null,
        isFinished: false,
        result: null,
      });
    }

    const currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];
    const { levelTransition, topicTransition, nextQuestionData, isFinished } =
      await moveToNextTopicOrFinish(variant, currentTopic, currentLevel, src);

    let result: any = null;
    if (isFinished) {
      result = await buildAdaptiveResult(variant, test.id, src);
    }

    await storage.updateAttempt(attempt.id, {
      variantJson: variant,
      resultJson: isFinished ? result : null,
      finishedAt: isFinished ? new Date() : null,
    });

    res.json({
      nextQuestion: nextQuestionData,
      levelTransition,
      topicTransition,
      isFinished,
      result,
    });
  } catch (error) {
    logger.error("Expire adaptive topic error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to expire topic" });
  }
});

// POST /api/attempts/:attemptId/section-timer — пинг «я в этом разделе».
//
// The SERVER owns the remaining time of a section (see services/section-timer):
// the host reports where the learner is, the server credits the elapsed active
// time (capped by the grace window) and answers with what is left and what is
// locked. Keeping this off the browser is what makes «закрыл вкладку — вернулся с
// полным лимитом» impossible.
router.post("/attempts/:attemptId/section-timer", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });
    if (attempt.userId !== req.session.userId) return res.status(403).json({ error: "Forbidden" });
    if (attempt.finishedAt) return res.status(400).json({ error: "Attempt already finished" });

    const topicId = typeof req.body?.topicId === "string" ? req.body.topicId : null;
    // The limit comes from the TEST, never from the client: a forged body must not
    // be able to widen a section's budget.
    let limitMinutes: number | null = null;
    if (topicId) {
      const sections = await storage.getTestSections(attempt.testId);
      limitMinutes = sections.find((s) => s.topicId === topicId)?.timeLimitMinutes ?? null;
    }

    const view = await pingSection(attempt.id, topicId, limitMinutes);
    if (!view) return res.status(400).json({ error: "Attempt already finished" });
    res.json(view);
  } catch (error) {
    logger.error("Section timer ping error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to update section timer" });
  }
});

// POST /api/attempts/:attemptId/save-progress - Сохранить прогресс
router.post("/attempts/:attemptId/save-progress", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    if (attempt.finishedAt) {
      return res.status(400).json({ error: "Attempt already finished" });
    }

    const { answers, currentIndex, shuffleMappings, questionStatus, sectionPositions } = req.body;

    const updatedVariant: any = {
      ...(attempt.variantJson as any),
      currentIndex,
    };

    if (shuffleMappings) {
      updatedVariant.shuffleMappings = shuffleMappings;
    }

    // PRD-19 (Block B): per-question navigation status travels with the variant
    // (web analogue of suspend_data.currentSession.questionStatuses). Absent =
    // legacy progress (treated as all-'unanswered' on resume).
    if (questionStatus) {
      updatedVariant.questionStatus = questionStatus;
    }

    // Per-section resume position: re-entering a section continues from the question
    // the learner stopped on (the web twin of the package's currentRouterTopic +
    // currentPageIndex checkpoint), instead of restarting the section.
    if (sectionPositions && typeof sectionPositions === "object") {
      updatedVariant.sectionPositions = sectionPositions;
    }

    await storage.updateAttempt(attempt.id, {
      answersJson: answers,
      variantJson: updatedVariant,
    });

    res.json({ success: true });
  } catch (error) {
    logger.error("Save progress error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to save progress" });
  }
});

// GET /api/tests/:testId/resume - Возобновить попытку
router.get("/tests/:testId/resume", requirePermission("attempts.take"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
    const inProgressAttempt = userAttempts.find((a) => a.finishedAt === null);

    if (!inProgressAttempt) {
      return res.json({ hasInProgress: false });
    }

    // PRD-15 block B: resume the in-progress attempt from its pinned snapshot,
    // so the questions match exactly what was started.
    const src = await dataSourceForAttempt(inProgressAttempt.snapshotId);
    const variant = inProgressAttempt.variantJson as any;
    const allQuestionIds = variant.sections.flatMap((s: any) => s.questionIds);
    const allQuestions = await src.getQuestionsByIds(allQuestionIds);

    const questionsForClient = test.showCorrectAnswers
      ? allQuestions
      : allQuestions.map((q) => ({ ...q, correctJson: undefined }));

    res.json({
      hasInProgress: true,
      attempt: {
        ...inProgressAttempt,
        testTitle: test.title,
        showCorrectAnswers: test.showCorrectAnswers || false,
        timeLimitMinutes: test.timeLimitMinutes || null,
        // PRD-19 (Block B): runtime navigation settings for the web host.
        ...prd19RuntimeSettings(test),
        // PRD-12 (FR-6): structure (content pages + flow mode) for the resumed run.
        ...(await flowPayload(src, test)),
        questions: questionsForClient,
      },
      savedAnswers: inProgressAttempt.answersJson || {},
      currentIndex: variant.currentIndex || 0,
      // PRD-19 (Block B): restore per-question statuses; absent = all-'unanswered'.
      questionStatus: variant.questionStatus || {},
      sectionPositions: variant.sectionPositions || {},
    });
  } catch (error) {
    logger.error("Resume attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to resume attempt" });
  }
});

// POST /api/attempts/:attemptId/section-result - PRD-19 D5 (FR-05a): grade ONE
// section's answers-so-far through the SAME shared engine the final results use
// (`aggregateStandardResult` + the test-side effective scoring), so the web
// section-results screen (итоги раздела) matches the SCORM-baked
// `computeSectionResult` (parity, PRD-12). Read-only — it neither finishes nor
// persists the attempt; the web host calls it when a section is committed.
router.post("/attempts/:attemptId/section-result", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) return res.status(404).json({ error: "Attempt not found" });
    if (attempt.userId !== req.session.userId) return res.status(403).json({ error: "Forbidden" });

    const { topicId, answers } = req.body as { topicId?: string; answers?: Record<string, unknown> };
    if (!topicId) return res.status(400).json({ error: "topicId required" });

    const variant = attempt.variantJson as TestVariant;
    const variantSection = variant.sections.find((s) => s.topicId === topicId);
    if (!variantSection) return res.status(404).json({ error: "Section not found in attempt" });

    // PRD-15 block B: grade against the pinned snapshot, like /finish.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const sections = await src.getTestSections(test.id);
    const section = sections.find((s) => s.topicId === topicId);
    const scoring = await loadTestScoringContext(test.id, src);
    const questions = await src.getQuestionsByIds(variantSection.questionIds);

    const aggSection: AggregateSection = {
      topicId: variantSection.topicId,
      topicName: variantSection.topicName,
      topicPassRule: section?.topicPassRuleJson ?? null,
      // PRD-24: the variant delivered for this topic decides which threshold gates it.
      formId: variantSection.formId ?? null,
      questions: questions.map((q) => {
        const effective = scoring.resolve(q);
        return {
          type: q.type as QuestionType,
          correct: (q.correctJson ?? {}) as CorrectData,
          scoring: effective.scoring,
          points: effective.points,
          answer: (answers ?? {})[q.id] as Answer,
        };
      }),
    };
    // Same overall pass rule as /finish so a topic with an inherit/none rule
    // resolves its verdict identically (resolveTopicRule -> overall).
    const agg = aggregateStandardResult({ sections: [aggSection], overallPassRule: test.overallPassRuleJson });
    const tr = agg.topicResults[0];
    res.json({
      topicId: tr.topicId,
      topicName: tr.topicName,
      correct: tr.correct,
      total: tr.total,
      percent: tr.percent,
      passed: tr.passed,
      earnedPoints: tr.earnedPoints,
      possiblePoints: tr.possiblePoints,
    });
  } catch (error) {
    logger.error("Section result error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to compute section result" });
  }
});

// POST /api/attempts/:attemptId/finish - Завершить попытку
router.post("/attempts/:attemptId/finish", requirePermission("attempts.take"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const { answers } = req.body;
    const variant = attempt.variantJson as TestVariant;
    // PRD-15 block B: grade against the pinned snapshot, not the live bank.
    const src = await dataSourceForAttempt(attempt.snapshotId);
    const test = await src.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const sections = await src.getTestSections(test.id);
    const sectionMap = new Map(sections.map((s) => [s.topicId, s]));
    // PRD-15 block D (FR-32): price and graded config come from the test-side
    // chain (override -> section default -> test default -> system), resolved
    // against the SAME source as delivery (snapshot or live).
    const scoring = await loadTestScoringContext(test.id, src);

    // PRD-12 §3.5: question types for the scale engine's percent-normalization.
    const questionTypes: Record<string, QuestionType> = {};

    // PRD-18: result aggregation + pass-rule evaluation run through the SINGLE
    // shared engine (`aggregateStandardResult`, the SAME one the SCORM runtime
    // runs). Effective price / graded config (block D) is resolved here; the engine
    // owns per-answer scoring, per-topic/overall percent and pass-rule resolution
    // (inherit_overall -> overall, none -> no gate, count basis = Σ earned points).
    const aggSections: AggregateSection<{
      recommendedCourses: { title: string; url: string }[];
      recommendedEvents: { title: string }[];
    }>[] = [];
    for (const variantSection of variant.sections) {
      const section = sectionMap.get(variantSection.topicId);
      const questions = await src.getQuestionsByIds(variantSection.questionIds);
      const courses = await src.getTopicCourses(variantSection.topicId);
      const events = await src.getTopicEvents(variantSection.topicId);
      aggSections.push({
        topicId: variantSection.topicId,
        topicName: variantSection.topicName,
        topicPassRule: section?.topicPassRuleJson ?? null,
        // PRD-24: the variant delivered for this topic decides which threshold gates it.
        formId: variantSection.formId ?? null,
        questions: questions.map((q) => {
          questionTypes[q.id] = q.type as QuestionType;
          const effective = scoring.resolve(q);
          return {
            type: q.type as QuestionType,
            correct: (q.correctJson ?? {}) as CorrectData,
            scoring: effective.scoring,
            points: effective.points,
            answer: answers?.[q.id] as Answer,
          };
        }),
        extra: {
          recommendedCourses: courses.map((c) => ({ title: c.title, url: c.url })),
          recommendedEvents: events.map((e) => ({ title: e.title })),
        },
      });
    }

    const agg = aggregateStandardResult({ sections: aggSections, overallPassRule: test.overallPassRuleJson });
    const totalCorrect = agg.correct;
    const totalQuestions = agg.totalQuestions;
    const totalEarnedPoints = agg.earnedPoints;
    const totalPossiblePoints = agg.possiblePoints;
    const overallPercent = agg.percent;
    let overallPassed = agg.passed;
    const topicResults: TopicResult[] = agg.topicResults.map((t) => ({
      topicId: t.topicId,
      topicName: t.topicName,
      correct: t.correct,
      total: t.total,
      percent: t.percent,
      earnedPoints: t.earnedPoints,
      possiblePoints: t.possiblePoints,
      passed: t.passed,
      passRule: t.passRule as PassRule | null,
      recommendedCourses: t.extra!.recommendedCourses,
      recommendedEvents: t.extra!.recommendedEvents,
    }));

    // PRD-12: graded namespaces (scales PRD-5 + result variables PRD-2) via the
    // shared engines, mirroring the SCORM runtime. No-op when the test has none.
    const scoringConfig = await loadScoringConfig(test.id, src);
    let scaleResults: AttemptResult["scaleResults"];
    let resultVariables: AttemptResult["resultVariables"];
    let status: AttemptResult["status"];
    if (scoringConfig.scales.length > 0 || scoringConfig.resultVariables.length > 0) {
      // Topic codes enable `topicById("<code>")` (readable id); names already on
      // topicResults enable `topicByName("<name>")` (PRD-2 §4.2).
      const topicCodeById = new Map(
        (await src.getTopics()).map((t) => [t.id, t.code ?? null] as const),
      );
      const computation = computeAttemptResult(
        scoringConfig,
        answers ?? {},
        questionTypes,
        {
          percent: overallPercent,
          topicResults: topicResults.map((t) => ({ ...t, code: topicCodeById.get(t.topicId) ?? null })),
        },
      );
      if (Object.keys(computation.scaleResults).length > 0) scaleResults = computation.scaleResults;
      if (Object.keys(computation.resultVariables).length > 0) resultVariables = computation.resultVariables;
      if (computation.status.success !== undefined || computation.status.completion !== undefined) {
        status = computation.status;
      }
      // A boolean controls_status="success" variable overrides the pass flag
      // (parity with the SCORM runtime, resultsPage.js).
      if (typeof computation.status.success === "boolean") {
        overallPassed = computation.status.success;
      }
    }

    const result: AttemptResult = {
      totalCorrect,
      totalQuestions,
      overallPercent,
      totalEarnedPoints,
      totalPossiblePoints,
      overallPassed,
      topicResults,
      ...(scaleResults ? { scaleResults } : {}),
      ...(resultVariables ? { resultVariables } : {}),
      ...(status ? { status } : {}),
    };

    await storage.updateAttempt(attempt.id, {
      answersJson: answers,
      resultJson: result,
      finishedAt: new Date(),
    });

    res.json({ success: true, result });
  } catch (error) {
    logger.error("Finish attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to finish attempt" });
  }
});

// GET /api/attempts/:attemptId/result - Результат попытки
router.get("/attempts/:attemptId/result", requirePermission("attempts.self.read"), async (req, res) => {
  try {
    const attempt = await storage.getAttempt(req.params.attemptId);
    if (!attempt) {
      return res.status(404).json({ error: "Attempt not found" });
    }

    if (attempt.userId !== req.session.userId) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const test = await storage.getTest(attempt.testId);

    const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, attempt.testId);
    const completedAttempts = userAttempts.filter((a) => a.finishedAt !== null).length;
    const maxAttempts = test?.maxAttempts || null;
    const canRetake = maxAttempts === null || completedAttempts < maxAttempts;
    // NB: the attempt counter is deliberately NOT put in the header subtitle any
    // more — the scene header carries the test's identity, not run parameters.

    // PRD-12 web-host: render payload (template layout + css + context) for the
    // results screen. Covers BOTH standard (results.html) and adaptive
    // (results.adaptive.html) — readResultsRenderPayload branches on result.mode.
    // Null only when the layout is missing or the result lacks topic rows, in which
    // case the client falls back to its React markup.
    const resultJson = attempt.resultJson as (AttemptResult & { mode?: string }) | null;
    let render = null;
    let report: ReportInput | AdaptiveReportInput | null = null;
    let reportRender: ReturnType<typeof readReportRenderPayload> = null;
    if (resultJson && Array.isArray(resultJson.topicResults)) {
      const templateId = ((test?.designSettingsJson as any)?.templateId as string) || "default";
      // Learner-facing render: never serve a non-active template, and when the
      // active template declares no `results` contentTemplate, render the results
      // screen from `default` (same fallback as «Структура» / the preview).
      const dir = await resolveSystemScreenDir(templateId, "results", { activeOnly: true });
      // Branding/cssVars resolve against the ACTIVE template manifest even when the
      // results layout falls back to `default` (active template owns no `results`).
      const paramsDir = await resolveTemplateDir(templateId, { activeOnly: true });
      // PRD-29: the measurement blocks (scales / indicators / recommendations). Only
      // for a STANDARD result — an adaptive one composes its own levels and takes no
      // measures — and only for a test that actually defines any.
      const measures =
        resultJson.mode === "adaptive" ? undefined : await measuresForAttempt(attempt, test);
      render = readResultsRenderPayload(
        dir,
        resultJson,
        test?.title || "",
        test?.designSettingsJson as any,
        paramsDir,
        undefined,
        measures,
      );
      // File-level fallback (PRD-1 §4.3.2, PRD-3 NFR-06): a template that declares a
      // `results` variant but ships no results layout still renders — from the
      // standard template — instead of dropping to the legacy React markup.
      if (!render) {
        const fallbackDir = await resolveTemplateDir("default", { activeOnly: false });
        if (path.resolve(fallbackDir) !== path.resolve(dir)) {
          render = readResultsRenderPayload(
            fallbackDir,
            resultJson,
            test?.title || "",
            test?.designSettingsJson as any,
            paramsDir,
            undefined,
            measures,
          );
        }
      }
      // Footer state for the layout-drawn results row (the package fills the same
      // block). «Скачать отчёт» is on now that the web host produces the report from
      // the SHARED generator (shared/report/*) — the same PDF the package hands out.
      if (render?.context && typeof render.context === "object") {
        const ctx = render.context as { result?: Record<string, unknown> };
        if (ctx.result) {
          ctx.result.nav = buildResultsNav({
            canReport: true,
            canRetry: !resultJson?.overallPassed && canRetake,
            // Attempts alone — the adaptive footer re-runs the test rather than
            // offering a remedy, so a pass does not close it (see results-nav).
            canRetake,
            hasPostPages: false,
            finishLabel: "К списку тестов",
          });
        }
      }

      // Input for the shared PDF report the browser builds on demand. Assembled here
      // because the report needs the RAW per-topic numbers and the learner's name,
      // neither of which the presentational render context carries.
      const learner = await storage.getUser(req.session.userId!);
      const reportMeta = {
        learnerName: learner?.name || null,
        timestamp: (attempt.finishedAt ?? attempt.startedAt)?.toISOString() ?? null,
        attemptsCount: completedAttempts || 1,
      };
      report =
        resultJson.mode === "adaptive"
          ? buildAdaptiveReportInput(resultJson, test?.title || "", reportMeta)
          : buildReportInput(resultJson, test?.title || "", reportMeta);

      // PRD-27 Фаза 2: страницу отчёта рисует МАКЕТ шаблона. Активный шаблон, не
      // объявивший нужного вида, отчёта не лишает: макет берётся из «Стандартного», а
      // брендинг остаётся этого теста (FR-10) — то же правило, что у системных экранов.
      const reportKind = reportKindForMode(resultJson.mode);
      const activeDir = await resolveTemplateDir(templateId, { activeOnly: true });
      // PRD-27 FR-24: вариант и значения полей берутся из теста, КОТОРЫЙ ВЫДАВАЛСЯ.
      // Попытка, приколотая к снапшоту (PRD-15), обязана собрать отчёт тем макетом и
      // теми параметрами, что действовали на момент выдачи: иначе автор меняет вид
      // отчёта — и документы по старым попыткам задним числом становятся другими.
      // Живой тест остаётся источником всего остального (название, счётчик попыток).
      // Читается ОДНА строка снапшота, а не собирается целый источник данных: попытке
      // здесь нужен только выбор варианта, а сборка источника тянет весь замороженный
      // пул вопросов.
      const deliveredTest = attempt.snapshotId
        ? ((await storage.getSnapshot(attempt.snapshotId))?.contentJson as
            | { test?: Test }
            | undefined)?.test ?? test
        : test;
      // Выбор автора хранится по РЕЖИМУ теста (PRD-27 §4.1); его отсутствие означает
      // вариант с `isDefault`.
      const authoredReport =
        (deliveredTest?.reportSettingsJson as ReportSettings | null)?.[
          resultJson.mode === "adaptive" ? "adaptive" : "standard"
        ] ?? null;
      reportRender = readReportRenderPayload(
        activeDir,
        reportKind,
        authoredReport,
        test?.designSettingsJson as any,
        activeDir,
        templateId,
      );
      if (!reportRender) {
        const fallbackDir = await resolveTemplateDir("default", { activeOnly: false });
        if (path.resolve(fallbackDir) !== path.resolve(activeDir)) {
          // Деградация на «Стандартный»: выбранного варианта там нет, поэтому берётся
          // его `isDefault`, а значения полей чужого варианта не переносятся. Картинки
          // приезжают оттуда же, откуда макет, — из «Стандартного» (FR-05).
          reportRender = readReportRenderPayload(
            fallbackDir,
            reportKind,
            null,
            test?.designSettingsJson as any,
            activeDir,
            "default",
          );
        }
      }
    }

    res.json({
      ...attempt,
      testTitle: test?.title || "Unknown Test",
      result: attempt.resultJson as AttemptResult,
      canRetake,
      render,
      report,
      reportRender,
      attemptsInfo:
        maxAttempts !== null
          ? {
              completed: completedAttempts,
              max: maxAttempts,
            }
          : null,
    });
  } catch (error) {
    logger.error("Get result error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch result" });
  }
});

// GET /api/learner/attempts - История попыток ученика
router.get("/learner/attempts", requirePermission("attempts.self.read"), async (req, res) => {
  try {
    const attempts = await storage.getAttemptsByUser(req.session.userId!);
    const tests = await storage.getTests();
    const testMap = new Map(tests.map((t) => [t.id, t]));

    const completedAttempts = attempts
      .filter((a) => a.finishedAt !== null)
      .sort((a, b) => new Date(b.finishedAt!).getTime() - new Date(a.finishedAt!).getTime());

    const groupedByTest: Record<string, {
      testId: string;
      testTitle: string;
      currentVersion: number;
      attempts: any[];
    }> = {};

    for (const attempt of completedAttempts) {
      const test = testMap.get(attempt.testId);
      const result = attempt.resultJson as AttemptResult | null;

      if (!groupedByTest[attempt.testId]) {
        groupedByTest[attempt.testId] = {
          testId: attempt.testId,
          testTitle: test?.title || "Unknown Test",
          currentVersion: test?.version || 1,
          attempts: [],
        };
      }

      const isAdaptive = (result as any)?.mode === "adaptive";
      const adaptiveResult = isAdaptive ? (result as any) : null;
      const achievedCount = adaptiveResult
        ? adaptiveResult.topicResults.filter((tr: any) => tr.achievedLevelIndex !== null).length
        : null;
      const totalTopics = adaptiveResult ? adaptiveResult.topicResults.length : null;

      groupedByTest[attempt.testId].attempts.push({
        id: attempt.id,
        testVersion: attempt.testVersion,
        finishedAt: attempt.finishedAt,
        overallPercent: result?.overallPercent || 0,
        overallPassed: result?.overallPassed || false,
        totalEarnedPoints: result?.totalEarnedPoints || 0,
        totalPossiblePoints: result?.totalPossiblePoints || 0,
        isAdaptive,
        achievedCount,
        totalTopics,
      });
    }

    const testGroups = Object.values(groupedByTest).map((group) => {
      const attemptsWithComparison = group.attempts.map((attempt, index) => {
        const prevAttempt = group.attempts[index + 1];
        const delta = prevAttempt ? attempt.overallPercent - prevAttempt.overallPercent : null;
        const isOutdated = attempt.testVersion < group.currentVersion;

        return { ...attempt, delta, isOutdated };
      });

      const latestAttempt = group.attempts[0];
      const firstAttempt = group.attempts[group.attempts.length - 1];
      const overallImprovement =
        group.attempts.length > 1 ? latestAttempt.overallPercent - firstAttempt.overallPercent : null;

      return {
        testId: group.testId,
        testTitle: group.testTitle,
        currentVersion: group.currentVersion,
        attemptCount: group.attempts.length,
        overallImprovement,
        attempts: attemptsWithComparison,
      };
    });

    res.json(testGroups);
  } catch (error) {
    logger.error("Fetch learner attempts error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch attempt history" });
  }
});

// ===== Helper Functions =====

async function getNextQuestionData(level: any, topic: any, questionIndex: number, storage: any) {
  const questionId = level.questionIds[questionIndex];
  if (!questionId) return null;

  const questions = await storage.getQuestionsByIds([questionId]);
  if (!questions[0]) return null;

  return {
    id: questionId,
    question: questions[0],
    topicName: topic.topicName,
    topicId: topic.topicId,
    // PRD-4 v1.1 §3.2: carry the topic's time budget so the runtime can run a
    // per-topic timer for the topic that owns this question.
    sectionTimeLimitMinutes: topic.timeLimitMinutes ?? null,
    levelName: level.levelName,
    questionNumber: questionIndex + 1,
    totalInLevel: level.questionIds.length,
  };
}

/**
 * Build the question-data payload for the variant's CURRENT position (the
 * `currentQuestionId` within the current topic/level). Used by the idempotent
 * branch of expire-topic-adaptive to re-sync a client after a lost response.
 */
async function currentAdaptiveQuestion(variant: any, storage: any) {
  const topic = variant.topics?.[variant.currentTopicIndex];
  if (!topic) return null;
  const level = topic.levelsState[topic.currentLevelIndex];
  const idx = level.questionIds.indexOf(variant.currentQuestionId);
  return getNextQuestionData(level, topic, idx >= 0 ? idx : 0, storage);
}

async function moveToNextTopicOrFinish(variant: any, currentTopic: any, currentLevel: any, storage: any) {
  currentTopic.status = "completed";

  const levelTransition = {
    type: "complete",
    fromLevel: currentLevel.levelName,
    toLevel: null,
    message:
      currentTopic.finalLevelIndex !== null
        ? `Тема завершена. Достигнутый уровень: "${currentTopic.levelsState[currentTopic.finalLevelIndex].levelName}"`
        : `К сожалению, уровень "${currentLevel.levelName}" не пройден.`,
  };

  const nextTopicIndex = variant.currentTopicIndex + 1;
  if (nextTopicIndex < variant.topics.length) {
    const topicTransition = {
      fromTopic: currentTopic.topicName,
      toTopic: variant.topics[nextTopicIndex].topicName,
    };

    variant.currentTopicIndex = nextTopicIndex;
    const nextTopic = variant.topics[nextTopicIndex];
    const startLevel = nextTopic.levelsState[nextTopic.currentLevelIndex];
    startLevel.status = "in_progress";

    variant.currentQuestionId = startLevel.questionIds[0];
    const nextQuestionData = await getNextQuestionData(startLevel, nextTopic, 0, storage);

    return { levelTransition, topicTransition, nextQuestionData, isFinished: false };
  }

  variant.currentQuestionId = null;
  return { levelTransition, topicTransition: null, nextQuestionData: null, isFinished: true };
}

// PRD-18 «ВСЕ РАСЧЕТЫ ПО ЕДИНОМУ АЛГОРИТМУ»: thin host adapter over the shared
// `aggregateAdaptiveResult`. This side's only job is to normalize DB-backed data
// (per-level feedback + links from separate tables, topic failure feedback) into
// the engine's input. `levels` is sorted by `levelIndex` ascending — the SAME order
// `levelsState` was built in — so the engine's POSITIONAL `finalLevelIndex` lookup
// aligns. `failureLinks` mirrors the SCORM failure branch (lowest level's links).
async function buildAdaptiveResult(variant: any, testId: string, storage: any) {
  const adaptiveSettings = await storage.getAdaptiveTopicSettingsByTest(testId);
  const adaptiveLevels = await storage.getAdaptiveLevelsByTest(testId);

  const topics = await Promise.all(
    variant.topics.map(async (topic: any) => {
      const topicSettings = adaptiveSettings.find((s: any) => s.topicId === topic.topicId);
      const topicLevels = adaptiveLevels
        .filter((l: any) => l.topicId === topic.topicId)
        .sort((a: any, b: any) => a.levelIndex - b.levelIndex);

      const levels = await Promise.all(
        topicLevels.map(async (l: any) => ({
          levelName: l.levelName,
          feedback: l.feedback ?? null,
          links: ((await storage.getAdaptiveLevelLinks(l.id)) || []).map((x: any) => ({ title: x.title, url: x.url })),
        })),
      );

      const levelsState = (topic.levelsState as any[]).map((ls) => ({
        levelIndex: ls.levelIndex,
        levelName: ls.levelName,
        status: ls.status,
        answeredCount: ls.answeredQuestionIds.length,
        correctCount: ls.correctCount,
      }));

      return {
        topicId: topic.topicId,
        topicName: topic.topicName,
        finalLevelIndex: topic.finalLevelIndex,
        levelsState,
        levels,
        failureFeedback: topicSettings?.failureFeedback || null,
        failureLinks: levels[0]?.links ?? [],
      };
    }),
  );

  return aggregateAdaptiveResult({ topics });
}

export default router;