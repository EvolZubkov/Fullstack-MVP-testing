/**
 * @module shared/access/permissions
 *
 * The role -> permission map and the permission-check helpers (PRD-13). A user's
 * effective permissions are the union of the permission sets of all roles in
 * their set, plus everything if `superadmin` is present. This module is pure: it
 * decides whether a role set holds a capability "in principle". Object-level
 * scope (test ownership and grants) is enforced separately by the test-access
 * service.
 *
 * Invariant: `administrator` holds every capability except the
 * superadmin-only ones ({@link SUPERADMIN_ONLY}); `superadmin` holds all. The
 * author and manager sets are listed explicitly.
 *
 * Normative source: docs/specs/access-control/role-model.md (sections 3-4).
 */

import { CAPABILITIES, type Capability } from "./capabilities";
import { ROLES, type Role } from "./roles";

/** Capabilities only the superadmin holds (administrator does not). */
export const SUPERADMIN_ONLY: readonly Capability[] = [
  "system.config",
  "system.roles.assignAdmin",
];

/** Baseline capabilities every authenticated user has via any role. */
const SELF_AND_TAKE: readonly Capability[] = [
  "auth.self",
  "attempts.take",
  "attempts.self.read",
];

/** Capabilities of the Author role (content authoring, scoped to own tests). */
const AUTHOR_CAPABILITIES: readonly Capability[] = [
  ...SELF_AND_TAKE,
  "topics.read",
  "topics.manage",
  // PRD-15 block C: an author grants access to topics they own (object-scoped).
  "topics.access.grant",
  "questions.read",
  "questions.manage",
  "questions.importExport",
  "folders.manage",
  "tests.read",
  "tests.create",
  "tests.edit",
  "tests.publish",
  "tests.delete",
  "tests.export.scorm",
  // PRD-15 BRC-27: an author grants access to tests they own (object-scoped).
  "tests.access.grant",
  "templates.read",
  "analytics.read",
  "analytics.export",
];

/** Capabilities of the Training Manager role (delivery, scoped to grants). */
const MANAGER_CAPABILITIES: readonly Capability[] = [
  ...SELF_AND_TAKE,
  "tests.read",
  "assignments.manage",
  "groups.manage",
  "users.read",
  "users.create",
  "analytics.read",
  "analytics.export",
];

/** Capabilities of the Administrator role: all except the superadmin-only ones. */
const ADMINISTRATOR_CAPABILITIES: readonly Capability[] = CAPABILITIES.filter(
  (cap) => !SUPERADMIN_ONLY.includes(cap),
);

/**
 * The role -> permission map. Source of truth for "does this role grant this
 * capability". Sets are frozen at module load.
 */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Capability>>> = {
  [ROLES.SUPERADMIN]: new Set<Capability>(CAPABILITIES),
  [ROLES.ADMINISTRATOR]: new Set<Capability>(ADMINISTRATOR_CAPABILITIES),
  [ROLES.AUTHOR]: new Set<Capability>(AUTHOR_CAPABILITIES),
  [ROLES.MANAGER]: new Set<Capability>(MANAGER_CAPABILITIES),
  [ROLES.LEARNER]: new Set<Capability>(SELF_AND_TAKE),
};

/** Does any role in the set grant the given capability. */
export function hasPermission(roles: readonly Role[], cap: Capability): boolean {
  for (const role of roles) {
    if (ROLE_PERMISSIONS[role]?.has(cap)) return true;
  }
  return false;
}

/** The union of capabilities granted by all roles in the set. */
export function getPermissions(roles: readonly Role[]): Set<Capability> {
  const out = new Set<Capability>();
  for (const role of roles) {
    const perms = ROLE_PERMISSIONS[role];
    if (!perms) continue;
    for (const cap of perms) out.add(cap);
  }
  return out;
}

/** Does the role set grant every one of the given capabilities. */
export function hasAllPermissions(
  roles: readonly Role[],
  caps: readonly Capability[],
): boolean {
  return caps.every((cap) => hasPermission(roles, cap));
}
