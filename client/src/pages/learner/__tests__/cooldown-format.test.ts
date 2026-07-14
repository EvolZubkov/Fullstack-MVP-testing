/**
 * @module client/src/pages/learner/__tests__/cooldown-format
 *
 * Unit tests for the web start-screen cooldown date helpers (PRD-19 Block F,
 * FR-20). These format the next-available date for the cooldown card on the SAME
 * start page (no separate block-wall) and must match the SCORM gate's
 * `fmtDateHuman` / `daysUntilIso` so both hosts render the date identically
 * (ДД.ММ.ГГГГ) and the optional «через N дн.» line agrees.
 */

import { describe, it, expect, afterEach, vi } from "vitest";
import { fmtIsoDateHuman, daysUntilIsoDate } from "../cooldown-format";

describe("fmtIsoDateHuman", () => {
  it("formats a YYYY-MM-DD ISO date as ДД.ММ.ГГГГ", () => {
    expect(fmtIsoDateHuman("2026-06-30")).toBe("30.06.2026");
  });

  it("tolerates an ISO datetime suffix", () => {
    expect(fmtIsoDateHuman("2026-12-01T00:00:00Z")).toBe("01.12.2026");
  });

  it("returns empty string for null/undefined/unparseable input", () => {
    expect(fmtIsoDateHuman(null)).toBe("");
    expect(fmtIsoDateHuman(undefined)).toBe("");
    expect(fmtIsoDateHuman("not-a-date")).toBe("");
  });
});

describe("daysUntilIsoDate", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts whole days from today to a future date (UTC granularity)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-28T10:00:00Z"));
    expect(daysUntilIsoDate("2026-06-30")).toBe(2);
  });

  it("returns null for today and past dates (no «через N дн.» line)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-30T23:00:00Z"));
    expect(daysUntilIsoDate("2026-06-30")).toBeNull();
    expect(daysUntilIsoDate("2026-06-29")).toBeNull();
  });

  it("returns null for null/unparseable input", () => {
    expect(daysUntilIsoDate(null)).toBeNull();
    expect(daysUntilIsoDate("garbage")).toBeNull();
  });
});
