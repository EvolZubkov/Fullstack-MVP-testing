/**
 * @module server/storage/attempts-repository
 * @description Data access for the attempt domain (`attempts`): creation, lookup
 * by id/user/(user,test), the whitelisted progress/result update and two deletes.
 * `updateAttempt` accepts only the mutable progress/result fields — identity and
 * pinning columns (userId/testId/testVersion/snapshotId/startedAt) are fixed at
 * creation. `annulInProgressAttempts` drops unfinished attempts (PRD-15 FR-14):
 * they never counted toward the retake limit, so deleting them annuls without
 * consuming an attempt. Exposed through the `IStorage` facade, never imported by
 * routes.
 */
import { randomUUID } from "crypto";
import { eq, and, isNull } from "drizzle-orm";
import { db } from "../db";
import { attempts, type Attempt, type InsertAttempt } from "@shared/schema";
import { pickDefined } from "./shared";

/** Repository for the `attempts` table. */
export class AttemptsRepository {
  async createAttempt(attempt: InsertAttempt): Promise<Attempt> {
    const id = randomUUID();
    const [newAttempt] = await db.insert(attempts).values({
      id,
      userId: attempt.userId,
      testId: attempt.testId,
      testVersion: attempt.testVersion || 1,
      snapshotId: attempt.snapshotId ?? null,
      variantJson: attempt.variantJson,
      answersJson: attempt.answersJson || null,
      resultJson: attempt.resultJson || null,
      startedAt: new Date(attempt.startedAt),
      finishedAt: attempt.finishedAt ? new Date(attempt.finishedAt) : null,
    }).returning();
    return newAttempt;
  }

  async getAttempt(id: string): Promise<Attempt | undefined> {
    const [attempt] = await db.select().from(attempts).where(eq(attempts.id, id));
    return attempt || undefined;
  }

  async updateAttempt(id: string, updates: Partial<Attempt>): Promise<Attempt | undefined> {
    // Whitelist: only the mutable progress/result fields. userId/testId/
    // testVersion/snapshotId/startedAt are fixed at creation and must not move.
    const set = pickDefined(updates, [
      "variantJson", "answersJson", "resultJson", "finishedAt",
    ] as const);
    if (Object.keys(set).length === 0) return this.getAttempt(id);
    const [updated] = await db.update(attempts).set(set).where(eq(attempts.id, id)).returning();
    return updated || undefined;
  }

  async getAttemptsByUser(userId: string): Promise<Attempt[]> {
    return db.select().from(attempts).where(eq(attempts.userId, userId));
  }

  async getAttemptsByUserAndTest(userId: string, testId: string): Promise<Attempt[]> {
    return db.select().from(attempts).where(
      and(eq(attempts.userId, userId), eq(attempts.testId, testId))
    );
  }

  async deleteAttemptsByUserAndTest(userId: string, testId: string): Promise<void> {
    await db.delete(attempts).where(
      and(eq(attempts.userId, userId), eq(attempts.testId, testId))
    );
  }

  async annulInProgressAttempts(testId: string): Promise<number> {
    // In-progress = finishedAt IS NULL. These were never completed, so they do
    // not count toward the retake limit (PRD-6 counts completed only) — deleting
    // them annuls without consuming an attempt (PRD-15 FR-14).
    const result = await db
      .delete(attempts)
      .where(and(eq(attempts.testId, testId), isNull(attempts.finishedAt)));
    return result.rowCount ?? 0;
  }

  async getAllAttempts(): Promise<Attempt[]> {
    return db.select().from(attempts);
  }
}
