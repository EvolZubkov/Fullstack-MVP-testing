// app/timer/timer.js

function initTimer() {
  if (TEST_DATA.timeLimitMinutes && TEST_DATA.timeLimitMinutes > 0) {
    state.remainingSeconds = TEST_DATA.timeLimitMinutes * 60;
    state.timerInterval = setInterval(updateTimer, 1000);
    updateTimerDisplay();
  }
}

function updateTimer() {
  if (state.submitted) {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    return;
  }

  if (state.remainingSeconds === null || state.remainingSeconds <= 0) {
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    return;
  }

  state.remainingSeconds--;
  updateTimerDisplay();

  if (state.remainingSeconds <= 0 && !state.submitted) {
    state.timeExpired = true;
    if (state.timerInterval) {
      clearInterval(state.timerInterval);
      state.timerInterval = null;
    }
    submit(true); // форсируем завершение
  }
}

function updateTimerDisplay() {
  var timerEl = document.getElementById('timer-display');
  if (timerEl && state.remainingSeconds !== null) {
    var mins = Math.floor(state.remainingSeconds / 60);
    var secs = state.remainingSeconds % 60;
    timerEl.textContent = mins + ':' + (secs < 10 ? '0' : '') + secs;
    if (state.remainingSeconds <= 60) {
      timerEl.style.color = '#dc2626';
      timerEl.style.fontWeight = 'bold';
    }
  }
  // PRD-4 v1.1 §3.2: per-section timer display lives alongside the
  // test-wide timer. Templates can render a separate element with
  // id="section-timer-display" or data-path="section.current.timer".
  var secTimerEl = document.getElementById('section-timer-display');
  if (secTimerEl && state.sectionTimer && typeof state.sectionTimer.remainingSeconds === 'number') {
    var sm = Math.floor(state.sectionTimer.remainingSeconds / 60);
    var ss = state.sectionTimer.remainingSeconds % 60;
    secTimerEl.textContent = sm + ':' + (ss < 10 ? '0' : '') + ss;
    if (state.sectionTimer.remainingSeconds <= 60) {
      secTimerEl.style.color = '#dc2626';
      secTimerEl.style.fontWeight = 'bold';
    }
  }
  // Sync onto TEST_DATA.section.current.timer for data-path binding so
  // templates that bind via renderPathOnlyDsl see live values.
  if (typeof TEST_DATA !== 'undefined' && TEST_DATA.section && TEST_DATA.section.current) {
    if (state.sectionTimer && typeof state.sectionTimer.remainingSeconds === 'number') {
      TEST_DATA.section.current.timer = {
        remainingSeconds: state.sectionTimer.remainingSeconds,
        displayText: formatTime(state.sectionTimer.remainingSeconds),
      };
    } else {
      TEST_DATA.section.current.timer = null;
    }
  }
}

function formatTime(seconds) {
  var mins = Math.floor(seconds / 60);
  var secs = seconds % 60;
  return mins + ':' + (secs < 10 ? '0' : '') + secs;
}

/**
 * PRD-4 v1.1 §3.2 / §4.6 — section timer lifecycle.
 *
 * Started by contentFlow / routerFlow when the learner enters a section
 * (linear chunk OR a router-picked topic). Stopped automatically when
 * the section completes (advancePageSequence past after_topic, router
 * returnFromTopic, adaptive session callback) or when the timer expires.
 *
 * Two simultaneous timers (test + section) are independent: test
 * expiry forces submit() per the existing flow; section expiry calls
 * onExpire(topicId) which the caller maps to "skip rest of section,
 * advance to next" (linear) or "return to router with section marked
 * completed" (router).
 */
function startSectionTimer(topicId, limitMinutes, onExpire) {
  stopSectionTimer();
  if (!limitMinutes || limitMinutes <= 0) return;
  state.sectionTimer = {
    topicId: topicId,
    limitMinutes: limitMinutes,
    remainingSeconds: limitMinutes * 60,
    expired: false,
    onExpire: onExpire || null,
    intervalId: null,
  };
  state.sectionTimer.intervalId = setInterval(function () {
    if (!state.sectionTimer || state.submitted) {
      stopSectionTimer();
      return;
    }
    state.sectionTimer.remainingSeconds--;
    updateTimerDisplay();
    if (state.sectionTimer.remainingSeconds <= 0) {
      state.sectionTimer.expired = true;
      var onExp = state.sectionTimer.onExpire;
      var tid = state.sectionTimer.topicId;
      stopSectionTimer();
      if (typeof onExp === 'function') onExp(tid);
    }
  }, 1000);
  updateTimerDisplay();
}

function stopSectionTimer() {
  if (state.sectionTimer && state.sectionTimer.intervalId) {
    clearInterval(state.sectionTimer.intervalId);
  }
  state.sectionTimer = null;
  // Clear the data-path binding so stale values don't linger.
  if (typeof TEST_DATA !== 'undefined' && TEST_DATA.section && TEST_DATA.section.current) {
    TEST_DATA.section.current.timer = null;
  }
}
