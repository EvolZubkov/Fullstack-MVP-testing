/**
 * @module tests/eligibility-engine
 * @description Unit tests for the PRD-6 eligibility engine
 * (shared/eligibility/engine.ts): calendar-day cooldown math, verdict
 * normalization, failPolicy, retake-state, and the evaluate orchestration.
 */
import { describe, it, expect } from "vitest";
import {
  parseIsoDate,
  formatIsoDate,
  cooldownDecision,
  daysUntilDate,
  normalizeVerdict,
  applyFailPolicy,
  buildRetakeState,
  evaluateEligibility,
  CORE_DEFAULT_RESULT,
} from "../shared/eligibility/engine";
import type { EligibilityContext } from "../shared/eligibility/types";

const ctx = (over: Partial<EligibilityContext> = {}): EligibilityContext => ({
  test: { id: "t1", title: "T" },
  retakePolicy: { cooldownPeriodDays: 30 },
  runtime: { todayDate: "2026-05-08" },
  ...over,
});

describe("date parsing", () => {
  it("parses and formats ISO dates round-trip", () => {
    const e = parseIsoDate("2026-05-08")!;
    expect(formatIsoDate(e)).toBe("2026-05-08");
  });
  it("rejects malformed / impossible dates", () => {
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-02-31")).toBeNull();
    expect(parseIsoDate("nope")).toBeNull();
  });
});

describe("cooldownDecision (calendar days, FR §4.3)", () => {
  it("blocks before the cooldown elapses; availableDate = last + days", () => {
    const d = cooldownDecision("2026-05-08", "2026-05-08", 30);
    expect(d.allowed).toBe(false);
    expect(d.availableDate).toBe("2026-06-07");
    expect(d.daysSince).toBe(0);
  });
  it("allows exactly on the boundary (>= cooldown)", () => {
    const d = cooldownDecision("2026-05-08", "2026-06-07", 30);
    expect(d.daysSince).toBe(30);
    expect(d.allowed).toBe(true);
  });
  it("no prior attempt => allowed, no availableDate", () => {
    const d = cooldownDecision(null, "2026-05-08", 30);
    expect(d).toEqual({ allowed: true, availableDate: null, daysSince: null, effectiveToday: null });
  });

  it("clamps an untrusted 'today' reported earlier than the last attempt", () => {
    // Machine clock rolled back behind the last attempt: impossible state, so the
    // clock is not trusted and the cooldown runs its full length from the attempt.
    const rolledBack = cooldownDecision("2026-05-20", "2026-05-01", 30);
    expect(rolledBack.allowed).toBe(false);
    expect(rolledBack.daysSince).toBe(0);
    expect(rolledBack.availableDate).toBe("2026-06-19");
    expect(rolledBack.effectiveToday).toBe("2026-05-20");
  });

  it("leaves a trustworthy 'today' unchanged as effectiveToday", () => {
    const d = cooldownDecision("2026-05-20", "2026-06-19", 30);
    expect(d).toEqual({
      allowed: true,
      availableDate: "2026-06-19",
      daysSince: 30,
      effectiveToday: "2026-06-19",
    });
  });
});

describe("normalizeVerdict", () => {
  it("normalizes a bare boolean", () => {
    expect(normalizeVerdict(true)).toEqual({ allowed: true, availableDate: null });
  });
  it("falls back to legacy data.nextAllowedDate for availableDate", () => {
    const r = normalizeVerdict({ allowed: false, data: { nextAllowedDate: "2026-06-07" } });
    expect(r.availableDate).toBe("2026-06-07");
  });
  it("prefers explicit availableDate over the legacy alias", () => {
    const r = normalizeVerdict({ allowed: false, availableDate: "2026-06-07", data: { nextAllowedDate: "2000-01-01" } });
    expect(r.availableDate).toBe("2026-06-07");
  });
});

describe("applyFailPolicy", () => {
  it("failOpen => allowed", () => {
    expect(applyFailPolicy("failOpen", "boom").allowed).toBe(true);
  });
  it("failClosed => blocked", () => {
    expect(applyFailPolicy("failClosed", "boom").allowed).toBe(false);
  });
});

describe("buildRetakeState", () => {
  it("mirrors availableDate into nextAllowedDate and lifts lastAttemptDate from data", () => {
    const s = buildRetakeState(
      { allowed: false, availableDate: "2026-06-07", source: "webtutor_cooldown", reason: "cooldown_active", data: { lastAttemptDate: "2026-05-08" } },
      { todayDate: "2026-05-08", cooldownPeriodDays: 30 },
    );
    expect(s).toMatchObject({
      checked: true,
      allowed: false,
      lastAttemptDate: "2026-05-08",
      availableDate: "2026-06-07",
      nextAllowedDate: "2026-06-07",
      cooldownPeriodDays: 30,
      source: "webtutor_cooldown",
      reason: "cooldown_active",
    });
  });
});

describe("evaluateEligibility orchestration", () => {
  it("no plugin => core default allowed", async () => {
    const r = await evaluateEligibility({ pluginRef: null, runPlugin: null, context: ctx() });
    expect(r).toEqual(CORE_DEFAULT_RESULT);
  });
  it("runs and normalizes a plugin verdict", async () => {
    const r = await evaluateEligibility({
      pluginRef: { key: "p" },
      runPlugin: async () => ({ allowed: false, availableDate: "2026-06-07", source: "p" }),
      context: ctx(),
    });
    expect(r.allowed).toBe(false);
    expect(r.availableDate).toBe("2026-06-07");
  });
  it("applies failPolicy when the plugin throws (failClosed blocks)", async () => {
    const r = await evaluateEligibility({
      pluginRef: { key: "p", failPolicy: "failClosed" },
      runPlugin: async () => {
        throw new Error("endpoint down");
      },
      context: ctx(),
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe("plugin_error_fail_closed");
    expect(r.data?.error).toBe("endpoint down");
  });
  it("failOpen allows on plugin error", async () => {
    const r = await evaluateEligibility({
      pluginRef: { key: "p", failPolicy: "failOpen" },
      runPlugin: () => {
        throw new Error("timeout");
      },
      context: ctx(),
    });
    expect(r.allowed).toBe(true);
    expect(r.reason).toBe("plugin_error_fail_open");
  });
});

describe("daysUntilDate", () => {
  it("counts whole days to a future date", () => {
    expect(daysUntilDate("2026-06-30", "2026-06-28")).toBe(2);
  });

  it("returns null for today and the past", () => {
    expect(daysUntilDate("2026-06-30", "2026-06-30")).toBeNull();
    expect(daysUntilDate("2026-06-29", "2026-06-30")).toBeNull();
  });

  it("returns null for empty and unparseable input", () => {
    expect(daysUntilDate(null, "2026-06-30")).toBeNull();
    expect(daysUntilDate("garbage", "2026-06-30")).toBeNull();
    expect(daysUntilDate("2026-06-30", "garbage")).toBeNull();
  });
});
