// Tests for the «Импорт» file kinds by role (stage E6, owner decision 2026-10-02).

import { describe, it, expect } from "vitest";
import { canImportAny, importKindsFor, ROLES } from "@shared/access";

describe("importKindsFor", () => {
  it("manager: LMS exports and users lists only — no tests, workbooks or templates", () => {
    expect(importKindsFor([ROLES.MANAGER])).toEqual(["lmsExport", "users"]);
  });

  it("author: workbooks and test packages, no users lists or templates", () => {
    const kinds = importKindsFor([ROLES.AUTHOR]);
    expect(kinds).toContain("workbook");
    expect(kinds).toContain("package");
    expect(kinds).not.toContain("users");
    expect(kinds).not.toContain("template");
  });

  it("administrator: every kind", () => {
    expect(importKindsFor([ROLES.ADMINISTRATOR])).toEqual(["workbook", "lmsExport", "package", "users", "template"]);
  });

  it("learner: nothing, and the section is closed", () => {
    expect(importKindsFor([ROLES.LEARNER])).toEqual([]);
    expect(canImportAny([ROLES.LEARNER])).toBe(false);
  });

  it("the section opens with any import right", () => {
    expect(canImportAny([ROLES.MANAGER])).toBe(true);
  });
});
