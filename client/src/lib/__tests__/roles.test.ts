/**
 * @module lib/__tests__/roles.test
 * @description Unit tests for the role display helpers (PRD-13): label/description
 * maps cover every role identifier, and `formatRoles` emits labels in the stable
 * priority order regardless of the input order (and yields "" for empty input).
 */
import { describe, expect, it } from "vitest";
import { ROLES, ROLE_PRIORITY, type Role } from "@shared/access";
import { ROLE_LABELS, ROLE_DESCRIPTIONS, formatRoles } from "../roles";

describe("roles display helpers", () => {
  it("provides a label and a description for every role", () => {
    for (const role of Object.values(ROLES)) {
      expect(ROLE_LABELS[role]).toBeTruthy();
      expect(ROLE_DESCRIPTIONS[role]).toBeTruthy();
    }
  });

  it("formatRoles returns labels joined in priority order (highest first)", () => {
    // Pass the roles out of priority order to prove it re-sorts them.
    const input: Role[] = [ROLES.LEARNER, ROLES.SUPERADMIN, ROLES.AUTHOR];
    const result = formatRoles(input);
    expect(result).toBe(
      [ROLE_LABELS[ROLES.SUPERADMIN], ROLE_LABELS[ROLES.AUTHOR], ROLE_LABELS[ROLES.LEARNER]].join(", "),
    );
  });

  it("formatRoles omits roles not present in the set", () => {
    expect(formatRoles([ROLES.MANAGER])).toBe(ROLE_LABELS[ROLES.MANAGER]);
  });

  it("formatRoles returns an empty string for empty or missing input", () => {
    expect(formatRoles([])).toBe("");
    expect(formatRoles(undefined)).toBe("");
  });

  it("ROLE_PRIORITY drives the ordering deterministically", () => {
    const all = [...ROLE_PRIORITY];
    const formatted = formatRoles(all).split(", ");
    expect(formatted).toEqual(ROLE_PRIORITY.map((r) => ROLE_LABELS[r]));
  });
});
