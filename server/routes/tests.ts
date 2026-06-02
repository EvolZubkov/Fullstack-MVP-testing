import { Router } from "express";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { templates, feedbackContentSchema, passRuleSchema } from "@shared/schema";
import { requireAuth, requireAuthor } from "../middleware/auth";
import { generateScormPackage } from "../scorm-exporter";
import { isSupportedTemplateApiVersion } from "../template-registry";
import { logger } from "../logger";
import {
  testSettingsService,
  VersionConflictError,
  type SectionPayload,
  type AdaptiveTopicPayload,
} from "../services/test-settings";
import { RequiredFieldsMissingError } from "../services/required-fields-validator";
import { FlowPolicyValidationError } from "../services/flow-policy-validator";

// ─── Validation schemas (PRD-7 §5.4) ─────────────────────────────────────────

const sectionBodySchema = z.object({
  topicId: z.string().min(1),
  drawCount: z.number().int().min(1),
  topicPassRuleJson: z.unknown().optional(),
  required: z.boolean().optional(),
  timeLimitMinutes: z.number().int().positive().nullable().optional(),
  feedbackJson: z.unknown().optional(),
});

const testBodyBaseSchema = z.object({
  title: z.string().min(1, "Title is required").optional(),
  description: z.string().nullable().optional(),
  overallPassRuleJson: passRuleSchema.optional(),
  webhookUrl: z.union([z.string().url(), z.literal(""), z.null()]).optional(),
  sections: z.array(sectionBodySchema).optional(),
  showCorrectAnswers: z.boolean().optional(),
  timeLimitMinutes: z.number().int().positive().nullable().optional(),
  maxAttempts: z.number().int().positive().nullable().optional(),
  startPageContent: z.string().nullable().optional(),
  feedback: z.string().nullable().optional(),
  mode: z.enum(["standard", "adaptive"]).optional(),
  showDifficultyLevel: z.boolean().optional(),
  adaptiveSettings: z.array(z.unknown()).optional(),
  // PRD-7 new fields
  status: z.enum(["draft", "published", "archived"]).optional(),
  published: z.boolean().optional(),
  telemetryEnabled: z.boolean().optional(),
  feedbackJson: feedbackContentSchema.nullable().optional(),
  flowPolicyJson: z.unknown().optional(),
  /** Destination folder for create (PRD-7 §5.5 — FAB folder-pick modal). */
  folderId: z.string().nullable().optional(),
});

const createTestBodySchema = testBodyBaseSchema.refine(
  (b) => !!b.title,
  { message: "Title is required", path: ["title"] },
);

const updateTestBodySchema = testBodyBaseSchema;

/** Converts a ZodError to the structured `fields` array per decisions.md §5.4. */
function zodToFields(err: z.ZodError) {
  return err.issues.map((e) => ({
    field: e.path.join(".") || "body",
    code: e.code,
    message: e.message,
  }));
}

/**
 * Log the structured zod field errors so the dev server output points at the
 * actual offending field instead of a bare `400 in 7ms` line. Use for both
 * create and update routes.
 */
function logZodValidationFailure(route: string, err: z.ZodError) {
  const fields = zodToFields(err);
  logger.warn(`${route} validation failed: ${JSON.stringify(fields)}`, "tests");
}

const router = Router();

/**
 * Load the complete editor-shaped representation of a test:
 * `tests` row + `sections[]` (with `topicName`/`maxQuestions`) + `adaptiveSettings`
 * for adaptive tests. Returns `null` if the test does not exist.
 *
 * Used by GET (single-test response) and after PUT/POST so the client
 * receives the same shape it would get from a follow-up GET — without this
 * the React-Query cache would store an incomplete row after save and the
 * editor would re-open with `sections=[]` / `adaptiveSettings=[]` until the
 * background refetch lands.
 */
async function loadFullTest(testId: string): Promise<Record<string, unknown> | null> {
  const test = await storage.getTest(testId);
  if (!test) return null;

  const sections = await storage.getTestSections(test.id);
  const topics = await storage.getTopics();
  const topicMap = new Map(topics.map((t) => [t.id, t]));

  const sectionsWithDetails = await Promise.all(
    sections.map(async (s) => {
      const topic = topicMap.get(s.topicId);
      const questions = await storage.getQuestionsByTopic(s.topicId);
      return {
        ...s,
        topicName: topic?.name || "Unknown",
        maxQuestions: questions.length,
      };
    }),
  );

  let adaptiveSettings: unknown = null;
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
          }),
        );
        return {
          ...ts,
          topicName: topicMap.get(ts.topicId)?.name || "Unknown",
          levels: levelsWithLinks,
        };
      }),
    );
  }

  return { ...test, sections: sectionsWithDetails, adaptiveSettings };
}

// GET /api/tests - Список тестов
// Query param: ?status=archived shows only archived; default excludes archived.
router.get("/", requireAuth, async (req, res) => {
  try {
    const statusFilter = (req.query.status as string | undefined)?.toLowerCase();
    const allTests = await storage.getTests();
    const filteredTests = statusFilter === "archived"
      ? allTests.filter((t) => t.status === "archived")
      : allTests.filter((t) => t.status !== "archived");
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t]));

    const testsWithSections = await Promise.all(
      filteredTests.map(async (test) => {
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

// GET /api/tests/migration-health — проверка полноты миграции legacy-полей (PRD-7 §1.11)
router.get("/migration-health", requireAuthor, async (req, res) => {
  try {
    const health = await storage.getMigrationHealth();
    res.json(health);
  } catch (error) {
    logger.error("Migration health error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to get migration health" });
  }
});

// GET /api/tests/:id - Полный single-test response (PRD-7 §5.2)
// Возвращает тот же shape, что и единичная карточка из списка `GET /api/tests`:
// все поля `tests` (включая `version`, `flowPolicyJson`, `designSettingsJson`,
// `feedbackJson`), `sections[]` с `topicName`/`maxQuestions`, плюс
// `adaptiveSettings` для adaptive-режима. Используется редактором PRD-7.
router.get("/:id", requireAuthor, async (req, res) => {
  try {
    // Heal `content_pages` system rows against current (flowMode, topics,
    // template) before returning the bundle (G48 2026-05-28). Idempotent —
    // no-op when state is already consistent. Surfaces silently-missed system
    // rows from out-of-band seed data or pre-fix tests stuck on router mode.
    try {
      const diff = await testSettingsService.reconcileExisting(req.params.id);
      if (diff.created > 0 || diff.deleted > 0) {
        logger.info(
          `Reconciled content_pages on GET tests/${req.params.id}: +${diff.created} −${diff.deleted}`,
          "tests",
        );
      }
    } catch (reconcileError) {
      // Reconcile is a healing best-effort — never block the load on it.
      logger.warn(
        `Reconcile-on-GET failed for tests/${req.params.id}: ${(reconcileError as Error).message}`,
        "tests",
      );
    }

    const full = await loadFullTest(req.params.id);
    if (!full) return res.status(404).json({ error: "Test not found" });
    res.json(full);
  } catch (error) {
    logger.error("Get test error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to fetch test" });
  }
});

// POST /api/tests - Создать тест
router.post("/", requireAuthor, async (req, res) => {
  try {
    const parsed = createTestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logZodValidationFailure("POST /api/tests", parsed.error);
      return res.status(400).json({ error: "Validation failed", fields: zodToFields(parsed.error) });
    }

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
      status,
      published,
      telemetryEnabled,
      feedbackJson,
      flowPolicyJson,
      folderId,
    } = parsed.data;

    // For standard mode, sections are required
    if (mode !== "adaptive" && (!sections || sections.length === 0)) {
      return res.status(400).json({ error: "Sections are required for standard tests" });
    }

    const test = await testSettingsService.create({
      test: {
        title: title!,
        description,
        overallPassRuleJson: overallPassRuleJson ?? { type: "percent" as const, value: 70 },
        webhookUrl: webhookUrl || null,
        status,
        published,
        showCorrectAnswers,
        timeLimitMinutes,
        maxAttempts,
        startPageContent,
        feedback,
        mode: mode || "standard",
        showDifficultyLevel: showDifficultyLevel ?? true,
        telemetryEnabled,
        feedbackJson: feedbackJson ?? null,
        flowPolicyJson: flowPolicyJson ?? null,
        folderId: folderId ?? null,
      },
      sections: (sections ?? []) as SectionPayload[],
      adaptiveSettings: mode === "adaptive"
        ? (adaptiveSettings as AdaptiveTopicPayload[] | undefined)
        : undefined,
    });

    const full = await loadFullTest(test.id);
    res.status(201).json(full ?? test);
  } catch (error) {
    if (error instanceof FlowPolicyValidationError) {
      return res.status(422).json({
        error: "flow_policy_invalid",
        violations: error.violations,
      });
    }
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

// GET /api/tests/:id/design - Настройки оформления теста
router.get("/:id/design", requireAuth, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const settings = test.designSettingsJson as Record<string, unknown> | null;
    if (!settings || Object.keys(settings).length === 0) {
      return res.json({ templateId: "default" });
    }
    res.json(settings);
  } catch (error) {
    logger.error("Get design settings error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to get design settings" });
  }
});

// PUT /api/tests/:id/design - Сохранить настройки оформления теста
router.put("/:id/design", requireAuthor, async (req, res) => {
  try {
    const testId = req.params.id;
    const test = await storage.getTest(testId);
    if (!test) return res.status(404).json({ error: "Test not found" });

    const body = req.body as Record<string, unknown>;

    // Empty body or explicit reset — restore defaults
    if (!body || Object.keys(body).length === 0) {
      await storage.updateTest(testId, { designSettingsJson: {} });
      return res.json({ templateId: "default" });
    }

    const { templateId, templateVersion, templateApiVersion, params = {} } = body as {
      templateId?: string;
      templateVersion?: string;
      templateApiVersion?: string;
      params?: Record<string, unknown>;
    };

    if (!templateId) {
      return res.status(422).json({ error: "templateId is required", field: "templateId" });
    }

    // Validate server-supported API version
    if (templateApiVersion && !isSupportedTemplateApiVersion(templateApiVersion)) {
      return res.status(422).json({
        error: `Unsupported templateApiVersion: ${templateApiVersion}`,
        field: "templateApiVersion",
      });
    }

    // Validate template exists and is active
    const [template] = await db
      .select()
      .from(templates)
      .where(and(eq(templates.id, templateId), eq(templates.isActive, true)));

    if (!template) {
      return res.status(422).json({ error: "Template not found or inactive", field: "templateId" });
    }

    // Validate params against manifest.params — reject unknown keys
    const manifest = template.manifest as Record<string, unknown>;
    const allowedKeys = new Set(
      ((manifest.params as Array<{ key: string }>) ?? []).map((p) => p.key)
    );
    const extraKeys = Object.keys(params ?? {}).filter((k) => !allowedKeys.has(k));
    if (extraKeys.length > 0) {
      return res.status(422).json({
        error: `Unknown params: ${extraKeys.join(", ")}`,
        field: "params",
        extraKeys,
      });
    }

    const designSettings = {
      templateId,
      templateVersion: templateVersion ?? template.version,
      templateApiVersion: templateApiVersion ?? template.templateApiVersion,
      params: params ?? {},
    };

    await storage.updateTest(testId, { designSettingsJson: designSettings });
    res.json(designSettings);
  } catch (error) {
    logger.error("Update design settings error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to update design settings" });
  }
});

// PUT /api/tests/:id - Обновить тест
// PUT /api/tests/:id — Atomic save via TestSettingsService.
//
// Goes through the service so a single transaction covers: test row update,
// sections replace, adaptive settings replace, system content_pages
// reconciliation (PRD-7 §1.4), and required-fields validation when the
// status transitions to "published" (PRD-1 §4.3.6).
router.put("/:id", requireAuthor, async (req, res) => {
  try {
    const parsed = updateTestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logZodValidationFailure(`PUT /api/tests/${req.params.id}`, parsed.error);
      return res.status(400).json({ error: "Validation failed", fields: zodToFields(parsed.error) });
    }

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
      status,
      published,
      telemetryEnabled,
      feedbackJson,
      flowPolicyJson,
    } = parsed.data;

    const expectedVersion = typeof (req.body as { expectedVersion?: unknown })?.expectedVersion === "number"
      ? (req.body as { expectedVersion: number }).expectedVersion
      : undefined;

    const test = await testSettingsService.save(req.params.id, {
      test: {
        title,
        description,
        overallPassRuleJson,
        webhookUrl: webhookUrl ?? undefined,
        showCorrectAnswers,
        timeLimitMinutes,
        maxAttempts,
        startPageContent,
        feedback,
        mode,
        showDifficultyLevel,
        status,
        published,
        telemetryEnabled,
        feedbackJson: feedbackJson ?? undefined,
        flowPolicyJson: flowPolicyJson ?? undefined,
      },
      // PRD-7 §6.3: sections live with the standard mode only. For adaptive,
      // sections come from the adaptive levels instead.
      sections: mode === "standard" ? (sections as SectionPayload[] | undefined) : undefined,
      adaptiveSettings: mode === "adaptive" ? (adaptiveSettings as AdaptiveTopicPayload[] | undefined) : undefined,
      expectedVersion,
    });

    const full = await loadFullTest(test.id);
    res.json(full ?? test);
  } catch (error) {
    if (error instanceof VersionConflictError) {
      return res.status(409).json({
        error: "version_conflict",
        currentVersion: error.currentVersion,
        expectedVersion: error.expectedVersion,
      });
    }
    if (error instanceof RequiredFieldsMissingError) {
      // PRD-1 §4.3.6 / PRD-7 §1.4: structured payload listing the missing
      // required placeholder keys per content_pages row.
      return res.status(422).json({
        error: "required_fields_missing",
        fields: error.violations.flatMap((v) =>
          v.missingFields.map((fieldName) => ({
            pageId: v.pageId,
            templateKey: v.templateKey,
            fieldName,
          })),
        ),
      });
    }
    if (error instanceof FlowPolicyValidationError) {
      // PRD-4 v1.1 §3.1.2 / L3 server-side guard: (mode × flowMode) is invalid
      // or adaptive strict gating is breached. Mirrors the client-side
      // ValidationIssue shape so the UI can surface field-anchored errors.
      return res.status(422).json({
        error: "flow_policy_invalid",
        violations: error.violations,
      });
    }
    const e = error as Error & { status?: number };
    if (e.status === 404) {
      return res.status(404).json({ error: "Test not found" });
    }
    logger.error("Update test error: " + e.message, "tests");
    res.status(500).json({ error: "Failed to update test" });
  }
});

// PATCH /api/tests/:id/status - Сменить статус (без инкремента версии, PRD-7 §9)
router.patch("/:id/status", requireAuthor, async (req, res) => {
  try {
    const { status, expectedVersion } = req.body as {
      status?: unknown;
      expectedVersion?: unknown;
    };

    if (!status || !["draft", "published", "archived"].includes(status as string)) {
      return res.status(400).json({ error: "status must be draft, published, or archived", field: "status" });
    }

    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    if (expectedVersion !== undefined && test.version !== Number(expectedVersion)) {
      return res.status(409).json({
        error: "version_conflict",
        currentVersion: test.version,
        expectedVersion: Number(expectedVersion),
      });
    }

    const updated = await storage.patchTestStatus(req.params.id, status as "draft" | "published" | "archived");
    if (!updated) return res.status(404).json({ error: "Test not found" });
    res.json(updated);
  } catch (error) {
    logger.error("PATCH status error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to update test status" });
  }
});

// POST /api/tests/:id/restore - Восстановить тест из архива
router.post("/:id/restore", requireAuthor, async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    if (test.status !== "archived") {
      return res.status(400).json({ error: "Test is not archived", code: "not_archived" });
    }

    await storage.patchTestStatus(req.params.id, "draft");
    res.status(204).end();
  } catch (error) {
    logger.error("Restore test error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to restore test" });
  }
});

// DELETE /api/tests/:id - Удалить тест (требует подтверждения точного названия, PRD-7 §5.2)
router.delete("/:id", requireAuthor, async (req, res) => {
  try {
    const { confirmTitle } = req.body as { confirmTitle?: string };

    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });

    if (!confirmTitle || confirmTitle !== test.title) {
      return res.status(400).json({ error: "title_mismatch", field: "confirmTitle" });
    }

    await storage.deleteAdaptiveLevelLinksByTest(req.params.id);
    await storage.deleteAdaptiveLevelsByTest(req.params.id);
    await storage.deleteAdaptiveTopicSettingsByTest(req.params.id);
    await storage.deleteTest(req.params.id);
    res.status(204).end();
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
        const events = await storage.getTopicEvents(s.topicId);
        return {
          ...s,
          topic: topic!,
          questions,
          courses,
          events,
        };
      })
    );

    // Validate design template before packaging
    const rawDesignSettings = test.designSettingsJson as Record<string, unknown> | null;
    const designTemplateId = (rawDesignSettings?.templateId as string | undefined) || "default";
    const designTemplateApiVersion = rawDesignSettings?.templateApiVersion as string | undefined;

    if (designTemplateApiVersion && !isSupportedTemplateApiVersion(designTemplateApiVersion)) {
      return res.status(422).json({
        error: `Unsupported templateApiVersion in design settings: ${designTemplateApiVersion}`,
        field: "templateApiVersion",
      });
    }

    const designSettings = rawDesignSettings && Object.keys(rawDesignSettings).length > 0
      ? {
          templateId: designTemplateId,
          templateVersion: rawDesignSettings.templateVersion as string | undefined,
          templateApiVersion: rawDesignSettings.templateApiVersion as string | undefined,
          params: (rawDesignSettings.params as Record<string, unknown>) ?? {},
        }
      : { templateId: "default", params: {} };

    // Load content pages for this test
    const contentPages = await storage.getContentPages(test.id);

    // Load result variables (PRD-2) for this test
    const resultVariables = await storage.getResultVariables(test.id);

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
      const apiBaseUrl = (process.env.API_BASE_URL || `http://localhost:${process.env.PORT || 5001}`).replace(/\/$/, '');

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
      contentPages,
      resultVariables,
      designSettings,
      telemetry: telemetryConfig,
    });

    res.setHeader("Content-Type", "application/zip");
    const safeTitle = test.title.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "scorm_export";
    const safeAscii = safeTitle.replace(/[^a-zA-Z0-9_]/g, "_") || "scorm_export";
    res.setHeader("Content-Disposition", `attachment; filename="${safeAscii}.zip"; filename*=UTF-8''${encodeURIComponent(safeTitle)}.zip`);
    res.setHeader("Content-Length", buffer.length);
    logger.info(`SCORM exported: test="${test.title}" (${test.id}) telemetry=${enableTelemetry} by user=${req.session.userId}`, "scorm-export");
    res.send(buffer);
  } catch (error) {
    logger.error("SCORM export error: " + (error as Error).message, "scorm-export");
    res.status(500).json({ error: "Failed to export SCORM package" });
  }
});

export default router;