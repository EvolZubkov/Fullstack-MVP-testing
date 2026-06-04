/**
 * @module shared/eligibility/plugins
 *
 * Pure logic of the two PRD-6 MVP eligibility plugins. Side effects (the WebTutor
 * `fetch`, reading SCORM `suspend_data`) live in the runtime; these functions
 * take already-fetched inputs so they are deterministic and testable:
 *
 * - `webtutor_cooldown` — filter the course records to "full attempts", pick the
 *   latest date, decide by calendar cooldown (PRD-6 §3.6/§4.2).
 * - `suspend_data_cooldown` — best-effort: decide from a date carried in
 *   `suspend_data` (within the same SCORM registration only, PRD-6 §4.6).
 *
 * A plain-JS twin runs in the package (server/scorm/template/app/eligibility/);
 * kept in parity by tests/eligibility-engine-port.test.ts.
 */

import { cooldownDecision, parseIsoDate } from "./engine";
import type { EligibilityContext, EligibilityResult } from "./types";

/** Filter that selects a "full attempt" record from WebTutor output (PRD-6 §3.3). */
export interface WebtutorAttemptFilter {
  /** Field holding the record state/status; default "state". */
  stateField?: string;
  stateIn?: string[];
  excludeStateIn?: string[];
  /** Field holding the progress value; default "progress". */
  progressField?: string;
  progressCompletePattern?: string;
  /** Field holding the usage/completion date. */
  dateField: string;
  /** Date format of `dateField`; default "dd.MM.yyyy". */
  dateFormat?: string;
}

export type WebtutorRecord = Record<string, unknown>;

/**
 * Parse a WebTutor date string to ISO `YYYY-MM-DD`. Supports ISO passthrough and
 * day-first `dd.MM.yyyy` / `dd/MM/yyyy` (the common WebTutor format). Returns null
 * if it cannot parse.
 */
export function parseFlexibleDate(value: string, format: string): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(value);
  if (m && /d.*m.*y/i.test(format)) {
    return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
}

/**
 * Select the latest "full attempt" date from WebTutor records by applying the
 * configurable filter (state/progress/date). Returns ISO `YYYY-MM-DD` or null.
 */
export function selectLastAttemptDate(
  records: WebtutorRecord[] | null | undefined,
  filter: WebtutorAttemptFilter,
): string | null {
  const stateField = filter.stateField || "state";
  const progressField = filter.progressField || "progress";
  const fmt = filter.dateFormat || "dd.MM.yyyy";
  const excl = filter.excludeStateIn || [];
  const progRe = filter.progressCompletePattern ? new RegExp(filter.progressCompletePattern) : null;
  let bestEpoch: number | null = null;
  let bestStr: string | null = null;
  for (const rec of records || []) {
    if (!rec) continue;
    const state = rec[stateField] != null ? String(rec[stateField]) : "";
    if (filter.stateIn && filter.stateIn.indexOf(state) === -1) continue;
    if (excl.indexOf(state) !== -1) continue;
    if (progRe) {
      const prog = rec[progressField] != null ? String(rec[progressField]) : "";
      if (!progRe.test(prog)) continue;
    }
    const raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : "";
    const iso = parseFlexibleDate(raw, fmt);
    if (!iso) continue;
    const epoch = parseIsoDate(iso);
    if (epoch == null) continue;
    if (bestEpoch == null || epoch > bestEpoch) {
      bestEpoch = epoch;
      bestStr = iso;
    }
  }
  return bestStr;
}

/** Build a normalized cooldown result from a resolved last-attempt date. */
function cooldownResult(
  lastAttemptDate: string | null,
  context: EligibilityContext,
  source: string,
): EligibilityResult {
  const days = context.retakePolicy.cooldownPeriodDays;
  const today = context.runtime.todayDate;
  const dec = cooldownDecision(lastAttemptDate, today, days);
  return {
    allowed: dec.allowed,
    reason: dec.allowed ? (lastAttemptDate ? "cooldown_passed" : "no_prior_attempt") : "cooldown_active",
    source,
    availableDate: dec.availableDate,
    data: {
      lastAttemptDate: lastAttemptDate ?? null,
      todayDate: today,
      nextAllowedDate: dec.availableDate,
      cooldownPeriodDays: days,
    },
  };
}

/**
 * `webtutor_cooldown` decision from already-fetched records (PRD-6 §3.6).
 * The runtime fetches `records` from WebTutor endpoints, then calls this.
 */
export function webtutorCooldownDecide(
  records: WebtutorRecord[] | null | undefined,
  filter: WebtutorAttemptFilter,
  context: EligibilityContext,
): EligibilityResult {
  return cooldownResult(selectLastAttemptDate(records, filter), context, "webtutor_cooldown");
}

/**
 * `suspend_data_cooldown` decision from a date carried in `suspend_data`
 * (best-effort, same-registration only, PRD-6 §4.6).
 */
export function suspendDataCooldownDecide(
  lastCompletedDate: string | null,
  context: EligibilityContext,
): EligibilityResult {
  return cooldownResult(lastCompletedDate, context, "suspend_data_cooldown");
}
