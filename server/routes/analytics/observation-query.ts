/**
 * @module server/routes/analytics/observation-query
 * @description PRD-56 FR-04, PRD-66 FR-54b: ONE reading of the analytics filter conditions.
 *
 * The registry, the workbook export, psychometrics and the answers of one question all select
 * passages through the observations layer (`loadObservations`). Each of them used to translate
 * its own input into an {@link ObservationFilter}, and the copies drifted: the export read dates
 * in local time and by finish date, the registry in UTC and by start date, so a book downloaded
 * from the registry window could hold a different number of rows than the window promised.
 *
 * The translation lives here once. The input differs only in SHAPE — query string for the
 * screens, JSON body for the export — and both shapes are mapped onto the same
 * {@link ObservationConditions} before the single {@link buildObservationFilter} turns them
 * into a filter.
 */
import type { Request } from "express";
import { attemptPickFromQuery, type AttemptPick } from "@shared/analytics/attempt-pick";

import type {
  ObservationFilter,
  ObservationOutcome,
  ObservationSource,
} from "../../services/analytics/observations";

/** Sources the filter understands — the same words the screen uses. */
export const OBSERVATION_SOURCES: readonly ObservationSource[] = ["web", "telemetry", "import"];

/** Outcomes the filter understands. */
export const OBSERVATION_OUTCOMES: readonly ObservationOutcome[] = [
  "passed", "failed", "completed", "incomplete",
];

/**
 * Filter conditions before validation, independent of where they came from.
 *
 * Every list may hold junk (an unknown source, an empty string): {@link buildObservationFilter}
 * drops it, because a stale link or an old client is not a reason to fail.
 */
export interface ObservationConditions {
  testIds?: readonly string[];
  groupIds?: readonly string[];
  sources?: readonly string[];
  outcomes?: readonly string[];
  formIds?: readonly string[];
  snapshotIds?: readonly string[];
  organizations?: readonly string[];
  units?: readonly string[];
  positions?: readonly string[];
  wrongQuestionIds?: readonly string[];
  /** Period start, `YYYY-MM-DD`. */
  from?: string;
  /** Period end, `YYYY-MM-DD`, inclusive. */
  to?: string;
}

/**
 * Values of a parameter repeated several times or listed comma-separated.
 *
 * @param value raw query value (string, array of strings or `undefined`)
 * @returns trimmed non-empty items
 */
export function listOf(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw
    .flatMap(item => String(item).split(","))
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * Values of a parameter that may only be REPEATED, never comma-separated.
 *
 * Org-structure values need this: a comma occurs inside an organisation name
 * («ООО «Альфа, Бета»»), so splitting on it would invent two organisations.
 *
 * @param value raw query value
 * @returns trimmed non-empty items
 */
export function repeatedOf(value: unknown): string[] {
  return (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .map(item => String(item).trim())
    .filter(Boolean);
}

/**
 * A date of the period.
 *
 * The end of the period is the end of the DAY: «по 30 сентября» on screen means inclusive, and
 * without it the passages of the last day would silently vanish from the selection.
 *
 * @param value `YYYY-MM-DD`
 * @param edge which edge of the day
 * @returns the instant, or `undefined` for an empty or unparsable value
 */
export function dateOf(value: unknown, edge: "start" | "end"): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Strings of a JSON array; anything else is an empty list. */
function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "")
      .map(item => item.trim())
    : [];
}

/**
 * Turn conditions into an observation filter.
 *
 * Unknown sources and outcomes are dropped, empty lists are left out entirely: an absent
 * condition means «any», and an empty list in the filter would mean the same only by accident
 * of the DAL.
 *
 * @param conditions conditions in either input shape, already mapped
 * @returns the filter, without paging and sorting
 */
export function buildObservationFilter(conditions: ObservationConditions): ObservationFilter {
  const clean = (list: readonly string[] | undefined) => (list ?? []).filter(Boolean);
  const testIds = clean(conditions.testIds);
  const groupIds = clean(conditions.groupIds);
  const sources = clean(conditions.sources).filter((s): s is ObservationSource =>
    (OBSERVATION_SOURCES as readonly string[]).includes(s));
  const outcomes = clean(conditions.outcomes).filter((o): o is ObservationOutcome =>
    (OBSERVATION_OUTCOMES as readonly string[]).includes(o));
  // A variant and a version are conditions INSIDE one test: other tests have their own. The
  // screen offers them only for a single selected test; here they are taken as given.
  const formIds = clean(conditions.formIds);
  const snapshotIds = clean(conditions.snapshotIds);
  const organizations = clean(conditions.organizations);
  const units = clean(conditions.units);
  const positions = clean(conditions.positions);
  const wrongQuestionIds = clean(conditions.wrongQuestionIds);
  const from = dateOf(conditions.from, "start");
  const to = dateOf(conditions.to, "end");

  return {
    ...(testIds.length ? { testIds } : {}),
    ...(groupIds.length ? { groupIds } : {}),
    ...(formIds.length ? { formIds } : {}),
    ...(snapshotIds.length ? { snapshotIds } : {}),
    ...(organizations.length ? { organizations } : {}),
    ...(units.length ? { units } : {}),
    ...(positions.length ? { positions } : {}),
    ...(wrongQuestionIds.length ? { wrongQuestionIds } : {}),
    ...(sources.length ? { sources } : {}),
    ...(outcomes.length ? { outcomes } : {}),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

/**
 * Conditions from the address of a screen (registry, test page, psychometrics).
 *
 * @param query `req.query`
 */
export function conditionsFromQuery(query: Request["query"]): ObservationConditions {
  return {
    testIds: listOf(query.testId),
    groupIds: listOf(query.groupId),
    sources: listOf(query.source),
    outcomes: listOf(query.outcome),
    formIds: listOf(query.formId),
    snapshotIds: listOf(query.snapshotId),
    organizations: repeatedOf(query.organization),
    units: repeatedOf(query.unit),
    positions: repeatedOf(query.position),
    // FR-17: «ошиблись на вопросе» — the jump from a question row of the test analytics.
    wrongQuestionIds: listOf(query.wrongQuestionId),
    from: typeof query.from === "string" ? query.from : undefined,
    to: typeof query.to === "string" ? query.to : undefined,
  };
}

/**
 * Conditions from the JSON body of the workbook export (`POST /api/export/excel`).
 *
 * The body names the fields in the plural and the period `dateFrom` / `dateTo` — the shape the
 * registry export window has always sent.
 *
 * @param body request body
 */
export function conditionsFromBody(body: unknown): ObservationConditions {
  const b = (body ?? {}) as Record<string, unknown>;
  return {
    testIds: stringsOf(b.testIds),
    groupIds: stringsOf(b.groupIds),
    sources: stringsOf(b.sources),
    outcomes: stringsOf(b.outcomes),
    formIds: stringsOf(b.formIds),
    snapshotIds: stringsOf(b.snapshotIds),
    organizations: stringsOf(b.organizations),
    units: stringsOf(b.units),
    positions: stringsOf(b.positions),
    wrongQuestionIds: stringsOf(b.wrongQuestionIds),
    from: typeof b.dateFrom === "string" ? b.dateFrom : undefined,
    to: typeof b.dateTo === "string" ? b.dateTo : undefined,
  };
}

/**
 * Conditions of the test page for one test — the reading psychometrics has always used.
 *
 * The test comes from the route, not from the address. The outcome condition and «ошиблись на
 * вопросе» are not read: the test page does not offer them, and psychometrics computed over
 * only the failed passages would be a different statistic, not a narrower one.
 *
 * @param req request whose query carries the page filter
 * @param testId the test of the route
 * @param attemptsByDefault what an absent `attempts` (and legacy `firstAttemptOnly`) means
 * @returns the filter and which attempt of each participant to keep (PRD-66 FR-51)
 */
export function readTestFilterQuery(
  req: Request,
  testId: string,
  attemptsByDefault: AttemptPick,
): { filter: ObservationFilter; attempts: AttemptPick } {
  const attempts = attemptPickFromQuery(req.query, attemptsByDefault);
  const conditions = conditionsFromQuery(req.query);
  return {
    attempts,
    filter: buildObservationFilter({
      ...conditions,
      testIds: [testId],
      outcomes: [],
      wrongQuestionIds: [],
    }),
  };
}
