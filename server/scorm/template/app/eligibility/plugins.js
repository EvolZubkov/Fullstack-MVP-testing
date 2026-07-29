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

  function normalizeName(s) {
    return String(s || '').replace(/\s+/g, ' ').replace(/^\s+|\s+$/g, '').toLowerCase();
  }

  function selectLastAttemptDate(records, filter, courseName) {
    var stateField = filter.stateField || 'state';
    var progressField = filter.progressField || 'progress';
    var fmt = filter.dateFormat || 'dd.MM.yyyy';
    var excl = filter.excludeStateIn || [];
    var progRe = filter.progressCompletePattern ? new RegExp(filter.progressCompletePattern) : null;
    var wantName = (filter.nameField && courseName) ? normalizeName(courseName) : null;
    var sentinels = filter.excludeDateValues || [];
    var bestEpoch = null;
    var bestStr = null;
    var list = records || [];
    for (var i = 0; i < list.length; i++) {
      var rec = list[i];
      if (!rec) continue;
      // Same-course match across assignments.
      if (wantName) {
        var nm = normalizeName(rec[filter.nameField] != null ? String(rec[filter.nameField]) : '');
        if (nm !== wantName) continue;
      }
      var st = rec[stateField] != null ? String(rec[stateField]) : '';
      if (filter.stateIn && filter.stateIn.indexOf(st) === -1) continue;
      if (excl.indexOf(st) !== -1) continue;
      if (progRe) {
        var prog = rec[progressField] != null ? String(rec[progressField]) : '';
        if (!progRe.test(prog)) continue;
      }
      var raw = rec[filter.dateField] != null ? String(rec[filter.dateField]) : '';
      // Skip open-ended / sentinel dates (e.g. «31.12.9999» = assigned, never taken).
      var skip = false;
      for (var s = 0; s < sentinels.length; s++) { if (raw.indexOf(sentinels[s]) !== -1) { skip = true; break; } }
      if (skip) continue;
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
        // Normalized "today" (clamped forward when the reported clock precedes the
        // attempt). Countdowns must derive from THIS, not from todayDate.
        effectiveToday: dec.effectiveToday,
        nextAllowedDate: dec.availableDate,
        cooldownPeriodDays: days
      }
    };
  }

  function webtutorCooldownDecide(records, filter, context, courseName) {
    return cooldownResult(selectLastAttemptDate(records, filter, courseName), context, 'webtutor_cooldown');
  }

  function suspendDataCooldownDecide(lastCompletedDate, context) {
    return cooldownResult(lastCompletedDate, context, 'suspend_data_cooldown');
  }

  function cooldownDecideFromDate(lastAttemptDate, context, source) {
    return cooldownResult(lastAttemptDate, context, source);
  }

  function unescapeXml(s) {
    return String(s || '')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
      .replace(/&#10;/g, ' ').replace(/&#9;/g, ' ').replace(/&amp;/g, '&');
  }

  function extractSecid(text, pattern) {
    var m = new RegExp(pattern || '[A-F0-9]{32}').exec(String(text || ''));
    return m ? m[0] : null;
  }

  function extractCourseCompletionDate(responseText, opts) {
    opts = opts || {};
    var text = unescapeXml(responseText);
    var marker = opts.completionMarker || 'best_learn_step_success';
    var at = text.indexOf(marker);
    if (at < 0) return null;
    var m = /(\d{1,2}\.\d{1,2}\.\d{4})/.exec(text.slice(at, at + 600));
    return m ? parseFlexibleDate(m[1], opts.dateFormat || 'dd.MM.yyyy') : null;
  }

  return {
    parseFlexibleDate: parseFlexibleDate,
    selectLastAttemptDate: selectLastAttemptDate,
    webtutorCooldownDecide: webtutorCooldownDecide,
    suspendDataCooldownDecide: suspendDataCooldownDecide,
    cooldownDecideFromDate: cooldownDecideFromDate,
    unescapeXml: unescapeXml,
    extractSecid: extractSecid,
    extractCourseCompletionDate: extractCourseCompletionDate
  };
})();
