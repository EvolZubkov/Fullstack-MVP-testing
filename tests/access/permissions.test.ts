// Golden tests for the access control permission layer (PRD-13).
// The expected per-role capability sets below mirror the matrix in
// docs/specs/access-control/role-model.md (section 4) and act as the oracle:
// if the code and the document drift, these tests fail.

import { describe, it, expect } from "vitest";
import {
  CAPABILITIES,
  SCOPE_AWARE_CAPABILITIES,
  ROLE_PERMISSIONS,
  hasPermission,
  getPermissions,
  hasAllPermissions,
  effectiveRoles,
  primaryRole,
  isStoredRole,
  hasAuthoringRole,
  ROLES,
  type Capability,
} from "@shared/access";

const SUPERADMIN_ONLY: Capability[] = ["system.config", "system.roles.assignAdmin"];

const EXPECTED_LEARNER: Capability[] = [
  "auth.self",
  "attempts.take",
  "attempts.self.read",
];

const EXPECTED_MANAGER: Capability[] = [
  "auth.self",
  "attempts.take",
  "attempts.self.read",
  "tests.read",
  "assignments.manage",
  "groups.manage",
  "users.read",
  "users.create",
  "analytics.read",
  "analytics.export",
];

const EXPECTED_AUTHOR: Capability[] = [
  "auth.self",
  "attempts.take",
  "attempts.self.read",
  "topics.read",
  "topics.manage",
  "topics.access.grant",
  "questions.read",
  "questions.manage",
  "questions.importExport",
  "folders.manage",
  "media.manage",
  "tests.read",
  "tests.create",
  "tests.edit",
  "tests.publish",
  "tests.delete",
  // SCORM generation is NOT here: it belongs to the developer role. The author
  // keeps the in-service debug run over the same edit scope.
  "tests.debug.play",
  "tests.access.grant",
  "templates.read",
  "analytics.read",
  "analytics.export",
];

/** The developer is the author plus SCORM generation and the template registry. */
const EXPECTED_DEVELOPER: Capability[] = [
  ...EXPECTED_AUTHOR,
  "tests.export.scorm",
  "adminTemplates.manage",
];

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

describe("capability catalogue", () => {
  it("has 35 unique capabilities", () => {
    expect(CAPABILITIES.length).toBe(35);
    expect(new Set(CAPABILITIES).size).toBe(CAPABILITIES.length);
  });

  it("scope-aware capabilities are all real capabilities", () => {
    for (const cap of SCOPE_AWARE_CAPABILITIES) {
      expect(CAPABILITIES).toContain(cap);
    }
  });
});

describe("role -> permission map (golden)", () => {
  it("learner has only self and test-taking", () => {
    expect(sorted(ROLE_PERMISSIONS[ROLES.LEARNER])).toEqual(sorted(EXPECTED_LEARNER));
  });

  it("manager matches the matrix", () => {
    expect(sorted(ROLE_PERMISSIONS[ROLES.MANAGER])).toEqual(sorted(EXPECTED_MANAGER));
  });

  it("author matches the matrix", () => {
    expect(sorted(ROLE_PERMISSIONS[ROLES.AUTHOR])).toEqual(sorted(EXPECTED_AUTHOR));
  });

  it("developer matches the matrix", () => {
    expect(sorted(ROLE_PERMISSIONS[ROLES.DEVELOPER])).toEqual(sorted(EXPECTED_DEVELOPER));
  });

  it("SCORM generation separates the developer from the author", () => {
    expect(hasPermission([ROLES.AUTHOR], "tests.export.scorm")).toBe(false);
    expect(hasPermission([ROLES.DEVELOPER], "tests.export.scorm")).toBe(true);
    // The debug run stays with both — it is a separate capability.
    expect(hasPermission([ROLES.AUTHOR], "tests.debug.play")).toBe(true);
    expect(hasPermission([ROLES.DEVELOPER], "tests.debug.play")).toBe(true);
  });

  it("administrator has all capabilities except the superadmin-only ones", () => {
    expect(ROLE_PERMISSIONS[ROLES.ADMINISTRATOR].size).toBe(CAPABILITIES.length - 2);
    for (const cap of CAPABILITIES) {
      const expected = !SUPERADMIN_ONLY.includes(cap);
      expect(ROLE_PERMISSIONS[ROLES.ADMINISTRATOR].has(cap)).toBe(expected);
    }
  });

  it("superadmin has every capability", () => {
    expect(ROLE_PERMISSIONS[ROLES.SUPERADMIN].size).toBe(CAPABILITIES.length);
    for (const cap of CAPABILITIES) {
      expect(ROLE_PERMISSIONS[ROLES.SUPERADMIN].has(cap)).toBe(true);
    }
  });
});

describe("hasPermission / getPermissions (union over roles)", () => {
  it("superadmin holds system capabilities, administrator does not", () => {
    expect(hasPermission([ROLES.SUPERADMIN], "system.config")).toBe(true);
    expect(hasPermission([ROLES.SUPERADMIN], "system.roles.assignAdmin")).toBe(true);
    expect(hasPermission([ROLES.ADMINISTRATOR], "system.config")).toBe(false);
    expect(hasPermission([ROLES.ADMINISTRATOR], "system.roles.assignAdmin")).toBe(false);
  });

  it("learner cannot read tests, author can", () => {
    expect(hasPermission([ROLES.LEARNER], "tests.read")).toBe(false);
    expect(hasPermission([ROLES.AUTHOR], "tests.read")).toBe(true);
  });

  it("author + manager is the union of both sets", () => {
    const roles = [ROLES.AUTHOR, ROLES.MANAGER];
    // From author:
    expect(hasPermission(roles, "tests.edit")).toBe(true);
    // From manager:
    expect(hasPermission(roles, "groups.manage")).toBe(true);
    expect(hasPermission(roles, "assignments.manage")).toBe(true);
    // From neither:
    expect(hasPermission(roles, "adminTemplates.manage")).toBe(false);
    expect(hasPermission(roles, "logs.read")).toBe(false);

    const union = new Set([...EXPECTED_AUTHOR, ...EXPECTED_MANAGER]);
    expect(getPermissions(roles).size).toBe(union.size);
  });

  it("hasAllPermissions requires every capability", () => {
    expect(hasAllPermissions([ROLES.AUTHOR], ["tests.edit", "tests.publish"])).toBe(true);
    expect(hasAllPermissions([ROLES.AUTHOR], ["tests.edit", "groups.manage"])).toBe(false);
  });

  it("unknown roles contribute nothing", () => {
    expect(getPermissions(["bogus" as never]).size).toBe(0);
    expect(hasPermission(["bogus" as never], "auth.self")).toBe(false);
  });
});

describe("role helpers", () => {
  it("isStoredRole excludes superadmin and unknowns", () => {
    expect(isStoredRole("author")).toBe(true);
    expect(isStoredRole("administrator")).toBe(true);
    expect(isStoredRole("superadmin")).toBe(false);
    expect(isStoredRole("bogus")).toBe(false);
  });

  it("effectiveRoles prepends superadmin only when flagged", () => {
    expect(effectiveRoles(["author"], false)).toEqual(["author"]);
    expect(effectiveRoles(["author"], true)).toEqual([ROLES.SUPERADMIN, "author"]);
  });

  it("primaryRole returns the highest-priority role", () => {
    expect(primaryRole([ROLES.MANAGER, ROLES.AUTHOR])).toBe(ROLES.AUTHOR);
    expect(primaryRole([ROLES.SUPERADMIN, ROLES.LEARNER])).toBe(ROLES.SUPERADMIN);
    expect(primaryRole([ROLES.AUTHOR, ROLES.DEVELOPER])).toBe(ROLES.DEVELOPER);
    expect(primaryRole([])).toBeNull();
  });

  it("hasAuthoringRole covers author and developer only", () => {
    expect(hasAuthoringRole([ROLES.AUTHOR])).toBe(true);
    expect(hasAuthoringRole([ROLES.DEVELOPER])).toBe(true);
    expect(hasAuthoringRole([ROLES.MANAGER, ROLES.LEARNER])).toBe(false);
    expect(hasAuthoringRole([ROLES.ADMINISTRATOR])).toBe(false);
    expect(hasAuthoringRole([])).toBe(false);
  });
});
