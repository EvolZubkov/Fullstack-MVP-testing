/**
 * @module shared/eligibility/plugins
 *
 * Pure logic of the PRD-6 `webtutor_cooldown` eligibility plugin. Side effects
 * (the WebTutor `fetch`) live in the runtime; these functions take already-fetched
 * inputs so they are deterministic and testable: filter the course records to
 * "full attempts", pick the latest date, decide by calendar cooldown
 * (PRD-6 §3.6/§4.2; PRD-40 splits the cooldown period by the winning record's
 * outcome).
 *
 * A plain-JS twin runs in the package (server/scorm/template/app/eligibility/);
 * kept in parity by tests/eligibility-engine-port.test.ts.
 */

import { cooldownDecision, parseIsoDate, resolveCooldownDays } from "./engine";
import type { EligibilityContext, EligibilityResult } from "./types";

/** Filter that selects a "full attempt" record from WebTutor output (PRD-6 §3.3). */
export interface WebtutorAttemptFilter {
  /** Field holding the record state/status; default "state". */
  stateField?: string;
  /**
   * States that count as a FINISHED attempt (any outcome). On the RT portal the
   * learning-record grid reports `state` as «Пройден» / «Не пройден» — BOTH are
   * finished attempts, so both must be listed here. The cooldown fires after any
   * finished attempt (requirement), so this must NOT be pass-only.
   */
  stateIn?: string[];
  excludeStateIn?: string[];
  /**
   * Field holding the progress value; default "progress". Only enforced when
   * `progressCompletePattern` is set. On the RT grid `progress` is «X из Y баллов»
   * (not a percent), so completion is decided by `state`, not progress — leave
   * `progressCompletePattern` unset there.
   */
  progressField?: string;
  progressCompletePattern?: string;
  /** Field holding the usage/completion date. */
  dateField: string;
  /** Date format of `dateField`; default "dd.MM.yyyy". */
  dateFormat?: string;
  /**
   * PRD-40: subset of `stateIn` whose records count as a PASSED attempt (vs. a
   * finished-but-failed one). Absent -> the outcome of any selected record is
   * unknown (`passed: null`), which `resolveCooldownDays` treats conservatively.
   */
  passedStateIn?: string[];
  /**
   * Field holding the course NAME. When set together with a `courseName` argument,
   * only records whose name matches (normalized) are considered — so all ASSIGNMENTS
   * of the same course (separate records, distinct object_ids, same name) are treated
   * as ONE course and their latest attempt wins.
   */
  nameField?: string;
  /**
   * Raw date values to treat as "no real attempt" sentinels (e.g. «31.12.9999» that
   * WebTutor uses for an open-ended assignment that was never actually taken). Matched
   * as substrings against the raw date; such records are skipped.
   */
  excludeDateValues?: string[];
}

/** Normalize a course name for tolerant matching (trim + collapse ws + lowercase). */
function normalizeName(s: string): string {
  return String(s || "").replace(/\s+/g, " ").trim().toLowerCase();
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
 * Select the latest FINISHED-attempt RECORD from WebTutor records by applying the
 * configurable filter (state/name/date). Returns the raw record or null — callers
 * derive whatever field they need (date via `selectLastAttemptDate`, outcome via
 * `recordPassed`).
 */
export function selectLastAttemptRecord(
  records: WebtutorRecord[] | null | undefined,
  filter: WebtutorAttemptFilter,
  courseName?: string,
): WebtutorRecord | null {
  const stateField = filter.stateField || "state";
  const progressField = filter.progressField || "progress";
  const fmt = filter.dateFormat || "dd.MM.yyyy";
  const excl = filter.excludeStateIn || [];
  const progRe = filter.progressCompletePattern ? new RegExp(filter.progressCompletePattern) : null;
  const wantName = filter.nameField && courseName ? normalizeName(courseName) : null;
  const sentinels = filter.excludeDateValues || [];
  let bestEpoch: number | null = null;
  let bestRec: WebtutorRecord | null = null;
  for (const rec of records || []) {
    if (!rec) continue;
    if (wantName) {
      const name = normalizeName(rec[filter.nameField as string] != null ? String(rec[filter.nameField as string]) : "");
      if (name !== wantName) continue;
    }
    const state = rec[stateField] != null ? String(rec[stateField]) : "";
    if (filter.stateIn && filter.stateIn.indexOf(state) === -1) continue;
    if (excl.indexOf(state) !== -1) continue;
    if (progRe) {
      const prog = rec[progressField] != null ? String(rec[progressField]) : "";
      if (!progRe.test(prog)) continue;
    }
    const raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : "";
    if (sentinels.some((s) => raw.indexOf(s) !== -1)) continue;
    const iso = parseFlexibleDate(raw, fmt);
    if (!iso) continue;
    const epoch = parseIsoDate(iso);
    if (epoch == null) continue;
    if (bestEpoch == null || epoch > bestEpoch) {
      bestEpoch = epoch;
      bestRec = rec;
    }
  }
  return bestRec;
}

/**
 * Select the latest FINISHED-attempt DATE from WebTutor records (PRD-6 §3.3).
 * Thin wrapper over `selectLastAttemptRecord` kept for backward compatibility with
 * existing callers/tests.
 */
export function selectLastAttemptDate(
  records: WebtutorRecord[] | null | undefined,
  filter: WebtutorAttemptFilter,
  courseName?: string,
): string | null {
  const rec = selectLastAttemptRecord(records, filter, courseName);
  if (!rec) return null;
  const raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : "";
  return parseFlexibleDate(raw, filter.dateFormat || "dd.MM.yyyy");
}

/**
 * PRD-40: was the given record a PASSED attempt? `null` when `passedStateIn` is
 * not configured (outcome not determinable from this filter) or `rec` is null.
 */
export function recordPassed(
  rec: WebtutorRecord | null,
  filter: WebtutorAttemptFilter,
): boolean | null {
  if (!rec || !filter.passedStateIn) return null;
  const stateField = filter.stateField || "state";
  const state = rec[stateField] != null ? String(rec[stateField]) : "";
  return filter.passedStateIn.indexOf(state) !== -1;
}

/** Build a normalized cooldown result from a resolved last-attempt date + outcome. */
function cooldownResult(
  lastAttemptDate: string | null,
  passed: boolean | null,
  context: EligibilityContext,
  source: string,
): EligibilityResult {
  const days = resolveCooldownDays(context.retakePolicy, passed);
  const today = context.runtime.todayDate;
  const dec = cooldownDecision(lastAttemptDate, today, days ?? 0);
  return {
    allowed: dec.allowed,
    reason: dec.allowed ? (lastAttemptDate ? "cooldown_passed" : "no_prior_attempt") : "cooldown_active",
    source,
    availableDate: dec.availableDate,
    data: {
      lastAttemptDate: lastAttemptDate ?? null,
      todayDate: today,
      // Normalized "today" (clamped forward when the reported clock precedes the
      // attempt). Countdowns must derive from THIS, not from `todayDate`.
      effectiveToday: dec.effectiveToday,
      nextAllowedDate: dec.availableDate,
      cooldownPeriodDays: days,
    },
  };
}

/**
 * `webtutor_cooldown` decision from already-fetched records (PRD-6 §3.6).
 * The runtime fetches `records` from WebTutor endpoints, then calls this.
 * `courseName` (the test title) scopes the selection to one course across all its
 * assignments when the filter declares a `nameField`. PRD-40: the outcome of the
 * SAME winning record (`recordPassed`) resolves which configured period applies.
 */
export function webtutorCooldownDecide(
  records: WebtutorRecord[] | null | undefined,
  filter: WebtutorAttemptFilter,
  context: EligibilityContext,
  courseName?: string,
): EligibilityResult {
  const rec = selectLastAttemptRecord(records, filter, courseName);
  const date = rec ? parseFlexibleDate(String(rec[filter.dateField] ?? ""), filter.dateFormat || "dd.MM.yyyy") : null;
  return cooldownResult(date, recordPassed(rec, filter), context, "webtutor_cooldown");
}

/** Cooldown decision from an already-resolved last-attempt date, any source. */
export function cooldownDecideFromDate(
  lastAttemptDate: string | null,
  context: EligibilityContext,
  source: string,
): EligibilityResult {
  return cooldownResult(lastAttemptDate, null, context, source);
}

/** Unescape the HTML/XML entities WebTutor uses inside its SOAP `<result>` XAML. */
export function unescapeXml(s: string): string {
  return String(s || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#10;/g, " ")
    .replace(/&#9;/g, " ")
    .replace(/&amp;/g, "&");
}

/** First 32-hex SECID token in a page (PRD-6: scraped from the course card). */
export function extractSecid(text: string, pattern?: string): string | null {
  const m = new RegExp(pattern || "[A-F0-9]{32}").exec(String(text || ""));
  return m ? m[0] : null;
}

/**
 * Completion date from the WebTutor `get_metadata` response (the course-card
 * XAML). Looks for the «Курс был пройден» block (`completionMarker`) and the
 * date after it. Absence of the block = no prior completion => null (allowed).
 */
export function extractCourseCompletionDate(
  responseText: string,
  opts: { completionMarker?: string; dateFormat?: string } = {},
): string | null {
  const text = unescapeXml(responseText);
  const marker = opts.completionMarker || "best_learn_step_success";
  const at = text.indexOf(marker);
  if (at < 0) return null;
  const scope = text.slice(at, at + 600);
  const m = /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(scope);
  return m ? parseFlexibleDate(m[1], opts.dateFormat || "dd.MM.yyyy") : null;
}
