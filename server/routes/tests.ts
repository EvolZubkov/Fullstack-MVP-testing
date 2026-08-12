import { Router } from "express";
import crypto from "node:crypto";
import path from "node:path";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { storage } from "../storage";
import { db } from "../db";
import { templates, feedbackContentSchema, passRuleSchema, drawBlueprintSchema, formSetSchema, retakePolicySchema, reportSettingsSchema, testIntroSchema, questionScoringSchema, designSettingsSchema } from "@shared/schema";
import { listActiveEligibilityPlugins } from "@shared/eligibility/registry";
import { readScreenTemplate, readManifestContentTemplates, readVariantLayouts } from "../services/template-render";
import { withTemplateAssetBase } from "@shared/template/asset-base";
import { declaredThemes, isTestTheme, supportsThemes, TEST_THEMES } from "@shared/template/themes";
import { startImageForVariant, type StartVariantDecl } from "@shared/template/start-image";
import { colorParamKeys } from "@shared/template/theme-params";
import { resolveTemplateDir, resolveSystemScreenDir } from "../services/template-dir";
import { requirePermission, requireUserContext } from "../middleware/auth";
import { requireTestScope } from "../middleware/test-scope";
import { readableTestScope, canGrantAccess } from "../services/test-access";
import { visibleTopic } from "../services/topic-access";
import { assessTestPublish } from "../services/draw-feasibility";
import { createTestSnapshot, getPublicationState } from "../services/test-snapshot";
import { countUnmappedPages } from "../services/page-variant-audit";
import { generateScormPackage } from "../scorm-exporter";
import { buildScormExportData, ScormBuildError } from "../scorm/build-export-data";
import { isSupportedTemplateApiVersion } from "../template-registry";
import { logger } from "../logger";
import { appBaseUrl } from "../config";
import {
  testSettingsService,
  VersionConflictError,
  type SectionPayload,
  type AdaptiveTopicPayload,
} from "../services/test-settings";
import { RequiredFieldsMissingError } from "../services/required-fields-validator";
import { FlowPolicyValidationError } from "../services/flow-policy-validator";
import { buildTestScoringContext } from "../services/effective-scoring";
import { syncEntityUsages, testFeedbackUsageEntity } from "../services/media/usage-index";

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
    // PRD-17 (BR-12): fixed-variant set. MUST be listed here — Zod strips unknown
    // keys, so without this the editor's saved form set is silently dropped before
    // it reaches the storage layer (200 OK, but nothing persisted). null = legacy draw.
    formSetJson: formSetSchema.nullish(),
    // PRD-15 block D (FR-31): per-section default price; null = inherit test.
    defaultPoints: z.number().int().min(0).nullable().optional(),
    // PRD-30 FR-02/FR-18: the topic's OVERRIDE of the test-wide order; null =
    // «как в тесте». MUST be listed here for the same reason as formSetJson
    // above — an unlisted key is stripped and silently lost.
    questionOrder: z.enum(["random", "fixed"]).nullish(),
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
  // PRD-19 (Блок A): правила навигации/завершения.
  allowReturnToUnanswered: z.boolean().optional(),
  allowAnswerChange: z.boolean().optional(),
  // PRD-43: independent of allowReturnToUnanswered.
  quickAdvance: z.boolean().optional(),
  showSectionResults: z.boolean().optional(),
  // Обзор при полностью отвеченном объёме — авторское решение, см. `review-gate`.
  skipReviewWhenComplete: z.boolean().optional(),
  // PRD-34 (FR-01): настройки защиты от копирования.
  copyProtection: z.boolean().optional(),
  // PRD-30 FR-16: the test-wide delivery order (the topics' default).
  questionOrder: z.enum(["fixed", "random", "shuffle_all"]).optional(),
  protectionWatermark: z.boolean().optional(),
  protectionHideOnBlur: z.boolean().optional(),
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
  // PRD-27: выбранный вариант отчёта и значения его полей, по режиму теста.
  reportSettingsJson: reportSettingsSchema.nullish(),
  introJson: testIntroSchema.nullish(),
  // PRD-15 block D (FR-31): test-wide default price; null = system default (1).
  defaultQuestionPoints: z.number().int().min(0).nullable().optional(),

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

/**
 * PRD-15 block C (FR-22/E-13): a test may only reference topics its author can
 * see. Validates every topic id referenced by the saved sections / adaptive
 * settings against {@link visibleTopic}. Returns the first invisible topic id,
 * or null when all are visible (or the actor is an admin, for whom every topic
 * is visible). The delivery path is intentionally NOT gated this way — losing
 * topic access must not break already published tests (FR-24).
 *
 * `exempt` carries the FR-25 derived in-context read: topics the test ALREADY
 * references are kept even after a soft grant revoke, so the author can still
 * re-save that test; only newly added references must be generally visible.
 *
 * @param roles - the actor's effective roles.
 * @param userId - the actor's id.
 * @param topicIds - the distinct topic ids referenced by the test body.
 * @param exempt - topic ids already referenced by the test (in-context read).
 * @returns the first topic id the actor cannot see, or null.
 */
async function firstInvisibleTopic(
  roles: readonly import("@shared/access").Role[],
  userId: string,
  topicIds: readonly string[],
  exempt: ReadonlySet<string> = new Set(),
): Promise<string | null> {
  for (const id of [...new Set(topicIds)]) {
    if (exempt.has(id)) continue;
    const topic = await storage.getTopic(id);
    // A missing topic is left to the existing referential checks; only an
    // existing-but-invisible topic is an access violation here.
    if (topic && !(await visibleTopic(roles, userId, topic))) return id;
  }
  return null;
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

  // PRD-15 block D: per-test scoring overrides — the editor needs the raw rows
  // (override values + staleness pins), and maxPoints must sum EFFECTIVE prices.
  const questionScoring = await storage.getTestQuestionScoring(test.id);
  const scoringCtx = buildTestScoringContext(test, sections, questionScoring);

  const sectionsWithDetails = await Promise.all(
    sections.map(async (s) => {
      const topic = topicMap.get(s.topicId);
      const questions = await storage.getQuestionsByTopic(s.topicId);
      return {
        ...s,
        topicName: topic?.name || "Unknown",
        // PRD-2 §4.2: author-defined readable id for `topicById("<code>")`; null → UUID.
        topicCode: topic?.code ?? null,
        maxQuestions: questions.length,
        // PRD-10: the section's maximum attainable points (Σ points). Absolute
        // pass thresholds are compared against earned POINTS at runtime, so the
        // editor caps them by this, not by the question count. Block D: the sum
        // is over EFFECTIVE prices (override -> defaults -> legacy -> system).
        maxPoints: questions.reduce((sum, q) => sum + scoringCtx.resolve(q).points, 0),
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

  // PRD-15 FR-12: publication state (draft / published / published_with_changes)
  // for the editor's status indicator and the «Опубликовать изменения» action.
  const publication = await getPublicationState(test.id);

  return { ...test, sections: sectionsWithDetails, adaptiveSettings, resultVariables, scales, measurements, questionScoring, publication };
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

    // PRD-13: resolve owner display names for the list "Владелец" column. Fall back
    // to email for users WITHOUT a name — notably configured superadmins, which
    // provisionSuperadmins creates with name=null. Their imported/created tests ARE
    // owned (owner_id is set), but a null name made the column render «—» as if
    // unowned. (getUsers decrypts emails, so u.email is plaintext here.)
    const allUsers = await storage.getUsers();
    const ownerNameById = new Map(allUsers.map((u) => [u.id, u.name || u.email]));

    // PRD-22 (plan Э6): pages bound to a variant the test's design template no
    // longer declares. Audited for the whole page of the list at once — see the
    // service note on why this is not a per-test query.
    const unmappedPages = await countUnmappedPages(visibleTests, storage);

    const testsWithSections = await Promise.all(
      visibleTests.map(async (test) => {
        const sections = await storage.getTestSections(test.id);
        // PRD-15 block D: maxPoints sums EFFECTIVE prices for this test.
        const scoringCtx = buildTestScoringContext(
          test,
          sections,
          await storage.getTestQuestionScoring(test.id),
        );
        const sectionsWithDetails = await Promise.all(
          sections.map(async (s) => {
            const topic = topicMap.get(s.topicId);
            const questions = await storage.getQuestionsByTopic(s.topicId);
            return {
              ...s,
              topicName: topic?.name || "Unknown",
              maxQuestions: questions.length,
              maxPoints: questions.reduce((sum, q) => sum + scoringCtx.resolve(q).points, 0),
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
        // PRD-15 FR-12: publication state for the list badge ("опубликован,
        // есть неопубликованные изменения"). Cheap for drafts (early return).
        const publication = await getPublicationState(test.id);
        return {
          ...test,
          ownerName,
          sections: sectionsWithDetails,
          adaptiveSettings,
          publication,
          unmappedPageCount: unmappedPages.get(test.id) ?? 0,
        };
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
  // PRD-19 Block D: обзор (section-finish / test-finish). No backing variant kind
  // (runtime template layout, like blocked) — resolved straight from the template dir.
  review: "review.html",
  // PRD-19 D5 (FR-05a): computed итоги раздела (section-results). Runtime layout
  // (no backing variant kind) — resolved straight from the template dir.
  "section-results": "section-results.html",
  // PRD-12 FR-6: author content pages («До теста» / «После теста» / перед темой /
  // после темы) and the router hub, which renders through the same wrapper. Served
  // with the manifest's contentTemplates below, since the skeleton is built from
  // the placeholder declarations.
  content: "content.html",
  // PRD-1 §4.3: «Введение раздела» has its own layout rather than the generic wrapper.
  "section-intro": "section-intro.html",
  // PRD-4 §4.7 / PRD-12: the adaptive level-change interstitial. A pure system
  // layout (no variant kind), like `blocked` — the file-level fallback below covers
  // a template that does not ship it.
  transition: "system.transition.html",
};
// System variant kind backing each screen (for the default-fallback resolution).
// `blocked` is a pure system layout with no contentTemplate kind, so it has no
// variant-level fallback — the file-level fallback below covers it instead.
const SCREEN_KIND: Record<string, string | undefined> = {
  start: "start",
  question: "questions",
  review: "review",
  "section-results": "section-results",
  "section-intro": "intro",
};
// PRD-15 FR-09: object-level read scope (owner/grant/admin/assigned learner)
// instead of the bare session check.
router.get("/:id/screen-template/:screen", requireUserContext, requireTestScope("read"), async (req, res) => {
  try {
    let layoutFile = SCREEN_LAYOUTS[req.params.screen];
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
    // cssVars/branding resolve against the ACTIVE template's manifest even when the
    // layout dir fell back to `default` (a screen kind the active template doesn't own).
    const paramsDir = await resolveTemplateDir(templateId, { activeOnly: true });
    // PRD-1 §4.3: the start screen honours the author's chosen VARIANT
    // (start.image-right, …). The `start` content page's templateKey selects a
    // contentTemplate whose own `layoutFile` replaces the generic start.html —
    // parity with the SCORM runtime (`startPage.resolveStartLayout`) and the editor
    // preview. Only overridden when the variant actually ships its layout in `dir`.
    // PRD-22: the same page also OWNS the illustration (`settings.image` of a
    // variant like `start.image-right`), so its value is carried to the render
    // context below — the page's picture wins over the branding param.
    let startPageSettings: Record<string, unknown> | null = null;
    let startVariant: StartVariantDecl | null = null;
    if (req.params.screen === "start") {
      try {
        const startPage = (await storage.getContentPages(req.params.id)).find((p) => p.kind === "start");
        startPageSettings = (startPage?.settingsJson as Record<string, unknown>) ?? null;
        const startKey = startPage?.templateKey;
        if (startKey) {
          const ct = (
            readManifestContentTemplates(dir) as Array<{ key?: string; layoutFile?: string; settings?: unknown }>
          ).find((c) => c.key === startKey);
          startVariant = (ct as StartVariantDecl | undefined) ?? null;
          const rel = ct?.layoutFile;
          if (typeof rel === "string" && rel && readVariantLayouts(dir)[rel]) {
            layoutFile = rel.replace(/^layouts\//, "");
          }
        }
      } catch {
        /* keep the standard start.html on any lookup failure */
      }
    }
    let payload = readScreenTemplate(dir, layoutFile, test.designSettingsJson as any, paramsDir);
    // File-level fallback (PRD-1 §4.3.2, PRD-3 NFR-06): a template that simply does
    // not ship this layout still renders — from the standard template — instead of
    // 404-ing the learner's screen. This is the only fallback `blocked` gets (it has
    // no variant kind), and it also catches a declared-but-absent layout file.
    if (!payload) {
      const fallbackDir = await resolveTemplateDir("default", { activeOnly: false });
      if (path.resolve(fallbackDir) !== path.resolve(dir)) {
        payload = readScreenTemplate(fallbackDir, layoutFile, test.designSettingsJson as any, paramsDir);
      }
    }
    if (!payload) return res.status(404).json({ error: "Template not found" });
    // PRD-22 FR-36: a layout may point at the template's own files by a relative
    // path. In a SCORM package those files sit next to the page; on the web they
    // are served by the template-assets route, so the base is applied here —
    // otherwise every such image renders broken.
    const assetsBase = `/api/templates/${encodeURIComponent(templateId)}/assets/`;
    payload = { ...payload, layout: withTemplateAssetBase(payload.layout, assetsBase) };
    // PRD-22: the start illustration the author uploaded ON THE PAGE overrides the
    // test-wide branding param. Resolved through the SHARED rule the SCORM runtime
    // uses (`resolveStartImageUrl`), so both hosts show the same picture.
    if (req.params.screen === "start") {
      const startImageUrl = startImageForVariant(
        startVariant,
        startPageSettings,
        ((test.designSettingsJson as { params?: Record<string, unknown> } | null)?.params) ?? null,
      );
      // The illustration is REPLACED, not merged: a variant that does not own it
      // must not keep the one `readScreenTemplate` derived from the branding param.
      const { startImageUrl: _dropped, ...restDesign } = payload.design ?? {};
      payload = {
        ...payload,
        design: { ...restDesign, ...(startImageUrl ? { startImageUrl } : {}) },
      };
    }
    // PRD-12 FR-6: the content screen also carries the manifest's placeholder
    // declarations — the web host builds its page skeleton from them through the
    // shared assembler, exactly as the SCORM runtime does from the bundled copy.
    // Read from the ACTIVE template (paramsDir), not a fallen-back layout dir.
    if (req.params.screen === "content") {
      const contentTemplates = readManifestContentTemplates(paramsDir);
      const variantDir = contentTemplates.length ? paramsDir : dir;
      // PRD-12 FR-6 / PRD-22: a variant with its own `layoutFile` must render
      // through THAT layout on the web too. Serving only the generic wrapper made
      // every variant of the grid look alike in the web run.
      const variantLayouts = Object.fromEntries(
        Object.entries(readVariantLayouts(variantDir)).map(([rel, html]) => [
          rel,
          withTemplateAssetBase(html, assetsBase),
        ]),
      );
      res.json({
        ...payload,
        contentTemplates: contentTemplates.length ? contentTemplates : readManifestContentTemplates(dir),
        variantLayouts,
        // PRD-22 FR-36: base for relative links in author CONTENT (the layout is
        // already rewritten above). The stored value is host-independent
        // (`images/x.png`); the web host prefixes it with this route, the SCORM
        // runtime with the package's `template/`.
        assetsBase,
      });
      return;
    }
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
      allowReturnToUnanswered,
      allowAnswerChange,
      quickAdvance,
      showSectionResults,
      skipReviewWhenComplete,
      copyProtection,
      protectionWatermark,
      protectionHideOnBlur,
      questionOrder,
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
      reportSettingsJson,
      introJson,
      defaultQuestionPoints,
      folderId,
    } = parsed.data;

    // For standard mode, sections are required
    if (mode !== "adaptive" && (!sections || sections.length === 0)) {
      return res.status(400).json({ error: "Sections are required for standard tests" });
    }

    // PRD-15 block C (FR-22/E-13): sections/levels may only cite visible topics.
    const referencedTopics = [
      ...(sections ?? []).map((s) => s.topicId),
      ...((adaptiveSettings ?? []) as AdaptiveTopicPayload[]).map((a) => a.topicId),
    ];
    const invisible = await firstInvisibleTopic(
      req.effectiveRoles ?? [],
      req.currentUser?.id ?? "",
      referencedTopics,
    );
    if (invisible) {
      return res.status(403).json({
        error: "topic_forbidden",
        message: "Тест ссылается на недоступную тему",
        topicId: invisible,
      });
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
        allowReturnToUnanswered,
        allowAnswerChange,
        quickAdvance,
        showSectionResults,
        skipReviewWhenComplete,
        copyProtection,
        protectionWatermark,
        protectionHideOnBlur,
        questionOrder,
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
        reportSettingsJson: reportSettingsJson ?? null,
        introJson: introJson ?? null,
        defaultQuestionPoints: defaultQuestionPoints ?? null,
        folderId: folderId ?? null,
        // PRD-13: creator owns the test atomically in the INSERT (the post-insert
        // setTestOwner below is now a redundant safety net).
        ownerId: req.currentUser?.id ?? req.session.userId ?? null,
      },
      sections: (sections ?? []) as SectionPayload[],
      adaptiveSettings: mode === "adaptive"
        ? (adaptiveSettings as AdaptiveTopicPayload[] | undefined)
        : undefined,
    });

    // PRD-13: the creator becomes the test owner.
    await storage.setTestOwner(test.id, req.session.userId ?? null);

    // Медиатека: сбой индексации не должен стоить автору его правки (тот же довод, что и на
    // пути сохранения оформления). Индексируется именно блок обратной связи, а не вся строка
    // теста: оформление уже учтено под `test_design`, и двойной учёт дал бы две строки на файл.
    // Разделы индексируются ТЕМ ЖЕ вызовом (см. `testFeedbackUsageEntity`): у них нет своего
    // ключа в индексе, а раздельные вызовы затёрли бы строки друг друга. Разделы перечитываются
    // из хранилища — присланные payload'ы ещё не имеют идентификаторов и порядка вставки.
    try {
      await syncEntityUsages(
        "test_feedback",
        test.id,
        testFeedbackUsageEntity(feedbackJson ?? null, await storage.getTestSections(test.id)),
      );
    } catch (error) {
      logger.error(`Media usage sync failed for test feedback ${test.id}: ${(error as Error).message}`, "tests");
    }

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
      // Медиатека: a reset to defaults clears whatever media the previous
      // design held — same fail-soft contract as the branch below. Indexing
      // `null` (not the reloaded test row) keeps the walk scoped to design
      // content only, mirroring the delete convention used elsewhere.
      try {
        await syncEntityUsages("test_design", testId, null);
      } catch (error) {
        logger.error(`Media usage sync failed for test design ${testId}: ${(error as Error).message}`, "tests");
      }
      return res.json({ templateId: "default" });
    }

    const {
      templateId,
      templateVersion,
      templateApiVersion,
      params = {},
      theme,
      paramsByTheme = {},
      labels,
      resultsBlockOrder,
    } = body as {
      templateId?: string;
      templateVersion?: string;
      templateApiVersion?: string;
      params?: Record<string, unknown>;
      /** PRD-23: `light` | `dark` | `auto`; absent reads as `auto`. */
      theme?: unknown;
      /** PRD-23: colour overrides per declared theme. */
      paramsByTheme?: Record<string, Record<string, unknown>>;
      /** PRD-49: the test's own wording of the results-screen labels; validated below. */
      labels?: unknown;
      /** PRD-49: the author's order of the four results sub-blocks; validated below. */
      resultsBlockOrder?: unknown;
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

    // ── PRD-23: theme choice and per-theme colours ──────────────────────────
    // Rejected rather than dropped: a silently ignored field would let the editor
    // believe a palette was saved and repaint the learner's screen with the other
    // one. Every refusal names the field and the reason.
    if (theme !== undefined && !isTestTheme(theme)) {
      return res.status(422).json({
        error: `Unknown theme: ${String(theme)}. Expected one of: ${TEST_THEMES.join(", ")}`,
        field: "theme",
      });
    }
    const themed = supportsThemes(manifest);
    const themeIds = new Set<string>(declaredThemes(manifest).map((t) => t.id));
    const byTheme = paramsByTheme ?? {};
    if (!themed) {
      if (Object.keys(byTheme).length > 0) {
        return res.status(422).json({
          error: `Template "${templateId}" declares no themes; paramsByTheme is not applicable`,
          field: "paramsByTheme",
        });
      }
      if (theme !== undefined && theme !== "auto") {
        return res.status(422).json({
          error: `Template "${templateId}" declares no themes; only "auto" is applicable`,
          field: "theme",
        });
      }
    } else {
      const unknownThemes = Object.keys(byTheme).filter((t) => !themeIds.has(t as never));
      if (unknownThemes.length > 0) {
        return res.status(422).json({
          error: `Unknown themes: ${unknownThemes.join(", ")}`,
          field: "paramsByTheme",
          unknownThemes,
        });
      }
      // Only a colour splits per theme: a font or a logo paints the same in both,
      // and accepting one here would create a value nothing ever reads.
      const colorKeys = colorParamKeys(manifest.params as Array<{ key: string; type?: string }>);
      for (const [themeId, values] of Object.entries(byTheme)) {
        const bad = Object.keys((values ?? {}) as Record<string, unknown>).filter(
          (k) => !colorKeys.has(k),
        );
        if (bad.length > 0) {
          return res.status(422).json({
            error: `Params not settable per theme: ${bad.join(", ")}`,
            field: `paramsByTheme.${themeId}`,
            extraKeys: bad,
          });
        }
      }
    }

    // ── PRD-49: results labels and sub-block order ──────────────────────────
    // Rejected rather than dropped, for the same reason as theme/paramsByTheme above: a
    // silently ignored field would let the editor believe a wording change was saved.
    const labelsResult = designSettingsSchema.shape.labels.safeParse(labels);
    if (!labelsResult.success) {
      return res.status(422).json({ error: "Invalid labels", field: "labels" });
    }
    const resultsBlockOrderResult = designSettingsSchema.shape.resultsBlockOrder.safeParse(resultsBlockOrder);
    if (!resultsBlockOrderResult.success) {
      return res.status(422).json({ error: "Invalid resultsBlockOrder", field: "resultsBlockOrder" });
    }

    const designSettings: Record<string, unknown> = {
      templateId,
      templateVersion: templateVersion ?? template.version,
      templateApiVersion: templateApiVersion ?? template.templateApiVersion,
      params: params ?? {},
    };
    // Written only when they carry meaning, so a themeless test keeps the exact
    // JSON shape it had before PRD-23.
    if (themed) {
      designSettings.theme = theme ?? "auto";
      if (Object.keys(byTheme).length > 0) designSettings.paramsByTheme = byTheme;
    }
    // Same "only when meaningful" convention as theme/paramsByTheme: an empty
    // labels/order payload keeps the exact JSON shape a pre-PRD-49 test had.
    if (labelsResult.data && Object.keys(labelsResult.data).length > 0) {
      designSettings.labels = labelsResult.data;
    }
    if (resultsBlockOrderResult.data && resultsBlockOrderResult.data.length > 0) {
      designSettings.resultsBlockOrder = resultsBlockOrderResult.data;
    }

    await storage.updateTest(testId, { designSettingsJson: designSettings });

    // Медиатека: сбой индексации не должен стоить автору его правки. Недостающая
    // строка индекса безопасна (она отказывает в доступе, а не выдаёт лишнее) и
    // чинится пересборкой; потерянное сохранение оформления не чинится ничем.
    // Indexed value is `designSettings` (what was just saved into
    // `designSettingsJson`), not the whole test row — the test also carries
    // `test_feedback`-scoped media (feedbackJson) that must not be double-
    // counted under `test_design`.
    try {
      await syncEntityUsages("test_design", testId, designSettings);
    } catch (error) {
      logger.error(`Media usage sync failed for test design ${testId}: ${(error as Error).message}`, "tests");
    }

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
      allowReturnToUnanswered,
      allowAnswerChange,
      quickAdvance,
      showSectionResults,
      skipReviewWhenComplete,
      copyProtection,
      protectionWatermark,
      protectionHideOnBlur,
      questionOrder,
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
      reportSettingsJson,
      introJson,
      defaultQuestionPoints,
    } = parsed.data;

    const expectedVersion = typeof (req.body as { expectedVersion?: unknown })?.expectedVersion === "number"
      ? (req.body as { expectedVersion: number }).expectedVersion
      : undefined;

    // PRD-15 block C (FR-22/E-13): sections/levels may only cite visible topics.
    // FR-25 derived in-context read: topics already referenced by this test are
    // exempt, so a soft grant revoke does not block re-saving an existing test.
    const referencedTopics = [
      ...(mode === "standard" ? (sections ?? []).map((s) => s.topicId) : []),
      ...(mode === "adaptive"
        ? ((adaptiveSettings ?? []) as AdaptiveTopicPayload[]).map((a) => a.topicId)
        : []),
    ];
    const existingSections = await storage.getTestSections(req.params.id);
    const exempt = new Set(existingSections.map((s) => s.topicId));
    const invisible = await firstInvisibleTopic(
      req.effectiveRoles ?? [],
      req.currentUser?.id ?? "",
      referencedTopics,
      exempt,
    );
    if (invisible) {
      return res.status(403).json({
        error: "topic_forbidden",
        message: "Тест ссылается на недоступную тему",
        topicId: invisible,
      });
    }

    const test = await testSettingsService.save(req.params.id, {
      test: {
        title,
        description,
        overallPassRuleJson,
        webhookUrl: webhookUrl ?? undefined,
        showCorrectAnswers,
        allowReturnToUnanswered,
        allowAnswerChange,
        quickAdvance,
        showSectionResults,
        skipReviewWhenComplete,
        copyProtection,
        protectionWatermark,
        protectionHideOnBlur,
        questionOrder,
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
        reportSettingsJson: reportSettingsJson ?? undefined,
        introJson: introJson ?? undefined,
        defaultQuestionPoints,
      },
      // PRD-7 §6.3: sections live with the standard mode only. For adaptive,
      // sections come from the adaptive levels instead.
      sections: mode === "standard" ? (sections as SectionPayload[] | undefined) : undefined,
      adaptiveSettings: mode === "adaptive" ? (adaptiveSettings as AdaptiveTopicPayload[] | undefined) : undefined,
      expectedVersion,
    });

    // Медиатека: индексируется СОХРАНЁННОЕ значение (`test.feedbackJson` — строка, которую
    // вернул апдейт), а не присланное: тело запроса может вовсе не нести `feedbackJson`,
    // и служба сохранения тогда оставляет прежний блок нетронутым — по присланному
    // `undefined` индекс обнулился бы, хотя вложение в тесте осталось. Сбой индексации
    // не должен стоить автору его правки: недостающая строка безопасна (она отказывает
    // в доступе, а не выдаёт лишнее) и чинится пересборкой.
    //
    // Разделы (`test_sections.feedback_json`) едут ТЕМ ЖЕ вызовом и под тем же ключом теста
    // (см. `testFeedbackUsageEntity`); перечитываются ПОСЛЕ сохранения — служба пересоздаёт
    // строки разделов, поэтому `existingSections`, прочитанные до save, здесь уже неверны.
    try {
      await syncEntityUsages(
        "test_feedback",
        test.id,
        testFeedbackUsageEntity(test.feedbackJson ?? null, await storage.getTestSections(test.id)),
      );
    } catch (error) {
      logger.error(`Media usage sync failed for test feedback ${test.id}: ${(error as Error).message}`, "tests");
    }

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

    // PRD-15 FR-10: publishing (and re-publishing) freezes the test into a new
    // snapshot. Delivery of this test now reads from the snapshot; edits to the
    // bank do not affect it until the next publish. Draft/archive create none.
    if (status === "published") {
      await createTestSnapshot(req.params.id, req.currentUser?.id ?? null);
    }

    res.json(updated);
  } catch (error) {
    logger.error("PATCH status error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to update test status" });
  }
});

// POST /api/tests/:id/republish-force — экстренная переопубликация (PRD-15 FR-14).
// Freezes a new snapshot AND annuls in-progress attempts: they are deleted, so
// they do not count toward the retake limit (the learner may pass again). For
// incident response (leaked key, broken question), not the routine path —
// routine "Опубликовать изменения" is PATCH /status published (keeps attempts).
router.post("/:id/republish-force", requirePermission("tests.publish"), requireTestScope("edit"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (test.status !== "published") {
      return res.status(400).json({ error: "Test is not published", code: "not_published" });
    }

    // Publish-time feasibility still applies (E-12): do not freeze an unplayable test.
    const findings = await assessTestPublish(req.params.id);
    if (findings.length > 0) {
      return res.status(409).json({
        error: "publish_infeasible",
        message: "Выдача вопросов невыполнима при текущем составе тем",
        findings,
      });
    }

    const annulled = await storage.annulInProgressAttempts(req.params.id);
    await createTestSnapshot(req.params.id, req.currentUser?.id ?? null);
    logger.info(
      `Force republish: test ${req.params.id} by ${req.currentUser?.id ?? "?"}, annulled ${annulled} in-progress attempts`,
      "tests",
    );
    res.json({ ok: true, annulledAttempts: annulled });
  } catch (error) {
    logger.error("Force republish error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to force republish" });
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

    // deleteTest is now the single, atomic owner of test deletion (adaptive rows,
    // sections, assignments, grants, attempts and snapshots all go with it).
    await storage.deleteTest(req.params.id);

    // Медиатека: deleteTest does not cascade `media_usages` (no FK cascade by
    // design — see shared/schema.ts on `mediaUsages`), so the test's design
    // usage rows would otherwise dangle, pointing at a testId that no longer
    // exists. content_pages rows are removed by the DB cascade on delete, but
    // their `content_page`-scoped usage rows are equally orphaned — the full
    // re-sync (Задача 11) is what ultimately reconciles those; here we clear
    // only the entities this route owns directly. Besides `test_design` those are the
    // three feedback kinds keyed by the TEST id: the test's own feedback block, and the
    // scale/indicator sets, which are indexed set-wide under the test rather than per row
    // (spec §6.1) — their rows would outlive the test with no owner left to clear them.
    try {
      await syncEntityUsages("test_design", req.params.id, null);
      await syncEntityUsages("test_feedback", req.params.id, null);
      await syncEntityUsages("scale_feedback", req.params.id, null);
      await syncEntityUsages("variable_feedback", req.params.id, null);
    } catch (error) {
      logger.error(`Media usage sync failed for test ${req.params.id}: ${(error as Error).message}`, "tests");
    }

    res.status(204).end();
  } catch (error) {
    logger.error("Delete test error: " + (error as Error).message, "tests");
    res.status(500).json({ error: "Failed to delete test" });
  }
});

// GET /api/tests/:id/export/scorm - Экспорт SCORM
router.get("/:id/export/scorm", requirePermission("tests.export.scorm"), requireTestScope("edit"), async (req, res) => {
  try {
    // Assemble the deliverable via the shared builder (NFR-18: the debug player
    // builds the SAME data the same way). Export uses the snapshot-aware source
    // (published → active snapshot, draft → live).
    const data = await buildScormExportData(req.params.id, { source: "export" });
    const test = data.test;

    // Telemetry configuration (request-specific): an opt-in flag creates a
    // scorm_package record so the in-LMS package can post back telemetry.
    let telemetryConfig = null;
    const enableTelemetry = req.query.telemetry === "true";

    if (enableTelemetry) {
      const packageId = crypto.randomUUID();
      const secretKey = crypto.randomBytes(32).toString("hex");
      const apiBaseUrl = appBaseUrl();

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

    const buffer = await generateScormPackage({ ...data, telemetry: telemetryConfig });

    res.setHeader("Content-Type", "application/zip");
    const safeTitle = test.title.replace(/[^a-zA-Zа-яА-ЯёЁ0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "") || "scorm_export";
    const safeAscii = safeTitle.replace(/[^a-zA-Z0-9_]/g, "_") || "scorm_export";
    res.setHeader("Content-Disposition", `attachment; filename="${safeAscii}.zip"; filename*=UTF-8''${encodeURIComponent(safeTitle)}.zip`);
    res.setHeader("Content-Length", buffer.length);
    logger.info(`SCORM exported: test="${test.title}" (${test.id}) telemetry=${enableTelemetry} by user=${req.session.userId}`, "scorm-export");
    res.send(buffer);
  } catch (error) {
    if (error instanceof ScormBuildError) {
      return res
        .status(error.status)
        .json(error.field ? { error: error.message, field: error.field } : { error: error.message });
    }
    logger.error("SCORM export error: " + (error as Error).message, "scorm-export");
    res.status(500).json({ error: "Failed to export SCORM package" });
  }
});

// ─── PRD-15 block D: per-(test, question) scoring overrides (FR-30/FR-35) ─────

/** Override payload: each value is an independent link of the effective chain. */
const questionScoringBodySchema = z.object({
  points: z.number().int().min(0).nullable().optional(),
  scoringJson: questionScoringSchema.nullable().optional(),
  difficulty: z.number().int().min(0).max(100).nullable().optional(),
});

// GET /api/tests/:id/question-scoring — the test's override rows (the «Оценка»
// tab reads them fresh, outside the editor draft).
router.get(
  "/:id/question-scoring",
  requirePermission("tests.read"),
  requireTestScope("read"),
  async (req, res) => {
    try {
      const rows = await storage.getTestQuestionScoring(req.params.id);
      res.json(rows);
    } catch (error) {
      logger.error("Get question scoring error: " + (error as Error).message, "tests");
      res.status(500).json({ error: "Failed to fetch question scoring" });
    }
  },
);

// PUT /api/tests/:id/question-scoring/:questionId — upsert the override.
// Pins the question's CURRENT contentHash (FR-30): saving from the editor
// (including «Подтвердить актуальность», which re-sends the same values)
// re-pins a stale override. An all-empty body clears the override instead of
// storing a no-op row. Both writes bump the test version so a published test
// flips to «Опубликован, есть изменения» (FR-12).
router.put(
  "/:id/question-scoring/:questionId",
  requirePermission("tests.edit"),
  requireTestScope("edit"),
  async (req, res) => {
    try {
      const parsed = questionScoringBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Validation failed", fields: zodToFields(parsed.error) });
      }
      const { points, scoringJson, difficulty } = parsed.data;

      const question = await storage.getQuestion(req.params.questionId);
      if (!question) return res.status(404).json({ error: "Question not found" });

      // The override only makes sense for a question of the test's own topics.
      const sections = await storage.getTestSections(req.params.id);
      if (!sections.some((s) => s.topicId === question.topicId)) {
        return res.status(422).json({ error: "question_not_in_test", message: "Вопрос не входит в темы теста" });
      }

      if (points == null && scoringJson == null && difficulty == null) {
        await storage.deleteTestQuestionScoring(req.params.id, question.id);
        await storage.updateTest(req.params.id, {});
        return res.json({ cleared: true });
      }

      const row = await storage.upsertTestQuestionScoring(req.params.id, question.id, {
        points: points ?? null,
        scoringJson: scoringJson ?? null,
        difficulty: difficulty ?? null,
        pinnedContentHash: question.contentHash ?? null,
      });
      await storage.updateTest(req.params.id, {});
      res.json(row);
    } catch (error) {
      logger.error("Upsert question scoring error: " + (error as Error).message, "tests");
      res.status(500).json({ error: "Failed to save question scoring" });
    }
  },
);

// DELETE /api/tests/:id/question-scoring/:questionId — reset to the default
// chain («Сбросить настройку» in the row and in the override modal).
router.delete(
  "/:id/question-scoring/:questionId",
  requirePermission("tests.edit"),
  requireTestScope("edit"),
  async (req, res) => {
    try {
      const deleted = await storage.deleteTestQuestionScoring(req.params.id, req.params.questionId);
      if (!deleted) return res.status(404).json({ error: "Override not found" });
      await storage.updateTest(req.params.id, {});
      res.json({ success: true });
    } catch (error) {
      logger.error("Delete question scoring error: " + (error as Error).message, "tests");
      res.status(500).json({ error: "Failed to delete question scoring" });
    }
  },
);

// ─── PRD-13: per-test access management (administrators / superadmin only) ────

// GET /api/tests/:id/access — owner and access grants for the test.
router.get("/:id/access", requirePermission("tests.access.grant"), async (req, res) => {
  try {
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (!canGrantAccess(req.effectiveRoles ?? [], req.currentUser?.id ?? "", test)) {
      return res.status(403).json({ error: "Forbidden" });
    }
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
    if (!canGrantAccess(req.effectiveRoles ?? [], req.currentUser?.id ?? "", test)) {
      return res.status(403).json({ error: "Forbidden" });
    }
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
    const test = await storage.getTest(req.params.id);
    if (!test) return res.status(404).json({ error: "Test not found" });
    if (!canGrantAccess(req.effectiveRoles ?? [], req.currentUser?.id ?? "", test)) {
      return res.status(403).json({ error: "Forbidden" });
    }
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