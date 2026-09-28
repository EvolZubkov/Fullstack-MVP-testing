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
 * The countdown text. Delegates to the SHARED duration formatter in the bundle
 * (`TBTemplate.formatCountdown`), so the package prints what the web host prints:
 * "M:SS", growing an hour part from an hour up and a day part from a day up — a
 * multi-day budget used to read "20160:00" here.
 *
 * With no bundle (a broken build) it degrades to the historical "M:SS" instead of
 * throwing: the countdown keeps running, it just stops growing units.
 * @param {number} seconds
 * @returns {string}
 */
function formatTime(seconds) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (TB && typeof TB.formatCountdown === 'function') return TB.formatCountdown(seconds);
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
 * Paint one timer element: the countdown text plus a reversible critical
 * highlight. Drives the DS `.ou-timer` chrome the layout ships (text into the
 * `.ou-timer__num` child, critical -> the DS `is-critical` state class), and
 * falls back to the legacy `.q-timer` styling for the hardcoded-chrome path.
 * @param {string} elementId
 * @param {number} seconds
 */
function paintTimer(elementId, seconds) {
  var el = document.getElementById(elementId);
  if (!el) return;
  var critical = seconds <= TIMER_WARN_AT;
  if (el.className.indexOf('ou-timer') !== -1) {
    var numEl = el.querySelector('.ou-timer__num') || el;
    numEl.textContent = formatTime(seconds);
    if (critical) el.classList.add('is-critical'); else el.classList.remove('is-critical');
    return;
  }
  el.textContent = formatTime(seconds);
  el.style.color = critical ? '#dc2626' : '';
  el.style.fontWeight = critical ? 'bold' : '';
  if (critical) el.classList.add('q-timer--urgent'); else el.classList.remove('q-timer--urgent');
}

/**
 * Reveal + paint the scene timers (test + section) that every flow layout ships
 * HIDDEN (`q-timer--hidden`). Call after a flow screen mounts so the running
 * countdowns are visible on EVERY screen of the timed flow — content pages, the
 * router hub, section intro/results, questions and the review — not just the
 * question screen. Presence follows the settings: the test timer shows only when a
 * test limit runs (`state.remainingSeconds` set); the section timer only while a
 * section countdown is active (`state.sectionTimer`). A screen without the timer
 * markup is a safe no-op (paintTimer / querySelector just find nothing).
 */
function revealSceneTimers(root) {
  var scope = root || document;
  var t = scope.querySelector('#timer-display');
  if (t && state.remainingSeconds !== null && state.remainingSeconds !== undefined) {
    t.classList.remove('q-timer--hidden');
    paintTimer('timer-display', state.remainingSeconds);
  }
  var s = scope.querySelector('#section-timer-display');
  if (s && state.sectionTimer) {
    s.classList.remove('q-timer--hidden');
    paintTimer('section-timer-display', state.sectionTimer.remainingSeconds);
  }
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
//
// The remaining time of a section is PERSISTED, in the same currency the test-wide
// timer anchors to: SCO ACTIVE time (`cmi.total_time`). Rules agreed 2026-07-29:
//   - it runs only while the learner is inside the section;
//   - leaving (hub / обзор / reload / closed browser) FREEZES the remainder;
//   - re-entering — including «Продолжить с места остановки» — resumes from it, so
//     reading the questions and coming back does not buy a fresh limit;
//   - at zero the section is spent and locks.
// The arithmetic lives in the SHARED `TBTemplate.sectionBudget` module, so the web
// host answers «сколько осталось» with the same formula.

/** Session start on the monotonic clock — the smoothing base for active time. */
var sectionSessionStartMs = timerNowMs();

/** Active-time reading in MS for the budget maths. */
function sectionActiveMs() {
  var sec = readTotalTimeSec();
  var base = (typeof sec === 'number' && !isNaN(sec)) ? sec * 1000 : 0;
  // `cmi.total_time` only advances on commit, so add the elapsed session time to
  // keep the countdown smooth between commits.
  return base + Math.max(0, timerNowMs() - sectionSessionStartMs);
}

/** Read the persisted section budgets from suspend_data. */
function readSectionBudgets() {
  try {
    var s = readSuspendObj();
    return (s && s.sectionBudgets && typeof s.sectionBudgets === 'object') ? s.sectionBudgets : {};
  } catch (e) {
    return {};
  }
}

/** Persist section budgets into suspend_data (next to the attempt state). */
function writeSectionBudgets(budgets) {
  try {
    var s = readSuspendObj();
    s.sectionBudgets = budgets;
    writeSuspendObj(s);
  } catch (e) {
    /* storage unavailable — the in-memory countdown still runs */
  }
}

/** The shared budget module (bundled into TBTemplate); null on a broken bundle. */
function sectionBudgetApi() {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  return (TB && TB.sectionBudget) ? TB.sectionBudget : null;
}

/**
 * Start (or RESUME) the countdown of a section, replacing any current one. On
 * expiry calls onExpire(topicId); the caller maps that to advancing past the
 * section (linear) or returning to the router (router mode).
 * @param {string} topicId
 * @param {number} limitMinutes
 * @param {(topicId: string) => void} [onExpire]
 */
function startSectionTimer(topicId, limitMinutes, onExpire) {
  stopSectionTimer();
  if (!limitMinutes || limitMinutes <= 0) return;
  var budget = sectionBudgetApi();
  if (!budget) return;

  var budgets = budget.enterSection(readSectionBudgets(), topicId, limitMinutes, sectionActiveMs());
  writeSectionBudgets(budgets);

  var section = {
    topicId: topicId,
    limitMinutes: limitMinutes,
    remainingSeconds: budget.remainingSeconds(budgets, topicId, sectionActiveMs()) || 0,
    expired: false,
    onExpire: onExpire || null,
    intervalId: null
  };
  state.sectionTimer = section;

  section.intervalId = setInterval(function () {
    if (state.sectionTimer !== section) return; // superseded by a newer section
    if (state.submitted) {
      stopSectionTimer();
      return;
    }
    var left = budget.remainingSeconds(readSectionBudgets(), topicId, sectionActiveMs());
    if (left === null) left = 0;
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

  paintTimer('section-timer-display', section.remainingSeconds);
  syncSectionBinding(section);
}

/**
 * Stop the section countdown and FREEZE its remainder in suspend_data, so the next
 * entry (or a reload) continues from where the learner left off.
 */
function stopSectionTimer() {
  if (state.sectionTimer && state.sectionTimer.intervalId) {
    clearInterval(state.sectionTimer.intervalId);
  }
  var budget = sectionBudgetApi();
  if (budget) {
    writeSectionBudgets(budget.pauseAll(readSectionBudgets(), sectionActiveMs()));
  }
  state.sectionTimer = null;
  clearSectionBinding();
}

/** Whether a section's budget is already spent (its questions stay locked). */
function isSectionSpent(topicId) {
  var budget = sectionBudgetApi();
  if (!budget || !topicId) return false;
  return budget.isSpent(readSectionBudgets(), topicId, sectionActiveMs());
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

/**
 * A new attempt starts with clean section state. The budgets used to survive into the
 * next attempt of the same registration, so a section spent in attempt 1 was spent from
 * the first second of attempt 2; the PRD-67 closed list would do the same, only harder.
 * Called by every path that registers a new attempt.
 */
function resetSectionRunState() {
  try {
    var s = readSuspendObj();
    if (!s.sectionBudgets && !s.sectionGate) return;
    delete s.sectionBudgets;
    delete s.sectionGate;
    writeSuspendObj(s);
  } catch (e) {
    /* storage unavailable — nothing persisted to clear */
  }
}

// --- PRD-67: «Закрывать раздел при выходе» ---------------------------------
//
// The freeze above let a learner read a question, close the SCO, look the answer up
// and come back to the same question with the same remainder. With the test setting
// on, leaving a started section CLOSES it for good. A leave is recognised without any
// clock: every SCO launch is a new session, so a section still marked open when the
// package loads is a section the previous session broke off inside. Inside a session a
// leave is a screen change — the hub, the next section, the section results.
//
// A test without sections is ONE section (`WHOLE_TEST_SECTION`): leaving it — only
// possible by leaving the SCO — hands the attempt in. The rules (which sections the
// setting acts on, how a gate opens and closes) live in the SHARED
// `TBTemplate.sectionBudget` module, the same one the web server runs.

/** Screen marker: this screen neither enters nor leaves a section (обзор, same-section page). */
var LEAVE_KEEP = { keep: true };

/** Whether the test turned the setting on. Absent in packages built before PRD-67. */
function closeOnLeaveEnabled() {
  return typeof TEST_DATA !== 'undefined' && TEST_DATA.closeSectionOnLeave === true;
}

/** Key of the implicit single section of a test without sections. */
function wholeTestSectionKey() {
  var api = sectionBudgetApi();
  return (api && api.WHOLE_TEST_SECTION) || '__test__';
}

/** True for a test without sections — the whole test is the unit a leave closes. */
function isFlatLeaveFlow() {
  var mode = (TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode) || 'linear_flat';
  return mode === 'linear_flat';
}

/** The unit a leave closes for a topic: the topic itself, or the whole test. */
function leaveUnitOf(topicId) {
  return isFlatLeaveFlow() ? wholeTestSectionKey() : topicId;
}

/** A section's own limit in minutes (0 when it has none). */
function sectionOwnLimitMinutes(topicId) {
  var sections = TEST_DATA.sections || [];
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].topicId === topicId) return sections[i].timeLimitMinutes || 0;
  }
  return 0;
}

/** Does the setting act on this unit? Only where there is a clock to dodge. */
function leaveGuarded(unit) {
  var api = sectionBudgetApi();
  if (!api || !closeOnLeaveEnabled() || !unit) return false;
  var own = 0;
  if (unit === wholeTestSectionKey()) {
    var sections = TEST_DATA.sections || [];
    for (var i = 0; i < sections.length; i++) {
      if ((sections[i].timeLimitMinutes || 0) > own) own = sections[i].timeLimitMinutes;
    }
  } else {
    own = sectionOwnLimitMinutes(unit);
  }
  return api.closesOnLeave({
    enabled: true,
    testLimitMinutes: TEST_DATA.timeLimitMinutes,
    sectionLimitMinutes: own
  });
}

/**
 * Does the setting act on any part of this test? What the start screen reports as
 * `course.closesOnLeave` — the same shared rule the web host uses.
 */
function packageClosesOnLeave() {
  var api = sectionBudgetApi();
  if (!api || typeof api.testClosesOnLeave !== 'function') return false;
  var limits = [];
  var sections = TEST_DATA.sections || [];
  for (var i = 0; i < sections.length; i++) limits.push(sections[i].timeLimitMinutes);
  return api.testClosesOnLeave({
    enabled: closeOnLeaveEnabled(),
    testLimitMinutes: TEST_DATA.timeLimitMinutes,
    sectionLimitMinutes: limits
  });
}

/** Read the open/closed sections from suspend_data (absent = nothing open, nothing closed). */
function readSectionGate() {
  var api = sectionBudgetApi();
  try {
    var s = readSuspendObj();
    return api ? api.readGate(s.sectionGate) : { open: null, closed: [] };
  } catch (e) {
    return { open: null, closed: [] };
  }
}

/** Persist the gate (and, when given, the budgets) in one suspend_data write. */
function writeSectionGate(gate, budgets) {
  try {
    var s = readSuspendObj();
    s.sectionGate = gate;
    if (budgets) s.sectionBudgets = budgets;
    writeSuspendObj(s);
  } catch (e) {
    /* storage unavailable — the in-memory run goes on */
  }
}

/** Was this topic's unit closed by a leave? */
function isSectionClosedByLeave(topicId) {
  if (!closeOnLeaveEnabled() || !topicId) return false;
  return readSectionGate().closed.indexOf(leaveUnitOf(topicId)) >= 0;
}

/**
 * Leave the open unit now: close it when the setting acts on it, merely clear it
 * otherwise. Every running budget is frozen either way.
 * @returns {string|null} the unit that got closed, or null.
 */
function leaveOpenSection() {
  var api = sectionBudgetApi();
  if (!api) return null;
  var gate = readSectionGate();
  if (!gate.open) return null;
  var left = api.leaveSection(gate, readSectionBudgets(), sectionActiveMs(), leaveGuarded(gate.open));
  writeSectionGate(left.gate, left.budgets);
  return left.closed;
}

/**
 * On SCO load: a unit still marked open means the previous session ended inside it —
 * a reload, a closed browser, a killed tab. Close it before anything is restored.
 * @returns {string|null} the unit that got closed, or null.
 */
function closeInterruptedSectionOnLoad() {
  if (!closeOnLeaveEnabled()) return null;
  return leaveOpenSection();
}

/** Human name of a section for the notice. */
function sectionTitleOf(topicId) {
  var sections = TEST_DATA.sections || [];
  for (var i = 0; i < sections.length; i++) {
    if (sections[i].topicId === topicId) return sections[i].topicName || '';
  }
  return '';
}

/**
 * Where the learner stands as far as a leave is concerned: a unit id (inside it), null
 * (outside every section) or LEAVE_KEEP (the screen changes nothing — the обзор, a page of
 * the section being worked through, anything in a test without sections).
 */
function currentLeaveUnit() {
  if (state.submitted) return LEAVE_KEEP;
  if (TEST_DATA.mode === 'adaptive' && state.adaptiveState) {
    var aItem = (typeof currentPageItem === 'function') ? currentPageItem() : null;
    var aTopic = (aItem && aItem.kind === 'adaptive-session' && aItem.topicId) || state.currentRouterTopic || null;
    return aTopic ? leaveUnitOf(aTopic) : LEAVE_KEEP;
  }
  if (state.phase === 'review') return LEAVE_KEEP;
  if (state.phase === 'question') {
    var fq = state.flatQuestions && state.flatQuestions[state.currentIndex];
    return fq ? leaveUnitOf(fq.topicId) : LEAVE_KEEP;
  }
  // A test without sections is left only by leaving the SCO — its own pages are inside it.
  if (isFlatLeaveFlow()) return LEAVE_KEEP;
  if (state.phase === 'content') {
    var item = (typeof currentPageItem === 'function') ? currentPageItem() : null;
    var pageTopic = (item && item.page && item.page.topicId) || null;
    if (pageTopic && readSectionGate().open === pageTopic) return LEAVE_KEEP;
    return null;
  }
  // Section results, the router hub, start and results screens are outside every section.
  return null;
}

/**
 * The learner is on a screen of a closed unit: tell them why and move them on — past the
 * section (linear), back to the hub marked done (router), or hand the attempt in (a test
 * without sections). Returns true: the caller must not draw the closed screen.
 */
function redirectFromClosedSection(unit) {
  if (unit === wholeTestSectionKey()) {
    if (typeof showToast === 'function') {
      showToast('Попытка завершена. Вы вышли из теста до завершения. Засчитаны ответы, данные до выхода.', 'warn', 8000);
    }
    if (typeof submit === 'function') submit(true);
    return true;
  }
  var name = sectionTitleOf(unit);
  if (typeof showToast === 'function') {
    showToast((name ? 'Раздел «' + name + '» закрыт' : 'Раздел закрыт') +
      '. Вы вышли из него до завершения. Ответы, данные до выхода, сохранены.', 'warn', 8000);
  }
  if (typeof RouterFlow !== 'undefined' && RouterFlow.isRouterMode && RouterFlow.isRouterMode() &&
      state.currentRouterTopic === unit && typeof RouterFlow.returnFromTopic === 'function') {
    RouterFlow.returnFromTopic();
    return true;
  }
  if (typeof skipSectionFromCurrent === 'function') {
    skipSectionFromCurrent(unit);
    return true;
  }
  return false;
}

/**
 * PRD-67 step run on EVERY render: leave the open unit when the screen is outside it,
 * open the unit of a question screen, and move the learner off a closed one.
 * @returns {boolean} true when it redirected (the caller skips drawing).
 */
function syncSectionLeaveGate() {
  if (!closeOnLeaveEnabled() || !sectionBudgetApi()) return false;
  var unit = currentLeaveUnit();
  if (unit === LEAVE_KEEP) return false;
  var gate = readSectionGate();
  if (gate.open && gate.open !== unit) {
    var closedUnit = leaveOpenSection();
    // Whatever path led to the hub (return, «Назад» through the nav history), a closed
    // topic is shown there «Пройдена» and never reopened.
    if (closedUnit && state.routerTopicStates && typeof RouterFlow !== 'undefined' &&
        RouterFlow.isRouterMode && RouterFlow.isRouterMode()) {
      state.routerTopicStates[closedUnit] = 'completed';
    }
    gate = readSectionGate();
  }
  if (!unit || !leaveGuarded(unit)) return false;
  if (gate.closed.indexOf(unit) >= 0) return redirectFromClosedSection(unit);
  // Entering a unit is silent: the rule is the author's to state on an intro page, once,
  // not a notice over every section's first question.
  if (gate.open !== unit) writeSectionGate(sectionBudgetApi().openSection(gate, unit), null);
  return false;
}
