/**
 * @module client/src/pages/learner/__tests__/cooldown-format
 *
 * Unit tests for the web start-screen cooldown date formatter (PRD-19 Block F,
 * FR-20). Formats the next-available date for the cooldown card on the SAME
 * start page (no separate block-wall) and must match the SCORM gate's
 * `fmtDateHuman` so both hosts render the date identically (ДД.ММ.ГГГГ). The
 * «через N дн.» countdown is a server decision (PRD-6) and is not covered here —
 * see `tests/retake-gate.test.ts`.
 */

import { describe, it, expect } from "vitest";
import { fmtIsoDateHuman } from "../cooldown-format";

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
