/**
 * @module server/services/test-access
 *
 * Object-level access resolution for tests (PRD-13, role-model.md section 6).
 * The role -> permission map decides whether an action is allowed in principle;
 * these helpers decide whether it applies to a SPECIFIC test by owner and grant.
 * Administrators and the superadmin bypass scope; the authoring roles (author and
 * developer, see `AUTHORING_ROLES`) are scoped to owned and edit-granted tests;
 * managers to assign-granted tests.
 *
 * Added in Phase 2 alongside the permission core; route handlers start calling it
 * in Phase 3 (PRD-13 implementation plan).
 */

import { ROLES, hasAuthoringRole, type Role } from "@shared/access";
import { storage } from "../storage";
import type { Test } from "@shared/schema";

/** Minimal test shape needed for resolution. */
type TestRef = Pick<Test, "id" | "ownerId">;

function hasRole(roles: readonly Role[], role: Role): boolean {
  return roles.includes(role);
}

/** Administrator or superadmin: full access to all tests, bypassing scope. */
export function isAdminOrSuper(roles: readonly Role[]): boolean {
  return hasRole(roles, ROLES.SUPERADMIN) || hasRole(roles, ROLES.ADMINISTRATOR);
}

/**
 * Can read the test: author edit-scope, manager assign-scope, or the test is
 * assigned to the user (role-model.md 6.4 `assignedToUser` branch — the
 * learner runtime reads design/screen data of assigned tests; PRD-15 FR-09).
 */
export async function canReadTest(
  roles: readonly Role[],
  userId: string,
  test: TestRef,
): Promise<boolean> {
  if (isAdminOrSuper(roles)) return true;
  if (hasAuthoringRole(roles) && (await canEditTest(roles, userId, test))) return true;
  if (hasRole(roles, ROLES.MANAGER) && (await canAssignTest(roles, userId, test))) return true;
  if (await storage.isTestAssignedToUser(test.id, userId)) return true;
  return false;
}

/** Can edit/publish/export the test: owner or edit-grant for authoring roles. */
export async function canEditTest(
  roles: readonly Role[],
  userId: string,
  test: TestRef,
): Promise<boolean> {
  if (isAdminOrSuper(roles)) return true;
  if (hasAuthoringRole(roles)) {
    if (test.ownerId === userId) return true;
    const grant = await storage.getTestGrantForUser(test.id, userId);
    return grant?.accessLevel === "edit";
  }
  return false;
}

/** Can delete/archive the test: owner only (plus admin/super). */
export async function canDeleteTest(
  roles: readonly Role[],
  userId: string,
  test: TestRef,
): Promise<boolean> {
  if (isAdminOrSuper(roles)) return true;
  return hasAuthoringRole(roles) && test.ownerId === userId;
}

/** Publishing, SCORM export and the debug run all follow the edit scope. */
export const canPublishTest = canEditTest;
export const canExportScorm = canEditTest;
export const canDebugTest = canEditTest;

/** Can assign the test: assign- or edit-grant for managers (plus admin/super). */
export async function canAssignTest(
  roles: readonly Role[],
  userId: string,
  test: TestRef,
): Promise<boolean> {
  if (isAdminOrSuper(roles)) return true;
  if (hasRole(roles, ROLES.MANAGER)) {
    const grant = await storage.getTestGrantForUser(test.id, userId);
    return grant?.accessLevel === "assign" || grant?.accessLevel === "edit";
  }
  return false;
}

/** Can read the test's analytics: author edit-scope or manager assign-scope. */
export async function canReadTestAnalytics(
  roles: readonly Role[],
  userId: string,
  test: TestRef,
): Promise<boolean> {
  if (isAdminOrSuper(roles)) return true;
  if (hasAuthoringRole(roles) && (await canEditTest(roles, userId, test))) return true;
  if (hasRole(roles, ROLES.MANAGER) && (await canAssignTest(roles, userId, test))) return true;
  return false;
}

/**
 * Granting access to a test: the owner of that test (PRD-15 BRC-27) or an
 * administrator/superadmin. The capability `tests.access.grant` is now held by
 * authors too, so this object-level check is what stops an author granting on a
 * test they do not own.
 */
export function canGrantAccess(roles: readonly Role[], userId: string, test: TestRef): boolean {
  if (isAdminOrSuper(roles)) return true;
  return hasAuthoringRole(roles) && test.ownerId === userId;
}

/** Changing the test owner is admin/superadmin only. */
export function canChangeOwner(roles: readonly Role[]): boolean {
  return isAdminOrSuper(roles);
}

/**
 * The set of test ids a user may READ, for list and analytics filtering. For
 * administrators/superadmin returns `{ all: true }` (no id set needed).
 * Otherwise the union of owned tests and edit-grants (authoring roles) and all
 * grants (manager role).
 */
export async function readableTestScope(
  roles: readonly Role[],
  userId: string,
): Promise<{ all: boolean; ids: Set<string> }> {
  if (isAdminOrSuper(roles)) return { all: true, ids: new Set() };
  const ids = new Set<string>();
  const wantsAuthor = hasAuthoringRole(roles);
  const wantsManager = hasRole(roles, ROLES.MANAGER);
  if (wantsAuthor) {
    for (const id of await storage.getTestIdsByOwner(userId)) ids.add(id);
  }
  if (wantsAuthor || wantsManager) {
    const grants = await storage.getUserTestGrants(userId);
    for (const g of grants) {
      if (wantsManager) ids.add(g.testId); // manager: assign or edit grant
      else if (g.accessLevel === "edit") ids.add(g.testId); // author: edit grant only
    }
  }
  return { all: false, ids };
}
