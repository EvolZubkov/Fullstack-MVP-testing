/**
 * @module shared/eligibility/engine
 *
 * Authoritative, pure core for the PRD-6 retake gate. Two concerns:
 *
 * 1. Cooldown date math — calendar-day arithmetic on `YYYY-MM-DD` dates
 *    (no time-of-day): `allowed = (today - lastAttempt) >= cooldownPeriodDays`,
 *    `availableDate = lastAttempt + cooldownPeriodDays` (PRD-6 §4.1/§4.3).
 * 2. Verdict normalization + orchestration — turn a plugin's `boolean |
 *    EligibilityResult` into a normalized result, default to `allowed` when no
 *    plugin is configured, and apply the test's `failPolicy` on error (§3.4/§4.5).
 *
 * A plain-JS twin runs inside the SCORM package
 * (server/scorm/template/app/eligibility/engine.js); a golden test keeps them in
 * parity (tests/eligibility-engine-port.test.ts).
 */

import type {
  EligibilityContext,
  EligibilityResult,
  EligibilityVerdict,
  RetakeState,
} from "./types";

/** Minimal plugin reference the engine needs (subset of retakePolicy.eligibilityPlugin). */
type PluginRef = { key: string; failPolicy?: "failOpen" | "failClosed" } | null | undefined;

const DAY_MS = 86400000;

/**
 * Parse a `YYYY-MM-DD` date to an integer epoch-day (UTC midnight); returns null
 * for malformed or non-existent dates (e.g. `2026-02-31`).
 */
export function parseIsoDate(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  const y = +m[1];
  const mo = +m[2];
  const d = +m[3];
  const t = Date.UTC(y, mo - 1, d);
  const dt = new Date(t);
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return Math.floor(t / DAY_MS);
}

/** Format an integer epoch-day back to `YYYY-MM-DD`. */
export function formatIsoDate(epochDay: number): string {
  const dt = new Date(epochDay * DAY_MS);
  const y = dt.getUTCFullYear();
  const mo = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const d = String(dt.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export interface CooldownDecision {
  allowed: boolean;
  availableDate: string | null;
  daysSince: number | null;
}

/**
 * Calendar-day cooldown decision. No prior attempt (`lastAttemptDate` null/
 * unparseable) => allowed with no `availableDate` (PRD-6 §4.3).
 */
export function cooldownDecision(
  lastAttemptDate: string | null,
  todayDate: string,
  cooldownPeriodDays: number,
): CooldownDecision {
  const today = parseIsoDate(todayDate);
  const last = lastAttemptDate ? parseIsoDate(lastAttemptDate) : null;
  if (last == null || today == null) {
    return { allowed: true, availableDate: null, daysSince: null };
  }
  const daysSince = today - last;
  return {
    allowed: daysSince >= cooldownPeriodDays,
    availableDate: formatIsoDate(last + cooldownPeriodDays),
    daysSince,
  };
}

/** Default result when no plugin is configured for the test (PRD-6 §3.4). */
export const CORE_DEFAULT_RESULT: EligibilityResult = {
  allowed: true,
  reason: "plugin_not_defined",
  source: "core_default",
  availableDate: null,
};

/** Normalize a plugin verdict to a full result; `data.nextAllowedDate` is a fallback. */
export function normalizeVerdict(verdict: EligibilityVerdict): EligibilityResult {
  if (typeof verdict === "boolean") {
    return { allowed: verdict, availableDate: null };
  }
  const r = verdict || ({ allowed: false } as EligibilityResult);
  const legacy = r.data && typeof r.data.nextAllowedDate === "string" ? r.data.nextAllowedDate : null;
  return {
    allowed: !!r.allowed,
    reason: r.reason,
    source: r.source,
    availableDate: r.availableDate ?? legacy ?? null,
    data: r.data,
  };
}

/** Apply the test's `failPolicy` when a plugin throws or times out (PRD-6 §4.5). */
export function applyFailPolicy(
  failPolicy: "failOpen" | "failClosed" | undefined,
  error: string,
): EligibilityResult {
  const failClosed = failPolicy === "failClosed";
  return {
    allowed: !failClosed,
    reason: failClosed ? "plugin_error_fail_closed" : "plugin_error_fail_open",
    source: "core_failpolicy",
    availableDate: null,
    data: { error },
  };
}

/** Build the `retake.*` runtime state from a normalized result (PRD-6 §5.4). */
export function buildRetakeState(
  result: EligibilityResult,
  ctx: { todayDate: string; cooldownPeriodDays: number },
): RetakeState {
  const lastAttemptDate =
    result.data && typeof result.data.lastAttemptDate === "string" ? result.data.lastAttemptDate : null;
  return {
    checked: true,
    allowed: result.allowed,
    lastAttemptDate,
    todayDate: ctx.todayDate,
    availableDate: result.availableDate ?? null,
    nextAllowedDate: result.availableDate ?? null,
    cooldownPeriodDays: ctx.cooldownPeriodDays,
    source: result.source ?? null,
    reason: result.reason ?? null,
  };
}

/**
 * Evaluate eligibility end-to-end. `runPlugin` is injected (the runtime supplies
 * the resolved plugin's `evaluate`), so the orchestration — default-allow when
 * no plugin, normalize on success, `failPolicy` on error — is testable in isolation.
 */
export async function evaluateEligibility(args: {
  pluginRef: PluginRef;
  runPlugin: ((ctx: EligibilityContext) => Promise<EligibilityVerdict> | EligibilityVerdict) | null;
  context: EligibilityContext;
}): Promise<EligibilityResult> {
  const { pluginRef, runPlugin, context } = args;
  if (!pluginRef || !pluginRef.key || !runPlugin) {
    return CORE_DEFAULT_RESULT;
  }
  try {
    return normalizeVerdict(await runPlugin(context));
  } catch (e) {
    return applyFailPolicy(pluginRef.failPolicy, e instanceof Error ? e.message : String(e));
  }
}
