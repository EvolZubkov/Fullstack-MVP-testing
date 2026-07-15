/**
 * @module scorm/template/app/timer
 *
 * Countdown timers for the in-package runtime: one test-wide time limit and an
 * optional per-section limit (PRD-4 v1.1 section 3.2 / 4.6). Both derive the
 * remaining time from a monotonic performance.now() reading rather than a blind
 * per-tick decrement, so the display stays correct when the browser throttles
 * background-tab intervals and cannot be stretched by moving the system clock
 * (PRD-20, phase 1).
 *
 * Runs inside the concatenated IIFE bundle, so it shares scope with `state`,
 * `TEST_DATA`, `submit()` and the DOM instead of importing them.
 *
 * Contract consumed by other bundle modules (kept stable):
 *   initTimer()                             - startPage on attempt start
 *   stopTestTimer()                         - answers / startPage on reset
 *   startSectionTimer(topicId, min, onExp)  - contentFlow / routerFlow
 *   stopSectionTimer()                      - contentFlow / routerFlow
 *   formatTime(seconds) -> "M:SS"           - mainRender / adaptiveRender
 * Shared state fields:
 *   state.timerInterval    - active interval handle; kept here because reset
 *                            paths historically stop the timer through it.
 *   state.timerStartPerfMs - monotonic start reading of the test timer.
 *   state.remainingSeconds - test seconds left; read by renderers and results.
 *   state.timeExpired      - set when the test limit runs out.
 *   state.sectionTimer     - { topicId, limitMinutes, remainingSeconds,
 *                              expired, onExpire, intervalId, startPerfMs }.
 */

var TIMER_TICK_MS = 1000;
var TIMER_WARN_AT = 60; // seconds-left threshold that marks the display critical
var TIMER_COMMIT_MS = 10000; // PRD-20 phase 2c: kill-resistance commit cadence

/**
 * Monotonic millisecond clock, immune to system-clock changes. Falls back to
 * wall time on engines without the Performance API (ES5-safe feature detect).
 * @returns {number}
 */
function timerNowMs() {
  return (window.performance && typeof performance.now === 'function')
    ? performance.now()
    : Date.now();
}

/**
 * Parse a SCORM 2004 timeinterval ("PT#H#M#S") into whole seconds.
 * @param {string} iso
 * @returns {number|null}
 */
function parseScormDuration(iso) {
  if (!iso) return null;
  var m = /P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/.exec(String(iso));
  if (!m) return null;
  return (+m[1] || 0) * 86400 + (+m[2] || 0) * 3600 + (+m[3] || 0) * 60 + Math.floor(+m[4] || 0);
}

/**
 * Read cmi.total_time (LMS-accumulated active time) in seconds, or null when
 * unavailable/unparseable. Null triggers degradation to the phase-1 timer.
 * @returns {number|null}
 */
function readTotalTimeSec() {
  try {
    if (typeof SCORM === 'undefined' || !SCORM.getValue) return null;
    var sec = parseScormDuration(SCORM.getValue('cmi.total_time'));
    return (typeof sec === 'number' && !isNaN(sec)) ? sec : null;
  } catch (e) {
    return null;
  }
}

/** Format whole seconds as a SCORM 2004 timeinterval ("PT#H#M#S"). */
function secondsToIsoDuration(sec) {
  var s = sec > 0 ? Math.floor(sec) : 0;
  return 'PT' + Math.floor(s / 3600) + 'H' + Math.floor((s % 3600) / 60) + 'M' + (s % 60) + 'S';
}

/**
 * PRD-20 phase 2c: commit the current session's elapsed time to
 * cmi.session_time so an ungraceful kill still credits the time already spent
 * (validated: committed session_time survives a tab kill). Best-effort.
 */
function commitSessionTime() {
  try {
    if (typeof SCORM === 'undefined' || !SCORM.setValue) return;
    if (state.timerStartPerfMs === null) return;
    var elapsed = Math.floor((timerNowMs() - state.timerStartPerfMs) / 1000);
    SCORM.setValue('cmi.session_time', secondsToIsoDuration(elapsed));
    SCORM.commit();
  } catch (e) {
    /* best-effort; a failed commit just widens the kill-loss window */
  }
}

/** Start the periodic session-time commit (kill-resistance). */
function startTimerCommit() {
  stopTimerCommit();
  if (typeof SCORM === 'undefined' || !SCORM.setValue) return; // standalone / no RTE
  state.timerCommitInterval = setInterval(commitSessionTime, TIMER_COMMIT_MS);
}

/** Stop the periodic session-time commit. */
function stopTimerCommit() {
  if (state.timerCommitInterval) {
    clearInterval(state.timerCommitInterval);
    state.timerCommitInterval = null;
  }
}

/**
 * Format a second count as "M:SS"; negative input clamps to "0:00".
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  var total = seconds > 0 ? seconds : 0;
  var mins = Math.floor(total / 60);
  var secs = total % 60;
  return mins + ':' + (secs < 10 ? '0' + secs : secs);
}

/**
 * Whole seconds still left from a monotonic start reading, never below zero.
 * @param {number} startMs
 * @param {number} totalSeconds
 * @returns {number}
 */
function timerRemaining(startMs, totalSeconds) {
  var elapsed = Math.floor((timerNowMs() - startMs) / 1000);
  var left = totalSeconds - elapsed;
  return left > 0 ? left : 0;
}

/**
 * Paint one timer element: text plus a reversible critical highlight.
 * @param {string} elementId
 * @param {number} seconds
 */
function paintTimer(elementId, seconds) {
  var el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = formatTime(seconds);
  var critical = seconds <= TIMER_WARN_AT;
  el.style.color = critical ? '#dc2626' : '';
  el.style.fontWeight = critical ? 'bold' : '';
  if (critical) el.classList.add('q-timer--urgent'); else el.classList.remove('q-timer--urgent');
}

// --- Test-wide timer -------------------------------------------------------

/**
 * Start the test-wide countdown when the test carries a positive limit.
 * Fresh attempt: write the active-time anchor and use the full limit. Reload
 * with a matching anchor: restore remaining from consumed active time
 * (PRD-20 phase 2b), or expire the attempt if the limit was exhausted while
 * away. Missing anchor / unreadable total_time degrades to the phase-1
 * (full, session-only) timer.
 */
function initTimer() {
  var minutes = TEST_DATA.timeLimitMinutes;
  if (!minutes || minutes <= 0) return;

  var totalSeconds = minutes * 60;
  var anchor = (typeof readTimerAnchor === 'function') ? readTimerAnchor() : null;
  var totalNow = readTotalTimeSec();
  var isResume =
    anchor &&
    anchor.limitMinutes === minutes &&
    typeof anchor.baselineTotalSec === 'number' &&
    totalNow !== null;

  var startSeconds;
  if (isResume) {
    // Consumed active time = LMS-committed sessions of this attempt so far.
    var consumed = totalNow - anchor.baselineTotalSec;
    if (consumed < 0) {
      consumed = 0; // total_time regressed below baseline -> ignore (safety)
      state.timerAnchorTampered = true; // PRD-20 2f: anomaly (total_time went back)
    }
    startSeconds = totalSeconds - consumed;
    if (startSeconds > totalSeconds) startSeconds = totalSeconds;
    if (startSeconds <= 0) {
      // Limit exhausted while away: expire with a visible notice, not silently.
      state.timeExpired = true;
      state.remainingSeconds = 0;
      paintTimer('timer-display', 0);
      if (typeof showToast === 'function') showToast('Время теста истекло', 'warn');
      stopTestTimer();
      submit(true);
      return;
    }
  } else {
    // Fresh attempt: establish the anchor (phase 2a) and use the full limit.
    startSeconds = totalSeconds;
    if (totalNow !== null && typeof writeTimerAnchor === 'function') {
      writeTimerAnchor({ limitMinutes: minutes, baselineTotalSec: totalNow });
    }
  }

  state.remainingSeconds = startSeconds;
  state.timerStartPerfMs = timerNowMs();
  paintTimer('timer-display', startSeconds);

  state.timerInterval = setInterval(function () {
    // Reset paths (answers / startPage) stop us by nulling the handle.
    if (state.timerInterval === null || state.submitted) {
      stopTestTimer();
      return;
    }
    var left = timerRemaining(state.timerStartPerfMs, startSeconds);
    state.remainingSeconds = left;
    paintTimer('timer-display', left);
    if (left <= 0) {
      state.timeExpired = true;
      stopTestTimer();
      submit(true); // force completion on expiry
    }
  }, TIMER_TICK_MS);

  startTimerCommit();
}

/**
 * Single entry point to stop the test timer; called by reset paths too.
 * Clears the active-time anchor so the next attempt starts fresh. A reload
 * never calls this, so the anchor survives a reload (enabling resume), but a
 * submit / restart / expiry does clear it.
 */
function stopTestTimer() {
  stopTimerCommit();
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
  state.timerStartPerfMs = null;
  if (typeof clearTimerAnchor === 'function') clearTimerAnchor();
}

// --- Per-section timer (PRD-4 v1.1 section 3.2 / 4.6) ----------------------

/**
 * Start an independent per-section countdown, replacing any current one.
 * On expiry calls onExpire(topicId); the caller maps that to advancing past
 * the section (linear) or returning to the router (router mode).
 * @param {string} topicId
 * @param {number} limitMinutes
 * @param {(topicId: string) => void} [onExpire]
 */
function startSectionTimer(topicId, limitMinutes, onExpire) {
  stopSectionTimer();
  if (!limitMinutes || limitMinutes <= 0) return;

  var totalSeconds = limitMinutes * 60;
  var section = {
    topicId: topicId,
    limitMinutes: limitMinutes,
    remainingSeconds: totalSeconds,
    expired: false,
    onExpire: onExpire || null,
    intervalId: null,
    startPerfMs: timerNowMs()
  };
  state.sectionTimer = section;

  section.intervalId = setInterval(function () {
    if (state.sectionTimer !== section) return; // superseded by a newer section
    if (state.submitted) {
      stopSectionTimer();
      return;
    }
    var left = timerRemaining(section.startPerfMs, totalSeconds);
    section.remainingSeconds = left;
    paintTimer('section-timer-display', left);
    syncSectionBinding(section);
    if (left <= 0) {
      section.expired = true;
      var onExp = section.onExpire;
      var tid = section.topicId;
      stopSectionTimer();
      if (typeof onExp === 'function') onExp(tid);
    }
  }, TIMER_TICK_MS);

  paintTimer('section-timer-display', totalSeconds);
  syncSectionBinding(section);
}

/** Stop and clear the section timer and its data-path binding. */
function stopSectionTimer() {
  if (state.sectionTimer && state.sectionTimer.intervalId) {
    clearInterval(state.sectionTimer.intervalId);
  }
  state.sectionTimer = null;
  clearSectionBinding();
}

/**
 * Mirror the live section time onto TEST_DATA so templates bound via
 * renderPathOnlyDsl (section.current.timer.*) show current values.
 * @param {object} section
 */
function syncSectionBinding(section) {
  if (typeof TEST_DATA === 'undefined' || !TEST_DATA.section || !TEST_DATA.section.current) return;
  TEST_DATA.section.current.timer = {
    remainingSeconds: section.remainingSeconds,
    displayText: formatTime(section.remainingSeconds)
  };
}

/** Clear the section timer data-path binding so stale values do not linger. */
function clearSectionBinding() {
  if (typeof TEST_DATA === 'undefined' || !TEST_DATA.section || !TEST_DATA.section.current) return;
  TEST_DATA.section.current.timer = null;
}
