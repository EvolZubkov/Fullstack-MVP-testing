// Tests for the role-assignment ceiling (PRD-13, role-model.md section 7).

import { describe, it, expect } from "vitest";
import {
  assignableRoles,
  canAssignRole,
  validateRoleChange,
  ROLES,
} from "@shared/access";

describe("assignableRoles", () => {
  it("superadmin can assign every stored role, including administrator", () => {
    expect(assignableRoles([ROLES.SUPERADMIN])).toEqual([
      ROLES.ADMINISTRATOR,
      ROLES.AUTHOR,
      ROLES.MANAGER,
      ROLES.LEARNER,
    ]);
  });

  it("administrator can assign up to author/manager, not administrator", () => {
    expect(assignableRoles([ROLES.ADMINISTRATOR])).toEqual([
      ROLES.AUTHOR,
      ROLES.MANAGER,
      ROLES.LEARNER,
    ]);
  });

  it("manager can assign learner only at creation", () => {
    expect(assignableRoles([ROLES.MANAGER], { atCreation: true })).toEqual([ROLES.LEARNER]);
    expect(assignableRoles([ROLES.MANAGER])).toEqual([]);
  });

  it("author and learner can assign nothing", () => {
    expect(assignableRoles([ROLES.AUTHOR])).toEqual([]);
    expect(assignableRoles([ROLES.LEARNER])).toEqual([]);
    expect(assignableRoles([])).toEqual([]);
  });

  it("combined roles take the union (administrator dominates manager)", () => {
    expect(assignableRoles([ROLES.ADMINISTRATOR, ROLES.MANAGER])).toEqual([
      ROLES.AUTHOR,
      ROLES.MANAGER,
      ROLES.LEARNER,
    ]);
  });

  it("canAssignRole gates the administrator role to superadmin", () => {
    expect(canAssignRole([ROLES.ADMINISTRATOR], ROLES.ADMINISTRATOR)).toBe(false);
    expect(canAssignRole([ROLES.SUPERADMIN], ROLES.ADMINISTRATOR)).toBe(true);
  });
});

describe("validateRoleChange", () => {
  it("administrator cannot grant the administrator role", () => {
    const res = validateRoleChange({
      actorRoles: [ROLES.ADMINISTRATOR],
      currentRoles: [ROLES.AUTHOR],
      requestedRoles: [ROLES.AUTHOR, ROLES.ADMINISTRATOR],
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toContain("administrator");
  });

  it("administrator cannot revoke the administrator role", () => {
    const res = validateRoleChange({
      actorRoles: [ROLES.ADMINISTRATOR],
      currentRoles: [ROLES.AUTHOR, ROLES.ADMINISTRATOR],
      requestedRoles: [ROLES.AUTHOR],
    });
    expect(res.ok).toBe(false);
  });

  it("superadmin can grant the administrator role", () => {
    const res = validateRoleChange({
      actorRoles: [ROLES.SUPERADMIN],
      currentRoles: [ROLES.AUTHOR],
      requestedRoles: [ROLES.AUTHOR, ROLES.ADMINISTRATOR],
    });
    expect(res.ok).toBe(true);
  });

  it("manager may create a learner but not an author", () => {
    expect(
      validateRoleChange({
        actorRoles: [ROLES.MANAGER],
        currentRoles: [],
        requestedRoles: [ROLES.LEARNER],
        atCreation: true,
      }).ok,
    ).toBe(true);

    expect(
      validateRoleChange({
        actorRoles: [ROLES.MANAGER],
        currentRoles: [],
        requestedRoles: [ROLES.AUTHOR],
        atCreation: true,
      }).ok,
    ).toBe(false);
  });

  it("manager cannot change roles of an existing user", () => {
    const res = validateRoleChange({
      actorRoles: [ROLES.MANAGER],
      currentRoles: [],
      requestedRoles: [ROLES.LEARNER],
      atCreation: false,
    });
    expect(res.ok).toBe(false);
  });

  it("only a superadmin may modify a superadmin account", () => {
    const base = {
      currentRoles: [ROLES.AUTHOR],
      requestedRoles: [ROLES.AUTHOR, ROLES.MANAGER],
      targetIsSuperadmin: true,
    } as const;
    expect(validateRoleChange({ ...base, actorRoles: [ROLES.ADMINISTRATOR] }).ok).toBe(false);
    expect(validateRoleChange({ ...base, actorRoles: [ROLES.SUPERADMIN] }).ok).toBe(true);
  });

  it("rejects invalid or non-stored roles in the request", () => {
    expect(
      validateRoleChange({
        actorRoles: [ROLES.SUPERADMIN],
        currentRoles: [],
        requestedRoles: ["superadmin"],
      }).ok,
    ).toBe(false);
    expect(
      validateRoleChange({
        actorRoles: [ROLES.SUPERADMIN],
        currentRoles: [],
        requestedRoles: ["bogus"],
      }).ok,
    ).toBe(false);
  });

  it("allows a no-op change regardless of actor privilege", () => {
    const res = validateRoleChange({
      actorRoles: [ROLES.AUTHOR],
      currentRoles: [ROLES.AUTHOR],
      requestedRoles: [ROLES.AUTHOR],
    });
    expect(res.ok).toBe(true);
  });

  it("administrator can grant a combined author + manager set", () => {
    const res = validateRoleChange({
      actorRoles: [ROLES.ADMINISTRATOR],
      currentRoles: [ROLES.LEARNER],
      requestedRoles: [ROLES.AUTHOR, ROLES.MANAGER],
    });
    expect(res.ok).toBe(true);
  });
});
