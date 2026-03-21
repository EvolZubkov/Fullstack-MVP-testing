import { Router } from "express";
import crypto from "node:crypto";
import { storage } from "../storage";
import { requireAuth, requireAuthor } from "../middleware/auth";
import { generateScormPackage } from "../scorm-exporter";
import { logger } from "../logger";

const router = Router();

// GET /api/tests - Список тестов
router.get("/", requireAuth, async (req, res) => {
  try {
    const tests = await storage.getTests();
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t]));

    const testsWithSections = await Promise.all(
      tests.map(async (test) => {
        const sections = await storage.getTestSections(test.id);
        const sectionsWithDetails = await Promise.all(
          sections.map(async (s) => {
            const topic = topicMap.get(s.topicId);
            const questions = await storage.getQuestionsByTopic(s.topicId);
            return {
              ...s,
              topicName: topic?.name || "Unknown",
              maxQuestions: questions.length,
            };
          })
        );

        // If adaptive test, load adaptive settings
        let adaptiveSettings = null;
        if (test.mode === "adaptive") {
          const topicSettings = await storage.getAdaptiveTopicSettingsByTest(test.id);
          const levels = await storage.getAdaptiveLevelsByTest(test.id);

          adaptiveSettings = await Promise.all(
            topicSettings.map(async (ts) => {
              const topicLevels = levels.filter((l) => l.topicId === ts.topicId);
              const levelsWithLinks = await Promise.all(
                topicLevels.map(async (level) => {
                  const links = await storage.getAdaptiveLevelLinks(level.id);
                  return { ...level, links };
                })
              );
              return {
                ...ts,
                topicName: topicMap.get(ts.topicId)?.name || "Unknown",
                levels: levelsWithLinks,
              };
            })
          );
        }

        return { ...test, sections: sectionsWithDetails, adaptiveSettings };
      })
    );

    res.json(testsWithSections);
  } catch (error) {
    logger.error("Get tests error: " + (error as Error).message, "tests")
    res.status(500).json({ error: "Failed to fetch tests" });
  }
});

// POST /api/tests - Создать тест
router.post("/", requireAuthor, async (req, res) => {
  try {
    const {
      title,
      description,
      overallPassRuleJson,
      webhookUrl,
      sections,
      showCorrectAnswers,
      timeLimitMinutes,
      maxAttempts,
      startPageContent,
      feedback,
      mode,
      showDifficultyLevel,
      adaptiveSettings,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    // For standard mode, sections are required
    if (mode !== "adaptive" && (!sections || sections.length === 0)) {
      return res.status(400).json({ error: "Sections are required for standard tests" });
    }

    const test = await storage.createTest(
      {
        title,
        description,
        overallPassRuleJson,
        webhookUrl,
        published: false,
        showCorrectAnswers,
        timeLimitMinutes,
        maxAttempts,
        startPageContent,
        feedback,
        mode: mode || "standard",
        showDifficultyLevel: showDifficultyLevel ?? true,
      },
      sections || []
    );

    // If adaptive mode, save adaptive settings
    if (mode === "adaptive" && adaptiveSettings) {
      for (const topicSettings of adaptiveSettings) {
        // Create topic settings (failure feedback)
        await storage.createAdaptiveTopicSettings({
          testId: test.id,
          topicId: topicSettings.topicId,
          failureFeedback: topicSettings.failureFeedback || null,
        });

        // Create levels for this topic
        for (const level of topicSettings.levels || []) {
          const createdLevel = await storage.createAdaptiveLevel({
            testId: test.id,
            topicId: topicSettings.topicId,
            levelIndex: level.levelIndex,
            levelName: level.levelName,
            minDifficulty: level.minDifficulty,
            maxDifficulty: level.maxDifficulty,
            questionsCount: level.questionsCount,
            passThreshold: level.passThreshold,
            passThresholdType: level.passThresholdType || "percent",
            feedback: level.feedback || null,
          });

          // Create links for this level
          for (const link of level.links || []) {
            await storage.createAdaptiveLevelLink({
              levelId: createdLevel.id,
              title: link.title,
              url: link.url,
            });
          }
        }
      }
    }

    res.status(201).json(test);
  } catch (error) {
    logger.error("Create test error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to create test" });
  }
});

// GET /api/tests/:id/adaptive-settings - Адаптивные настройки теста
router.get("/:id/adaptive-settings", requireAuthor, async (req, res) => {
  try {
    const testId = req.params.id;
    const topicSettings = await storage.getAdaptiveTopicSettingsByTest(testId);
    const levels = await storage.getAdaptiveLevelsByTest(testId);
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t]));

    const adaptiveSettings = await Promise.all(
      topicSettings.map(async (ts) => {
        const topicLevels = levels.filter((l) => l.topicId === ts.topicId);
        const levelsWithLinks = await Promise.all(
          topicLevels.map(async (level) => {
            const links = await storage.getAdaptiveLevelLinks(level.id);
            return { ...level, links };
          })
        );
        return {
          ...ts,
          topicName: topicMap.get(ts.topicId)?.name || "Unknown",
          levels: levelsWithLinks,
        };
      })
    );

    res.json(adaptiveSettings);
  } catch (error) {
    logger.error("Get adaptive settings error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to get adaptive settings" });
  }
});

// PUT /api/tests/:id - Обновить тест
router.put("/:id", requireAuthor, async (req, res) => {
  try {
    const {
      title,
      description,
      overallPassRuleJson,
      webhookUrl,
      sections,
      showCorrectAnswers,
      timeLimitMinutes,
      maxAttempts,
      startPageContent,
      feedback,
      mode,
      showDifficultyLevel,
      adaptiveSettings,
    } = req.body;

    // Update test basic info
    const test = await storage.updateTest(
      req.params.id,
      {
        title,
        description,
        overallPassRuleJson,
        webhookUrl,
        showCorrectAnswers,
        timeLimitMinutes,
        maxAttempts,
        startPageContent,
        feedback,
        mode,
        showDifficultyLevel,
      },
      mode === "standard" ? sections : undefined
    );

    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    // If adaptive mode and settings provided, update adaptive settings
    if (mode === "adaptive" && adaptiveSettings) {
      // Delete old adaptive settings
      await storage.deleteAdaptiveLevelLinksByTest(test.id);
      await storage.deleteAdaptiveLevelsByTest(test.id);
      await storage.deleteAdaptiveTopicSettingsByTest(test.id);

      // Create new adaptive settings
      for (const topicSettings of adaptiveSettings) {
        await storage.createAdaptiveTopicSettings({
          testId: test.id,
          topicId: topicSettings.topicId,
          failureFeedback: topicSettings.failureFeedback || null,
        });

        for (const level of topicSettings.levels || []) {
          const createdLevel = await storage.createAdaptiveLevel({
            testId: test.id,
            topicId: topicSettings.topicId,
            levelIndex: level.levelIndex,
            levelName: level.levelName,
            minDifficulty: level.minDifficulty,
            maxDifficulty: level.maxDifficulty,
            questionsCount: level.questionsCount,
            passThreshold: level.passThreshold,
            passThresholdType: level.passThresholdType || "percent",
            feedback: level.feedback || null,
          });

          for (const link of level.links || []) {
            await storage.createAdaptiveLevelLink({
              levelId: createdLevel.id,
              title: link.title,
              url: link.url,
            });
          }
        }
      }
    }

    res.json(test);
  } catch (error) {
    logger.error("Update test error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to update test" });
  }
});

// DELETE /api/tests/:id - Удалить тест
router.delete("/:id", requireAuthor, async (req, res) => {
  try {
    // Delete adaptive settings first
    await storage.deleteAdaptiveLevelLinksByTest(req.params.id);
    await storage.deleteAdaptiveLevelsByTest(req.params.id);
    await storage.deleteAdaptiveTopicSettingsByTest(req.params.id);

    const success = await storage.deleteTest(req.params.id);
    if (!success) {
      return res.status(404).json({ error: "Test not found" });
    }
    res.json({ success: true });
  } catch (error) {
    logger.error("Delete test error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to delete test" });
  }
});

// GET /api/tests/:id/export/scorm - Экспорт SCORM
router.get("/:id/export/scorm", requireAuthor, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const sections = await storage.getTestSections(test.id);
    const exportSections = await Promise.all(
      sections.map(async (s) => {
        const topic = await storage.getTopic(s.topicId);
        const questions = await storage.getQuestionsByTopic(s.topicId);
        const courses = await storage.getTopicCourses(s.topicId);
        return {
          ...s,
          topic: topic!,
          questions,
          courses,
        };
      })
    );

    // Load adaptive settings if test is adaptive
    let adaptiveSettings = null;
    if (test.mode === "adaptive") {
      const topicSettings = await storage.getAdaptiveTopicSettingsByTest(test.id);
      const levels = await storage.getAdaptiveLevelsByTest(test.id);

      // Load links for each level
      const levelsWithLinks = await Promise.all(
        levels.map(async (level) => {
          const links = await storage.getAdaptiveLevelLinks(level.id);
          return { ...level, links };
        })
      );

      adaptiveSettings = {
        topicSettings,
        levels: levelsWithLinks,
      };
    }

    // Telemetry configuration
    let telemetryConfig = null;
    const enableTelemetry = req.query.telemetry === "true";

    if (enableTelemetry) {
      const packageId = crypto.randomUUID();
      const secretKey = crypto.randomBytes(32).toString("hex");
      const apiBaseUrl = process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5001}`;

      // Create scorm_package record
      await storage.createScormPackage({
        id: packageId,
        testId: test.id,
        testTitle: test.title,
        testMode: test.mode || "standard",
        secretKey: secretKey,
        apiBaseUrl: apiBaseUrl,
        exportedAt: new Date(),
        createdBy: req.session.userId!,
        isActive: true,
      });

      telemetryConfig = {
        enabled: true,
        packageId: packageId,
        secretKey: secretKey,
        apiBaseUrl: apiBaseUrl,
      };

      logger.info(`SCORM telemetry package created: ${packageId} test="${test.title}" (${test.id}) by user=${req.session.userId}`, "scorm-export");
    }

    const buffer = await generateScormPackage({
      test,
      sections: exportSections,
      adaptiveSettings,
      telemetry: telemetryConfig,
    });

    res.setHeader("Content-Type", "application/zip");
    const safeTitle = test.title.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "scorm_export";
    const safeAscii = safeTitle.replace(/[^a-zA-Z0-9_]/g, "_") || "scorm_export";
    res.setHeader("Content-Disposition", `attachment; filename="${safeAscii}.zip"; filename*=UTF-8''${encodeURIComponent(safeTitle)}.zip`);
    logger.info(`SCORM exported: test="${test.title}" (${test.id}) telemetry=${enableTelemetry} by user=${req.session.userId}`, "scorm-export");
  } catch (error) {
    logger.error("SCORM export error: " + (error as Error).message, "scorm-export");
    res.status(500).json({ error: "Failed to export SCORM package" });
  }
});

export default router;