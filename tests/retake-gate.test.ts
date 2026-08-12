/**
 * @module tests/retake-gate
 *
 * Unit tests for the server-side retake cooldown decision — barrier A of the web
 * access model (PRD-6 / PRD-12, reframed by PRD-31). The calendar math itself is
 * the shared engine's, so these tests focus on the web wiring: the gate is inert
 * unless enabled, no prior attempt is allowed, and an active cooldown is blocked
 * with the correct availableDate. The route wiring is covered by the attempts
 * route tests; the assignment model as such by `retake-gate-assignment.test.ts`.
 *
 * Since PRD-31 barrier A guards the boundary BETWEEN assignments, every case here
 * is expressed through `acrossAssignments`: a prior attempt of an earlier
 * assignment, and a current assignment the learner has not attempted yet. That is
 * the situation the old three-argument signature described.
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

/** The barrier-A situation: a prior assignment's attempt, a fresh assignment now. */
const acrossAssignments = (
  p: RetakePolicy | null,
  lastAttemptDate: string | null,
  todayDate: string,
): RetakeGateResult =>
  decideRetake(p, {
    currentAssignmentId: "new",
    attempts: lastAttemptDate
      ? [{ assignmentId: "old", finishedAt: new Date(`${lastAttemptDate}T00:00:00Z`) }]
      : [],
    now: new Date(`${todayDate}T00:00:00Z`),
  });

describe("decideRetake", () => {
  it("is allowed when there is no policy", () => {
    expect(acrossAssignments(null, "2026-01-01", "2026-06-06").allowed).toBe(true);
  });

  it("is allowed when the policy is disabled", () => {
    expect(acrossAssignments(policy({ enabled: false }), "2026-06-06", "2026-06-06").allowed).toBe(true);
  });

  it("is allowed when there is no prior completed attempt", () => {
    const out = acrossAssignments(policy(), null, "2026-06-06");
    expect(out.allowed).toBe(true);
    expect(out.availableDate).toBeUndefined();
  });

  it("blocks while inside the cooldown window and reports availableDate", () => {
    // last attempt 2026-06-01, cooldown 30 days -> available 2026-07-01.
    const out = acrossAssignments(policy({ cooldownPeriodDays: 30 }), "2026-06-01", "2026-06-06");
    expect(out.allowed).toBe(false);
    expect(out.reason).toBe("cooldown_active");
    expect(out.blockedBy).toBe("cooldown");
    expect(out.cooldownPeriodDays).toBe(30);
    expect(out.availableDate).toBe("2026-07-01");
  });

  it("allows once the cooldown has elapsed (boundary = exactly N days)", () => {
    // last attempt 2026-06-01, +30 days = 2026-07-01 is the first allowed day.
    expect(acrossAssignments(policy({ cooldownPeriodDays: 30 }), "2026-06-01", "2026-06-30").allowed).toBe(false);
    expect(acrossAssignments(policy({ cooldownPeriodDays: 30 }), "2026-06-01", "2026-07-01").allowed).toBe(true);
  });
});

describe("decideRetake — daysUntil", () => {
  it("reports a countdown from the server date while access is blocked", () => {
    const gate = acrossAssignments(policy({ cooldownPeriodDays: 30 }), "2026-05-20", "2026-06-16");
    expect(gate.allowed).toBe(false);
    expect(gate.availableDate).toBe("2026-06-19");
    expect(gate.daysUntil).toBe(3);
  });

  it("omits the countdown once access is open", () => {
    const gate = acrossAssignments(policy({ cooldownPeriodDays: 30 }), "2026-05-20", "2026-06-19");
    expect(gate.allowed).toBe(true);
    expect(gate.daysUntil).toBeUndefined();
  });

  it("counts from effectiveToday, not the raw todayDate, when the reported clock precedes the last attempt", () => {
    // "now" (2026-06-01) is BEFORE the last attempt (2026-06-20) — an untrusted
    // clock. The engine clamps effectiveToday to the last attempt date, so the
    // countdown must run the full cooldown (30), not 49 days from the raw date.
    const gate = acrossAssignments(policy({ cooldownPeriodDays: 30 }), "2026-06-20", "2026-06-01");
    expect(gate.allowed).toBe(false);
    expect(gate.availableDate).toBe("2026-07-20");
    expect(gate.daysUntil).toBe(30);
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
