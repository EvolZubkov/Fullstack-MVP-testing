/**
 * @module tests/attempt-interval-engine
 *
 * PRD-31 barrier B: absolute hour interval between attempts INSIDE one
 * assignment. Unlike the calendar-day cooldown (barrier A) this is wall-clock
 * arithmetic on ISO instants, so the tests pin the boundary to the millisecond.
 */
import { describe, it, expect } from "vitest";
import { attemptIntervalDecision, parseIsoInstant, formatIsoInstant } from "../shared/eligibility/engine";

describe("attemptIntervalDecision", () => {
  it("allows when there is no previous attempt", () => {
    expect(attemptIntervalDecision(null, "2026-08-01T10:00:00.000Z", 24)).toEqual({
      allowed: true,
      availableAt: null,
      msSince: null,
      effectiveNow: null,
    });
  });

  it("blocks strictly before the interval elapses", () => {
    const d = attemptIntervalDecision("2026-08-01T10:00:00.000Z", "2026-08-02T09:59:59.999Z", 24);
    expect(d.allowed).toBe(false);
    expect(d.availableAt).toBe("2026-08-02T10:00:00.000Z");
    expect(d.msSince).toBe(86399999);
  });

  it("allows exactly at the boundary", () => {
    const d = attemptIntervalDecision("2026-08-01T10:00:00.000Z", "2026-08-02T10:00:00.000Z", 24);
    expect(d.allowed).toBe(true);
    expect(d.availableAt).toBe("2026-08-02T10:00:00.000Z");
  });

  it("clamps a clock reported BEFORE the last attempt (FR-TD-05 analogue)", () => {
    const d = attemptIntervalDecision("2026-08-01T10:00:00.000Z", "2026-07-20T00:00:00.000Z", 24);
    expect(d.allowed).toBe(false);
    expect(d.effectiveNow).toBe("2026-08-01T10:00:00.000Z");
    expect(d.msSince).toBe(0);
  });

  it("treats an unparseable instant as no data (allowed)", () => {
    expect(attemptIntervalDecision("garbage", "2026-08-01T10:00:00.000Z", 24).allowed).toBe(true);
    expect(attemptIntervalDecision("2026-08-01T10:00:00.000Z", "garbage", 24).allowed).toBe(true);
  });

  it("parses and formats ISO instants round-trip", () => {
    expect(parseIsoInstant("2026-08-01T10:00:00.000Z")).toBe(1785578400000);
    expect(formatIsoInstant(1785578400000)).toBe("2026-08-01T10:00:00.000Z");
    expect(parseIsoInstant("")).toBeNull();
    expect(parseIsoInstant("garbage")).toBeNull();
  });
});
