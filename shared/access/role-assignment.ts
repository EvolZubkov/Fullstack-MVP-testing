/**
 * @module shared/access/role-assignment
 *
 * The role-assignment ceiling (PRD-13, role-model.md section 7). Roles are
 * granted and revoked one at a time; this module decides which roles a given
 * actor may assign or revoke, and validates a requested change to a user's role
 * set against that ceiling. It is pure — the caller supplies the actor's
 * effective roles and whether the target account is a superadmin.
 *
 * Ceiling summary:
 *
 * - superadmin: any stored role, including `administrator`;
 * - administrator: `developer`, `author`, `manager`, `learner` (NOT `administrator`);
 * - manager: `learner`, and only when creating a user;
 * - others: none.
 *
 * Normative source: docs/specs/access-control/role-model.md (section 7).
 */

import {
  ROLES,
  STORED_ROLES,
  isStoredRole,
  type Role,
  type StoredRole,
} from "./roles";

/** Options affecting the assignable set (e.g. manager can assign at creation). */
export interface AssignOptions {
  /** True when the change happens while creating a new user. */
  atCreation?: boolean;
}

/**
 * The set of stored roles the actor may assign or revoke, given their effective
 * roles. Computed as the union across the actor's roles, returned in the stable
 * {@link STORED_ROLES} order.
 */
export function assignableRoles(
  actorRoles: readonly Role[],
  opts: AssignOptions = {},
): StoredRole[] {
  const atCreation = opts.atCreation ?? false;
  const allowed = new Set<StoredRole>();
  const has = (role: Role) => actorRoles.includes(role);

  if (has(ROLES.SUPERADMIN)) {
    for (const role of STORED_ROLES) allowed.add(role);
  }
  if (has(ROLES.ADMINISTRATOR)) {
    allowed.add(ROLES.DEVELOPER);
    allowed.add(ROLES.AUTHOR);
    allowed.add(ROLES.MANAGER);
    allowed.add(ROLES.LEARNER);
  }
  if (has(ROLES.MANAGER) && atCreation) {
    allowed.add(ROLES.LEARNER);
  }

  return STORED_ROLES.filter((role) => allowed.has(role));
}

/** Convenience: may the actor assign or revoke the given role. */
export function canAssignRole(
  actorRoles: readonly Role[],
  role: StoredRole,
  opts: AssignOptions = {},
): boolean {
  return assignableRoles(actorRoles, opts).includes(role);
}

/** Input to {@link validateRoleChange}. */
export interface RoleChangeInput {
  /** Effective roles of the actor performing the change. */
  actorRoles: readonly Role[];
  /** Target's current stored roles. */
  currentRoles: readonly StoredRole[];
  /** Requested stored roles (untrusted input). */
  requestedRoles: readonly string[];
  /** Whether the target account is a superadmin (config-derived). */
  targetIsSuperadmin?: boolean;
  /** Whether the change happens while creating the user. */
  atCreation?: boolean;
}

/** Result of {@link validateRoleChange}. */
export interface RoleChangeResult {
  ok: boolean;
  reason?: string;
}

/**
 * Validate a requested change to a user's role set against the actor's ceiling.
 * Mirrors `applyRoleChange` in role-model.md section 7: only a superadmin may
 * touch a superadmin account, and every added or removed role must be within
 * {@link assignableRoles} of the actor. A no-op change is always allowed.
 */
export function validateRoleChange(input: RoleChangeInput): RoleChangeResult {
  const {
    actorRoles,
    currentRoles,
    requestedRoles,
    targetIsSuperadmin = false,
    atCreation = false,
  } = input;

  // Requested roles must all be valid stored roles (never `superadmin`).
  for (const role of requestedRoles) {
    if (!isStoredRole(role)) {
      return { ok: false, reason: `invalid role: ${role}` };
    }
  }

  // Only a superadmin may modify a superadmin account.
  if (targetIsSuperadmin && !actorRoles.includes(ROLES.SUPERADMIN)) {
    return { ok: false, reason: "only a superadmin may modify a superadmin account" };
  }

  const current = new Set<string>(currentRoles);
  const requested = new Set<string>(requestedRoles);

  // The diff: roles added or removed by this change.
  const changed: string[] = [];
  for (const role of requested) if (!current.has(role)) changed.push(role);
  for (const role of current) if (!requested.has(role)) changed.push(role);

  const allowed = new Set<string>(assignableRoles(actorRoles, { atCreation }));
  for (const role of changed) {
    if (!allowed.has(role)) {
      return { ok: false, reason: `not allowed to assign or revoke role: ${role}` };
    }
  }

  return { ok: true };
}
