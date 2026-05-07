import { Router } from "express";
import { logger } from "../logger";
import { storage } from "../storage";
import { requireLearner } from "../middleware/auth";
import { checkAnswer } from "../utils/check-answer";
import type { TestVariant, AttemptResult, TopicResult, PassRule } from "@shared/schema";

const router = Router();

// GET /api/learner/tests - Тесты для ученика
router.get("/learner/tests", requireLearner, async (req, res) => {
  try {
    const assignedTests = await storage.getAssignedTestsForUser(req.session.userId!);

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
        const completedAttempts = userAttempts.filter((a) => a.finishedAt !== null).length;
        const inProgressAttempt = userAttempts.find((a) => a.finishedAt === null);

        return {
          ...test,
          sections: sectionsWithNames,
          completedAttempts,
          inProgressAttemptId: inProgressAttempt?.id || null,
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
router.post("/tests/:testId/attempts/start", requireLearner, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    // Проверяем ограничение попыток
    if (test.maxAttempts !== null) {
      const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
      const completedAttempts = userAttempts.filter((a) => a.finishedAt !== null).length;

      if (completedAttempts >= test.maxAttempts) {
        return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
      }
    }

    const sections = await storage.getTestSections(test.id);
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));

    const variant: TestVariant = { sections: [] };
    const allQuestionIds: string[] = [];

    for (const section of sections) {
      const questions = await storage.getQuestionsByTopic(section.topicId);
      const shuffled = questions.sort(() => Math.random() - 0.5);
      const selected = shuffled.slice(0, section.drawCount);
      const qIds = selected.map((q) => q.id);

      variant.sections.push({
        topicId: section.topicId,
        topicName: topicMap.get(section.topicId) || "Unknown",
        questionIds: qIds,
      });

      allQuestionIds.push(...qIds);
    }

    const allQuestions = await storage.getQuestionsByIds(allQuestionIds);

    const attempt = await storage.createAttempt({
      userId: req.session.userId!,
      testId: test.id,
      testVersion: test.version || 1,
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
      questions: questionsForClient,
    });
  } catch (error) {
    logger.error("Start attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to start attempt" });
  }
});

// POST /api/tests/:testId/attempts/start-adaptive - Начать адаптивный тест
router.post("/tests/:testId/attempts/start-adaptive", requireLearner, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    // Проверяем ограничение попыток
    if (test.maxAttempts !== null) {
      const userAttempts = await storage.getAttemptsByUserAndTest(req.session.userId!, test.id);
      const completedAttempts = userAttempts.filter((a) => a.finishedAt !== null).length;

      if (completedAttempts >= test.maxAttempts) {
        return res.status(403).json({ error: "Attempts exhausted", code: "ATTEMPTS_EXHAUSTED" });
      }
    }

    if (test.mode !== "adaptive") {
      return res.status(400).json({ error: "This is not an adaptive test" });
    }

    const adaptiveSettings = await storage.getAdaptiveTopicSettingsByTest(test.id);
    const adaptiveLevels = await storage.getAdaptiveLevelsByTest(test.id);
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t.name]));

    if (adaptiveSettings.length === 0) {
      return res.status(400).json({ error: "Adaptive test has no settings configured" });
    }

    // Build adaptive variant
    const adaptiveTopics: any[] = [];

    for (const topicSettings of adaptiveSettings) {
      const topicLevels = adaptiveLevels
        .filter((l) => l.topicId === topicSettings.topicId)
        .sort((a, b) => a.levelIndex - b.levelIndex);

      if (topicLevels.length === 0) continue;

      const allQuestions = await storage.getQuestionsByTopic(topicSettings.topicId);
      const levelsState: any[] = [];

      for (const level of topicLevels) {
        const levelQuestions = allQuestions.filter(
          (q) => (q.difficulty ?? 50) >= level.minDifficulty && (q.difficulty ?? 50) <= level.maxDifficulty
        );

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
      variantJson: variant,
      answersJson: {},
      resultJson: null,
      startedAt: new Date(),
      finishedAt: null,
    });

    let firstQuestion = null;
    if (firstQuestionId) {
      const questions = await storage.getQuestionsByIds([firstQuestionId]);
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
router.post("/attempts/:attemptId/answer-adaptive", requireLearner, async (req, res) => {
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

    const test = await storage.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const currentTopic = variant.topics[variant.currentTopicIndex];
    const currentLevel = currentTopic.levelsState[currentTopic.currentLevelIndex];

    if (variant.currentQuestionId !== questionId) {
      return res.status(400).json({ error: "Unexpected question ID" });
    }

    const questions = await storage.getQuestionsByIds([questionId]);
    const question = questions[0];
    if (!question) {
      return res.status(404).json({ error: "Question not found" });
    }

    const isCorrect = checkAnswer(question, answer) === 1;
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
          nextQuestionData = await getNextQuestionData(nextLevel, currentTopic, 0, storage);
        } else {
          ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
            variant,
            currentTopic,
            currentLevel,
            storage
          ));
        }
      } else {
        ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
          variant,
          currentTopic,
          currentLevel,
          storage
        ));
      }
    } else if (alreadyFailed || (allAnswered && correctCount < requiredCorrect)) {
      currentLevel.status = "failed";

      if (currentTopic.finalLevelIndex !== null) {
        ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
          variant,
          currentTopic,
          currentLevel,
          storage
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
            nextQuestionData = await getNextQuestionData(prevLevel, currentTopic, 0, storage);
          } else {
            currentTopic.finalLevelIndex = null;
            ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
              variant,
              currentTopic,
              currentLevel,
              storage
            ));
          }
        } else {
          currentTopic.finalLevelIndex = null;
          ({ topicTransition, nextQuestionData, isFinished } = await moveToNextTopicOrFinish(
            variant,
            currentTopic,
            currentLevel,
            storage
          ));
        }
      }
    } else {
      const currentQuestionIndex = currentLevel.questionIds.indexOf(questionId);
      const nextQuestionId = currentLevel.questionIds[currentQuestionIndex + 1];
      variant.currentQuestionId = nextQuestionId;
      nextQuestionData = await getNextQuestionData(currentLevel, currentTopic, currentQuestionIndex + 1, storage);
    }

    let result: any = null;
    if (isFinished) {
      result = await buildAdaptiveResult(variant, test.id, storage);
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

// POST /api/attempts/:attemptId/save-progress - Сохранить прогресс
router.post("/attempts/:attemptId/save-progress", requireLearner, async (req, res) => {
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

    const { answers, currentIndex, shuffleMappings } = req.body;

    const updatedVariant: any = {
      ...(attempt.variantJson as any),
      currentIndex,
    };

    if (shuffleMappings) {
      updatedVariant.shuffleMappings = shuffleMappings;
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
router.get("/tests/:testId/resume", requireLearner, async (req, res) => {
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

    const variant = inProgressAttempt.variantJson as any;
    const allQuestionIds = variant.sections.flatMap((s: any) => s.questionIds);
    const allQuestions = await storage.getQuestionsByIds(allQuestionIds);

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
        questions: questionsForClient,
      },
      savedAnswers: inProgressAttempt.answersJson || {},
      currentIndex: variant.currentIndex || 0,
    });
  } catch (error) {
    logger.error("Resume attempt error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to resume attempt" });
  }
});

// POST /api/attempts/:attemptId/finish - Завершить попытку
router.post("/attempts/:attemptId/finish", requireLearner, async (req, res) => {
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
    const test = await storage.getTest(attempt.testId);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const sections = await storage.getTestSections(test.id);
    const sectionMap = new Map(sections.map((s) => [s.topicId, s]));

    let totalCorrect = 0;
    let totalQuestions = 0;
    let totalEarnedPoints = 0;
    let totalPossiblePoints = 0;
    const topicResults: TopicResult[] = [];

    for (const variantSection of variant.sections) {
      const section = sectionMap.get(variantSection.topicId);
      const questions = await storage.getQuestionsByIds(variantSection.questionIds);
      const courses = await storage.getTopicCourses(variantSection.topicId);

      let sectionCorrect = 0;
      let sectionEarnedPoints = 0;
      let sectionPossiblePoints = 0;
      const sectionTotal = questions.length;

      for (const q of questions) {
        const answer = answers?.[q.id];
        const scoreRatio = checkAnswer(q, answer);
        const qPoints = q.points || 1;
        sectionPossiblePoints += qPoints;

        if (scoreRatio === 1) {
          sectionCorrect++;
        }
        sectionEarnedPoints += qPoints * scoreRatio;
      }

      totalCorrect += sectionCorrect;
      totalQuestions += sectionTotal;
      totalEarnedPoints += sectionEarnedPoints;
      totalPossiblePoints += sectionPossiblePoints;

      const sectionPercent = sectionPossiblePoints > 0 ? (sectionEarnedPoints / sectionPossiblePoints) * 100 : 0;
      const passRule = section?.topicPassRuleJson as PassRule | null;
      let passed: boolean | null = null;

      if (passRule) {
        if (passRule.type === "percent") {
          passed = sectionPercent >= passRule.value;
        } else {
          passed = sectionCorrect >= passRule.value;
        }
      }

      topicResults.push({
        topicId: variantSection.topicId,
        topicName: variantSection.topicName,
        correct: sectionCorrect,
        total: sectionTotal,
        percent: sectionPercent,
        earnedPoints: sectionEarnedPoints,
        possiblePoints: sectionPossiblePoints,
        passed,
        passRule,
        recommendedCourses: courses.map((c) => ({ title: c.title, url: c.url })),
      });
    }

    const overallPercent = totalPossiblePoints > 0 ? (totalEarnedPoints / totalPossiblePoints) * 100 : 0;
    const overallPassRule = test.overallPassRuleJson as PassRule;
    let overallPassed = true;

    if (overallPassRule.type === "percent") {
      overallPassed = overallPercent >= overallPassRule.value;
    } else {
      overallPassed = totalCorrect >= overallPassRule.value;
    }

    for (const tr of topicResults) {
      if (tr.passed === false) {
        overallPassed = false;
        break;
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
router.get("/attempts/:attemptId/result", requireLearner, async (req, res) => {
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

    res.json({
      ...attempt,
      testTitle: test?.title || "Unknown Test",
      result: attempt.resultJson as AttemptResult,
      canRetake,
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
router.get("/learner/attempts", requireLearner, async (req, res) => {
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
    levelName: level.levelName,
    questionNumber: questionIndex + 1,
    totalInLevel: level.questionIds.length,
  };
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

async function buildAdaptiveResult(variant: any, testId: string, storage: any) {
  const adaptiveSettings = await storage.getAdaptiveTopicSettingsByTest(testId);
  const adaptiveLevels = await storage.getAdaptiveLevelsByTest(testId);

  const topicResults: any[] = [];
  let overallPassed = true;

  for (const topic of variant.topics) {
    const topicSettings = adaptiveSettings.find((s: any) => s.topicId === topic.topicId);
    const topicLevels = adaptiveLevels.filter((l: any) => l.topicId === topic.topicId);

    let totalQuestionsAnswered = 0;
    let totalCorrect = 0;
    const levelsAttempted: any[] = [];

    for (const levelState of topic.levelsState) {
      if (levelState.status === "passed" || levelState.status === "failed") {
        totalQuestionsAnswered += levelState.answeredQuestionIds.length;
        totalCorrect += levelState.correctCount;
        levelsAttempted.push({
          levelIndex: levelState.levelIndex,
          levelName: levelState.levelName,
          questionsAnswered: levelState.answeredQuestionIds.length,
          correctCount: levelState.correctCount,
          status: levelState.status,
        });
      }
    }

    let achievedLevelName: string | null = null;
    let levelPercent = 0;
    let feedback: string | null = null;
    let recommendedLinks: any[] = [];

    if (topic.finalLevelIndex !== null) {
      const achievedLevel = topicLevels.find((l: any) => l.levelIndex === topic.finalLevelIndex);
      if (achievedLevel) {
        achievedLevelName = achievedLevel.levelName;
        const levelState = topic.levelsState.find((ls: any) => ls.levelIndex === topic.finalLevelIndex);
        if (levelState && levelState.answeredQuestionIds.length > 0) {
          levelPercent = (levelState.correctCount / levelState.answeredQuestionIds.length) * 100;
        }
        feedback = achievedLevel.feedback;

        const links = await storage.getAdaptiveLevelLinks(achievedLevel.id);
        recommendedLinks = links.map((l: any) => ({ title: l.title, url: l.url }));
      }
    } else {
      overallPassed = false;
      feedback = topicSettings?.failureFeedback || null;
    }

    topicResults.push({
      topicId: topic.topicId,
      topicName: topic.topicName,
      achievedLevelIndex: topic.finalLevelIndex,
      achievedLevelName,
      levelPercent,
      totalQuestionsAnswered,
      totalCorrect,
      levelsAttempted,
      feedback,
      recommendedLinks,
    });
  }

  return {
    mode: "adaptive",
    overallPassed,
    topicResults,
  };
}

export default router;