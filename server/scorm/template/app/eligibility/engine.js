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

  function cooldownDecision(lastAttemptDate, todayDate, cooldownPeriodDays) {
    var today = parseIsoDate(todayDate);
    var last = lastAttemptDate ? parseIsoDate(lastAttemptDate) : null;
    if (last == null || today == null) {
      return { allowed: true, availableDate: null, daysSince: null };
    }
    var daysSince = today - last;
    return {
      allowed: daysSince >= cooldownPeriodDays,
      availableDate: formatIsoDate(last + cooldownPeriodDays),
      daysSince: daysSince
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
    return {
      checked: true,
      allowed: result.allowed,
      lastAttemptDate: lastAttemptDate,
      todayDate: ctx.todayDate,
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
    CORE_DEFAULT_RESULT: CORE_DEFAULT_RESULT,
    normalizeVerdict: normalizeVerdict,
    applyFailPolicy: applyFailPolicy,
    buildRetakeState: buildRetakeState
  };
})();
