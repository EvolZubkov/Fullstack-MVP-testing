/**
 * @module server/services/topic-access
 *
 * Object-level access resolution for topics (PRD-15 block C, role-model.md
 * §6.5-6.8). The role -> permission map decides whether an action is allowed in
 * principle; these helpers decide whether it applies to a SPECIFIC topic by
 * owner, grant and visibility:
 *
 * - `visibleTopic`        — may see the topic and its questions, and use it in a
 *   test (owner, active `use`/`manage` grant, shared visibility, or admin);
 * - `canManageTopicContent` — may CRUD the topic's questions and edit the topic
 *   (owner, active `manage` grant, or admin);
 * - `canDeleteTopic`      — owner or admin only;
 * - `canGrantTopicAccess` / `canChangeTopicOwner` — owner-on-own / admin-on-any.
 *
 * Questions inherit their topic's visibility (no per-question grants). The
 * delivery path (attempts, SCORM) NEVER calls these — a learner takes a test by
 * assignment, so losing topic access must not break published tests (FR-24).
 */

import { ROLES, type Role } from "@shared/access";
import { storage } from "../storage";
import type { Topic } from "@shared/schema";

/** Minimal topic shape needed for resolution. */
type TopicRef = Pick<Topic, "id" | "ownerId" | "visibility">;

function hasRole(roles: readonly Role[], role: Role): boolean {
  return roles.includes(role);
}

export function isAdminOrSuper(roles: readonly Role[]): boolean {
  return hasRole(roles, ROLES.SUPERADMIN) || hasRole(roles, ROLES.ADMINISTRATOR);
}

/** A user's group ids — needed to resolve group-addressed grants. */
async function groupIdsOf(userId: string): Promise<string[]> {
  const groups = await storage.getUserGroups(userId);
  return groups.map((g) => g.id);
}

/** The highest active grant level a user holds on a topic (direct or via group). */
async function grantLevelFor(
  topicId: string,
  userId: string,
): Promise<"use" | "manage" | null> {
  const grants = await storage.getActiveTopicGrantsForGrantees(userId, await groupIdsOf(userId));
  let level: "use" | "manage" | null = null;
  for (const g of grants) {
    if (g.topicId !== topicId) continue;
    if (g.accessLevel === "manage") return "manage";
    level = "use";
  }
  return level;
}

/** Can see the topic and use it: owner, any active grant, shared, or admin. */
export async function visibleTopic(
  roles: readonly Role[],
  userId: string,
  topic: TopicRef,
): Promise<boolean> {
  if (isAdminOrSuper(roles)) return true;
  if (topic.visibility === "shared" && hasRole(roles, ROLES.AUTHOR)) return true;
  if (topic.ownerId === userId) return true;
  return (await grantLevelFor(topic.id, userId)) !== null;
}

/** Can CRUD the topic's questions and edit the topic: owner, manage grant, admin. */
export async function canManageTopicContent(
  roles: readonly Role[],
  userId: string,
  topic: TopicRef,
): Promise<boolean> {
  if (isAdminOrSuper(roles)) return true;
  if (topic.ownerId === userId) return true;
  return (await grantLevelFor(topic.id, userId)) === "manage";
}

/** Deleting a topic is owner or admin only. */
export function canDeleteTopic(roles: readonly Role[], userId: string, topic: TopicRef): boolean {
  return isAdminOrSuper(roles) || topic.ownerId === userId;
}

/** Granting access to a topic: owner of that topic, or admin/super. */
export function canGrantTopicAccess(roles: readonly Role[], userId: string, topic: TopicRef): boolean {
  return isAdminOrSuper(roles) || topic.ownerId === userId;
}

/** Changing a topic's owner is admin/super only. */
export function canChangeTopicOwner(roles: readonly Role[]): boolean {
  return isAdminOrSuper(roles);
}

/**
 * The set of topic ids a user may SEE/use, for list and picker filtering. For
 * admins returns `{ all: true }` (no id set needed). Otherwise the union of
 * shared topics, owned topics and active grants. `wantsAuthor` is false for a
 * pure manager/learner — they see nothing in the content bank.
 */
export async function visibleTopicScope(
  roles: readonly Role[],
  userId: string,
): Promise<{ all: boolean; ids: Set<string> }> {
  if (isAdminOrSuper(roles)) return { all: true, ids: new Set() };
  const ids = new Set<string>();
  if (!hasRole(roles, ROLES.AUTHOR)) return { all: false, ids };

  // Shared topics are visible to every author.
  const shared = await storage.getSharedTopicIds();
  for (const id of shared) ids.add(id);
  for (const id of await storage.getTopicIdsByOwner(userId)) ids.add(id);
  const grants = await storage.getActiveTopicGrantsForGrantees(userId, await groupIdsOf(userId));
  for (const g of grants) ids.add(g.topicId);
  return { all: false, ids };
}
