/**
 * @module schema-prd6-retake
 * @description Tests for the PRD-6 `retakePolicySchema` (tests.retake_policy_json):
 * defaults, the `cooldownDays` legacy alias, range and enum validation.
 */
import { describe, it, expect } from "vitest";
import { retakePolicySchema } from "../shared/schema";

describe("retakePolicySchema", () => {
  it("accepts a minimal policy and applies defaults", () => {
    const p = retakePolicySchema.parse({ cooldownPeriodDays: 30 });
    expect(p.enabled).toBe(false);
    expect(p.gateMode).toBe("before_internal_start");
  });

  it("normalizes the legacy cooldownDays alias to cooldownPeriodDays", () => {
    const p = retakePolicySchema.parse({ enabled: true, cooldownDays: 14 });
    expect(p.cooldownPeriodDays).toBe(14);
  });

  it("keeps an explicit eligibilityPlugin with failPolicy default", () => {
    const p = retakePolicySchema.parse({
      enabled: true,
      cooldownPeriodDays: 30,
      eligibilityPlugin: { key: "webtutor_cooldown", configId: "webtutor_catalog_default" },
    });
    expect(p.eligibilityPlugin?.key).toBe("webtutor_cooldown");
    expect(p.eligibilityPlugin?.failPolicy).toBe("failOpen");
  });

  it("rejects cooldownPeriodDays out of [1, 3650]", () => {
    expect(() => retakePolicySchema.parse({ cooldownPeriodDays: 0 })).toThrow();
    expect(() => retakePolicySchema.parse({ cooldownPeriodDays: 4000 })).toThrow();
    expect(() => retakePolicySchema.parse({ cooldownPeriodDays: 1.5 })).toThrow();
  });

  it("rejects an unknown failPolicy", () => {
    expect(() =>
      retakePolicySchema.parse({ cooldownPeriodDays: 30, eligibilityPlugin: { key: "x", failPolicy: "nope" } }),
    ).toThrow();
  });

  it("nullish() accepts null/undefined (= no retake gate)", () => {
    const n = retakePolicySchema.nullish();
    expect(() => n.parse(null)).not.toThrow();
    expect(() => n.parse(undefined)).not.toThrow();
  });
});
