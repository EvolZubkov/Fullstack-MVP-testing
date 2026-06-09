/**
 * @module server/services/retake-gate
 *
 * Server-side retake cooldown decision for the web learner runtime (PRD-6 in the
 * web; PRD-12). It reuses the authoritative calendar-day cooldown math
 * (`@shared/eligibility/engine.cooldownDecision`) but sources the date from the
 * server's own completed attempts (`attempts.finishedAt`) instead of an LMS
 * plugin — in the web the server is the authoritative date source, so the
 * `eligibilityPlugin` machinery (webtutor_cooldown) is not involved.
 *
 * Storage-free and unit-testable: the route supplies `lastAttemptDate` from the
 * DB. The gate is inert unless the test's `retakePolicy.enabled === true`, so
 * legacy tests are unaffected.
 */

import { cooldownDecision } from "@shared/eligibility/engine";
import type { RetakePolicy } from "@shared/schema";

/** Outcome of the retake gate; spread into the 403 deny body when blocked. */
export interface RetakeGateResult {
  allowed: boolean;
  reason?: string;
  cooldownPeriodDays?: number;
  lastAttemptDate?: string | null;
  /** Calendar date (`YYYY-MM-DD`) from which a retake is allowed, if known. */
  availableDate?: string | null;
}

/** Format a Date to a calendar `YYYY-MM-DD` (UTC), matching the cooldown math. */
export function toIsoDateUTC(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Most recent completed-attempt date (`YYYY-MM-DD` UTC), or null when none. */
export function lastCompletedAttemptDate(
  finishedAts: Array<Date | string | null | undefined>,
): string | null {
  let max = 0;
  for (const f of finishedAts) {
    if (!f) continue;
    const t = new Date(f).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max > 0 ? toIsoDateUTC(new Date(max)) : null;
}

/**
 * Decides whether a new attempt is allowed under the test's retake policy. Inert
 * (always allowed) unless `enabled === true`; otherwise applies a calendar-day
 * cooldown against the last completed attempt.
 */
export function decideRetake(
  retakePolicy: RetakePolicy | null | undefined,
  lastAttemptDate: string | null,
  todayDate: string,
): RetakeGateResult {
  if (!retakePolicy || retakePolicy.enabled !== true) {
    return { allowed: true };
  }
  const cooldownPeriodDays = retakePolicy.cooldownPeriodDays;
  const decision = cooldownDecision(lastAttemptDate, todayDate, cooldownPeriodDays);
  return {
    allowed: decision.allowed,
    reason: decision.allowed ? undefined : "cooldown_active",
    cooldownPeriodDays,
    lastAttemptDate,
    availableDate: decision.availableDate,
  };
}
