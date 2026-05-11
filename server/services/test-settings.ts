/**
 * @module server/services/test-settings
 * @description Transactional service for creating and updating test settings
 * including sections and adaptive data in a single atomic operation.
 *
 * Implements version-conflict detection per PRD-7 §5.3 and §9.
 */
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  tests,
  testSections,
  adaptiveTopicSettings,
  adaptiveLevels,
  adaptiveLevelLinks,
} from "@shared/schema";
import type { Test } from "@shared/schema";

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

      return newTest;
    });
  }

  /**
   * Updates a test atomically. Performs an optimistic version check when
   * `payload.expectedVersion` is provided.
   */
  async save(testId: string, payload: SavePayload): Promise<Test> {
    return db.transaction(async (tx) => {
      if (payload.expectedVersion !== undefined) {
        const [current] = await tx
          .select({ version: tests.version })
          .from(tests)
          .where(eq(tests.id, testId));
        if (!current) {
          throw Object.assign(new Error("Test not found"), { status: 404 });
        }
        if (current.version !== payload.expectedVersion) {
          throw new VersionConflictError(current.version, payload.expectedVersion);
        }
      }

      const { status, published } = resolveStatus(payload.test);
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

      return updated;
    });
  }

  // ── private helpers ──────────────────────────────────────────────────────

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
