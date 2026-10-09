/**
 * @module scripts/deps/pace
 * @description How long to wait before the next request to the corporate system.
 *
 * This tool talks to somebody else's production system under a live person's account, and we
 * have no documentation for it. The pace below rests on an assumption, not on anything observed:
 * a burst of requests could read to its defences as an attack, and an account is presumably
 * easier to get blocked than unblocked. That is the reasoning behind the numbers (spec section 5);
 * section 11 lists what about this system is still unconfirmed. The numbers live here, as a single
 * frozen object, rather than scattered through the client, so a "just make it faster" edit has one
 * place to hit a red test instead of quietly drifting past review.
 *
 * Stopping the run after repeated refusals is policy `repo-client.mjs` enforces: it keeps ONE
 * consecutive-refusal counter for the whole client — spanning every request it sends, including
 * requests for different packages — and stops the run once that counter reaches three, exactly as
 * spec section 5's "three in a row" rule requires. This module only computes the delay (and the
 * stop signal) for a single refusal at a time; the cross-request bookkeeping lives in
 * `repo-client.mjs`, not here.
 */

/**
 * Pace constants, frozen so a change here cannot be silently absorbed by a default parameter
 * somewhere else. Mirrors spec section 5 verbatim; a change to any value here must also change
 * that section, and vice versa.
 */
export const PACE = Object.freeze({
  baseDelayMs: 500,
  jitterMs: 200,
  retryBaseMs: 2000,
  retryMaxMs: 60000,
  longPauseEvery: 50,
  longPauseMs: 5000,
});

/**
 * Pause before an ordinary request: a fixed part plus a random one (always up to `PACE.jitterMs`),
 * so the requests do not arrive on a perfectly even machine grid.
 *
 * @param {number} [baseMs] Fixed part of the pause, in milliseconds. Overridable because the CLI
 *   exposes it via `--delay`; the jitter spread is not overridable — it is not a knob anyone is
 *   meant to turn.
 * @param {() => number} [random] Source of randomness in [0, 1); injected for tests.
 * @returns {number} Milliseconds to sleep.
 */
export function jitteredDelay(baseMs = PACE.baseDelayMs, random = Math.random) {
  return baseMs + Math.floor(random() * PACE.jitterMs);
}

/**
 * Parses a `Retry-After` header value into a millisecond delay from `now`.
 *
 * RFC 9110 §10.2.3 allows two forms: `delta-seconds` (a plain non-negative integer, e.g. `"120"`)
 * or an HTTP-date (e.g. `"Wed, 21 Oct 2026 07:28:00 GMT"`). Earlier this parsed only the first
 * form — `Number.parseInt` on a date string yields `NaN` (the string starts with a weekday name,
 * not a digit), so the one explicit instruction the server gave us was silently dropped and the
 * caller fell back to a generic 2-second guess. `Number.parseInt` is tried first (and, for a
 * partially-numeric string like `"2.9"`, truncates rather than rejecting — that is deliberate,
 * matching the delta-seconds tests below); only when that yields nothing usable is the value
 * retried as a date.
 *
 * @param {string|null|undefined} retryAfter Value of the `Retry-After` header, if any.
 * @param {number} now Reference time in epoch milliseconds, for the HTTP-date form.
 * @returns {number|null} Milliseconds until the asked-for retry, or null when the header is
 *   absent, unreadable, non-positive, or (for a date) already in the past.
 */
function parseRetryAfterMs(retryAfter, now) {
  const raw = retryAfter ?? "";
  const seconds = Number.parseInt(raw, 10);
  if (Number.isFinite(seconds)) {
    return seconds > 0 ? seconds * 1000 : null;
  }
  // Not delta-seconds (parseInt found no leading digit at all) — try the HTTP-date form.
  const dateMs = Date.parse(String(raw).trim());
  if (Number.isNaN(dateMs)) return null;
  const diffMs = dateMs - now;
  // A date already in the past carries no wait instruction — treat it the same as "absent"
  // rather than asking the caller to interpret a negative wait.
  return diffMs > 0 ? diffMs : null;
}

/**
 * What to do after a rate-limit-shaped refusal.
 *
 * We have not seen this system answer with 429 or 503 — the branches below are written for
 * ordinary HTTP service behaviour, not for anything measured on this particular system (spec
 * section 5). `Retry-After` is honoured verbatim, with no minute cap of ours: it is the one
 * explicit instruction the server gives us, and capping it would mean disregarding it exactly
 * where we promised not to look like an attack. When it asks for longer than a minute, the run
 * should stop rather than hold a connection open that long — the caller decides how to act on
 * `stop`; this function only reports the server's ask.
 *
 * @param {number} attempt Zero-based retry number; negative values are treated as 0.
 * @param {string|null|undefined} retryAfter Value of the `Retry-After` header, if the server sent
 *   one — either `delta-seconds` or an HTTP-date (RFC 9110 §10.2.3); see `parseRetryAfterMs`.
 * @param {number} [now] Reference time in epoch milliseconds for the HTTP-date form; injectable so
 *   a test does not depend on the wall clock. Defaults to `Date.now()`.
 * @returns {{waitMs: number, stop: boolean, askedMs: number|null}} `waitMs`: how long to sleep
 *   (meaningless when `stop` is true); `stop`: true when the server's own ask exceeds a minute;
 *   `askedMs`: what `Retry-After` asked for in milliseconds, or null when absent/unreadable.
 */
export function retryPlan(attempt, retryAfter, now = Date.now()) {
  const safeAttempt = Math.max(0, attempt);
  const askedMs = parseRetryAfterMs(retryAfter, now);
  if (askedMs !== null) {
    if (askedMs <= PACE.retryMaxMs) return { waitMs: askedMs, stop: false, askedMs };
    return { waitMs: 0, stop: true, askedMs };
  }
  const waitMs = Math.min(PACE.retryBaseMs * 2 ** safeAttempt, PACE.retryMaxMs);
  return { waitMs, stop: false, askedMs: null };
}

/**
 * Extra breather every fiftieth request.
 *
 * @param {number} index Zero-based index of the request about to be sent.
 * @returns {number} Milliseconds to sleep, usually zero.
 */
export function longPauseMs(index) {
  return index > 0 && index % PACE.longPauseEvery === 0 ? PACE.longPauseMs : 0;
}

/**
 * Promise that resolves after `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
