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

describe("retakePolicySchema — PRD-31 attemptInterval", () => {
  it("accepts an interval-only policy without cooldownPeriodDays", () => {
    const parsed = retakePolicySchema.parse({
      enabled: false,
      attemptInterval: { enabled: true, hours: 24 },
    });
    expect(parsed.attemptInterval).toEqual({ enabled: true, hours: 24 });
    expect(parsed.cooldownPeriodDays).toBeUndefined();
  });

  it("still requires cooldownPeriodDays when the cooldown is enabled", () => {
    expect(() => retakePolicySchema.parse({ enabled: true })).toThrow();
  });

  it("requires hours when the interval is enabled", () => {
    expect(() =>
      retakePolicySchema.parse({ enabled: false, attemptInterval: { enabled: true } }),
    ).toThrow();
  });

  it("rejects an interval out of [1, 8760]", () => {
    for (const hours of [0, 8761, 1.5]) {
      expect(() =>
        retakePolicySchema.parse({ enabled: false, attemptInterval: { enabled: true, hours } }),
      ).toThrow();
    }
  });

  it("treats an absent attemptInterval as disabled", () => {
    const parsed = retakePolicySchema.parse({ enabled: true, cooldownPeriodDays: 30 });
    expect(parsed.attemptInterval ?? null).toBeNull();
  });

  it("keeps both barriers when both are configured", () => {
    const parsed = retakePolicySchema.parse({
      enabled: true,
      cooldownPeriodDays: 30,
      attemptInterval: { enabled: true, hours: 24 },
    });
    expect(parsed.cooldownPeriodDays).toBe(30);
    expect(parsed.attemptInterval).toEqual({ enabled: true, hours: 24 });
  });
});

describe("retakePolicySchema — PRD-40 cooldownByOutcome", () => {
  it("defaults cooldownByOutcome to false and does not require the split fields", () => {
    const p = retakePolicySchema.parse({ enabled: true, cooldownPeriodDays: 30 });
    expect(p.cooldownByOutcome).toBe(false);
    expect(p.cooldownPeriodDaysPassed).toBeUndefined();
    expect(p.cooldownPeriodDaysFailed).toBeUndefined();
  });

  it("requires both split fields when cooldownByOutcome is on", () => {
    expect(() =>
      retakePolicySchema.parse({ enabled: true, cooldownByOutcome: true, cooldownPeriodDaysPassed: 90 }),
    ).toThrow();
    expect(() =>
      retakePolicySchema.parse({ enabled: true, cooldownByOutcome: true, cooldownPeriodDaysFailed: 7 }),
    ).toThrow();
  });

  it("accepts both split fields and does not require cooldownPeriodDays", () => {
    const p = retakePolicySchema.parse({
      enabled: true,
      cooldownByOutcome: true,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
    });
    expect(p.cooldownPeriodDaysPassed).toBe(90);
    expect(p.cooldownPeriodDaysFailed).toBe(7);
    expect(p.cooldownPeriodDays).toBeUndefined();
  });

  it("rejects split fields out of [1, 3650]", () => {
    expect(() =>
      retakePolicySchema.parse({
        enabled: true,
        cooldownByOutcome: true,
        cooldownPeriodDaysPassed: 0,
        cooldownPeriodDaysFailed: 7,
      }),
    ).toThrow();
    expect(() =>
      retakePolicySchema.parse({
        enabled: true,
        cooldownByOutcome: true,
        cooldownPeriodDaysPassed: 90,
        cooldownPeriodDaysFailed: 4000,
      }),
    ).toThrow();
  });

  it("cooldownByOutcome off does not require the split fields even when true previously", () => {
    const p = retakePolicySchema.parse({
      enabled: true,
      cooldownByOutcome: false,
      cooldownPeriodDays: 30,
      cooldownPeriodDaysPassed: 90,
      cooldownPeriodDaysFailed: 7,
    });
    expect(p.enabled).toBe(true);
    expect(p.cooldownPeriodDays).toBe(30);
  });
});
