import { Router } from "express";
import crypto from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { templates, feedbackContentSchema, passRuleSchema, drawBlueprintSchema, retakePolicySchema } from "@shared/schema";
import { listActiveEligibilityPlugins } from "@shared/eligibility/registry";
import { readScreenTemplate } from "../services/template-render";
import { resolveTemplateDir, resolveSystemScreenDir } from "../services/template-dir";
import { requirePermission, requireUserContext } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { readableTestScope } from "../services/test-access";
import { assessTestPublish } from "../services/draw-feasibility";
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

const sectionBodySchema = z
  .object({
    topicId: z.string().min(1),
    // min(0): `drawAll` sections (and legacy adaptive sections) carry a draw_count
    // of 0 that the runtime ignores. The client's FR-13 validation enforces
    // `>= 1` for fixed-draw sections; this schema is only a backstop.
    drawCount: z.number().int().min(0),
    // Author's manual "draw the whole topic" flag; adaptive mode overrides the
    // effective behaviour without changing this stored value.
    drawAll: z.boolean().optional(),
    topicPassRuleJson: z.unknown().optional(),
    required: z.boolean().optional(),
    timeLimitMinutes: z.number().int().positive().nullable().optional(),
    feedbackJson: z.unknown().optional(),
    drawBlueprintJson: drawBlueprintSchema.nullish(),
  })
  .superRefine((s, ctx) => {
    // PRD-11 FR-05: the quotas are minimums inside the topic's sample, so their
    // sum must not exceed draw_count (the per-tag "fewer questions than count"
    // case is a non-blocking warning handled at draw time, FR-06). Quotas are
    // moot when the whole topic is drawn, so skip the check for drawAll sections.
    if (!s.drawAll && s.drawBlueprintJson) {
      const sum = s.drawBlueprintJson.strata.reduce((acc, st) => acc + st.count, 0);
      if (sum > s.drawCount) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["drawBlueprintJson"],
          message: `Сумма квот (${sum}) превышает выборку темы drawCount (${s.drawCount})`,
        });
      }
    }
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
  retakePolicyJson: retakePolicySchema.nullish(), // PRD-6

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
        // PRD-10: the section's maximum attainable points (Σ points). Absolute
        // pass thresholds are compared against earned POINTS at runtime, so the
        // editor caps them by this, not by the question count.
        maxPoints: questions.reduce((sum, q) => sum + (q.points ?? 1), 0),
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

  // PRD-2: include result variables so the editor loads them into the draft and
  // its diff-on-save can reconcile them against this snapshot.
  const resultVariables = await storage.getResultVariables(test.id);

  // PRD-5 (B4): scales + per-question measurement rows for the «Шкалы» tab. Raw
  // DB rows (scaleId/valueJson) — the editor's data layer keeps uuids; export
  // flattening to the engine shape happens later in buildTestJson.
  const scales = await storage.getScales(test.id);
  const measurements = await storage.getQuestionMeasurements(test.id);

  return { ...test, sections: sectionsWithDetails, adaptiveSettings, resultVariables, scales, measurements };
}

// GET /api/tests - Список тестов
// Query param: ?status=archived shows only archived; default excludes archived.
router.get("/", requirePermission("tests.read"), async (req, res) => {
  try {
    const statusFilter = (req.query.status as string | undefined)?.toLowerCase();
    const allTests = await storage.getTests();
    const filteredTests = statusFilter === "archived"
      ? allTests.filter((t) => t.status === "archived")
      : allTests.filter((t) => t.status !== "archived");

    // PRD-13: restrict the list to tests this user may read (scope by role).
    const scope = await readableTestScope(req.effectiveRoles ?? [], req.currentUser?.id ?? "");
    const visibleTests = scope.all
      ? filteredTests
      : filteredTests.filter((t) => scope.ids.has(t.id));

    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map((t) => [t.id, t]));

    // PRD-13: resolve owner display names for the list "Владелец" column.
    const allUsers = await storage.getUsers();
    const ownerNameById = new Map(allUsers.map((u) => [u.id, u.name]));

    const testsWithSections = await Promise.all(
      visibleTests.map(async (test) => {
        const sections = await storage.getTestSections(test.id);
        const sectionsWithDetails = await Promise.all(
          sections.map(async (s) => {
            const topic = topicMap.get(s.topicId);
            const questions = await storage.getQuestionsByTopic(s.topicId);
            return {
              ...s,
              topicName: topic?.name || "Unknown",
              maxQuestions: questions.length,
              maxPoints: questions.reduce((sum, q) => sum + (q.points ?? 1), 0),
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

        const ownerName = test.ownerId ? ownerNameById.get(test.ownerId) ?? null : null;
        return { ...test, ownerName, sections: sectionsWithDetails, adaptiveSettings };
      })
    );

    res.json(testsWithSections);
  } catch (error) {
    logger.error("Get tests error: " + (error as Error).message, "tests")
    res.status(500).json({ error: "Failed to fetch tests" });
  }
});

// GET /api/tests/:id/screen-template/:screen — template assets (layout+css+theme)
// for a learner-facing screen the client renders itself (PRD-12 web-host).
const SCREEN_LAYOUTS: Record<string, string> = {
  start: "start.html",
  blocked: "system.blocked.html",
  question: "question.html",
};
// System variant kind backing each screen (for the default-fallback resolution).
// `blocked` is a pure system layout with no contentTemplate kind — never falls back.
const SCREEN_KIND: Record<string, string | undefined> = {
  start: "start",
  question: "questions",
};
// PRD-15 FR-09: object-level read scope (owner/grant/admin/assigned learner)
// instead of the bare session check.
router.get("/:id/screen-template/:screen", requireUserContext, requireTestScope("read"), async (req, res) => {
  try {
    const layoutFile = SCREEN_LAYOUTS[req.params.screen];
    if (!layoutFile) return res.status(400).json({ error: "Unknown screen" });
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const templateId = ((test.designSettingsJson as any)?.templateId as string) || "default";
    // Learner-facing render (PRD-12 web host): never serve a non-active template,
    // and when the active template declares no contentTemplate of this screen's
    // kind, render from `default` (same fallback as «Структура» / the preview).
    const kind = SCREEN_KIND[req.params.screen];
    const dir = kind
      ? await resolveSystemScreenDir(templateId, kind, { activeOnly: true })
      : await resolveTemplateDir(templateId, { activeOnly: true });
    const payload = readScreenTemplate(dir, layoutFile);
    if (!payload) return res.status(404).json({ error: "Template not found" });
    res.json(payload);
  } catch (error) {
    logger.error("Get screen template error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to fetch screen template" });
  }
});

// GET /api/tests/migration-health — проверка полноты миграции legacy-полей (PRD-7 §1.11)
router.get("/migration-health", requirePermission("tests.read"), async (req, res) => {
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
router.get("/:id", requirePermission("tests.read"), requireTestScope("read"), async (req, res) => {
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

// PRD-6 §6.2: read-only list of active eligibility plugins + configs for the
// author's retake-policy picker. Phase 1 serves the seeded in-code registry
// (trimmed — no raw endpoints); a DB-backed admin registry is Phase 2.
router.get("/:id/available-eligibility-plugins", requirePermission("tests.read"), requireTestScope("read"), (_req, res) => {
  const plugins = listActiveEligibilityPlugins().map((p) => ({
    key: p.key,
    name: p.name,
    version: p.version,
    description: p.description,
    bestEffort: p.bestEffort,
    configs: p.configs
      .filter((c) => c.isActive)
      .map((c) => ({ id: c.id, name: c.name, version: c.version })),
  }));
  res.json({ plugins });
});

// POST /api/tests - Создать тест
router.post("/", requirePermission("tests.create"), async (req, res) => {
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
      retakePolicyJson,
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
        retakePolicyJson: retakePolicyJson ?? null,
        folderId: folderId ?? null,
      },
      sections: (sections ?? []) as SectionPayload[],
      adaptiveSettings: mode === "adaptive"
        ? (adaptiveSettings as AdaptiveTopicPayload[] | undefined)
        : undefined,
    });

    // PRD-13: the creator becomes the test owner.
    await storage.setTestOwner(test.id, req.session.userId ?? null);

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
router.get("/:id/adaptive-settings", requirePermission("tests.read"), requireTestScope("read"), async (req, res) => {
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
// PRD-15 FR-09: object-level read scope (owner/grant/admin/assigned learner).
router.get("/:id/design", requireUserContext, requireTestScope("read"), async (req, res) => {
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
router.put("/:id/design", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
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
router.put("/:id", requirePermission("tests.edit"), requireTestScope("edit"), async (req, res) => {
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
      retakePolicyJson,
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
        retakePolicyJson: retakePolicyJson ?? undefined,
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
router.patch("/:id/status", requirePermission("tests.publish"), requireTestScope("edit"), async (req, res) => {
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

    // PRD-15 FR-06 (E-12): a test must not be published with an infeasible
    // draw — pools, blueprint quotas and adaptive levels are checked against
    // the current bank state.
    if (status === "published") {
      const findings = await assessTestPublish(req.params.id);
      if (findings.length > 0) {
        return res.status(409).json({
          error: "publish_infeasible",
          message: "Выдача вопросов невыполнима при текущем составе тем",
          findings,
        });
      }
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
router.post("/:id/restore", requirePermission("tests.publish"), requireTestScope("edit"), async (req, res) => {
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
router.delete("/:id", requirePermission("tests.delete"), requireTestScope("delete"), async (req, res) => {
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
router.get("/:id/export/scorm", requirePermission("tests.export.scorm"), requireTestScope("edit"), async (req, res) => {
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

    // Load scales + measurements (PRD-5) for this test
    const scales = await storage.getScales(test.id);
    const measurements = await storage.getQuestionMeasurements(test.id);

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

    // Resolve the actual on-disk directory of the selected template (built-in or
    // uploaded PRD-3) so the exporter copies the right files instead of falling
    // back to `default` for uploaded ids (whose files live under uploads/templates).
    // The exported package is a learner-facing artifact: a non-active template
    // must not ship — fall back to `default`.
    const templateDir = await resolveTemplateDir(designTemplateId, { activeOnly: true });

    const buffer = await generateScormPackage({
      test,
      sections: exportSections,
      adaptiveSettings,
      contentPages,
      resultVariables,
      scales,
      measurements,
      designSettings,
      templateDir,
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

// ─── PRD-13: per-test access management (administrators / superadmin only) ────

// GET /api/tests/:id/access — owner and access grants for the test.
router.get("/:id/access", requirePermission("tests.access.grant"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const grants = await storage.getTestAccessGrants(test.id);
    res.json({ testId: test.id, ownerId: test.ownerId ?? null, grants });
  } catch (error) {
    logger.error("Get test access error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to get test access" });
  }
});

// POST /api/tests/:id/access — grant or update a user's edit/assign access.
router.post("/:id/access", requirePermission("tests.access.grant"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const { userId, accessLevel } = req.body ?? {};
    if (typeof userId !== "string" || !userId) {
      return res.status(400).json({ error: "userId required" });
    }
    if (accessLevel !== "edit" && accessLevel !== "assign") {
      return res.status(400).json({ error: "accessLevel must be 'edit' or 'assign'" });
    }
    const grantee = await storage.getUser(userId);
    if (!grantee) return res.status(404).json({ error: "User not found" });
    const grant = await storage.upsertTestAccessGrant({
      testId: test.id,
      userId,
      accessLevel,
      grantedBy: req.session.userId ?? null,
    });
    res.status(201).json(grant);
  } catch (error) {
    logger.error("Grant test access error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to grant test access" });
  }
});

// DELETE /api/tests/:id/access/:userId — revoke a user's access grant.
router.delete("/:id/access/:userId", requirePermission("tests.access.grant"), async (req, res) => {
  try {
    const removed = await storage.removeTestAccessGrant(req.params.id, req.params.userId);
    if (!removed) return res.status(404).json({ error: "Grant not found" });
    res.status(204).end();
  } catch (error) {
    logger.error("Revoke test access error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to revoke test access" });
  }
});

// PATCH /api/tests/:id/owner — change the test owner.
router.patch("/:id/owner", requirePermission("tests.owner.change"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    const { ownerId } = req.body ?? {};
    if (ownerId !== null && typeof ownerId !== "string") {
      return res.status(400).json({ error: "ownerId must be a string or null" });
    }
    if (ownerId) {
      const owner = await storage.getUser(ownerId);
      if (!owner) return res.status(404).json({ error: "Owner user not found" });
    }
    await storage.setTestOwner(test.id, ownerId ?? null);
    res.json({ testId: test.id, ownerId: ownerId ?? null });
  } catch (error) {
    logger.error("Change test owner error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to change test owner" });
  }
});

export default router;