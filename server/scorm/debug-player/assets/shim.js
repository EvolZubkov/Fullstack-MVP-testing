// ─── SCORM 2004 RTE shim — records structured traffic so the inspector can show
//     exactly what the module sends to the LMS and what the LMS answers back ──────
(function () {
  var cmi = defaults();
  var traffic = [];
  var seq = 0;
  var lastError = "0";
  var currentKey = "scorm-player-default";
  var listeners = [];

  function emit() { for (var i = 0; i < listeners.length; i++) { try { listeners[i](); } catch (e) {} } }
  function record(fn, key, value, ret) {
    traffic.push({ seq: ++seq, t: Date.now(), fn: fn, key: key, value: value, ret: ret, err: lastError });
    if (traffic.length > 5000) traffic.shift();
    emit();
  }

  function defaults() {
    return {
      "cmi.completion_status": "incomplete",
      "cmi.success_status": "unknown",
      "cmi.entry": "ab-initio",
      "cmi.location": "",
      "cmi.suspend_data": "",
      "cmi.learner_id": "preview-learner",
      "cmi.learner_name": "Предпросмотр",
      "cmi.core.student_id": "preview-learner",
      "cmi.core.student_name": "Предпросмотр",
      "cmi.score.scaled": "",
      "cmi.score.raw": "",
      "cmi.score.min": "",
      "cmi.score.max": "",
      "cmi.mode": "normal",
      "cmi.credit": "credit",
      "cmi.total_time": "PT0H0M0S",
    };
  }

  // cmi.total_time is kept the way an LMS keeps it: the sum of the sessions' committed
  // cmi.session_time, credited when the NEXT session starts (a killed tab never reaches
  // Terminate, so the last commit is what counts). A package of a timed test anchors its
  // remaining time on it (PRD-20); without it every relaunch lost the attempt.
  function durationSec(iso) {
    var m = /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(String(iso || ""));
    if (!m) return 0;
    return (+(m[1] || 0)) * 86400 + (+(m[2] || 0)) * 3600 + (+(m[3] || 0)) * 60 + (+(m[4] || 0));
  }
  function isoDuration(sec) {
    var cs = Math.round(sec * 100); // centiseconds: the precision of the SCORM timeinterval
    var h = Math.floor(cs / 360000);
    var min = Math.floor((cs % 360000) / 6000);
    var s = (cs % 6000) / 100;
    return "PT" + h + "H" + min + "M" + s + "S";
  }
  function creditSessionTime() {
    if (cmi["cmi.session_time"] == null) return;
    cmi["cmi.total_time"] = isoDuration(durationSec(cmi["cmi.total_time"]) + durationSec(cmi["cmi.session_time"]));
    delete cmi["cmi.session_time"];
  }

  function persist() {
    try { localStorage.setItem(currentKey, JSON.stringify(cmi)); } catch (e) {}
  }
  function restore(key) {
    currentKey = key;
    cmi = defaults();
    traffic.length = 0;
    seq = 0;
    try {
      var saved = JSON.parse(localStorage.getItem(key) || "null");
      if (saved && typeof saved === "object") {
        Object.assign(cmi, saved);
        cmi["cmi.entry"] = cmi["cmi.suspend_data"] ? "resume" : "ab-initio";
      }
    } catch (e) {}
    emit();
  }
  function resetAttempt() {
    try { localStorage.removeItem(currentKey); } catch (e) {}
    cmi = defaults();
    traffic.length = 0;
    seq = 0;
    emit();
  }

  var API_1484_11 = {
    Initialize: function () { creditSessionTime(); lastError = "0"; record("Initialize", "", null, "true"); return "true"; },
    Terminate: function () { lastError = "0"; persist(); record("Terminate", "", null, "true"); return "true"; },
    GetValue: function (k) { var v = cmi[k] != null ? String(cmi[k]) : ""; lastError = "0"; record("GetValue", k, null, v); return v; },
    SetValue: function (k, v) {
      if (k === "cmi.total_time") { lastError = "404"; record("SetValue", k, v, "false"); return "false"; } // read-only element
      cmi[k] = v; lastError = "0"; record("SetValue", k, v, "true"); return "true";
    },
    Commit: function () { lastError = "0"; persist(); record("Commit", "", null, "true"); return "true"; },
    GetLastError: function () { return lastError; },
    GetErrorString: function () { return ""; },
    GetDiagnostic: function () { return ""; },
  };
  window.API_1484_11 = API_1484_11;
  window.__scorm = {
    getCmi: function () { return cmi; },
    getTraffic: function () { return traffic; },
    subscribe: function (cb) { listeners.push(cb); },
    restore: restore,
    reset: resetAttempt,
  };
})();
