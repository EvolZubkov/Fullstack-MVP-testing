/**
 * @module shared/access/roles
 *
 * Role vocabulary for the role-based access control model (PRD-13). A user holds
 * a SET of roles; the effective permission set is the union over those roles
 * (see {@link module:shared/access/permissions}). This module is the single
 * source of the role identifiers and the helpers that depend only on the role
 * set — it has no knowledge of the database, the session or the network.
 *
 * Two layers of roles exist:
 *
 * - stored roles ({@link STORED_ROLES}) live in the `user_roles` table and are
 *   assignable through the UI;
 * - the `superadmin` role is never stored or assignable: it is computed at
 *   runtime from configuration (`SUPERADMIN_EMAILS`). It appears here only so
 *   the permission map and the resolution helpers can reason about it.
 *
 * Normative source: docs/specs/access-control/role-model.md.
 */

/** All role identifiers, including the configuration-only `superadmin`. */
export const ROLES = {
  SUPERADMIN: "superadmin",
  ADMINISTRATOR: "administrator",
  DEVELOPER: "developer",
  AUTHOR: "author",
  MANAGER: "manager",
  LEARNER: "learner",
} as const;

/** Any role identifier (stored roles plus the configuration-only superadmin). */
export type Role = (typeof ROLES)[keyof typeof ROLES];

/**
 * Roles that can be persisted in `user_roles` and assigned through the UI.
 * Excludes `superadmin`, which is derived from configuration only.
 */
export const STORED_ROLES = [
  ROLES.ADMINISTRATOR,
  ROLES.DEVELOPER,
  ROLES.AUTHOR,
  ROLES.MANAGER,
  ROLES.LEARNER,
] as const;

/** A role that can be stored in `user_roles` (excludes `superadmin`). */
export type StoredRole = (typeof STORED_ROLES)[number];

/**
 * Priority order for choosing a default landing area when a user has several
 * roles (PRD-13 FR-30): the first matching role wins, highest privilege first.
 */
export const ROLE_PRIORITY: readonly Role[] = [
  ROLES.SUPERADMIN,
  ROLES.ADMINISTRATOR,
  ROLES.DEVELOPER,
  ROLES.AUTHOR,
  ROLES.MANAGER,
  ROLES.LEARNER,
];

/**
 * The authoring class: roles whose object-level scope over content is the one
 * described for the author in role-model.md section 6 — own topics/tests plus
 * grants, and the shared topic pool. `developer` is an author who additionally
 * generates SCORM packages, so every scope rule that names the author must name
 * it too. Use {@link hasAuthoringRole} instead of comparing against
 * `ROLES.AUTHOR` directly.
 */
export const AUTHORING_ROLES: readonly Role[] = [ROLES.DEVELOPER, ROLES.AUTHOR];

/** Does the role set contain any role of the authoring class. */
export function hasAuthoringRole(roles: readonly Role[]): boolean {
  return AUTHORING_ROLES.some((role) => roles.includes(role));
}

/** Type guard: is the given string a storable/assignable role. */
export function isStoredRole(value: string): value is StoredRole {
  return (STORED_ROLES as readonly string[]).includes(value);
}

/**
 * Compose the effective role set from the stored roles plus the runtime
 * superadmin flag. Superadmin is prepended so priority-based helpers see it
 * first. The flag is computed elsewhere from `SUPERADMIN_EMAILS`.
 */
export function effectiveRoles(
  storedRoles: readonly StoredRole[],
  isSuperadmin: boolean,
): Role[] {
  return isSuperadmin ? [ROLES.SUPERADMIN, ...storedRoles] : [...storedRoles];
}

/**
 * The highest-priority role in the set, used to pick the default landing area
 * (FR-30). Returns `null` when the set is empty.
 */
export function primaryRole(roles: readonly Role[]): Role | null {
  for (const role of ROLE_PRIORITY) {
    if (roles.includes(role)) return role;
  }
  return null;
}
