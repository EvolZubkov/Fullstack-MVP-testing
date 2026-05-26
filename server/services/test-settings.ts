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
import type { Test, TemplateManifest } from "@shared/schema";
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
    case "intro":   return "intro";
    case "summary": return "summary";
    case "router":
    case "questions":
    default:        return "info";
  }
}

/** Position value for a system row. The position column was designed for
 *  content-page placement before/after a topic; system kinds reuse it on a
 *  best-fit basis (intro → "before", summary → "after_topic",
 *  router/questions → "before_topic"). */
function positionForKind(kind: SystemKind): "before" | "before_topic" | "after_topic" {
  switch (kind) {
    case "intro":   return "before";
    case "summary": return "after_topic";
    case "router":
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
  topicPassRuleJson?: unknown;
  required?: boolean;
  timeLimitMinutes?: number | null;
  feedbackJson?: unknown;
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
  telemetryEnabled?: boolean;
  timeLimitMinutes?: number | null;
  maxAttempts?: number | null;
  showCorrectAnswers?: boolean;
  startPageContent?: string | null;
  mode?: "standard" | "adaptive";
  showDifficultyLevel?: boolean;
  designSettingsJson?: unknown;
  folderId?: string | null;
}

export interface CreatePayload {
  test: TestPayload;
  sections: SectionPayload[];
  adaptiveSettings?: AdaptiveTopicPayload[];
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
    return db.transaction(async (tx) => {
      const id = randomUUID();
      const { status, published } = resolveStatus(payload.test);

      const [newTest] = await tx.insert(tests).values({
        id,
        title: payload.test.title ?? "",
        description: payload.test.description ?? null,
        overallPassRuleJson: payload.test.overallPassRuleJson ?? { type: "percent", value: 70 },
        webhookUrl: payload.test.webhookUrl ?? null,
        status,
        published,
        telemetryEnabled: payload.test.telemetryEnabled ?? false,
        feedbackJson: payload.test.feedbackJson ?? null,
        flowPolicyJson: payload.test.flowPolicyJson ?? null,
        showCorrectAnswers: payload.test.showCorrectAnswers ?? false,
        timeLimitMinutes: payload.test.timeLimitMinutes ?? null,
        maxAttempts: payload.test.maxAttempts ?? null,
        startPageContent: payload.test.startPageContent ?? null,
        feedback: payload.test.feedback ?? null,
        mode: payload.test.mode ?? "standard",
        showDifficultyLevel: payload.test.showDifficultyLevel ?? true,
        designSettingsJson: (payload.test.designSettingsJson as Record<string, unknown>) ?? {},
        folderId: payload.test.folderId ?? null,
      }).returning();

      await this._insertSections(tx, id, payload.sections);

      if (payload.adaptiveSettings?.length) {
        await this._replaceAdaptiveSettings(tx, id, payload.adaptiveSettings);
      }

      await this._reconcileSystemPages(
        tx,
        id,
        extractFlowMode(payload.test.flowPolicyJson),
        payload.sections.map((s) => s.topicId),
        extractTemplateId(payload.test.designSettingsJson),
      );

      return newTest;
    });
  }

  /**
   * Updates a test atomically. Performs an optimistic version check when
   * `payload.expectedVersion` is provided.
   */
  async save(testId: string, payload: SavePayload): Promise<Test> {
    return db.transaction(async (tx) => {
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
        await this._reconcileSystemPages(
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
    const defaultTemplate = byId.get(DEFAULT_TEMPLATE_ID);
    if (!template || !defaultTemplate) return;

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

    for (const ins of plan.create) {
      await tx.insert(contentPages).values({
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
      });
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
    for (const s of sections) {
      await tx.insert(testSections).values({
        id: randomUUID(),
        testId,
        topicId: s.topicId,
        drawCount: s.drawCount,
        topicPassRuleJson: s.topicPassRuleJson ?? null,
        required: s.required ?? true,
        timeLimitMinutes: s.timeLimitMinutes ?? null,
        feedbackJson: s.feedbackJson ?? null,
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
