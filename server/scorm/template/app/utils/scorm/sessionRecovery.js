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
// currentSession stored inside suspend_data object:
//   { attemptsUsed, attempts: [...], currentSession: { ... } | null }

function saveCurrentSession() {
  if (TEST_DATA.timeLimitMinutes || TEST_DATA.mode === 'adaptive') return;
  if (!state.flatQuestions || state.flatQuestions.length === 0) return;

  var s = readSuspendObj();
  s.currentSession = {
    savedAt: new Date().toISOString(),
    currentIndex: state.currentIndex,
    answers: JSON.parse(JSON.stringify(state.answers)),
    flatQuestions: JSON.parse(JSON.stringify(state.flatQuestions)),
    remainingSeconds: null,
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
//   { action: 'show_last_attempt', attempt: {...} }
//   { action: 'start_fresh' }
function determineRecovery() {
  var s = readSuspendObj();
  var session = s.currentSession || null;
  var attempts = s.attempts || [];

  // Adaptive — never restore mid-session
  if (TEST_DATA.mode === 'adaptive') {
    if (attempts.length > 0) {
      return { action: 'show_last_attempt', attempt: attempts[attempts.length - 1] };
    }
    return { action: 'start_fresh' };
  }

  // Stale session — treat as no session
  if (session && isSessionStale(session)) {
    console.log('⏰ Session is stale, ignoring');
    session = null;
  }

  // No session or empty questions
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
