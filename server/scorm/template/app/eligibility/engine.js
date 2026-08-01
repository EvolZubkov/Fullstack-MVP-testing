// app/eligibility/engine.js
// PRD-6 retake gate — plain-JS port of shared/eligibility/engine.ts. Pure
// cooldown date math + verdict normalization + failPolicy + retake state. Kept
// in golden parity with the TS source by tests/eligibility-engine-port.test.ts.
var EligibilityEngine = (function () {
  var DAY_MS = 86400000;

  function parseIsoDate(value) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
    if (!m) return null;
    var y = +m[1], mo = +m[2], d = +m[3];
    var t = Date.UTC(y, mo - 1, d);
    var dt = new Date(t);
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
    return Math.floor(t / DAY_MS);
  }

  function formatIsoDate(epochDay) {
    var dt = new Date(epochDay * DAY_MS);
    var y = dt.getUTCFullYear();
    var mo = String(dt.getUTCMonth() + 1);
    if (mo.length < 2) mo = '0' + mo;
    var d = String(dt.getUTCDate());
    if (d.length < 2) d = '0' + d;
    return y + '-' + mo + '-' + d;
  }

  // Calendar-day cooldown decision. No prior attempt (lastAttemptDate null/
  // unparseable) => allowed with no availableDate. The reported "today" is
  // normalized against an untrusted clock before use: see effectiveToday below.
  function cooldownDecision(lastAttemptDate, todayDate, cooldownPeriodDays) {
    var reportedToday = parseIsoDate(todayDate);
    var last = lastAttemptDate ? parseIsoDate(lastAttemptDate) : null;
    if (last == null || reportedToday == null) {
      return { allowed: true, availableDate: null, daysSince: null, effectiveToday: null };
    }
    // A "today" that precedes the last attempt is an impossible state: the clock is
    // not trusted (rolled-back OS date), so the cooldown runs from the attempt date.
    var today = Math.max(reportedToday, last);
    var daysSince = today - last;
    return {
      allowed: daysSince >= cooldownPeriodDays,
      availableDate: formatIsoDate(last + cooldownPeriodDays),
      daysSince: daysSince,
      // "Today" AFTER normalizing an untrusted clock. Derived values (e.g. a "N
      // days left" countdown) MUST be computed from this, not from the raw
      // todayDate argument, or they will disagree with allowed/daysSince.
      effectiveToday: formatIsoDate(today)
    };
  }

  // Whole days from todayDate to iso (UTC calendar granularity), or null when either
  // date is absent/unparseable or the target is not in the future. Both hosts render
  // the optional "через N дн." countdown from this -- the web server via decideRetake,
  // the SCORM gate via renderCooldownStart -- so they cannot disagree; callers MUST
  // pass cooldownDecision(...).effectiveToday (or the retake.effectiveToday it feeds),
  // not a raw clock read.
  function daysUntilDate(iso, todayDate) {
    var target = iso ? parseIsoDate(iso) : null;
    var today = todayDate ? parseIsoDate(todayDate) : null;
    if (target == null || today == null) return null;
    var diff = target - today;
    return diff > 0 ? diff : null;
  }

  // PRD-31 barrier B — plain-JS twin of attemptIntervalDecision. Wall-clock hours
  // between attempts INSIDE one assignment, decided on the instant the previous
  // attempt finished (suspend_data.attempts[].completedAt in the package). A "now"
  // earlier than that attempt is an impossible state (rolled-back clock), so the
  // interval runs its full length from the attempt -- the rule the calendar
  // cooldown already applies.
  function parseIsoInstant(value) {
    if (!value) return null;
    var t = Date.parse(String(value));
    return isFinite(t) ? t : null;
  }

  function formatIsoInstant(ms) {
    return new Date(ms).toISOString();
  }

  function attemptIntervalDecision(lastFinishedAt, nowIso, intervalHours) {
    var reportedNow = parseIsoInstant(nowIso);
    var last = parseIsoInstant(lastFinishedAt);
    if (last == null || reportedNow == null) {
      return { allowed: true, availableAt: null, msSince: null, effectiveNow: null };
    }
    var now = Math.max(reportedNow, last);
    var msSince = now - last;
    return {
      allowed: msSince >= intervalHours * 3600000,
      availableAt: formatIsoInstant(last + intervalHours * 3600000),
      msSince: msSince,
      effectiveNow: formatIsoInstant(now)
    };
  }

  var CORE_DEFAULT_RESULT = {
    allowed: true,
    reason: 'plugin_not_defined',
    source: 'core_default',
    availableDate: null
  };

  function normalizeVerdict(verdict) {
    if (typeof verdict === 'boolean') {
      return { allowed: verdict, availableDate: null };
    }
    var r = verdict || { allowed: false };
    var legacy = r.data && typeof r.data.nextAllowedDate === 'string' ? r.data.nextAllowedDate : null;
    return {
      allowed: !!r.allowed,
      reason: r.reason,
      source: r.source,
      availableDate: r.availableDate != null ? r.availableDate : (legacy != null ? legacy : null),
      data: r.data
    };
  }

  function applyFailPolicy(failPolicy, error) {
    var failClosed = failPolicy === 'failClosed';
    return {
      allowed: !failClosed,
      reason: failClosed ? 'plugin_error_fail_closed' : 'plugin_error_fail_open',
      source: 'core_failpolicy',
      availableDate: null,
      data: { error: error }
    };
  }

  function buildRetakeState(result, ctx) {
    var lastAttemptDate = result.data && typeof result.data.lastAttemptDate === 'string'
      ? result.data.lastAttemptDate : null;
    var effectiveToday = result.data && typeof result.data.effectiveToday === 'string'
      ? result.data.effectiveToday : null;
    return {
      checked: true,
      allowed: result.allowed,
      lastAttemptDate: lastAttemptDate,
      todayDate: ctx.todayDate,
      effectiveToday: effectiveToday,
      availableDate: result.availableDate != null ? result.availableDate : null,
      nextAllowedDate: result.availableDate != null ? result.availableDate : null,
      cooldownPeriodDays: ctx.cooldownPeriodDays,
      source: result.source != null ? result.source : null,
      reason: result.reason != null ? result.reason : null
    };
  }

  return {
    parseIsoDate: parseIsoDate,
    formatIsoDate: formatIsoDate,
    cooldownDecision: cooldownDecision,
    daysUntilDate: daysUntilDate,
    parseIsoInstant: parseIsoInstant,
    formatIsoInstant: formatIsoInstant,
    attemptIntervalDecision: attemptIntervalDecision,
    CORE_DEFAULT_RESULT: CORE_DEFAULT_RESULT,
    normalizeVerdict: normalizeVerdict,
    applyFailPolicy: applyFailPolicy,
    buildRetakeState: buildRetakeState
  };
})();
