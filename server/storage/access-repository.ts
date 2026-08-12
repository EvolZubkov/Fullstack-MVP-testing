/**
 * @module server/storage/access-repository
 * @description Data access for the authorization layer (PRD-13 RBAC + PRD-15
 * ownership): user roles (`user_roles`), test ownership + access grants
 * (`tests.owner_id` + `test_access_grants`) and topic ownership/visibility +
 * access grants (`topics.owner_id`/`visibility` + `topic_access_grants`). This
 * repository owns the "who may do what" concern and therefore writes the
 * ownership columns of the `tests`/`topics` tables, while the content
 * repositories own their CRUD. Set-replacement mutations (`setUserRoles`) run in
 * a transaction. Exposed through the `IStorage` facade, never imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, and } from "drizzle-orm";
import { db } from "../db";
import {
  tests, topics, userRoles, testAccessGrants, topicAccessGrants,
  type TestAccessGrant, type InsertTestAccessGrant, type TopicAccessGrant,
} from "@shared/schema";
import type { StoredRole } from "@shared/access";

/** Repository for roles, test/topic ownership and access grants. */
export class AccessRepository {
  // ─── User roles (PRD-13 RBAC) ──────────────────────────────────────────────

  async getUserRoles(userId: string): Promise<StoredRole[]> {
    const rows = await db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId));
    return rows.map((r) => r.role);
  }

  async setUserRoles(userId: string, roles: StoredRole[], grantedBy: string | null = null): Promise<void> {
    // Replace the whole role set atomically (mirrors setUserGroups).
    await db.transaction(async (tx) => {
      await tx.delete(userRoles).where(eq(userRoles.userId, userId));
      const unique = Array.from(new Set(roles));
      if (unique.length > 0) {
        await tx.insert(userRoles).values(unique.map((role) => ({
          id: randomUUID(),
          userId,
          role,
          grantedBy,
          grantedAt: new Date(),
        })));
      }
    });
  }

  async addUserRole(userId: string, role: StoredRole, grantedBy: string | null = null): Promise<void> {
    await db.insert(userRoles).values({
      id: randomUUID(),
      userId,
      role,
      grantedBy,
      grantedAt: new Date(),
    }).onConflictDoNothing();
  }

  async removeUserRole(userId: string, role: StoredRole): Promise<void> {
    await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));
  }

  // ─── Test ownership + access grants (PRD-13 RBAC) ──────────────────────────

  async setTestOwner(testId: string, ownerId: string | null): Promise<void> {
    await db.update(tests).set({ ownerId }).where(eq(tests.id, testId));
  }

  async getTestIdsByOwner(ownerId: string): Promise<string[]> {
    const rows = await db.select({ id: tests.id }).from(tests).where(eq(tests.ownerId, ownerId));
    return rows.map((r) => r.id);
  }

  async getTestAccessGrants(testId: string): Promise<TestAccessGrant[]> {
    return db.select().from(testAccessGrants).where(eq(testAccessGrants.testId, testId));
  }

  async getUserTestGrants(userId: string): Promise<TestAccessGrant[]> {
    return db.select().from(testAccessGrants).where(eq(testAccessGrants.userId, userId));
  }

  async getTestGrantForUser(testId: string, userId: string): Promise<TestAccessGrant | undefined> {
    const [grant] = await db.select().from(testAccessGrants)
      .where(and(eq(testAccessGrants.testId, testId), eq(testAccessGrants.userId, userId)));
    return grant || undefined;
  }

  async upsertTestAccessGrant(grant: InsertTestAccessGrant): Promise<TestAccessGrant> {
    const [row] = await db.insert(testAccessGrants).values({
      id: randomUUID(),
      testId: grant.testId,
      userId: grant.userId,
      accessLevel: grant.accessLevel,
      grantedBy: grant.grantedBy ?? null,
      createdAt: new Date(),
    }).onConflictDoUpdate({
      target: [testAccessGrants.testId, testAccessGrants.userId],
      set: { accessLevel: grant.accessLevel, grantedBy: grant.grantedBy ?? null },
    }).returning();
    return row;
  }

  async removeTestAccessGrant(testId: string, userId: string): Promise<boolean> {
    const result = await db.delete(testAccessGrants)
      .where(and(eq(testAccessGrants.testId, testId), eq(testAccessGrants.userId, userId)));
    return (result.rowCount ?? 0) > 0;
  }

  // ─── Topic ownership/visibility + access grants (PRD-15 block C) ───────────

  async setTopicOwner(topicId: string, ownerId: string | null): Promise<void> {
    await db.update(topics).set({ ownerId }).where(eq(topics.id, topicId));
  }

  async setTopicVisibility(topicId: string, visibility: "private" | "shared"): Promise<void> {
    await db.update(topics).set({ visibility }).where(eq(topics.id, topicId));
  }

  async getTopicIdsByOwner(ownerId: string): Promise<string[]> {
    const rows = await db.select({ id: topics.id }).from(topics).where(eq(topics.ownerId, ownerId));
    return rows.map((r) => r.id);
  }

  async getSharedTopicIds(): Promise<string[]> {
    const rows = await db.select({ id: topics.id }).from(topics).where(eq(topics.visibility, "shared"));
    return rows.map((r) => r.id);
  }

  async getTopicGrants(topicId: string): Promise<TopicAccessGrant[]> {
    return db.select().from(topicAccessGrants).where(eq(topicAccessGrants.topicId, topicId));
  }

  /** Active grants addressed to a user (TD-01: user-only, no group resolution). */
  async getActiveTopicGrantsForGrantees(userId: string): Promise<TopicAccessGrant[]> {
    return db
      .select()
      .from(topicAccessGrants)
      .where(and(
        eq(topicAccessGrants.state, "active"),
        eq(topicAccessGrants.granteeId, userId),
      ));
  }

  async getTopicGrantForGrantee(
    topicId: string,
    granteeId: string,
  ): Promise<TopicAccessGrant | undefined> {
    const [row] = await db
      .select()
      .from(topicAccessGrants)
      .where(and(
        eq(topicAccessGrants.topicId, topicId),
        eq(topicAccessGrants.granteeId, granteeId),
      ));
    return row || undefined;
  }

  async upsertTopicGrant(grant: {
    topicId: string;
    granteeId: string;
    accessLevel: "use" | "manage";
    grantedBy: string | null;
  }): Promise<TopicAccessGrant> {
    const [row] = await db
      .insert(topicAccessGrants)
      .values({
        id: randomUUID(),
        topicId: grant.topicId,
        granteeId: grant.granteeId,
        accessLevel: grant.accessLevel,
        state: "active",
        grantedBy: grant.grantedBy,
      })
      .onConflictDoUpdate({
        target: [topicAccessGrants.topicId, topicAccessGrants.granteeId],
        set: { accessLevel: grant.accessLevel, state: "active", grantedBy: grant.grantedBy },
      })
      .returning();
    return row;
  }

  async setTopicGrantState(id: string, state: "active" | "revoked_in_use"): Promise<void> {
    await db.update(topicAccessGrants).set({ state }).where(eq(topicAccessGrants.id, id));
  }

  async removeTopicGrant(id: string): Promise<void> {
    await db.delete(topicAccessGrants).where(eq(topicAccessGrants.id, id));
  }
}
