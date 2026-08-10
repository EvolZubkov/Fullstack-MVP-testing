// app/utils/trusted-now.js
// Trusted "now" for the access barriers (PRD-6 trusted date, PRD-31 barrier B):
// the LMS clock, read from the `Date` response header of the portal chrome the
// package fetches anyway.
//
// Extracted from gate.js because BOTH barriers need it now. The calendar cooldown
// needs a DAY and the hour interval needs a full INSTANT, and the interval is the
// more fragile of the two: reading the machine clock would let a learner reopen a
// 24-hour barrier by moving the system time forward, which is exactly the bypass
// the trusted date closed for the cooldown.
//
// Same-origin is the expected mode — confirmed 2026-08-01, the course frame and the
// portal share an origin — but it is NOT an invariant this code checks: `Date` is
// not on the CORS safelist, so a foreign origin simply exposes no header and the
// resolution degrades. Degradation to the machine clock (= legacy behaviour) happens
// when the header is MISSING or UNPARSEABLE, when the request REJECTS, or when the
// sub-budget TIMES OUT. An HTTP error carrying a valid `Date` is deliberately NOT a
// fallback: the portal stamps the header whatever the response status, so a 500 from
// the portal still reports the portal's clock — which is the whole point.
var TrustedNow = (function () {
  // NFR-TD-01: the resolution has its own sub-budget, so a slow portal can never hang
  // the start — it just degrades. The gate's overall GATE_TIMEOUT_MS is SHARED: what
  // is spent here is deducted from what the plugin gets afterwards.
  var DATE_TIMEOUT_MS = 2500;

  // Marker resolved by the sub-budget race so the fallback can name `timeout` as the
  // cause instead of lumping it in with "no usable header".
  var TIMEOUT = { timedOut: true };

  var chrome = {};

  // Which clock the LAST resolution actually used. Reported rather than inferred: a
  // caller comparing the returned value against its own `Date.now()` could not tell a
  // portal whose clock matches the machine from a fallback, and PRD-31 stamps this
  // onto the stored attempt, where a wrong label would mislead later diagnosis.
  var lastSource = 'client';

  function glog() {
    if (typeof console === 'undefined' || !console.log) return;
    var args = ['[TB clock]'];
    for (var i = 0; i < arguments.length; i++) args.push(arguments[i]);
    console.log.apply(console, args);
  }

  // Memoized same-origin GET of the portal chrome. SECID, cur_person_id and the
  // trusted clock all read the SAME response, so the portal is touched once per URL
  // instead of once per resolver. `no-store` keeps the Date header live: a cached
  // response would carry a stale server clock.
  function fetchPortalChrome(url) {
    var key = url || '/';
    if (Object.prototype.hasOwnProperty.call(chrome, key)) return chrome[key];
    chrome[key] = (function () {
      // `fetch` may be missing or throw synchronously (hostile shim, ancient runtime).
      // Turn that into a rejection so callers degrade instead of escaping their promise
      // chain — resolveNowMs is called synchronously from buildContext, i.e. BEFORE the
      // gate's own chain exists, so a synchronous throw would never reach its `.catch`.
      try { return fetch(key, { credentials: 'include', cache: 'no-store' }); }
      catch (e) { return Promise.reject(e); }
    })()
      .then(function (r) {
        var dateHeader = '';
        try { dateHeader = (r.headers && r.headers.get && r.headers.get('Date')) || ''; } catch (e) { dateHeader = ''; }
        return r.text().then(function (text) {
          // `failed`/`status` are diagnostics only: an error response can still carry a
          // usable `Date` header, so the body is handed on exactly as before.
          return { text: text || '', dateHeader: dateHeader, failed: !r.ok, status: r.status || 0 };
        });
      })
      .catch(function (e) { return { text: '', dateHeader: '', failed: true, status: 0, error: e }; });
    return chrome[key];
  }

  /** Drop the memoized responses so the next run asks the portal again. */
  function reset() { chrome = {}; }

  // Why the trusted clock was NOT used. The resolution degrades silently by design (a
  // network hiccup must never block a course), so this string is the ONLY way to tell a
  // mis-integration from a healthy same-origin portal — the first live LMS run has to be
  // readable off the console in one pass, without a "patched — re-uploaded" round trip.
  function fallbackCause(page) {
    if (page === TIMEOUT) return 'timeout after ' + DATE_TIMEOUT_MS + ' ms';
    if (page && page.dateHeader) return 'unparseable-header: "' + page.dateHeader + '"';
    if (page && page.failed) {
      return 'request-failed' + (page.status ? ': HTTP ' + page.status : '') +
        (page.error && page.error.message ? ': ' + page.error.message : '');
    }
    return 'no-header';
  }

  /**
   * Resolve epoch-ms of the portal clock, falling back to the machine clock on any
   * degradation. Never rejects: a verdict is always reachable.
   */
  function resolveNowMs(endpoint) {
    var work = fetchPortalChrome(endpoint || '/');
    var timeout = new Promise(function (resolve) {
      setTimeout(function () { resolve(TIMEOUT); }, DATE_TIMEOUT_MS);
    });
    // The race carries the PAGE (not a parsed timestamp) so the fallback branch can
    // still see which degradation happened.
    return Promise.race([work, timeout])
      .catch(function (e) { return { dateHeader: '', failed: true, status: 0, error: e }; })
      .then(function (page) {
        var clientMs = Date.now();
        var header = (page && page.dateHeader) || '';
        var serverMs = header ? Date.parse(header) : NaN;
        if (!serverMs || !isFinite(serverMs)) {
          lastSource = 'client';
          glog('date source: client (' + fallbackCause(page) + ') | client:', new Date(clientMs).toUTCString());
          return clientMs;
        }
        lastSource = 'network';
        // Both timestamps, raw, plus the skew: the trusted-date spec wants the server
        // and the client clock side by side, not just the days they happen to fall on.
        glog('date source: network | server:', header,
          '| client:', new Date(clientMs).toUTCString(),
          '| skew sec:', Math.round((serverMs - clientMs) / 1000));
        return serverMs;
      });
  }

  return {
    DATE_TIMEOUT_MS: DATE_TIMEOUT_MS,
    fetchPortalChrome: fetchPortalChrome,
    resolveNowMs: resolveNowMs,
    /** Clock used by the last resolveNowMs: 'network' (portal) or 'client' (machine). */
    lastSource: function () { return lastSource; },
    reset: reset
  };
})();
