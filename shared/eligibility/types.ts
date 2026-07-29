/**
 * @module shared/eligibility/types
 *
 * Contracts for the PRD-6 retake gate / cooldown. An eligibility plugin is an
 * explicit admission function: Core does not know how a plugin obtains data, it
 * only knows the `evaluate(context) -> boolean | EligibilityResult` contract
 * (PRD-6 §3.4). Core normalizes the verdict, applies the test's `failPolicy` on
 * error, and exposes a `retake.*` state to the block-wall page (§4.4 / §5.4).
 */

/** Minimal, PII-free context handed to a plugin's `evaluate` (PRD-6 §3.4). */
export interface EligibilityContext {
  test: { id: string; title: string };
  retakePolicy: { cooldownPeriodDays: number };
  runtime: { todayDate: string; timezone?: string; launchUrl?: string };
  lms?: { scormVersion?: string; sessionId?: string };
  /** Admin-managed plugin config (endpoints, filter, parsing) from the registry. */
  config?: Record<string, unknown>;
}

/** Normalized plugin result (PRD-6 §3.4). */
export interface EligibilityResult {
  allowed: boolean;
  reason?: string;
  source?: string;
  /** Calendar date (YYYY-MM-DD) from which retake is allowed; null if unknown. */
  availableDate?: string | null;
  data?: Record<string, string | number | boolean | null>;
}

/** A plugin may return a bare boolean or a full result; Core normalizes both. */
export type EligibilityVerdict = boolean | EligibilityResult;

/** The eligibility plugin contract Core depends on (PRD-6 §3.4). */
export interface EligibilityPlugin {
  key: string;
  version: string;
  evaluate(context: EligibilityContext): Promise<EligibilityVerdict> | EligibilityVerdict;
}

/**
 * Runtime state surfaced to the block-wall and diagnostics (PRD-6 §5.4 / §4.4).
 * `nextAllowedDate` is a compatibility alias of `availableDate`.
 */
export interface RetakeState {
  checked: boolean;
  allowed: boolean;
  lastAttemptDate: string | null;
  todayDate: string | null;
  /**
   * "Today" as the cooldown decision actually used it: `todayDate` clamped forward
   * to `lastAttemptDate` when the reported clock precedes the attempt. Null when the
   * plugin reported no such value (no prior attempt, unparseable dates, or a verdict
   * that did not come from the cooldown math at all — e.g. a `failPolicy` fallback).
   * Countdown renderers MUST prefer this over `todayDate`, or they will disagree with
   * `allowed`.
   */
  effectiveToday: string | null;
  availableDate: string | null;
  nextAllowedDate: string | null;
  cooldownPeriodDays: number | null;
  source: string | null;
  reason: string | null;
}
