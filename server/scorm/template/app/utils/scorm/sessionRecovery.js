// app/utils/scorm/sessionRecovery.js
//
// Manages saving and restoring mid-test session progress.
//
// Design:
//   - No timer  → save current question index + answers on every question advance
//                 and restore on next load (user continues where they left off)
//   - With timer → time is gone; cannot restore. Show last attempt result.
//   - Adaptive   → mid-session state is too complex to restore. Show last attempt.
//
// PRD-4 v1.1 §3.2 (Phase 4f) — sectional recovery:
//   - router_by_topics: completed sections + their results are persisted across
//     SCO reload. In-progress sections are NOT restored (learner re-enters the
//     section and re-runs questions); the router shows the previously-completed
//     topics as «Пройдена». Section timers are not persisted — time passing
//     while the SCO was closed is real-world unrecoverable, so re-entry to a
//     timed section starts the timer fresh.
//   - linear_by_topics: same conservative behaviour as before (no per-section
//     checkpoint, only mid-question restore when no test timer is set).
//
// currentSession stored inside suspend_data object:
//   { attemptsUsed, attempts: [...], currentSession: { ... } | null }

function saveCurrentSession() {
  // PRD-4 v1.1: router mode persists sectional checkpoint even with a test
  // timer (the section progress itself doesn't depend on timer state).
  var isRouterMode =
    TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode === 'router_by_topics';

  if (!isRouterMode) {
    if (TEST_DATA.timeLimitMinutes || TEST_DATA.mode === 'adaptive') return;
    if (!state.flatQuestions || state.flatQuestions.length === 0) return;
  }

  var s = readSuspendObj();
  s.currentSession = {
    savedAt: new Date().toISOString(),
    currentIndex: state.currentIndex,
    answers: JSON.parse(JSON.stringify(state.answers)),
    flatQuestions: JSON.parse(JSON.stringify(state.flatQuestions || [])),
    remainingSeconds: null,
    // PRD-4 v1.1 §3.2 / Phase 4f — sectional checkpoint. Only meaningful in
    // router mode; restored by restoreSession to keep completed topics
    // marked as such after a SCO reload. sectionTimer is intentionally
    // not persisted (see module header).
    flowMode:
      (TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode) || 'linear_flat',
    routerTopicStates: JSON.parse(JSON.stringify(state.routerTopicStates || {})),
    sectionResults: JSON.parse(JSON.stringify(state.sectionResults || {})),
    routerFinished: state.routerFinished === true,
  };
  writeSuspendObj(s);
  console.log('💾 Session saved at question', state.currentIndex);
}

function clearCurrentSession() {
  var s = readSuspendObj();
  if (!s.currentSession) return;
  s.currentSession = null;
  writeSuspendObj(s);
  console.log('🗑️ Current session cleared');
}

function isSessionStale(session) {
  try {
    var saved = new Date(session.savedAt).getTime();
    if (isNaN(saved)) return true;
    var maxAge = 24 * 60 * 60 * 1000; // 24 hours
    return Date.now() - saved > maxAge;
  } catch (e) {
    return true;
  }
}

// Returns one of:
//   { action: 'restore',           session: {...} }
//   { action: 'restore_router',    session: {...} }   PRD-4 v1.1 §3.2
//   { action: 'show_last_attempt', attempt: {...} }
//   { action: 'start_fresh' }
function determineRecovery() {
  var s = readSuspendObj();
  var session = s.currentSession || null;
  var attempts = s.attempts || [];
  var isRouterMode =
    TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode === 'router_by_topics';

  // Stale session — treat as no session (router or not)
  if (session && isSessionStale(session)) {
    console.log('⏰ Session is stale, ignoring');
    session = null;
  }

  // PRD-4 v1.1 §3.2 / Phase 4f — router-mode recovery: restore the
  // routerTopicStates / sectionResults snapshot and re-render the router
  // page. In-progress section work is lost (learner re-enters that
  // section), but completed topics stay marked as «Пройдена». This is
  // safe under both standard and adaptive — completed sectionResults are
  // already frozen, in-flight adaptive state is dropped on save (we don't
  // persist adaptiveState).
  if (isRouterMode) {
    if (session && session.flowMode === 'router_by_topics') {
      return { action: 'restore_router', session: session };
    }
    return { action: 'start_fresh' };
  }

  // Non-router adaptive — same conservative «show last attempt» as before.
  if (TEST_DATA.mode === 'adaptive') {
    if (attempts.length > 0) {
      return { action: 'show_last_attempt', attempt: attempts[attempts.length - 1] };
    }
    return { action: 'start_fresh' };
  }

  // No session or empty questions (linear modes only — router handled above)
  if (!session || !session.flatQuestions || session.flatQuestions.length === 0) {
    return { action: 'start_fresh' };
  }

  // With timer — time is gone, cannot restore
  if (TEST_DATA.timeLimitMinutes) {
    if (attempts.length > 0) {
      return { action: 'show_last_attempt', attempt: attempts[attempts.length - 1] };
    }
    return { action: 'start_fresh' };
  }

  // No timer — restore in-progress session
  return { action: 'restore', session: session };
}

// Restores state from a saved session and moves to question phase
function restoreSession(session) {
  state.flatQuestions = session.flatQuestions;
  state.answers = session.answers || {};
  state.currentIndex = session.currentIndex || 0;
  state.phase = 'question';
  state.submitted = false;
  state.feedbackShown = false;
  state.answerConfirmed = false;
  state.timeExpired = false;
  console.log('✅ Session restored at question', state.currentIndex, 'of', state.flatQuestions.length);
}

/**
 * PRD-4 v1.1 §3.2 / Phase 4f — restore the sectional checkpoint in router
 * mode. Re-populates routerTopicStates + sectionResults from the saved
 * session, then defers to the standard router init (generateVariant +
 * rebuildPageSequence place the router page as the active item; render
 * shows the previously-completed topics as «Пройдена»). In-progress
 * section work is intentionally dropped: the learner re-enters that
 * section and re-runs it from scratch.
 */
function restoreRouterSession(session) {
  if (!session) return;
  state.routerTopicStates = JSON.parse(JSON.stringify(session.routerTopicStates || {}));
  state.sectionResults = JSON.parse(JSON.stringify(session.sectionResults || {}));
  state.routerFinished = session.routerFinished === true;
  // Drop in-progress topic — learner restarts that section.
  state.currentRouterTopic = null;
  // Mark any in-progress topic as notStarted so it's re-enterable.
  Object.keys(state.routerTopicStates).forEach(function (tid) {
    if (state.routerTopicStates[tid] === 'inProgress') {
      state.routerTopicStates[tid] = 'notStarted';
    }
  });
  console.log(
    '✅ Router session restored: ',
    Object.keys(state.routerTopicStates).filter(function (tid) {
      return state.routerTopicStates[tid] === 'completed';
    }).length,
    'completed topics',
  );
}
