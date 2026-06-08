/**
 * @module tests/access/effective-roles.test
 *
 * Acceptance tests for server-side effective-role resolution (PRD-13, Phase 5
 * T-31). Covers AC-09 (a configured superadmin email gets superadmin power,
 * derived from config and never stored). Roles come solely from `user_roles`
 * after T-10 dropped the legacy `users.role` column; AC-11 (no access lost on
 * migration) is met by the 016 backfill and the seed writing `user_roles`, not
 * by a runtime fallback.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ROLES } from "@shared/access";

const { storageMock, configMock } = vi.hoisted(() => ({
  storageMock: { getUserRoles: vi.fn() },
  configMock: { isSuperadminEmailHash: vi.fn(), SUPERADMIN_EMAILS: [] as string[] },
}));
vi.mock("../../server/storage", () => ({ storage: storageMock }));
vi.mock("../../server/config", () => configMock);

import { getEffectiveRoles, isSuperadmin } from "../../server/services/access";

const userWith = (over: Partial<{ id: string; emailHash: string }> = {}) => ({
  id: "u1",
  emailHash: "hash-1",
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUserRoles.mockResolvedValue([]);
  configMock.isSuperadminEmailHash.mockReturnValue(false);
});

describe("isSuperadmin", () => {
  it("reflects the configuration email-hash check", () => {
    configMock.isSuperadminEmailHash.mockReturnValue(true);
    expect(isSuperadmin({ emailHash: "hash-1" })).toBe(true);
    configMock.isSuperadminEmailHash.mockReturnValue(false);
    expect(isSuperadmin({ emailHash: "hash-1" })).toBe(false);
  });
});

describe("getEffectiveRoles — roles come solely from user_roles (T-10: legacy column dropped)", () => {
  it("returns the stored roles", async () => {
    storageMock.getUserRoles.mockResolvedValue([ROLES.AUTHOR]);
    expect(await getEffectiveRoles(userWith())).toEqual([ROLES.AUTHOR]);
  });

  it("respects an explicit downgrade in user_roles", async () => {
    storageMock.getUserRoles.mockResolvedValue([ROLES.LEARNER]);
    expect(await getEffectiveRoles(userWith())).toEqual([ROLES.LEARNER]);
  });

  it("yields no roles when there are no user_roles rows (no legacy fallback)", async () => {
    storageMock.getUserRoles.mockResolvedValue([]);
    expect(await getEffectiveRoles(userWith())).toEqual([]);
  });
});

describe("AC-09 — configured superadmin power is derived from config", () => {
  it("adds superadmin to an account whose email hash is configured", async () => {
    configMock.isSuperadminEmailHash.mockReturnValue(true);
    storageMock.getUserRoles.mockResolvedValue([]);
    const roles = await getEffectiveRoles(userWith());
    expect(roles).toContain(ROLES.SUPERADMIN);
  });

  it("keeps stored roles AND adds superadmin (config overlays, does not replace)", async () => {
    configMock.isSuperadminEmailHash.mockReturnValue(true);
    storageMock.getUserRoles.mockResolvedValue([ROLES.LEARNER]);
    const roles = await getEffectiveRoles(userWith());
    expect(roles).toContain(ROLES.SUPERADMIN);
    expect(roles).toContain(ROLES.LEARNER);
  });

  it("does not grant superadmin when the email hash is not configured", async () => {
    configMock.isSuperadminEmailHash.mockReturnValue(false);
    storageMock.getUserRoles.mockResolvedValue([ROLES.ADMINISTRATOR]);
    const roles = await getEffectiveRoles(userWith());
    expect(roles).not.toContain(ROLES.SUPERADMIN);
  });
});
