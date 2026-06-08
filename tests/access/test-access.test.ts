/**
 * @module tests/access/test-access.test
 *
 * Acceptance tests for the object-level test-access resolution (PRD-13, Phase 5
 * T-31). Covers AC-03 (author edit scope), AC-04 (author delete scope), AC-05
 * (manager assign scope), AC-06 (grants/owner are admin-only) and AC-10 (the
 * readable-test scope used to filter lists and analytics). The role -> permission
 * map ("in principle" checks) is covered separately by permissions.test.ts.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { ROLES } from "@shared/access";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getTestGrantForUser: vi.fn(),
    getTestIdsByOwner: vi.fn(),
    getUserTestGrants: vi.fn(),
  },
}));
vi.mock("../../server/storage", () => ({ storage: storageMock }));

import {
  isAdminOrSuper,
  canReadTest,
  canEditTest,
  canDeleteTest,
  canPublishTest,
  canExportScorm,
  canAssignTest,
  canReadTestAnalytics,
  canGrantAccess,
  canChangeOwner,
  readableTestScope,
} from "../../server/services/test-access";

/** A test owned by `owner-1`. */
const TEST = { id: "t1", ownerId: "owner-1" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
});

describe("isAdminOrSuper", () => {
  it("is true for administrator and superadmin only", () => {
    expect(isAdminOrSuper([ROLES.ADMINISTRATOR])).toBe(true);
    expect(isAdminOrSuper([ROLES.SUPERADMIN])).toBe(true);
    expect(isAdminOrSuper([ROLES.AUTHOR])).toBe(false);
    expect(isAdminOrSuper([ROLES.MANAGER])).toBe(false);
    expect(isAdminOrSuper([ROLES.LEARNER])).toBe(false);
    expect(isAdminOrSuper([])).toBe(false);
  });
});

describe("admin/super bypass scope", () => {
  it("administrator can edit/delete/assign/read any test without owner or grant", async () => {
    const roles = [ROLES.ADMINISTRATOR];
    await expect(canEditTest(roles, "anyone", TEST)).resolves.toBe(true);
    await expect(canDeleteTest(roles, "anyone", TEST)).resolves.toBe(true);
    await expect(canAssignTest(roles, "anyone", TEST)).resolves.toBe(true);
    await expect(canReadTest(roles, "anyone", TEST)).resolves.toBe(true);
    // No grant lookups needed when the admin short-circuits.
    expect(storageMock.getTestGrantForUser).not.toHaveBeenCalled();
  });
});

describe("AC-03 — author edit scope (own test or edit grant)", () => {
  it("allows the owner to edit/publish/export", async () => {
    const roles = [ROLES.AUTHOR];
    await expect(canEditTest(roles, "owner-1", TEST)).resolves.toBe(true);
    await expect(canPublishTest(roles, "owner-1", TEST)).resolves.toBe(true);
    await expect(canExportScorm(roles, "owner-1", TEST)).resolves.toBe(true);
  });

  it("allows a non-owner with an edit grant", async () => {
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "edit" });
    await expect(canEditTest([ROLES.AUTHOR], "u2", TEST)).resolves.toBe(true);
  });

  it("denies a non-owner without a grant", async () => {
    await expect(canEditTest([ROLES.AUTHOR], "u2", TEST)).resolves.toBe(false);
  });

  it("denies a non-owner whose grant is assign-only (assign does not imply edit)", async () => {
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "assign" });
    await expect(canEditTest([ROLES.AUTHOR], "u2", TEST)).resolves.toBe(false);
  });

  it("denies a manager (no author role) even on an owned test", async () => {
    await expect(canEditTest([ROLES.MANAGER], "owner-1", TEST)).resolves.toBe(false);
  });
});

describe("AC-04 — author delete scope (owner only)", () => {
  it("allows the owner", async () => {
    await expect(canDeleteTest([ROLES.AUTHOR], "owner-1", TEST)).resolves.toBe(true);
  });

  it("denies a non-owner even with an edit grant", async () => {
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "edit" });
    await expect(canDeleteTest([ROLES.AUTHOR], "u2", TEST)).resolves.toBe(false);
  });
});

describe("AC-05 — manager assign scope (assign or edit grant)", () => {
  it("allows a manager with an assign grant", async () => {
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "assign" });
    await expect(canAssignTest([ROLES.MANAGER], "u2", TEST)).resolves.toBe(true);
  });

  it("allows a manager with an edit grant (edit implies assign)", async () => {
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "edit" });
    await expect(canAssignTest([ROLES.MANAGER], "u2", TEST)).resolves.toBe(true);
  });

  it("denies a manager without a grant", async () => {
    await expect(canAssignTest([ROLES.MANAGER], "u2", TEST)).resolves.toBe(false);
  });

  it("denies an author (no manager role) even with an assign grant", async () => {
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "assign" });
    await expect(canAssignTest([ROLES.AUTHOR], "u2", TEST)).resolves.toBe(false);
  });
});

describe("AC-06 — granting access and changing owner are admin/super only", () => {
  it("allows administrator and superadmin", () => {
    expect(canGrantAccess([ROLES.ADMINISTRATOR])).toBe(true);
    expect(canChangeOwner([ROLES.SUPERADMIN])).toBe(true);
  });

  it("denies author and manager", () => {
    expect(canGrantAccess([ROLES.AUTHOR])).toBe(false);
    expect(canGrantAccess([ROLES.MANAGER])).toBe(false);
    expect(canChangeOwner([ROLES.AUTHOR])).toBe(false);
    expect(canChangeOwner([ROLES.MANAGER])).toBe(false);
  });
});

describe("canReadTest / canReadTestAnalytics — edit or assign scope", () => {
  it("lets an author read a test they can edit", async () => {
    await expect(canReadTest([ROLES.AUTHOR], "owner-1", TEST)).resolves.toBe(true);
    await expect(canReadTestAnalytics([ROLES.AUTHOR], "owner-1", TEST)).resolves.toBe(true);
  });

  it("lets a manager read a test they can assign", async () => {
    storageMock.getTestGrantForUser.mockResolvedValue({ accessLevel: "assign" });
    await expect(canReadTest([ROLES.MANAGER], "u2", TEST)).resolves.toBe(true);
    await expect(canReadTestAnalytics([ROLES.MANAGER], "u2", TEST)).resolves.toBe(true);
  });

  it("denies a user with neither scope", async () => {
    await expect(canReadTest([ROLES.AUTHOR], "u2", TEST)).resolves.toBe(false);
  });
});

describe("AC-10 — readableTestScope (list/analytics filtering)", () => {
  it("returns { all: true } for administrators and superadmins", async () => {
    await expect(readableTestScope([ROLES.ADMINISTRATOR], "x")).resolves.toEqual({
      all: true,
      ids: new Set(),
    });
    expect(storageMock.getTestIdsByOwner).not.toHaveBeenCalled();
  });

  it("for an author: owned tests plus edit grants, but NOT assign grants", async () => {
    storageMock.getTestIdsByOwner.mockResolvedValue(["owned-1", "owned-2"]);
    storageMock.getUserTestGrants.mockResolvedValue([
      { testId: "edit-1", accessLevel: "edit" },
      { testId: "assign-1", accessLevel: "assign" },
    ]);
    const scope = await readableTestScope([ROLES.AUTHOR], "u1");
    expect(scope.all).toBe(false);
    expect([...scope.ids].sort()).toEqual(["edit-1", "owned-1", "owned-2"]);
  });

  it("for a manager: every grant (assign or edit), no ownership lookup", async () => {
    storageMock.getUserTestGrants.mockResolvedValue([
      { testId: "edit-1", accessLevel: "edit" },
      { testId: "assign-1", accessLevel: "assign" },
    ]);
    const scope = await readableTestScope([ROLES.MANAGER], "u1");
    expect(scope.all).toBe(false);
    expect([...scope.ids].sort()).toEqual(["assign-1", "edit-1"]);
    expect(storageMock.getTestIdsByOwner).not.toHaveBeenCalled();
  });

  it("AC-12 — a user with author + manager roles gets the union of both scopes", async () => {
    storageMock.getTestIdsByOwner.mockResolvedValue(["owned-1"]);
    storageMock.getUserTestGrants.mockResolvedValue([
      { testId: "edit-1", accessLevel: "edit" },
      { testId: "assign-1", accessLevel: "assign" },
    ]);
    const scope = await readableTestScope([ROLES.AUTHOR, ROLES.MANAGER], "u1");
    // author contributes owned-1 + edit-1; manager contributes edit-1 + assign-1.
    expect([...scope.ids].sort()).toEqual(["assign-1", "edit-1", "owned-1"]);
  });

  it("returns an empty scope for a learner / no content role", async () => {
    const scope = await readableTestScope([ROLES.LEARNER], "u1");
    expect(scope.all).toBe(false);
    expect(scope.ids.size).toBe(0);
  });
});
