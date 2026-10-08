// app/utils/scorm/sessionRecovery.js
//
// Manages saving and restoring mid-test session progress.
//
// Design:
//   - Save the current question index + answers on every question advance and restore
//     them on the next load (the learner continues where they left off).
//   - Timed tests resume too (PRD-20 5.12): the remaining time comes back from the
//     active-time anchor, not from a fresh limit.
//   - Adaptive   → mid-session state is too complex to restore. Show last attempt.
//
// PRD-4 v1.1 §3.2 (Phase 4f) — sectional recovery:
//   - router_by_topics: completed sections + their results are persisted across
//     SCO reload, and PRD-20 (2e) resumes INSIDE an unfinished topic.
//   - Section time is persisted too (`suspend_data.sectionBudgets`, timer.js): a
//     re-entered section continues from its frozen remainder.
//   - PRD-67: under «Закрывать раздел при выходе» a section the previous session broke
//     off inside is CLOSED on load (timer.js closeInterruptedSectionOnLoad) and comes
//     back «Пройдена»; a test without sections is handed in.
//
// currentSession stored inside suspend_data object:
//   { attemptsUsed, attempts: [...], currentSession: { ... } | null }

/**
 * Техдолг №8: исходы пунктов роутера (`state.sectionPassed`) в `suspend_data` — `1` пройден, `0`
 * не пройден. Пункт без порога (`null`) не пишется: его нельзя не пройти, а бюджет `suspend_data`
 * не резиновый (PRD-36).
 */
function encodeSectionPassed(map) {
  var out = {};
  Object.keys(map || {}).forEach(function (key) {
    if (map[key] === true) out[key] = 1;
    else if (map[key] === false) out[key] = 0;
  });
  return out;
}

/** Обратное к {@link encodeSectionPassed}; сеанс до появления поля — пустая карта. */
function decodeSectionPassed(raw) {
  var out = {};
  Object.keys(raw || {}).forEach(function (key) {
    out[key] = raw[key] === 1;
  });
  return out;
}

function saveCurrentSession() {
  // PRD-4 v1.1: router mode persists sectional checkpoint even with a test
  // timer (the section progress itself doesn't depend on timer state).
  var isRouterMode =
    TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode === 'router_by_topics';

  if (!isRouterMode) {
    // PRD-20 (5.12): timed non-router tests now persist progress (the timer is
    // restored separately from the active-time anchor). Adaptive mid-session
    // state stays non-restorable — keep skipping it.
    if (TEST_DATA.mode === 'adaptive') return;
    if (!state.flatQuestions || state.flatQuestions.length === 0) return;
  }

  var s = readSuspendObj();
  var questions = [], answers = [], statuses = [], shuffles = [];
  var fq = state.flatQuestions || [];
  for (var i = 0; i < fq.length; i++) {
    var q = fq[i].question;
    questions.push(q);
    answers.push((state.answers || {})[q.id]);
    statuses.push((state.questionStatuses || {})[q.id] || 'unanswered');
    shuffles.push((state.shuffleMappings || {})[q.id] || null);
  }
  s.currentSession = {
    at: new Date().toISOString(),
    i: state.currentIndex,
    // PRD-36 FR-10: rows instead of question objects. The checkpoint used to carry a full
    // copy of every delivered question — one of the two copies that overflowed the budget.
    dl: TBRunState.encodeDelivery(state.deliveryPositions || []),
    an: TBRunState.encodeAnswers(answers, questions),
    // PRD-19 (Block B): per-question status travels with the checkpoint so a resumed
    // session restores skipped/answered marks.
    st: TBRunState.encodeStatuses(statuses),
    // PRD-36 §8: the option order survives the break. Without it the learner returns to a
    // screen whose options sit in the AUTHOR's order — answers stay right, the screen lies.
    sh: TBRunState.encodeShuffle(shuffles),
    // PRD-36 FR-19 / §8: the delivered PRD-17 variant. Without it `deliveredFormId` returns
    // null after a resume and a `by_variant` threshold silently degrades to the topic's own.
    f: JSON.parse(JSON.stringify(state.deliveredForms || {})),
    // PRD-4 v1.1 §3.2 / Phase 4f — sectional checkpoint. Only meaningful in
    // router mode; restored by restoreRouterSession to keep completed topics
    // marked as such after a SCO reload. sectionTimer is intentionally
    // not persisted (see module header).
    fm: (TEST_DATA.flowPolicy && TEST_DATA.flowPolicy.mode) || 'linear_flat',
    rt: JSON.parse(JSON.stringify(state.routerTopicStates || {})),
    sr: JSON.parse(JSON.stringify(state.sectionResults || {})),
    // Техдолг №8: исходы пунктов роутера для хаба — `1`/`0`, пункт без порога не пишется.
    sp: encodeSectionPassed(state.sectionPassed),
    rf: state.routerFinished === true,
    // PRD-20 (2e): in-progress router topic + position within its chunk, so a
    // reload resumes INSIDE the unfinished non-adaptive topic (not re-run).
    crt: state.currentRouterTopic || null,
    cpi: state.currentPageIndex || 0,
    sc: JSON.parse(JSON.stringify(state.sectionCommitted || {})),
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
    var saved = new Date(session.at).getTime();
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
  // PRD-36 FR-03: the state no longer keeps a list — «show the last attempt» reads the
  // stored last summary (`last: 0` means it is the same object as the best one).
  var last = s.best ? ((s.last === 0 || !s.last) ? s.best : s.last) : null;
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
    if (session && session.fm === 'router_by_topics') {
      return { action: 'restore_router', session: session };
    }
    return { action: 'start_fresh' };
  }

  // Non-router adaptive — same conservative «show last attempt» as before.
  if (TEST_DATA.mode === 'adaptive') {
    if (last) {
      return { action: 'show_last_attempt', attempt: last };
    }
    return { action: 'start_fresh' };
  }

  // No session or empty delivery (linear modes only — router handled above)
  if (!session || !session.dl) {
    return { action: 'start_fresh' };
  }

  // PRD-20 (5.12): timed tests resume when the active-time anchor lets us
  // restore the remaining time; otherwise fall back to the previous behaviour
  // (show last attempt) so a learner never silently regains the full limit.
  if (TEST_DATA.timeLimitMinutes) {
    var anchor = (typeof readTimerAnchor === 'function') ? readTimerAnchor() : null;
    var totalNow = (typeof readTotalTimeSec === 'function') ? readTotalTimeSec() : null;
    var canRestoreTimer = !!(anchor &&
      anchor.limitMinutes === TEST_DATA.timeLimitMinutes &&
      typeof anchor.baselineTotalSec === 'number' &&
      totalNow !== null);
    if (!canRestoreTimer) {
      if (last) {
        return { action: 'show_last_attempt', attempt: last };
      }
      return { action: 'start_fresh' };
    }
  }

  // Restore in-progress session (no timer, or timer restorable from anchor)
  return { action: 'restore', session: session };
}

/**
 * PRD-36 FR-10: rebuild the runtime state from the stored ROWS. The delivered questions come
 * back from TEST_DATA BY POSITION — the checkpoint carries addresses, not content — and the
 * answers, statuses and option order come back from their own rows, keyed by the slot they
 * occupy in the delivery.
 */
function applySessionRows(session) {
  var positions = TBRunState.decodeDelivery(session.dl || '');
  state.deliveryPositions = positions;
  state.flatQuestions = [];
  var questions = [];
  for (var i = 0; i < positions.length; i++) {
    var section = TEST_DATA.sections[positions[i].s];
    var q = (section && section.questions) ? section.questions[positions[i].q] : null;
    if (!q) continue;
    questions.push(q);
    state.flatQuestions.push({ question: q, topicId: section.topicId, topicName: section.topicName });
  }
  var answers = TBRunState.decodeAnswers(session.an || '', questions);
  var statuses = TBRunState.decodeStatuses(session.st || '');
  var shuffles = TBRunState.decodeShuffle(session.sh || '');
  state.answers = {};
  state.questionStatuses = {};
  state.shuffleMappings = {};
  for (var j = 0; j < questions.length; j++) {
    if (answers[j] !== undefined) state.answers[questions[j].id] = answers[j];
    // PRD-19 (Block B): restore navigation statuses; a checkpoint без ряда restores as
    // all-'unanswered', which is what a legacy package's checkpoint means anyway.
    state.questionStatuses[questions[j].id] = statuses[j] || 'unanswered';
    // PRD-36 §8: the order the learner actually saw. Absent row = author's order, the
    // pre-PRD-36 behaviour, which is also what the budget sacrifices fall back to.
    if (shuffles[j]) state.shuffleMappings[questions[j].id] = shuffles[j];
  }
  // PRD-36 FR-19: restore the pinned variant map and make sure `state.variant` carries the
  // same formIds — that is what `deliveredFormId` (PRD-24) reads when it resolves a
  // `by_variant` topic threshold. In router mode a fresh variant has already been generated
  // by the time we get here, so its sections are FILLED IN rather than replaced: they also
  // carry the delivered questionIds, which nothing else can rebuild.
  state.deliveredForms = session.f || {};
  if (!state.variant || !state.variant.sections) state.variant = { sections: [] };
  for (var tid in state.deliveredForms) {
    if (!Object.prototype.hasOwnProperty.call(state.deliveredForms, tid)) continue;
    var known = null;
    for (var vi = 0; vi < state.variant.sections.length; vi++) {
      if (state.variant.sections[vi].topicId === tid) { known = state.variant.sections[vi]; break; }
    }
    if (known) known.formId = state.deliveredForms[tid];
    else state.variant.sections.push({ topicId: tid, formId: state.deliveredForms[tid] });
  }
  state.currentIndex = session.i || 0;
  state.sectionCommitted = session.sc || {};
}

/** Restores state from a saved session and moves to question phase. */
function restoreSession(session) {
  applySessionRows(session);
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
  state.routerTopicStates = JSON.parse(JSON.stringify(session.rt || {}));
  state.sectionResults = JSON.parse(JSON.stringify(session.sr || {}));
  state.sectionPassed = decodeSectionPassed(session.sp);
  state.routerFinished = session.rf === true;
  // PRD-36 FR-19: the router run keeps its delivered variants too — a topic re-entered
  // after the reload must be gated by the SAME variant threshold it was gated by before.
  state.deliveredForms = session.f || {};
  // Drop in-progress topic — learner restarts that section.
  state.currentRouterTopic = null;
  // Mark any in-progress topic as notStarted so it's re-enterable — unless the learner
  // left it under «Закрывать раздел при выходе» (PRD-67): then it is done for good.
  Object.keys(state.routerTopicStates).forEach(function (tid) {
    if (state.routerTopicStates[tid] === 'inProgress') {
      var closed = typeof isSectionClosedByLeave === 'function' && isSectionClosedByLeave(tid);
      state.routerTopicStates[tid] = closed ? 'completed' : 'notStarted';
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
