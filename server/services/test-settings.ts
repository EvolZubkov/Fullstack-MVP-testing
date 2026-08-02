/**
 * @module server/services/test-settings
 * @description Transactional service for creating and updating test settings
 * including sections and adaptive data in a single atomic operation.
 *
 * Implements version-conflict detection per PRD-7 §5.3 and §9.
 */
import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  tests,
  testSections,
  adaptiveTopicSettings,
  adaptiveLevels,
  adaptiveLevelLinks,
  contentPages,
  templates,
} from "@shared/schema";
import type { Test, ContentPage, TemplateManifest, DrawBlueprint, FormSet } from "@shared/schema";
import {
  planSystemPages,
  SYSTEM_KINDS,
  type FlowMode,
  type SystemKind,
  type ExistingSystemPage,
} from "./content-pages-lifecycle";
import {
  findMissingRequiredFields,
  RequiredFieldsMissingError,
  type RequiredFieldsViolation,
} from "./required-fields-validator";
import {
  validateFlowPolicy,
  FlowPolicyValidationError,
} from "./flow-policy-validator";
import { syncEntityUsages } from "./media/usage-index";
import { logger } from "../logger";

const DEFAULT_TEMPLATE_ID = "default";

/** Extracts `flowMode` from `tests.flow_policy_json`, defaulting per FR-40. */
function extractFlowMode(flowPolicyJson: unknown): FlowMode {
  if (typeof flowPolicyJson === "object" && flowPolicyJson !== null) {
    const mode = (flowPolicyJson as { mode?: unknown }).mode;
    if (mode === "linear_by_topics" || mode === "router_by_topics") return mode;
  }
  return "linear_flat";
}

/** Extracts `templateId` from `tests.design_settings_json`, defaulting per NFR-01. */
function extractTemplateId(designSettingsJson: unknown): string {
  if (typeof designSettingsJson === "object" && designSettingsJson !== null) {
    const id = (designSettingsJson as { templateId?: unknown }).templateId;
    if (typeof id === "string" && id.length > 0) return id;
  }
  return DEFAULT_TEMPLATE_ID;
}

/** Legacy `type` value for a freshly-created system row. `questions`/`router`
 *  have no native legacy mapping — we pick `info` since the column will be
 *  dropped in a future release (PRD-7 §1.12). */
function legacyTypeForKind(kind: SystemKind): "intro" | "info" | "summary" | "html" {
  switch (kind) {
    case "intro":   return "intro"; // section «Введение раздела»
    case "section-results": // section «Итоги раздела» — results-shaped legacy type
    case "results": return "summary";
    case "start":   // start/router/questions/review have no native legacy type
    case "router":  // (column is deprecated, PRD-7 §1.12) — "info" is the neutral
    case "questions": // placeholder.
    case "review":
    default:        return "info";
  }
}

/** Position value for a system row. The position column was designed for
 *  content-page placement before/after a topic; system kinds reuse it on a
 *  best-fit basis (start/router → "before", results → "after",
 *  summary → "after_topic", intro/questions → "before_topic").
 *
 *  `router` is test-scope (topicId = null): it is the «До теста» navigation hub
 *  shown before the topics, so it MUST be "before" — the router runtime seeds the
 *  initial pageSequence from the test-scope "before" pages (PRD-4 v1.1 §4.7;
 *  contentFlow.rebuildPageSequence). Placing it at "before_topic" orphans the hub
 *  (no per-topic loop matches a null topicId), so the flow skips straight to the
 *  questions and the router page never renders. */
function positionForKind(kind: SystemKind): "before" | "after" | "before_topic" | "after_topic" {
  switch (kind) {
    case "start":   return "before"; // test landing — «До теста», before everything
    case "router":  return "before"; // router hub — test-scope «До теста», before the topics
    case "results": return "after";  // test final results — «После теста»
    // PRD-19 runtime nodes (обзор / итоги раздела): test-level singletons rendered
    // by their own runtime phase and EXCLUDED from the content-page flow by kind
    // (contentFlow.contentPagesFor), so the position is cosmetic — "after" keeps
    // them out of the per-topic before/after zones.
    case "review":
    case "section-results": return "after";
    case "intro":   // section «Введение раздела» — before the topic's questions
    case "questions":
    default:        return "before_topic";
  }
}

// ─── Error types ─────────────────────────────────────────────────────────────

/** Thrown by {@link TestSettingsService.save} when the provided expectedVersion
 *  does not match the current row version (optimistic concurrency check). */
export class VersionConflictError extends Error {
  readonly currentVersion: number;
  readonly expectedVersion: number;

  constructor(currentVersion: number, expectedVersion: number) {
    super("version_conflict");
    this.name = "VersionConflictError";
    this.currentVersion = currentVersion;
    this.expectedVersion = expectedVersion;
  }
}

// ─── Payload types ───────────────────────────────────────────────────────────

export interface SectionPayload {
  topicId: string;
  drawCount: number;
  /** Author's manual "draw the whole topic" flag (adaptive overrides effect). */
  drawAll?: boolean;
  topicPassRuleJson?: unknown;
  required?: boolean;
  timeLimitMinutes?: number | null;
  feedbackJson?: unknown;
  /** PRD-11: optional stratified-draw blueprint; null/absent = uniform draw. */
  drawBlueprintJson?: DrawBlueprint | null;
  /** PRD-17 (BR-12): optional fixed-variant set; null/absent = legacy draw. */
  formSetJson?: FormSet | null;
  /** PRD-15 block D (FR-31): per-section default price; null = inherit test. */
  defaultPoints?: number | null;
  /**
   * PRD-30 FR-02: delivery order of the topic's questions. `random` (the
   * default) shuffles as before; `fixed` orders by `questions.order_index`,
   * or by the variant's own list in variants mode (FR-07).
   */
  questionOrder?: "random" | "fixed";
}

export interface AdaptiveLevelPayload {
  levelIndex: number;
  levelName: string;
  minDifficulty: number;
  maxDifficulty: number;
  questionsCount: number;
  passThreshold: number;
  passThresholdType?: "percent" | "absolute";
  feedback?: string | null;
  links?: Array<{ title: string; url: string }>;
}

export interface AdaptiveTopicPayload {
  topicId: string;
  failureFeedback?: string | null;
  levels?: AdaptiveLevelPayload[];
}

export interface TestPayload {
  title?: string;
  description?: string | null;
  overallPassRuleJson?: unknown;
  webhookUrl?: string | null;
  /** PRD-7 §4.1: primary status field. */
  status?: "draft" | "published" | "archived";
  /** @deprecated Use `status` instead. Accepted for backward compat; synced from status on write. */
  published?: boolean;
  feedback?: string | null;
  feedbackJson?: unknown;
  flowPolicyJson?: unknown;
  retakePolicyJson?: unknown;
  /** PRD-27: выбранный вариант отчёта и значения его полей, по режиму теста. */
  reportSettingsJson?: unknown;
  telemetryEnabled?: boolean;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  showCorrectAnswers?: boolean;
  // PRD-19 (Блок A): правила навигации/завершения.
  allowReturnToUnanswered?: boolean;
  allowAnswerChange?: boolean;
  showSectionResults?: boolean;
  // PRD-34 (FR-01): настройки защиты от копирования.
  copyProtection?: boolean;
  protectionWatermark?: boolean;
  protectionHideOnBlur?: boolean;
  startPageContent?: string | null;
  mode?: "standard" | "adaptive";
  showDifficultyLevel?: boolean;
  designSettingsJson?: unknown;
  folderId?: string | null;
  /** PRD-15 block D (FR-31): test-wide default price; null = system default. */
  defaultQuestionPoints?: number | null;
  /**
   * PRD-13: test owner (= creator/importer). Written INSIDE the create INSERT so
   * ownership is atomic with the row — not a fragile post-insert `setTestOwner`
   * UPDATE that can be skipped (older deployment) or lost, which left imported
   * tests ownerless («Владелец» = «—»).
   */
  ownerId?: string | null;
}

export interface CreatePayload {
  test: TestPayload;
  sections: SectionPayload[];
  adaptiveSettings?: AdaptiveTopicPayload[];
}

/**
 * What {@link TestSettingsService._reconcileSystemPages} mutated inside its
 * transaction — carried out so the caller can sync the media usage index
 * AFTER commit (never inside the transaction: a rollback must not leave a
 * usage row for a page that was never actually written).
 */
interface PageReconcileResult {
  created: ContentPage[];
  deletedIds: string[];
}

export interface SavePayload {
  test: TestPayload;
  sections?: SectionPayload[];
  adaptiveSettings?: AdaptiveTopicPayload[];
  /** When provided, the current DB version must match. Throws {@link VersionConflictError} if not. */
  expectedVersion?: number;
}

// ─── Service ─────────────────────────────────────────────────────────────────

/** Resolves effective status from payload, syncing the legacy `published` flag. */
function resolveStatus(test: TestPayload): { status: "draft" | "published" | "archived"; published: boolean } {
  const status = test.status ?? (test.published ? "published" : "draft");
  return { status, published: status === "published" };
}

export class TestSettingsService {
  /**
   * Creates a test with its sections (and optionally adaptive settings) in one
   * atomic transaction.
   */
  async create(payload: CreatePayload): Promise<Test> {
    // PRD-4 v1.1 L3 server-side guard: reject invalid (mode × flowMode)
    // combinations + strict adaptive-section gating before DB write.
    const violations = validateFlowPolicy(
      payload.test,
      payload.sections,
      payload.adaptiveSettings,
    );
    if (violations.length > 0) {
      throw new FlowPolicyValidationError(violations);
    }
    let pageSync: PageReconcileResult = { created: [], deletedIds: [] };
    const newTest = await db.transaction(async (tx) => {
      const id = randomUUID();
      const { status, published } = resolveStatus(payload.test);

      const [newTest] = await tx.insert(tests).values({
        id,
        // PRD-13: own the test atomically in the INSERT (no fragile post-insert UPDATE).
        ownerId: payload.test.ownerId ?? null,
        title: payload.test.title ?? "",
        description: payload.test.description ?? null,
        overallPassRuleJson: payload.test.overallPassRuleJson ?? { type: "percent", value: 70 },
        webhookUrl: payload.test.webhookUrl ?? null,
        status,
        published,
        telemetryEnabled: payload.test.telemetryEnabled ?? false,
        feedbackJson: payload.test.feedbackJson ?? null,
        flowPolicyJson: payload.test.flowPolicyJson ?? null,
        retakePolicyJson: (payload.test.retakePolicyJson as never) ?? null,
        reportSettingsJson: (payload.test.reportSettingsJson as never) ?? null,
        showCorrectAnswers: payload.test.showCorrectAnswers ?? false,
        // PRD-19 (Блок A): новый тест — возврат ВКЛ по умолчанию (FR-01).
        allowReturnToUnanswered: payload.test.allowReturnToUnanswered ?? true,
        allowAnswerChange: payload.test.allowAnswerChange ?? false,
        showSectionResults: payload.test.showSectionResults ?? true,
        // PRD-34 (FR-03): новый тест — защита ВКЛ по умолчанию.
        copyProtection: payload.test.copyProtection ?? true,
        protectionWatermark: payload.test.protectionWatermark ?? false,
        protectionHideOnBlur: payload.test.protectionHideOnBlur ?? false,
        timeLimitMinutes: payload.test.timeLimitMinutes ?? null,
        maxAttempts: payload.test.maxAttempts ?? null,
        startPageContent: payload.test.startPageContent ?? null,
        feedback: payload.test.feedback ?? null,
        mode: payload.test.mode ?? "standard",
        showDifficultyLevel: payload.test.showDifficultyLevel ?? true,
        designSettingsJson: (payload.test.designSettingsJson as Record<string, unknown>) ?? {},
        folderId: payload.test.folderId ?? null,
        defaultQuestionPoints: payload.test.defaultQuestionPoints ?? null,
      }).returning();

      await this._insertSections(tx, id, payload.sections);

      if (payload.adaptiveSettings?.length) {
        await this._replaceAdaptiveSettings(tx, id, payload.adaptiveSettings);
      }

      pageSync = await this._reconcileSystemPages(
        tx,
        id,
        extractFlowMode(payload.test.flowPolicyJson),
        payload.sections.map((s) => s.topicId),
        extractTemplateId(payload.test.designSettingsJson),
      );

      return newTest;
    });

    // Медиатека: индексируется ПОСЛЕ commit — строки, которые реконсиляция
    // реально создала/удалила внутри транзакции. Сбой не должен ронять
    // сохранение теста; недостающая строка индекса чинится пересборкой.
    await this._syncPageUsages(pageSync);

    return newTest;
  }

  /**
   * Updates a test atomically. Performs an optimistic version check when
   * `payload.expectedVersion` is provided.
   */
  async save(testId: string, payload: SavePayload): Promise<Test> {
    // PRD-4 v1.1 L3 server-side guard: reject invalid (mode × flowMode)
    // combinations + strict adaptive-section gating before DB write. Skips
    // when neither sections nor adaptive settings are provided (the partial
    // patch can't possibly violate strict gating without also touching
    // adaptive config).
    if (payload.sections || payload.adaptiveSettings || payload.test.mode || payload.test.flowPolicyJson) {
      const violations = validateFlowPolicy(
        payload.test,
        payload.sections,
        payload.adaptiveSettings,
      );
      if (violations.length > 0) {
        throw new FlowPolicyValidationError(violations);
      }
    }
    let pageSync: PageReconcileResult = { created: [], deletedIds: [] };
    const updatedTest = await db.transaction(async (tx) => {
      const { status, published } = resolveStatus(payload.test);

      // Read the pre-update row when needed: the optimistic-concurrency check
      // (expectedVersion) and the publish-transition gate below both depend on
      // state captured before the row is mutated.
      let current:
        | { version: number; status: string | null; published: boolean | null }
        | undefined;
      if (payload.expectedVersion !== undefined || status === "published") {
        [current] = await tx
          .select({
            version: tests.version,
            status: tests.status,
            published: tests.published,
          })
          .from(tests)
          .where(eq(tests.id, testId));
      }

      if (payload.expectedVersion !== undefined) {
        if (!current) {
          throw Object.assign(new Error("Test not found"), { status: 404 });
        }
        if (current.version !== payload.expectedVersion) {
          throw new VersionConflictError(current.version, payload.expectedVersion);
        }
      }

      const patch: Record<string, unknown> = { ...payload.test, status, published };

      const [updated] = await tx
        .update(tests)
        .set({ ...(patch as object), version: sql`${tests.version} + 1`, updatedAt: new Date() })
        .where(eq(tests.id, testId))
        .returning();

      if (!updated) {
        throw Object.assign(new Error("Test not found"), { status: 404 });
      }

      if (payload.sections !== undefined) {
        await tx.delete(testSections).where(eq(testSections.testId, testId));
        await this._insertSections(tx, testId, payload.sections);
      }

      if (payload.adaptiveSettings !== undefined) {
        await this._replaceAdaptiveSettings(tx, testId, payload.adaptiveSettings);
      }

      // System content_pages reconciliation triggers when any of these change:
      //   - sections list (topic add/remove drives per-topic questions rows)
      //   - flowPolicyJson (flowMode change rebuilds router + questions layout)
      //   - designSettingsJson (templateId change rebinds variants by kind)
      const needsReconcile =
        payload.sections !== undefined ||
        payload.test.flowPolicyJson !== undefined ||
        payload.test.designSettingsJson !== undefined;

      if (needsReconcile) {
        const sectionRows = payload.sections
          ?? (await tx
            .select({ topicId: testSections.topicId })
            .from(testSections)
            .where(eq(testSections.testId, testId)));
        pageSync = await this._reconcileSystemPages(
          tx,
          testId,
          extractFlowMode(payload.test.flowPolicyJson ?? updated.flowPolicyJson),
          sectionRows.map((s) => s.topicId),
          extractTemplateId(payload.test.designSettingsJson ?? updated.designSettingsJson),
        );
      }

      // Required-fields validation runs ONLY on an actual transition into
      // `published` (draft/archived -> published). Re-saving an already
      // published test must stay possible: otherwise a test left published in
      // an incomplete state (e.g. without a template) could never be edited or
      // fixed, because every save would re-trip the gate and roll back. Draft
      // saves likewise allow incomplete state mid-edit. The hard rule
      // (PRD-1 §4.3.6) applies at the publish boundary; the in-editor save
      // button is gated by frontend indicators.
      const prevStatus = current?.status ?? (current?.published ? "published" : "draft");
      if (prevStatus !== "published" && status === "published") {
        await this._validateAllRequiredFields(
          tx,
          testId,
          extractTemplateId(payload.test.designSettingsJson ?? updated.designSettingsJson),
        );
      }

      return updated;
    });

    // Медиатека: индексируется ПОСЛЕ commit — см. комментарий в create().
    await this._syncPageUsages(pageSync);

    return updatedTest;
  }

  /**
   * Idempotent reconcile for an existing test, driven by the test's current
   * persisted state (no payload). Used on editor open to heal databases where
   * system rows were never materialized — e.g. seed data inserted out-of-band,
   * or a `router_by_topics` test created before the default template declared
   * a `kind: router` variant (G48 2026-05-28).
   *
   * Returns the count of mutations applied so callers can log a warning when
   * non-zero. No-op when the test does not exist or its manifests cannot be
   * loaded.
   */
  async reconcileExisting(testId: string): Promise<{ deleted: number; created: number }> {
    let pageSync: PageReconcileResult = { created: [], deletedIds: [] };
    const result = await db.transaction(async (tx) => {
      const [row] = await tx
        .select({
          id: tests.id,
          flowPolicyJson: tests.flowPolicyJson,
          designSettingsJson: tests.designSettingsJson,
        })
        .from(tests)
        .where(eq(tests.id, testId));
      if (!row) return { deleted: 0, created: 0 };

      const sectionRows = await tx
        .select({ topicId: testSections.topicId })
        .from(testSections)
        .where(eq(testSections.testId, testId));

      const before = await tx
        .select({ id: contentPages.id })
        .from(contentPages)
        .where(eq(contentPages.testId, testId));
      const beforeIds = new Set(before.map((r) => r.id));

      pageSync = await this._reconcileSystemPages(
        tx,
        testId,
        extractFlowMode(row.flowPolicyJson),
        sectionRows.map((s) => s.topicId),
        extractTemplateId(row.designSettingsJson),
      );

      const after = await tx
        .select({ id: contentPages.id })
        .from(contentPages)
        .where(eq(contentPages.testId, testId));
      const afterIds = new Set(after.map((r) => r.id));

      let deleted = 0;
      let created = 0;
      for (const id of beforeIds) if (!afterIds.has(id)) deleted += 1;
      for (const id of afterIds) if (!beforeIds.has(id)) created += 1;
      return { deleted, created };
    });

    // Медиатека: индексируется ПОСЛЕ commit — см. комментарий в create().
    await this._syncPageUsages(pageSync);

    return result;
  }

  // ── private helpers ──────────────────────────────────────────────────────

  /**
   * Reconciles system `content_pages` rows for a test against the desired
   * (flowMode, topics, templateId) tuple. Implements PRD-1 §4.3.5 lifecycle
   * via the pure {@link planSystemPages} planner: deletes obsolete system
   * rows and creates missing ones inside the active transaction. User `info`
   * pages are untouched (FR-40).
   *
   * Silently no-ops when the test's template or the built-in `default`
   * template cannot be loaded — the planner needs both manifests to compute
   * variant bindings, and a missing template usually means the test was
   * created in an unsupported state that a higher layer should surface.
   */
  private async _reconcileSystemPages(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    testId: string,
    flowMode: FlowMode,
    topicIds: string[],
    templateId: string,
  ): Promise<PageReconcileResult> {
    const noop: PageReconcileResult = { created: [], deletedIds: [] };
    const wantedIds = templateId === DEFAULT_TEMPLATE_ID
      ? [DEFAULT_TEMPLATE_ID]
      : [templateId, DEFAULT_TEMPLATE_ID];

    const manifestRows = await tx
      .select({ id: templates.id, manifest: templates.manifest })
      .from(templates)
      .where(inArray(templates.id, wantedIds));

    const byId = new Map(manifestRows.map((r) => [r.id, r.manifest as TemplateManifest]));
    const template = byId.get(templateId) ?? byId.get(DEFAULT_TEMPLATE_ID);
    const defaultTemplate = byId.get(DEFAULT_TEMPLATE_ID);
    if (!template || !defaultTemplate) return noop;

    const allRows = await tx
      .select({
        id: contentPages.id,
        kind: contentPages.kind,
        topicId: contentPages.topicId,
        templateKey: contentPages.templateKey,
        valuesJson: contentPages.valuesJson,
      })
      .from(contentPages)
      .where(eq(contentPages.testId, testId));

    const systemKindSet = new Set<string>(SYSTEM_KINDS);
    const existing: ExistingSystemPage[] = allRows
      .filter((r) => systemKindSet.has(r.kind))
      .map((r) => ({
        id: r.id,
        kind: r.kind as SystemKind,
        topicId: r.topicId,
        templateKey: r.templateKey,
        valuesJson: (r.valuesJson ?? {}) as Record<string, unknown>,
      }));

    const plan = planSystemPages(existing, {
      flowMode,
      topicIds,
      template,
      defaultTemplate,
    });

    for (const del of plan.delete) {
      await tx.delete(contentPages).where(eq(contentPages.id, del.id));
    }

    // Медиатека: rows created/deleted here move content (including media
    // references) between pages (spec — system-page reconciliation transfers
    // `valuesJson` on flowMode/template changes). Both lists are handed back
    // to the caller, which syncs `media_usages` AFTER the transaction commits
    // — a row for a page that got rolled back must never exist, and a deleted
    // page's row must never linger (it would hold files hostage via a false
    // 409 on delete).
    const created: ContentPage[] = [];
    for (const ins of plan.create) {
      const [row] = await tx.insert(contentPages).values({
        id: randomUUID(),
        testId,
        topicId: ins.topicId,
        position: positionForKind(ins.kind),
        mode: "template",
        type: legacyTypeForKind(ins.kind),
        kind: ins.kind,
        templateKey: ins.templateKey,
        sortOrder: 0,
        valuesJson: ins.valuesJson,
        autoAdvance: false,
        autoAdvanceDelayMs: null,
      }).returning();
      created.push(row);
    }

    return { created, deletedIds: plan.delete.map((d) => d.id) };
  }

  /**
   * Applies the media usage sync for a {@link PageReconcileResult}, AFTER the
   * owning transaction has committed. Errors are logged, never thrown — a
   * failed sync must not undo (or retroactively fail) a test save that already
   * committed; the missing/stale row is safe (it only ever narrows access) and
   * is healed by the full reindex.
   */
  private async _syncPageUsages(result: PageReconcileResult): Promise<void> {
    for (const page of result.created) {
      try {
        await syncEntityUsages("content_page", page.id, page);
      } catch (error) {
        logger.error(`Media usage sync failed for content page ${page.id}: ${(error as Error).message}`);
      }
    }
    for (const id of result.deletedIds) {
      try {
        await syncEntityUsages("content_page", id, null);
      } catch (error) {
        logger.error(`Media usage sync failed for content page ${id}: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Loads every content_pages row of the test plus the active template's
   * manifest, then checks each row against its variant's `required: true`
   * placeholders. Throws {@link RequiredFieldsMissingError} on violations
   * so the transaction rolls back and the route layer can surface a 422.
   *
   * Silently no-ops when the template manifest cannot be loaded — same
   * fail-soft behaviour as {@link _reconcileSystemPages}.
   */
  private async _validateAllRequiredFields(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    testId: string,
    templateId: string,
  ): Promise<void> {
    const wantedIds = templateId === DEFAULT_TEMPLATE_ID
      ? [DEFAULT_TEMPLATE_ID]
      : [templateId, DEFAULT_TEMPLATE_ID];

    const manifestRows = await tx
      .select({ id: templates.id, manifest: templates.manifest })
      .from(templates)
      .where(inArray(templates.id, wantedIds));

    const byId = new Map(manifestRows.map((r) => [r.id, r.manifest as TemplateManifest]));
    const template = byId.get(templateId) ?? byId.get(DEFAULT_TEMPLATE_ID);
    if (!template) return;

    const variants = (template.contentTemplates ?? []) as Array<{
      key: string;
      placeholders?: Array<{ key: string; required?: boolean }>;
    }>;
    const variantByKey = new Map(variants.map((v) => [v.key, v]));

    const rows = await tx
      .select({
        id: contentPages.id,
        templateKey: contentPages.templateKey,
        valuesJson: contentPages.valuesJson,
      })
      .from(contentPages)
      .where(eq(contentPages.testId, testId));

    const violations: RequiredFieldsViolation[] = [];
    for (const row of rows) {
      if (!row.templateKey) continue;
      const variant = variantByKey.get(row.templateKey);
      if (!variant?.placeholders?.length) continue;

      const values = ((row.valuesJson ?? {}) as { values?: Record<string, unknown> }).values;
      const missing = findMissingRequiredFields(variant.placeholders, values);
      if (missing.length > 0) {
        violations.push({
          pageId: row.id,
          templateKey: row.templateKey,
          missingFields: missing,
        });
      }
    }

    if (violations.length > 0) {
      throw new RequiredFieldsMissingError(violations);
    }
  }

  private async _insertSections(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    testId: string,
    sections: SectionPayload[],
  ): Promise<void> {
    // The array index becomes the section's sortOrder, so author-controlled
    // topic order in the editor (PRD-7 G47 drag-reorder) round-trips through
    // getTestSections() ORDER BY sort_order.
    for (let i = 0; i < sections.length; i += 1) {
      const s = sections[i];
      await tx.insert(testSections).values({
        id: randomUUID(),
        testId,
        topicId: s.topicId,
        drawCount: s.drawCount,
        drawAll: s.drawAll ?? false,
        topicPassRuleJson: s.topicPassRuleJson ?? null,
        required: s.required ?? true,
        timeLimitMinutes: s.timeLimitMinutes ?? null,
        feedbackJson: s.feedbackJson ?? null,
        drawBlueprintJson: s.drawBlueprintJson ?? null,
        formSetJson: s.formSetJson ?? null,
        defaultPoints: s.defaultPoints ?? null,
        questionOrder: s.questionOrder ?? "random",
        sortOrder: i,
      });
    }
  }

  private async _replaceAdaptiveSettings(
    tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
    testId: string,
    adaptiveTopics: AdaptiveTopicPayload[],
  ): Promise<void> {
    // Delete old rows bottom-up to respect FK order.
    const existingLevels = await tx
      .select({ id: adaptiveLevels.id })
      .from(adaptiveLevels)
      .where(eq(adaptiveLevels.testId, testId));
    for (const { id } of existingLevels) {
      await tx.delete(adaptiveLevelLinks).where(eq(adaptiveLevelLinks.levelId, id));
    }
    await tx.delete(adaptiveLevels).where(eq(adaptiveLevels.testId, testId));
    await tx.delete(adaptiveTopicSettings).where(eq(adaptiveTopicSettings.testId, testId));

    for (const ts of adaptiveTopics) {
      await tx.insert(adaptiveTopicSettings).values({
        id: randomUUID(),
        testId,
        topicId: ts.topicId,
        failureFeedback: ts.failureFeedback ?? null,
      });

      for (const level of ts.levels ?? []) {
        const levelId = randomUUID();
        await tx.insert(adaptiveLevels).values({
          id: levelId,
          testId,
          topicId: ts.topicId,
          levelIndex: level.levelIndex,
          levelName: level.levelName,
          minDifficulty: level.minDifficulty,
          maxDifficulty: level.maxDifficulty,
          questionsCount: level.questionsCount,
          passThreshold: level.passThreshold,
          passThresholdType: level.passThresholdType ?? "percent",
          feedback: level.feedback ?? null,
        });

        for (const link of level.links ?? []) {
          await tx.insert(adaptiveLevelLinks).values({
            id: randomUUID(),
            levelId,
            title: link.title,
            url: link.url,
          });
        }
      }
    }
  }
}

export const testSettingsService = new TestSettingsService();
