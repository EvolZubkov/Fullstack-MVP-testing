/**
 * @module server/storage/groups-repository
 * @description Data access for the group domain: groups and user membership
 * (`groups` + `user_groups`). Membership mutations that touch several rows
 * (`deleteGroup`, `setUserGroups`) run inside a transaction so a partial write
 * cannot leave inconsistent state. `getGroupUsers` decrypts member emails on
 * read. Exposed through the `IStorage` facade, never imported by routes.
 */
import { randomUUID } from "crypto";
import { eq, and, desc } from "drizzle-orm";
import { db } from "../db";
import {
  groups, userGroups, users,
  type Group, type InsertGroup, type User, type UserGroup,
} from "@shared/schema";
import { decryptEmail } from "../utils/crypto";
import { pickDefined } from "./shared";

/** Repository for `groups` and the `user_groups` membership table. */
export class GroupsRepository {
  async getGroups(): Promise<Group[]> {
    return db.select().from(groups).orderBy(desc(groups.createdAt));
  }

  async getGroup(id: string): Promise<Group | undefined> {
    const [group] = await db.select().from(groups).where(eq(groups.id, id));
    return group || undefined;
  }

  async createGroup(group: InsertGroup & { createdBy?: string }): Promise<Group> {
    const id = randomUUID();
    const [created] = await db.insert(groups).values({
      id,
      name: group.name,
      description: group.description || null,
      createdAt: new Date(),
      createdBy: group.createdBy || null,
    }).returning();
    return created;
  }

  async updateGroup(id: string, data: Partial<Group>): Promise<Group | undefined> {
    // Whitelist: id/createdAt/createdBy are not writable through updateGroup.
    const set = pickDefined(data, ["name", "description"] as const);
    if (Object.keys(set).length === 0) return this.getGroup(id);
    const [updated] = await db.update(groups).set(set).where(eq(groups.id, id)).returning();
    return updated || undefined;
  }

  async deleteGroup(id: string): Promise<boolean> {
    // Drop the user memberships and the group itself as one unit. Uses
    // returning().length (the dominant idiom here) rather than rowCount so the
    // result is portable across drivers.
    return db.transaction(async (tx) => {
      await tx.delete(userGroups).where(eq(userGroups.groupId, id));
      const result = await tx.delete(groups).where(eq(groups.id, id)).returning();
      return result.length > 0;
    });
  }

  async getUserGroups(userId: string): Promise<Group[]> {
    const result = await db
      .select({ group: groups })
      .from(userGroups)
      .innerJoin(groups, eq(userGroups.groupId, groups.id))
      .where(eq(userGroups.userId, userId));
    return result.map(r => r.group);
  }

  async getGroupUsers(groupId: string): Promise<User[]> {
    const result = await db
      .select({ user: users })
      .from(userGroups)
      .innerJoin(users, eq(userGroups.userId, users.id))
      .where(eq(userGroups.groupId, groupId));
    return Promise.all(result.map(async r => ({ ...r.user, email: await decryptEmail(r.user.email) })));
  }

  async addUserToGroup(userId: string, groupId: string): Promise<UserGroup> {
    const id = randomUUID();
    const [created] = await db.insert(userGroups).values({
      id,
      userId,
      groupId,
      addedAt: new Date(),
    }).returning();
    return created;
  }

  async removeUserFromGroup(userId: string, groupId: string): Promise<boolean> {
    const result = await db.delete(userGroups)
      .where(and(eq(userGroups.userId, userId), eq(userGroups.groupId, groupId)));
    return (result.rowCount ?? 0) > 0;
  }

  async setUserGroups(userId: string, groupIds: string[]): Promise<void> {
    // Replace the whole membership set atomically — a failed insert must not
    // leave the user with zero groups.
    await db.transaction(async (tx) => {
      await tx.delete(userGroups).where(eq(userGroups.userId, userId));
      if (groupIds.length > 0) {
        const values = groupIds.map((groupId) => ({
          id: randomUUID(),
          userId,
          groupId,
          addedAt: new Date(),
        }));
        await tx.insert(userGroups).values(values);
      }
    });
  }
}
