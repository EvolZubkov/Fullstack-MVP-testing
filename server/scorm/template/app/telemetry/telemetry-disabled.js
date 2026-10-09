/* Пустая реализация: имя занято, чтобы вызовы в коде экранов не падали. См. server/scorm/index.ts. */
var Telemetry = (function () {
  function noop() {}

  return {
    init: noop,
    start: noop,
    startNewAttempt: noop,
    answer: noop,
    finish: noop,
    isEnabled: function () { return false; },
    getSessionId: function () { return null; },
    getAttemptNumber: function () { return 1; },
    // false намеренно: `1` выше — заглушка, и экран не должен показывать её участнику как
    // настоящий номер попытки (mainRender.scormCourseSubtitle).
    hasAttemptNumber: function () { return false; }
  };
})();
