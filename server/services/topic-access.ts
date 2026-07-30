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

import { ROLES, hasAuthoringRole, type Role } from "@shared/access";
import { storage } from "../storage";
import { normalizeTopicName } from "@shared/topics/naming";
import type { Topic, Test } from "@shared/schema";

/** A topic reduced to what the same-name surfaces need. */
type TopicSummary = Pick<Topic, "id" | "name" | "ownerId" | "visibility">;
const toSummary = (t: Topic): TopicSummary => ({
  id: t.id, name: t.name, ownerId: t.ownerId, visibility: t.visibility,
});

/** Minimal topic shape needed for resolution. */
type TopicRef = Pick<Topic, "id" | "ownerId" | "visibility">;

function hasRole(roles: readonly Role[], role: Role): boolean {
  return roles.includes(role);
}

export function isAdminOrSuper(roles: readonly Role[]): boolean {
  return hasRole(roles, ROLES.SUPERADMIN) || hasRole(roles, ROLES.ADMINISTRATOR);
}

/** The highest active grant level a user holds on a topic (TD-01: direct grants
 *  only — topic access is never granted to groups). */
async function grantLevelFor(
  topicId: string,
  userId: string,
): Promise<"use" | "manage" | null> {
  const grants = await storage.getActiveTopicGrantsForGrantees(userId);
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
  if (topic.visibility === "shared" && hasAuthoringRole(roles)) return true;
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
 * shared topics, owned topics and active grants. A pure manager/learner holds no
 * authoring role and sees nothing in the content bank.
 */
export async function visibleTopicScope(
  roles: readonly Role[],
  userId: string,
): Promise<{ all: boolean; ids: Set<string> }> {
  if (isAdminOrSuper(roles)) return { all: true, ids: new Set() };
  const ids = new Set<string>();
  if (!hasAuthoringRole(roles)) return { all: false, ids };

  // Shared topics are visible to every author.
  const shared = await storage.getSharedTopicIds();
  for (const id of shared) ids.add(id);
  for (const id of await storage.getTopicIdsByOwner(userId)) ids.add(id);
  const grants = await storage.getActiveTopicGrantsForGrantees(userId);
  for (const g of grants) ids.add(g.topicId);
  return { all: false, ids };
}

/** A grantee's test that references the topic — one line of the FR-26 report. */
export interface RevokeDependent {
  testId: string;
  title: string;
  status: Test["status"];
}

/**
 * FR-26 hard-revoke feasibility: the grantee's own tests that reference the
 * topic and would lose their derived in-context read if the grant were fully
 * removed. TD-01: grantees are users, so these are the user's own tests.
 * Published dependents are the operationally blocking ones.
 *
 * @param topicId - the topic whose grant is being revoked.
 * @param granteeId - the user id of the grantee.
 * @returns the dependent tests (id, title, status).
 */
export async function dependentTestsForGrant(
  topicId: string,
  granteeId: string,
): Promise<RevokeDependent[]> {
  const using = await storage.getTestsUsingTopic(topicId);
  return using
    .filter((t) => t.ownerId === granteeId)
    .map((t) => ({ testId: t.id, title: t.title, status: t.status }));
}

// ─── Same-name policy (FR-27) ────────────────────────────────────────────────

/**
 * FR-27 hard uniqueness: another topic of the SAME owner already uses this
 * normalized name. Unowned (legacy) names are never constrained. Returns the
 * clashing topic or null.
 *
 * @param ownerId - the owner the new/renamed topic belongs to (null = legacy).
 * @param name - the proposed raw name.
 * @param excludeId - the topic being renamed (excluded from the comparison).
 */
export async function sameOwnerNameClash(
  ownerId: string | null,
  name: string,
  excludeId?: string,
): Promise<TopicSummary | null> {
  if (!ownerId) return null;
  const norm = normalizeTopicName(name);
  const all = await storage.getTopics();
  const hit = all.find(
    (t) => t.ownerId === ownerId && t.id !== excludeId && normalizeTopicName(t.name) === norm,
  );
  return hit ? toSummary(hit) : null;
}

/**
 * FR-27 non-blocking warning set: topics in the actor's visible area whose
 * normalized name matches. After the hard same-owner check these are the
 * other-owner collisions worth flagging to the author.
 */
export async function visibleSameNameTopics(
  roles: readonly Role[],
  userId: string,
  name: string,
  excludeId?: string,
): Promise<TopicSummary[]> {
  const norm = normalizeTopicName(name);
  const scope = await visibleTopicScope(roles, userId);
  const all = await storage.getTopics();
  return all
    .filter(
      (t) =>
        t.id !== excludeId &&
        (scope.all || scope.ids.has(t.id)) &&
        normalizeTopicName(t.name) === norm,
    )
    .map(toSummary);
}

/**
 * FR-27 administrator report: groups of topics that share a normalized name
 * across the whole system (each group has more than one member).
 */
export async function duplicateNameGroups(): Promise<
  Array<{ nameNormalized: string; topics: TopicSummary[] }>
> {
  const all = await storage.getTopics();
  const byNorm = new Map<string, Topic[]>();
  for (const t of all) {
    const key = normalizeTopicName(t.name);
    const arr = byNorm.get(key) ?? [];
    arr.push(t);
    byNorm.set(key, arr);
  }
  return [...byNorm.entries()]
    .filter(([, arr]) => arr.length > 1)
    .map(([nameNormalized, arr]) => ({ nameNormalized, topics: arr.map(toSummary) }));
}
