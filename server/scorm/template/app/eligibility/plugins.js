// app/eligibility/plugins.js
// PRD-6 — plain-JS port of shared/eligibility/plugins.ts pure logic (WebTutor
// record filtering / latest-attempt selection, flexible date parsing, cooldown
// decisions). Side effects (fetch, suspend_data read) live in gate.js. Kept in
// golden parity with the TS source by tests/eligibility-engine-port.test.ts.
var EligibilityPlugins = (function () {
  function parseFlexibleDate(value, format) {
    if (!value) return null;
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) return String(value).slice(0, 10);
    var m = /^(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(String(value));
    if (m && /d.*m.*y/i.test(format || '')) {
      var d = m[1].length < 2 ? '0' + m[1] : m[1];
      var mo = m[2].length < 2 ? '0' + m[2] : m[2];
      return m[3] + '-' + mo + '-' + d;
    }
    return null;
  }

  function selectLastAttemptDate(records, filter) {
    var stateField = filter.stateField || 'state';
    var progressField = filter.progressField || 'progress';
    var fmt = filter.dateFormat || 'dd.MM.yyyy';
    var excl = filter.excludeStateIn || [];
    var progRe = filter.progressCompletePattern ? new RegExp(filter.progressCompletePattern) : null;
    var bestEpoch = null;
    var bestStr = null;
    var list = records || [];
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (!rec) continue;
      var st = rec[stateField] != null ? String(rec[stateField]) : '';
      if (filter.stateIn && filter.stateIn.indexOf(st) === -1) continue;
      if (excl.indexOf(st) !== -1) continue;
      if (progRe) {
        var prog = rec[progressField] != null ? String(rec[progressField]) : '';
        if (!progRe.test(prog)) continue;
      }
      var raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : '';
      var iso = parseFlexibleDate(raw, fmt);
      if (!iso) continue;
      var epoch = EligibilityEngine.parseIsoDate(iso);
      if (epoch == null) continue;
      if (bestEpoch == null || epoch > bestEpoch) { bestEpoch = epoch; bestStr = iso; }
    }
    return bestStr;
  }

  function cooldownResult(lastAttemptDate, context, source) {
    var days = context.retakePolicy.cooldownPeriodDays;
    var today = context.runtime.todayDate;
    var dec = EligibilityEngine.cooldownDecision(lastAttemptDate, today, days);
    return {
      allowed: dec.allowed,
      reason: dec.allowed ? (lastAttemptDate ? 'cooldown_passed' : 'no_prior_attempt') : 'cooldown_active',
      source: source,
      availableDate: dec.availableDate,
      data: {
        lastAttemptDate: lastAttemptDate != null ? lastAttemptDate : null,
        todayDate: today,
        nextAllowedDate: dec.availableDate,
        cooldownPeriodDays: days
      }
    };
  }

  function webtutorCooldownDecide(records, filter, context) {
    return cooldownResult(selectLastAttemptDate(records, filter), context, 'webtutor_cooldown');
  }

  function suspendDataCooldownDecide(lastCompletedDate, context) {
    return cooldownResult(lastCompletedDate, context, 'suspend_data_cooldown');
  }

  return {
    parseFlexibleDate: parseFlexibleDate,
    selectLastAttemptDate: selectLastAttemptDate,
    webtutorCooldownDecide: webtutorCooldownDecide,
    suspendDataCooldownDecide: suspendDataCooldownDecide
  };
})();
