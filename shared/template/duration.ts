/**
 * @module shared/template/duration
 *
 * The ONE place a time budget turns into text for a learner — both the static
 * limit printed on the start screen / section intro and the running countdown in
 * the scene header, on BOTH hosts.
 *
 * Why it exists: the limit used to be printed as a raw minute count with the unit
 * hardcoded in every layout (`<span data-path="course.timeLimitMinutes"></span>
 * мин`), so a two-week budget read «20160 мин» and its countdown «20160:00».
 * The template DSL deliberately supports no helpers or expressions (see
 * {@link module:shared/template/dsl}), so the decomposition into days / hours /
 * minutes cannot live in a layout — the context has to hand the layout a finished
 * string, and that string is built here.
 *
 * Framework-free and pure, so the web host imports it directly and the SCORM
 * package gets the same functions through the `TBTemplate` bundle instead of
 * keeping a plain-JS copy that would drift.
 */

/** Minutes in an hour / in a day — named so the arithmetic below reads. */
const MIN_PER_HOUR = 60;
const MIN_PER_DAY = 24 * MIN_PER_HOUR;

/** Seconds in a minute / hour / day, for the countdown side. */
const SEC_PER_MIN = 60;
const SEC_PER_HOUR = 60 * SEC_PER_MIN;
const SEC_PER_DAY = 24 * SEC_PER_HOUR;

/**
 * Decline «день» for a day count by the Russian rules (1 день, 2 дня, 5 дней,
 * 11 дней, 21 день).
 * @param {number} n Whole day count.
 * @returns {string} The matching form of the word.
 */
function pluralDays(n: number): string {
  const hundred = n % 100;
  if (hundred >= 11 && hundred <= 14) return "дней";
  const ten = n % 10;
  if (ten === 1) return "день";
  if (ten >= 2 && ten <= 4) return "дня";
  return "дней";
}

/** Whole, non-negative minutes, or 0 for anything unusable (null / NaN / < 0). */
function wholeMinutes(minutes: number | null | undefined): number {
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes <= 0) return 0;
  return Math.floor(minutes);
}

/** Two-digit zero padding for the countdown's minute / second fields. */
function pad2(n: number): string {
  return n < 10 ? "0" + n : String(n);
}

/**
 * A time limit as a learner-readable phrase: days spelled out and declined, hours
 * and minutes abbreviated, empty parts dropped — «14 дней», «1 день 2 ч»,
 * «2 ч 30 мин», «45 мин».
 *
 * @param {number|null|undefined} minutes The budget in minutes.
 * @returns {string} The phrase, or an empty string when there is no limit —
 *   which is what the layouts' `{{#if …}}` gates on, so an unlimited test prints
 *   no fact at all.
 */
export function formatMinutesHuman(minutes: number | null | undefined): string {
  const total = wholeMinutes(minutes);
  if (total === 0) return "";

  const days = Math.floor(total / MIN_PER_DAY);
  const hours = Math.floor((total % MIN_PER_DAY) / MIN_PER_HOUR);
  const mins = total % MIN_PER_HOUR;

  const parts: string[] = [];
  if (days > 0) parts.push(days + " " + pluralDays(days));
  if (hours > 0) parts.push(hours + " ч");
  if (mins > 0) parts.push(mins + " мин");
  return parts.join(" ");
}

/**
 * The running countdown: `M:SS` while under an hour, `H:MM:SS` from an hour up
 * and `D д H:MM:SS` from a day up. A spent or negative remainder clamps to
 * «0:00», so the display never goes negative between the last tick and the
 * forced submit.
 *
 * @param {number} seconds Seconds left.
 * @returns {string} The countdown text.
 */
export function formatCountdown(seconds: number): string {
  const total = typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0
    ? Math.floor(seconds)
    : 0;

  const days = Math.floor(total / SEC_PER_DAY);
  const hours = Math.floor((total % SEC_PER_DAY) / SEC_PER_HOUR);
  const mins = Math.floor((total % SEC_PER_HOUR) / SEC_PER_MIN);
  const secs = total % SEC_PER_MIN;

  if (days > 0) return days + " д " + hours + ":" + pad2(mins) + ":" + pad2(secs);
  if (hours > 0) return hours + ":" + pad2(mins) + ":" + pad2(secs);
  return mins + ":" + pad2(secs);
}
