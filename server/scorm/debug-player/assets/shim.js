// ─── SCORM 2004 RTE shim — records structured traffic so the inspector can show
//     exactly what the module sends to the LMS and what the LMS answers back ──────
(function () {
  var cmi = {};
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
    };
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
    Initialize: function () { lastError = "0"; record("Initialize", "", null, "true"); return "true"; },
    Terminate: function () { lastError = "0"; persist(); record("Terminate", "", null, "true"); return "true"; },
    GetValue: function (k) { var v = cmi[k] != null ? String(cmi[k]) : ""; lastError = "0"; record("GetValue", k, null, v); return v; },
    SetValue: function (k, v) { cmi[k] = v; lastError = "0"; record("SetValue", k, v, "true"); return "true"; },
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
