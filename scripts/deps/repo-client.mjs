/**
 * @module scripts/deps/repo-client
 * @description Asks the corporate system whether a package version is allowed.
 *
 * The client carries no verdicts: it delivers records and nothing else. Everything it knows
 * about the API was recovered from a saved session and the client bundle — there is no
 * documentation. The request shape mirrors what was observed for the real web client's call to
 * `POST /gateway/artifacts/findArtifacts`: `npm.name`/`npm.scope`/`npm.version`, `offset`,
 * `limit` and `strict: false` all match. `state` is the one field we deviate on ON PURPOSE: of
 * eighteen recorded requests, eight carried an empty `state: {}` and ten carried
 * `state: {"statuses":["PERMITTED"]}` (narrowing to already-permitted artifacts) — both forms
 * were genuinely observed in the session, neither is a guess standing in for the other. This
 * client always sends the empty form, deliberately, because a status filter would hide exactly
 * the RESTRICTED/forbidden records this tool exists to surface.
 *
 * Neither field the request narrows by is trustworthy on its own: the API matches BOTH name and
 * version as a SUBSTRING (spec section 2.2), so a query for "express" comes back with
 * "platform-express" and "expressive-code" mixed in among the records that are actually ours.
 * This module hands every record it gets back to the caller unfiltered — `classify.mjs` is the
 * one place strict equality on name, scope and version is enforced, and it says so in its own
 * comment. What THIS module is responsible for is noticing when that filtering might be starved
 * of the one record that matters (see `MAX_RECORDS` below) and never staying silent about it.
 */

import { PACE, jitteredDelay, longPauseMs, retryPlan, sleep as realSleep } from "./pace.mjs";
import { matchArtifact } from "./classify.mjs";

const ENDPOINT = "/gateway/artifacts/findArtifacts";
const PAGE = 50;

/**
 * How many records `findArtifacts` will collect before giving up on a package. A substring
 * search on a SHORT name (`ms` and `qs` are both in this project's lockfile) can come back almost
 * entirely as noise from unrelated packages that merely contain the same two letters, so a low
 * ceiling risks cutting the page stream off before our own exact-match
 * record ever appears — and a truncated answer that happens to omit our record is, from the
 * caller's side, indistinguishable from an honest "not in the base" (spec section 2.2/7). 1000
 * is deliberately generous for the same reason 200 turned out to be dangerous: a slow, honest
 * "we could not finish checking this one" beats a fast, wrong "forbidden". Hitting this ceiling
 * without a match throws instead of returning a quietly truncated list — see `findArtifacts`.
 */
const MAX_RECORDS = 1000;
/**
 * How many consecutive refusals stop the run (spec section 5: "three in a row"). The counter this
 * bounds lives on the CLIENT (`consecutiveRefusals` in `createClient`), not inside a single
 * `request()` call: a client is reused across every package in the run, so three refusals spread
 * across three different packages must stop it exactly as three refusals on one package would —
 * persistence in the middle of skipping from package to package is the behaviour spec section 5
 * calls out as "the one thing not to do". Any successful response resets the counter to zero.
 */
const MAX_REFUSALS = 3;
/**
 * Generous for a slow corporate network, short enough that one genuinely hung connection cannot
 * block the whole ~12-minute run forever with nobody watching the terminal.
 */
const DEFAULT_TIMEOUT_MS = 30000;

/**
 * HTTP statuses that are worth the backoff-and-retry dance ON THEIR OWN, without needing a
 * `Retry-After` header to say so (401 is handled on its own path above this check and never
 * reaches it). 429 and any 5xx are the system telling us "try again later" by their status alone.
 *
 * This is only HALF of what decides a rate-limit refusal, though — spec section 5 is explicit
 * that the OTHER half is any response, whatever its status, that carries a `Retry-After` header.
 * An earlier version of this client used `isRetryableStatus` as the WHOLE decision and treated
 * every other status (400, 403, 404, a malformed request, …) as "wrong on our side, retrying
 * won't help" — which is usually true, but not when the system attaches `Retry-After` to a `403`:
 * that combination is exactly the shape a blocked or rate-limited account answers with, and
 * treating it as "our fault, move on" meant hammering an account that had just asked to be left
 * alone. See the `retryAfterHeader` check at the call site below for the other half.
 *
 * @param {number} status
 * @returns {boolean}
 */
function isRetryableStatus(status) {
  return status === 429 || (status >= 500 && status < 600);
}

/**
 * A short Russian count phrase ("трижды", "дважды", …) for messages that state how many
 * consecutive failures triggered a stop. Deriving it from `MAX_REFUSALS` instead of writing
 * "трижды" as a literal keeps the message true if that constant ever changes — a bare literal
 * would go on claiming "three in a row" even after the threshold moved.
 *
 * @param {number} n
 * @returns {string}
 */
function timesPhrase(n) {
  if (n === 1) return "один раз";
  if (n === 2) return "дважды";
  if (n === 3) return "трижды";
  return `${n} раз`;
}

/**
 * Builds an Error that means "stop the whole run", not just "this one package failed" — the
 * cases this is used for (dead login, repeated refusals, a `Retry-After` longer than a minute)
 * are exactly the ones spec section 5 says must end the run rather than skip a package and move
 * on. The `stopRun` flag is how the CLI tells the two apart; it deliberately does NOT rely on
 * sniffing the message text with a regex, because a reworded message would silently turn a
 * required stop into a skipped package — the failure mode is invisible until the account it was
 * meant to protect gets blocked.
 *
 * @param {string} message Human-readable reason, already in the language the CLI prints.
 * @returns {Error & {stopRun: true}}
 */
function stopError(message) {
  return Object.assign(new Error(message), { stopRun: true });
}

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(opts?: {force?: boolean}) => Promise<string>} options.getToken
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random]
 * @param {string} [options.baseUrl]
 * @param {number} [options.delayMs] Pause before each request; the CLI may widen it.
 * @param {number} [options.timeoutMs] Per-request abort timeout; see `DEFAULT_TIMEOUT_MS`.
 * @returns {{findArtifacts: (pkg: object) => Promise<Array<object>>, sent: () => number}}
 */
export function createClient({
  fetchImpl = fetch,
  getToken,
  sleep = realSleep,
  random = Math.random,
  baseUrl = "https://repository.rt.ru",
  delayMs = PACE.baseDelayMs,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  let sent = 0;
  /**
   * Set once ANY request decides the whole run must stop. A client is used sequentially by the
   * CLI's for-loop, one package after another, but nothing about its own contract promises that:
   * a caller that fired `findArtifacts` for every package with `Promise.all` would otherwise turn
   * "stop asking" into a parting salvo of however many calls were already in flight. Once this is
   * set, every future call fails immediately, before any pace delay or network access — see the
   * guard at the top of `findArtifacts`.
   */
  let stoppedError = null;
  /**
   * Consecutive refusals across the WHOLE client — every request it has sent, for every package —
   * not just the retries inside one `request()` call. Spec section 5's "three in a row" is about
   * upsetting the target system, and the system does not know or care whether the third refusal in
   * a row landed on the same package as the first two or on a different one three packages later;
   * scoping this counter to a single `request()` call (as an earlier version did) meant it reset to
   * zero at every package boundary, so "three in a row" was never actually reachable for a status
   * this module does not itself retry (see the non-retryable branch in `request` below) — each such
   * refusal was recorded as "could not be asked" and the run moved on to hammer the next package.
   * Any successful response resets this to zero (see `request` below).
   */
  let consecutiveRefusals = 0;

  /** Records the stop, then throws it — the one place `stoppedError` is ever written. */
  function raiseStop(message) {
    stoppedError = stopError(message);
    throw stoppedError;
  }

  /** One request, with the pace, the 401 retry and the refusal backoff applied. */
  async function request(pkg, offset) {
    // True only for the single attempt immediately following a 401 — NOT for the rest of this
    // call's retry loop. An earlier version left this flag raised after the forced refresh
    // succeeded, so a later, unrelated 503 in the same request() call kept forcing a fresh token
    // on every retry for no reason. It is reset the instant it has been read (right after the
    // getToken() call below), so only that one attempt ever forces.
    let forceTokenRefresh = false;

    for (;;) {
      const breather = longPauseMs(sent);
      if (breather) await sleep(breather);
      await sleep(jitteredDelay(delayMs, random));
      sent += 1;

      const token = await getToken(forceTokenRefresh ? { force: true } : undefined);
      const wasForcedRefresh = forceTokenRefresh;
      forceTokenRefresh = false;

      let response;
      try {
        response = await fetchImpl(`${baseUrl}${ENDPOINT}`, {
          method: "POST",
          headers: { "Content-Type": "application/json;charset=utf-8", Authorization: `Bearer ${token}` },
          body: JSON.stringify({
            npm: { name: pkg.name, scope: pkg.scope ?? "", version: pkg.version, state: {} },
            offset,
            limit: PAGE,
            strict: false,
          }),
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch (networkError) {
        // A dropped connection or a timed-out signal never even reaches the ok/status branches
        // below, so without this it would fail (or hang) on the very first try while an ordinary
        // 5xx gets three attempts — the same transient-failure shape retried inconsistently.
        // Sharing `consecutiveRefusals` with the HTTP-status path below means three failures of
        // EITHER kind in a row stop the run, matching spec section 5's "three in a row" rule
        // regardless of which layer the failure came from — and regardless of which package each
        // one happened to be asking about (see the field's own comment above).
        consecutiveRefusals += 1;
        if (consecutiveRefusals >= MAX_REFUSALS) {
          raiseStop(`Сеть отказала ${timesPhrase(MAX_REFUSALS)} подряд (${networkError.message}): прогон остановлен`);
        }
        await sleep(retryPlan(consecutiveRefusals - 1, null).waitMs);
        continue;
      }

      if (response.ok) {
        consecutiveRefusals = 0;
        return (await response.json()).artifacts ?? [];
      }

      // Read (or at least drain) the body on every non-ok response. It is the one piece of
      // diagnosis the system gives us for a request built entirely from a reverse-engineered API
      // with no documentation — on the first live run it may be the only clue to what is wrong,
      // and leaving it unread both throws that away and keeps the connection open longer than it
      // needs to be.
      const bodyText = (await response.text().catch(() => "")).trim();
      const detail = bodyText ? `: ${bodyText}` : "";

      if (response.status === 401) {
        if (wasForcedRefresh) raiseStop(`401 от системы после обновления токена: вход больше не действует${detail}`);
        forceTokenRefresh = true;
        continue;
      }

      // Spec section 5: a rate-limit-shaped refusal is "429, 503 OR ANY OTHER RESPONSE WITH
      // Retry-After" — a `403` (or any other status) carrying `Retry-After` is exactly the shape a
      // blocked or throttled account answers with, and must be treated the same as a `429`: waited
      // out (or, past a minute, stopped on) rather than shrugged off as "our request was wrong".
      const retryAfterHeader = response.headers?.get?.("Retry-After") ?? null;
      const rateLimitRefusal = isRetryableStatus(response.status) || Boolean(retryAfterHeader);

      if (!rateLimitRefusal) {
        // Genuinely not worth retrying (no Retry-After, and not 429/5xx) — almost certainly wrong
        // on OUR side, so this one attempt is not repeated. It still counts toward the same
        // cross-client "three in a row" ceiling as every other kind of refusal: three packages in
        // a row answered this way is not proof the request is malformed (a malformed request would
        // usually say so consistently), it is just as plausibly the target system refusing
        // everything from this account — and continuing to ask 690 times is exactly the behaviour
        // spec section 5 rules out.
        consecutiveRefusals += 1;
        if (consecutiveRefusals >= MAX_REFUSALS) {
          raiseStop(`${response.status} от системы ${timesPhrase(MAX_REFUSALS)} подряд: прогон остановлен${detail}`);
        }
        throw new Error(`${response.status} от системы, повторять бессмысленно${detail}`);
      }

      consecutiveRefusals += 1;
      const plan = retryPlan(consecutiveRefusals - 1, retryAfterHeader);
      if (plan.stop) {
        raiseStop(
          `Система просит подождать ${Math.round(plan.askedMs / 1000)} секунд — это дольше минуты, ` +
            `прогон остановлен. Проверенное сохранено в кэше, вернитесь позже.${detail}`,
        );
      }
      if (consecutiveRefusals >= MAX_REFUSALS) {
        raiseStop(`${response.status} от системы ${timesPhrase(MAX_REFUSALS)} подряд: прогон остановлен${detail}`);
      }
      await sleep(plan.waitMs);
    }
  }

  return {
    sent: () => sent,

    /**
     * Every record whose name and version merely CONTAIN the ones asked for (see the module
     * doc) — this function does not filter by name, scope or version at all, and does not decide
     * a verdict; `classify.mjs` does both. What it DOES decide is whether the page stream was cut
     * off before an exact match could show up: if the collection hits `MAX_RECORDS` while the
     * last page was still full (there was more to read, we just stopped), and nothing in what we
     * did collect is an exact match for `pkg`, that is a genuinely unfinished check, not an
     * "absent" verdict — so it throws a plain (non-`stopRun`) error instead of returning a
     * silently truncated list. The caller records that as "could not be asked", the honest
     * outcome, rather than letting `classify.mjs` read it as "not in the base".
     *
     * @param {{name: string, scope: string, version: string}} pkg
     * @returns {Promise<Array<object>>}
     */
    async findArtifacts(pkg) {
      if (stoppedError) throw stoppedError;

      const collected = [];
      let lastPageFull = false;
      for (let offset = 0; offset < MAX_RECORDS; offset += PAGE) {
        const page = await request(pkg, offset);
        collected.push(...page);
        lastPageFull = page.length === PAGE;
        if (!lastPageFull) break;
      }

      if (lastPageFull && !matchArtifact(collected, pkg)) {
        const label = pkg.scope ? `${pkg.scope}/${pkg.name}` : pkg.name;
        throw new Error(
          `Выдача обрезана на ${collected.length} записях, точного совпадения среди них нет — имя и версия ` +
            `ищутся подстрокой (spec §2.2/§7), и у короткого имени большая часть страниц может оказаться ` +
            `чужими записями. Пакет "${label}"@${pkg.version} не проверен.`,
        );
      }

      return collected;
    },
  };
}
