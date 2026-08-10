/**
 * @module server/services/retake-gate
 *
 * Server-side access decision for the web learner runtime (PRD-6 barrier A,
 * PRD-31 barrier B). The assignment is the unit of access (PRD-31 §3):
 *
 *   - inside the current assignment only barrier B applies — the hour interval
 *     since the PREVIOUS attempt of that same assignment;
 *   - on the first attempt of an assignment only barrier A applies — the calendar
 *     cooldown since the last attempt of ANY OTHER assignment.
 *
 * The two never fire at once, so a single `blockedBy` names the one in force.
 * Consulting barrier A inside an assignment would turn it back into a
 * between-attempts barrier — precisely the defect this module now avoids.
 *
 * The math is shared with the SCORM package (`@shared/eligibility/engine`), so both
 * hosts decide identically from identical facts; only the FACTS differ (here the
 * DB, there `suspend_data` plus the LMS learning records).
 *
 * Storage-free and unit-testable: the caller supplies the attempts and the clock.
 */

import {
  attemptIntervalDecision,
  cooldownDecision,
  daysUntilDate,
  formatIsoInstant,
  resolveCooldownDays,
} from "@shared/eligibility/engine";
import type { RetakePolicy } from "@shared/schema";

/** One attempt as the decision sees it. */
export interface AttemptFact {
  assignmentId: string | null;
  finishedAt: Date | string | null;
  /** PRD-40: outcome of this attempt, when known. Absent/null = outcome undetermined. */
  passed?: boolean | null;
}

/** Everything the decision needs; a route loads it once and reuses it. */
export interface RetakeFacts {
  currentAssignmentId: string | null;
  attempts: AttemptFact[];
  now: Date;
}

/** Outcome of the access decision; spread into the 403 deny body when blocked. */
export interface RetakeGateResult {
  allowed: boolean;
  /** Which barrier is in force; absent when access is open. */
  blockedBy?: "cooldown" | "attemptInterval";
  reason?: string;
  cooldownPeriodDays?: number;
  intervalHours?: number;
  lastAttemptDate?: string | null;
  /** Calendar date (`YYYY-MM-DD`) barrier A opens on. */
  availableDate?: string | null;
  /** ISO instant barrier B opens at. */
  availableAt?: string | null;
  /**
   * Whole days from the SERVER date to `availableDate`; `null` when access is open
   * or when barrier B is in force (an hour interval has no day countdown).
   */
  daysUntil?: number | null;
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

/** Most recent completed attempt (date + outcome), or null when none. */
function lastCompletedAttempt(
  attempts: AttemptFact[],
): { finishedAt: Date; passed: boolean | null } | null {
  let best: { finishedAt: Date; passed: boolean | null } | null = null;
  for (const a of attempts) {
    if (!a.finishedAt) continue;
    const t = new Date(a.finishedAt);
    if (!Number.isFinite(t.getTime())) continue;
    if (!best || t.getTime() > best.finishedAt.getTime()) {
      best = { finishedAt: t, passed: a.passed ?? null };
    }
  }
  return best;
}

/** Latest finish instant among the given attempts, as an ISO string; null when none. */
function lastFinishedInstant(attempts: AttemptFact[]): string | null {
  let max = 0;
  for (const a of attempts) {
    if (!a.finishedAt) continue;
    const t = new Date(a.finishedAt).getTime();
    if (Number.isFinite(t) && t > max) max = t;
  }
  return max > 0 ? formatIsoInstant(max) : null;
}

/**
 * PRD-31 (FR-07): completed attempts of the CURRENT assignment — the number
 * `maxAttempts` is compared against. A new assignment hands out a fresh set, which
 * is how the web now matches the SCORM package (one registration = one set).
 */
export function countAttemptsInAssignment(
  attempts: AttemptFact[],
  currentAssignmentId: string | null,
): number {
  return attempts.filter((a) => a.finishedAt != null && a.assignmentId === currentAssignmentId).length;
}

/**
 * Decides whether a new attempt is allowed. Inert (always allowed) unless at least
 * one barrier is enabled AND configured; the barriers are independent (FR-03) and
 * apply at disjoint moments (§3).
 */
export function decideRetake(
  retakePolicy: RetakePolicy | null | undefined,
  facts: RetakeFacts,
): RetakeGateResult {
  const cooldownDays = retakePolicy?.enabled === true ? retakePolicy.cooldownPeriodDays : undefined;
  const cooldownConfigured =
    retakePolicy?.enabled === true && (cooldownDays != null || retakePolicy.cooldownByOutcome === true);
  const intervalHours =
    retakePolicy?.attemptInterval?.enabled === true ? retakePolicy.attemptInterval.hours : undefined;
  if (!cooldownConfigured && intervalHours == null) return { allowed: true };

  const finished = facts.attempts.filter((a) => a.finishedAt != null);
  const inside = finished.filter((a) => a.assignmentId === facts.currentAssignmentId);

  if (inside.length > 0) {
    // A repeat INSIDE the assignment: barrier B only. Barrier A is deliberately not
    // consulted — it guards the boundary BETWEEN assignments (§3).
    if (intervalHours == null) return { allowed: true };
    const decision = attemptIntervalDecision(
      lastFinishedInstant(inside),
      formatIsoInstant(facts.now.getTime()),
      intervalHours,
    );
    if (decision.allowed) return { allowed: true };
    return {
      allowed: false,
      blockedBy: "attemptInterval",
      reason: "attempt_interval_active",
      intervalHours,
      availableAt: decision.availableAt,
      availableDate: null,
      daysUntil: null,
    };
  }

  // The FIRST attempt of this assignment: barrier A only, measured against attempts
  // of every OTHER assignment (the legacy NULL bucket counts as one of them).
  if (!cooldownConfigured) return { allowed: true };
  const outside = finished.filter((a) => a.assignmentId !== facts.currentAssignmentId);
  const lastOutside = lastCompletedAttempt(outside);
  const lastAttemptDate = lastOutside ? toIsoDateUTC(lastOutside.finishedAt) : null;
  const resolvedDays = resolveCooldownDays(
    { cooldownPeriodDays: cooldownDays, ...(retakePolicy ?? {}) },
    lastOutside?.passed ?? null,
  );
  if (resolvedDays == null) return { allowed: true };
  const decision = cooldownDecision(lastAttemptDate, toIsoDateUTC(facts.now), resolvedDays);
  if (decision.allowed) return { allowed: true };
  return {
    allowed: false,
    blockedBy: "cooldown",
    reason: "cooldown_active",
    cooldownPeriodDays: resolvedDays,
    lastAttemptDate,
    availableDate: decision.availableDate,
    availableAt: null,
    daysUntil: daysUntilDate(decision.availableDate, decision.effectiveToday),
  };
}
