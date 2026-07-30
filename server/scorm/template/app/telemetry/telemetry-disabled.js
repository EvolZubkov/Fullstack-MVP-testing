/**
 * @module scorm/template/app/telemetry/telemetry-disabled
 *
 * No-op stand-in for the telemetry runtime, bundled INSTEAD of it when a test is
 * exported with telemetry switched off.
 *
 * Turning telemetry off must leave no telemetry in the package: no endpoint, no request
 * signing, no LMS profile reads, no retry buffer. What it cannot do is leave the
 * `Telemetry` name unbound — the call sites are spread across the render and action code
 * (`resultsPage`, `adaptiveRender`, `startPage`, `answers`, `feedback`), and the adaptive
 * screens ship in every package regardless of the test's mode. An unresolved reference is
 * a `ReferenceError` the moment the learner reaches that screen, which is exactly what
 * happened while the call sites were removed by regex source-mangling: a form the pattern
 * did not anticipate (`Telemetry.finish(results)` — a variable, not an object literal)
 * survived the strip and broke the adaptive results screen.
 *
 * Hence this stub: the same surface as the real module, doing nothing. It keeps the
 * package a few hundred bytes larger than a perfect strip would, and in exchange the
 * whole class of missed call site cannot exist.
 *
 * `hasAttemptNumber()` returns false on purpose — `getAttemptNumber()` reports a
 * placeholder `1`, and screens must not present that to a learner as their real attempt
 * number (see mainRender.scormCourseSubtitle).
 */
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
    hasAttemptNumber: function () { return false; }
  };
})();
