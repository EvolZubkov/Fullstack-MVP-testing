/**
 * @module server/services/access
 *
 * Server-side resolution of a user's effective roles and permissions (PRD-13),
 * plus startup provisioning of configured superadmins. Superadmin power is
 * derived from configuration ({@link module:server/config}) and matched by email
 * hash; it is never stored in `user_roles`. Effective roles and permissions are
 * computed per call (not cached in the session) so a configuration change takes
 * effect on the next request.
 */

import { randomBytes } from "crypto";
import { storage } from "../storage";
import { isSuperadminEmailHash, superadminEmails } from "../superadmin";
import { logger } from "../logger";
import {
  effectiveRoles,
  getPermissions,
  hasPermission,
  ROLES,
  type Capability,
  type Role,
} from "@shared/access";
import type { User } from "@shared/schema";

/** Whether the user has configuration-derived superadmin power. */
export function isSuperadmin(user: Pick<User, "emailHash">): boolean {
  return isSuperadminEmailHash(user.emailHash);
}

/**
 * Effective role set: the stored roles plus the configuration superadmin. Roles
 * come solely from `user_roles` (the legacy `users.role` column was dropped in
 * T-10); superadmin power is derived from configuration, never stored.
 */
export async function getEffectiveRoles(
  user: Pick<User, "id" | "emailHash">,
): Promise<Role[]> {
  const stored = await storage.getUserRoles(user.id);
  return effectiveRoles(stored, isSuperadmin(user));
}

/** The union of capabilities granted by the user's effective roles. */
export async function getUserCapabilities(
  user: Pick<User, "id" | "emailHash">,
): Promise<Set<Capability>> {
  return getPermissions(await getEffectiveRoles(user));
}

/**
 * Whether the user holds the given capability in principle. Object-level scope
 * (test ownership and grants) is resolved separately by the test-access service.
 */
export async function userHasPermission(
  user: Pick<User, "id" | "emailHash">,
  cap: Capability,
): Promise<boolean> {
  return hasPermission(await getEffectiveRoles(user), cap);
}

/**
 * Whether this account may receive a passwordless assignment link (magic link,
 * `GET /access/:token`). The link performs a full passwordless login as its
 * recipient (scoped afterwards by `server/middleware/magic-scope.ts` to the one
 * assigned test, but the account itself must never be enterable this way for
 * anyone but a plain learner — PLAN_MAGIC_LINK_SCOPE.md, Этап 3 / defect D-3).
 *
 * Uses {@link getEffectiveRoles}, NOT the raw stored roles, so a configuration
 * superadmin from `SUPERADMIN_EMAILS` is excluded even with an empty
 * `user_roles` row.
 *
 * An account holding NO role at all also returns `false`: the JSDoc contract is
 * "only a PURE learner may", and a roleless account is not a learner (it also
 * lacks `attempts.take`, so it could not use the test the link opens either
 * way). Denying by default here mirrors the deny-by-default posture already
 * used by the magic-scope guard in this same effort, rather than reading the
 * plan's "any role other than learner" literally as a double negative that
 * would let a roleless account through.
 */
export async function mayReceiveAssignmentLink(
  user: Pick<User, "id" | "emailHash">,
): Promise<boolean> {
  const roles = await getEffectiveRoles(user);
  return roles.length === 1 && roles[0] === ROLES.LEARNER;
}

/**
 * Ensure every configured superadmin has an account. Missing accounts are
 * created WITHOUT stored roles (superadmin power comes from configuration); a
 * random password is set so the account must use the password-reset flow to set
 * its first password. Existing accounts are left untouched — no role is added.
 * Best-effort: a failure for one address is logged and does not abort startup.
 */
export async function provisionSuperadmins(): Promise<void> {
  for (const email of superadminEmails()) {
    try {
      const existing = await storage.getUserByEmail(email);
      if (existing) {
        logger.info(`Superadmin account present: ${email}`, "access");
        continue;
      }
      await storage.createUser({
        email,
        // Random, unusable password — the account sets one via password reset.
        passwordHash: randomBytes(24).toString("hex"),
        // Default the display name to the email so the superadmin is never nameless
        // (a null name renders as «—»/blank wherever the account is shown, e.g. the
        // «Владелец» column of tests they import). They can change it in the profile.
        name: email,
        // Superadmin power comes from configuration; `user_roles` stays empty.
        status: "active",
        mustChangePassword: true,
      });
      logger.info(
        `Superadmin account provisioned (no stored roles): ${email}. Use password reset to set a password.`,
        "access",
      );
    } catch (err) {
      logger.error(
        `Failed to provision superadmin ${email}: ${err instanceof Error ? err.message : String(err)}`,
        "access",
      );
    }
  }
}
