/**
 * @module tests/retake-gate
 *
 * Unit tests for the server-side retake cooldown decision (PRD-12 / PRD-6 in the
 * web; server/services/retake-gate). The decision is pure — the calendar math is
 * the shared engine's, so these tests focus on the web wiring: the gate is inert
 * unless enabled, no prior attempt is allowed, and an active cooldown is blocked
 * with the correct availableDate. The route wiring is covered by the attempts
 * route tests.
 */

import { describe, it, expect } from "vitest";
import {
  decideRetake,
  lastCompletedAttemptDate,
  toIsoDateUTC,
  type RetakeGateResult,
} from "../server/services/retake-gate";
import type { RetakePolicy } from "../shared/schema";

const policy = (overrides: Partial<RetakePolicy> = {}): RetakePolicy =>
  ({
    enabled: true,
    cooldownPeriodDays: 30,
    gateMode: "before_internal_start",
    eligibilityPlugin: null,
    ...overrides,
  }) as RetakePolicy;

describe("decideRetake", () => {
  it("is allowed when there is no policy", () => {
    expect(decideRetake(null, "2026-01-01", "2026-06-06").allowed).toBe(true);
  });

  it("is allowed when the policy is disabled", () => {
    expect(decideRetake(policy({ enabled: false }), "2026-06-06", "2026-06-06").allowed).toBe(true);
  });

  it("is allowed when there is no prior completed attempt", () => {
    const out = decideRetake(policy(), null, "2026-06-06");
    expect(out.allowed).toBe(true);
    expect(out.availableDate).toBeNull();
  });

  it("blocks while inside the cooldown window and reports availableDate", () => {
    // last attempt 2026-06-01, cooldown 30 days -> available 2026-07-01.
    const out: RetakeGateResult = decideRetake(policy({ cooldownPeriodDays: 30 }), "2026-06-01", "2026-06-06");
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("cooldown_active");
    expect(out.cooldownPeriodDays).toBe(30);
    expect(out.availableDate).toBe("2026-07-01");
  });

  it("allows once the cooldown has elapsed (boundary = exactly N days)", () => {
    // last attempt 2026-06-01, +30 days = 2026-07-01 is the first allowed day.
    expect(decideRetake(policy({ cooldownPeriodDays: 30 }), "2026-06-01", "2026-06-30").allowed).toBe(false);
    expect(decideRetake(policy({ cooldownPeriodDays: 30 }), "2026-06-01", "2026-07-01").allowed).toBe(true);
  });
});

describe("lastCompletedAttemptDate / toIsoDateUTC", () => {
  it("returns the most recent finishedAt as a UTC calendar date", () => {
    const dates = [new Date("2026-06-01T10:00:00Z"), new Date("2026-06-03T23:30:00Z"), null];
    expect(lastCompletedAttemptDate(dates)).toBe("2026-06-03");
  });

  it("returns null when there are no completed attempts", () => {
    expect(lastCompletedAttemptDate([null, undefined])).toBeNull();
  });

  it("formats a Date to YYYY-MM-DD (UTC)", () => {
    expect(toIsoDateUTC(new Date("2026-12-31T23:59:59Z"))).toBe("2026-12-31");
  });
});
