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
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "../db";
import { attempts, type Attempt, type InsertAttempt } from "@shared/schema";
import { pickDefined } from "./shared";

/** Repository for the `attempts` table. */
export class AttemptsRepository {
  /**
   * Question ids that already carry an answer in an attempt of this test.
   *
   * Used by the selective import to WARN before deleting a question: the answers live as
   * keys of `answers_json`, so the question is asked of the jsonb rather than of a join
   * table — there is none. Rows whose payload is not an object are skipped instead of
   * failing the query.
   */
  async getAnsweredQuestionIds(testId: string): Promise<string[]> {
    const rows = await db
      .select({ questionId: sql<string>`jsonb_object_keys(${attempts.answersJson})` })
      .from(attempts)
      .where(and(eq(attempts.testId, testId), sql`jsonb_typeof(${attempts.answersJson}) = 'object'`));
    return [...new Set(rows.map((row) => row.questionId))];
  }

  async createAttempt(attempt: InsertAttempt): Promise<Attempt> {
    const id = randomUUID();
    const [newAttempt] = await db.insert(attempts).values({
      id,
      userId: attempt.userId,
      testId: attempt.testId,
      testVersion: attempt.testVersion || 1,
      snapshotId: attempt.snapshotId ?? null,
      // PRD-31 (FR-12): the assignment the attempt was taken under. Omitting it here
      // left every row NULL while `getCurrentAssignmentId` returned a real id, so the
      // whole assignment scope silently collapsed: `inside` was always empty, which
      // means barrier B never fired, barrier A fired between EVERY attempt, and
      // `maxAttempts` — counted inside the assignment — never reached its limit.
      assignmentId: attempt.assignmentId ?? null,
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
      // `sectionTimerJson` is progress too: the server-owned remaining time of each
      // section (see services/section-timer), moved here off the learner's browser.
      "variantJson", "answersJson", "resultJson", "sectionTimerJson", "finishedAt",
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

  async annulInProgressAttempts(testId: string, userId?: string): Promise<number> {
    // In-progress = finishedAt IS NULL. These were never completed, so they do
    // not count toward the retake limit (PRD-6 counts completed only) — deleting
    // them annuls without consuming an attempt (PRD-15 FR-14).
    //
    // `userId` narrows the annulment to ONE learner: the start route drops the
    // learner's own abandoned run before opening the next one, so a test cannot
    // accumulate several unfinished attempts of the same person (the resume lookup
    // picks one of them arbitrarily). Omitted = the whole test, as republish does.
    const result = await db
      .delete(attempts)
      .where(and(
        eq(attempts.testId, testId),
        isNull(attempts.finishedAt),
        ...(userId ? [eq(attempts.userId, userId)] : []),
      ));
    return result.rowCount ?? 0;
  }

  async getAllAttempts(): Promise<Attempt[]> {
    return db.select().from(attempts);
  }
}
