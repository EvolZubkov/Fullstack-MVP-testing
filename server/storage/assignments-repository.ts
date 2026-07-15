/**
 * @module server/storage/assignments-repository
 * @description Data access for the test-assignment domain: assignments
 * (`test_assignments`, direct-to-user or to-group) and their magic-link access
 * tokens (`assignment_access_tokens`). Membership-aware reads
 * (`isTestAssignedToUser`, `getAssignedTestsForUser`) resolve the user's group
 * ids with a direct `user_groups` lookup (only the ids are needed, so no join to
 * `groups`), and `getAssignedTestsForUser` loads the resulting tests with a
 * direct `tests` read — foreign-table reads inlined here so the facade stays pure
 * delegation. Token revocation is a soft update (`revokedAt`), never a delete.
 * Exposed through the `IStorage` facade, never imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, and, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import {
  testAssignments, assignmentAccessTokens, userGroups, tests,
  type Test,
  type TestAssignment, type InsertTestAssignment,
  type AssignmentAccessToken,
} from "@shared/schema";

/** Repository for `test_assignments` and `assignment_access_tokens`. */
export class AssignmentsRepository {
  /** Ids of the groups a user belongs to (membership lookup, ids only). */
  private async getUserGroupIds(userId: string): Promise<string[]> {
    const rows = await db
      .select({ groupId: userGroups.groupId })
      .from(userGroups)
      .where(eq(userGroups.userId, userId));
    return rows.map((r) => r.groupId);
  }

  async getAssignment(id: string): Promise<TestAssignment | undefined> {
    const [a] = await db.select().from(testAssignments).where(eq(testAssignments.id, id));
    return a;
  }

  async getTestAssignments(testId: string): Promise<TestAssignment[]> {
    return db.select().from(testAssignments).where(eq(testAssignments.testId, testId));
  }

  async getUserAssignments(userId: string): Promise<TestAssignment[]> {
    return db.select().from(testAssignments).where(eq(testAssignments.userId, userId));
  }

  async getGroupAssignments(groupId: string): Promise<TestAssignment[]> {
    return db.select().from(testAssignments).where(eq(testAssignments.groupId, groupId));
  }

  async isTestAssignedToUser(testId: string, userId: string): Promise<boolean> {
    // Direct assignment first (cheapest), then via the user's groups.
    const [direct] = await db
      .select({ id: testAssignments.id })
      .from(testAssignments)
      .where(and(eq(testAssignments.testId, testId), eq(testAssignments.userId, userId)))
      .limit(1);
    if (direct) return true;
    const groupIds = await this.getUserGroupIds(userId);
    if (groupIds.length === 0) return false;
    const [viaGroup] = await db
      .select({ id: testAssignments.id })
      .from(testAssignments)
      .where(and(eq(testAssignments.testId, testId), inArray(testAssignments.groupId, groupIds)))
      .limit(1);
    return !!viaGroup;
  }

  async createTestAssignment(assignment: InsertTestAssignment & { assignedBy: string }): Promise<TestAssignment> {
    const id = randomUUID();
    const [created] = await db.insert(testAssignments).values({
      id,
      testId: assignment.testId,
      userId: assignment.userId || null,
      groupId: assignment.groupId || null,
      dueDate: assignment.dueDate || null,
      assignedAt: new Date(),
      assignedBy: assignment.assignedBy,
    }).returning();
    return created;
  }

  async deleteTestAssignment(id: string): Promise<boolean> {
    const result = await db.delete(testAssignments).where(eq(testAssignments.id, id));
    return (result.rowCount ?? 0) > 0;
  }

  async getAssignedTestsForUser(userId: string): Promise<Test[]> {
    const groupIds = await this.getUserGroupIds(userId);

    // Assignments made directly to the user.
    const directAssignments = await db
      .select({ testId: testAssignments.testId })
      .from(testAssignments)
      .where(eq(testAssignments.userId, userId));

    // Assignments made through groups.
    let groupAssignments: { testId: string }[] = [];
    if (groupIds.length > 0) {
      groupAssignments = await db
        .select({ testId: testAssignments.testId })
        .from(testAssignments)
        .where(inArray(testAssignments.groupId, groupIds));
    }

    // Collect unique testIds.
    const testIds = [...new Set([
      ...directAssignments.map((a) => a.testId),
      ...groupAssignments.map((a) => a.testId),
    ])];

    if (testIds.length === 0) return [];

    // Load the tests (direct foreign read; delivery does not need legacy status
    // normalization here — callers use these rows for the assigned-tests list).
    return db.select().from(tests).where(inArray(tests.id, testIds));
  }

  // ── Assignment Access Tokens (magic links) ──────────────────────────────────

  async createAssignmentAccessToken(data: { assignmentId: string; userId: string; testId: string; tokenHash: string; expiresAt: Date }): Promise<AssignmentAccessToken> {
    const [token] = await db.insert(assignmentAccessTokens).values({
      id: randomUUID(),
      assignmentId: data.assignmentId,
      userId: data.userId,
      testId: data.testId,
      tokenHash: data.tokenHash,
      expiresAt: data.expiresAt,
    }).returning();
    return token;
  }

  async getAssignmentAccessToken(tokenHash: string): Promise<AssignmentAccessToken | undefined> {
    const [token] = await db.select().from(assignmentAccessTokens)
      .where(eq(assignmentAccessTokens.tokenHash, tokenHash));
    return token;
  }

  async getAssignmentAccessTokensByAssignment(assignmentId: string): Promise<AssignmentAccessToken[]> {
    return db.select().from(assignmentAccessTokens)
      .where(eq(assignmentAccessTokens.assignmentId, assignmentId));
  }

  async revokeAssignmentAccessToken(id: string): Promise<void> {
    await db.update(assignmentAccessTokens)
      .set({ revokedAt: new Date() })
      .where(eq(assignmentAccessTokens.id, id));
  }

  async revokeAssignmentAccessTokensByAssignment(assignmentId: string): Promise<void> {
    await db.update(assignmentAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(assignmentAccessTokens.assignmentId, assignmentId),
        sql`${assignmentAccessTokens.revokedAt} IS NULL`,
      ));
  }

  async revokeAssignmentAccessTokensByAssignmentAndUser(assignmentId: string, userId: string): Promise<void> {
    await db.update(assignmentAccessTokens)
      .set({ revokedAt: new Date() })
      .where(and(
        eq(assignmentAccessTokens.assignmentId, assignmentId),
        eq(assignmentAccessTokens.userId, userId),
        sql`${assignmentAccessTokens.revokedAt} IS NULL`,
      ));
  }
}
