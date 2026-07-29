function showToast(message, kind) {
  // kind: 'warn' | 'info' | 'ok' (как раньше, можно использовать в className)
  var id = 'center-toast';
  var existing = document.getElementById(id);

  // если уже показано — обновим текст и перезапустим таймер
  if (existing) {
    existing.querySelector('.center-toast__box').textContent = message;
    existing.className = 'center-toast' + (kind ? (' ' + kind) : '');
    existing.style.display = 'flex';
    if (existing._timeout) clearTimeout(existing._timeout);
    existing._timeout = setTimeout(hide, 3000);
    return;
  }

  var overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'center-toast' + (kind ? (' ' + kind) : '');
  overlay.style.position = 'fixed';
  overlay.style.inset = '0';
  overlay.style.display = 'flex';
  overlay.style.alignItems = 'center';
  overlay.style.justifyContent = 'center';
  overlay.style.background = 'rgba(0,0,0,0.35)';
  overlay.style.zIndex = '99999';
  overlay.style.padding = '16px';

  var box = document.createElement('div');
  box.className = 'center-toast__box';
  box.textContent = message;
  box.style.maxWidth = '90vw';
  box.style.padding = '14px 16px';
  box.style.borderRadius = '12px';
  box.style.fontSize = '16px';
  box.style.fontWeight = '100';
  box.style.boxShadow = '0 10px 30px rgba(0,0,0,0.25)';

  // цвета по kind
  if (kind === 'warn') {
    box.style.background = '#3c55d6ff';
    box.style.color = '#f2f2f2ff';
    
  } else if (kind === 'ok') {
    box.style.background = '#d1e7dd';
    box.style.color = '#0f5132';
    box.style.border = '1px solid #badbcc';
  } else {
    box.style.background = 'white';
    box.style.color = '#111';
    box.style.border = '1px solid rgba(0,0,0,0.08)';
  }

  overlay.appendChild(box);
  document.body.appendChild(overlay);

  function hide() {
    if (!overlay) return;
    overlay.style.display = 'none';
  }

  // закрыть по клику в любом месте
  overlay.addEventListener('click', function () {
    hide();
  });

  // закрыть по Esc
  document.addEventListener('keydown', function onKey(e) {
    if (e.key === 'Escape') {
      hide();
    }
  });

  overlay._timeout = setTimeout(hide, 3000);
}


function hasAnswer(q, answer) {
  if (!q) return true;

  // A scale is answered by one graduation index, exactly like single choice — and
  // index 0 is a real answer, so the check is on the type of the value.
  if (typeof TBQType !== 'undefined' && TBQType.isSingleIndexChoice(q.type)) return typeof answer === 'number';
  if (q.type === 'single') return typeof answer === 'number';
  if (q.type === 'multiple') return Array.isArray(answer) && answer.length > 0;

  if (q.type === 'matching') {
    if (!answer || typeof answer !== 'object') return false;
    var need = (q.data && Array.isArray(q.data.left)) ? q.data.left.length : 0;
    var keys = Object.keys(answer);
    return keys.length === need && keys.every(function(k) {
      return typeof answer[k] === 'number';
    });
  }

  // ranking: the delivered order is guaranteed non-correct (createRankingOrder),
  // so an untouched arrangement is never right — require an actual reorder before
  // it counts as an answer (parity with single/multiple). A ranking that was
  // already committed stays answerable when the learner returns to it.
  if (q.type === 'ranking') {
    if (state.questionStatuses && state.questionStatuses[q.id] === 'answered') return true;
    return !!(state.rankingTouched && state.rankingTouched[q.id]);
  }

  return answer !== undefined && answer !== null;
}

function requireAnswerOrToast() {
  var fq = state.flatQuestions[state.currentIndex];
  if (!fq) return true;

  var q = fq.question;
  var answer = state.answers[q.id];

  if (!hasAnswer(q, answer)) {
    showToast('Сначала ответьте на вопрос', 'warn');
    return false;
  }
  return true;
}

// Resolve the question currently being answered (adaptive-aware), mirroring
// rerenderCurrentQuestionInput. Used to gate «Отправить ответ»/«Принять».
function currentAnsweringQuestion() {
  if (TEST_DATA.mode === 'adaptive' && state.adaptiveState) {
    var qData = typeof getCurrentAdaptiveQuestion === 'function' ? getCurrentAdaptiveQuestion() : null;
    return qData ? qData.question : null;
  }
  var fq = state.flatQuestions[state.currentIndex];
  return fq ? fq.question : null;
}

// «Отправить ответ»/«Принять» is enabled only once the current question has a
// usable answer (the same gate as requireAnswerOrToast). The selection handlers
// patch the DOM in place without a full re-render, so call this after every
// answer change to keep the submit button's disabled state in sync.
function refreshSubmitEnabled() {
  // The gate sits on the nav row's PRIMARY button, and WHICH action that is depends
  // on the flow (shared buildQuestionNav): «Отправить ответ»/«Принять» is
  // `answer-submit`, but a strict-linear row — and every adaptive question — carries
  // the gate on «Далее»/«Завершить тест» instead. Refreshing only `answer-submit`
  // left those disabled until the next full re-render, i.e. unusable.
  var btn = document.querySelector('[data-action="answer-submit"]')
    || document.querySelector('.tb-scene__foot [data-action="answer-next"]')
    || document.querySelector('.tb-scene__foot [data-action="test-finish"]');
  if (!btn) return;
  var q = currentAnsweringQuestion();
  if (!q) return;
  btn.disabled = !hasAnswer(q, state.answers[q.id]);
}

// PRD-19 (Block B): is the current question's answer locked against edits?
// Locked when the question's section was frozen on exit (answerCommitScope
// 'section', B4-freeze) or after an explicit commit when allowAnswerChange is
// off. With allowAnswerChange on, a committed answer re-opens on the next edit.
function isAnswerLocked(fq) {
  if (fq && state.sectionCommitted && state.sectionCommitted[fq.topicId]) return true;
  // PRD-19 (Block B): a committed answer is read-only unless allowAnswerChange.
  // Key off the PERSISTED status, NOT the transient state.feedbackShown (which
  // resets on every navigation/restore) — so a question the learner returns to
  // stays locked. Mirrors the web host isQuestionLocked (FR-04 parity).
  if (fq && fq.question && state.questionStatuses[fq.question.id] === 'answered' && !TEST_DATA.allowAnswerChange) return true;
  return false;
}

// PRD-19 (Block B): when allowAnswerChange lets a learner edit a committed
// answer, the first new selection re-opens the question — drop the 'answered'
// fixation (back to 'unanswered') and restore the two-button nav until they
// confirm again. No-op until a commit has happened (feedbackShown).
function reopenIfCommitted(fq) {
  var committed = state.feedbackShown ||
    !!(fq && fq.question && state.questionStatuses && state.questionStatuses[fq.question.id] === 'answered');
  if (!committed) return;
  state.feedbackShown = false;
  if (fq && fq.question && state.questionStatuses) {
    state.questionStatuses[fq.question.id] = 'unanswered';
  }
  if (typeof updateNavigationButton === 'function') updateNavigationButton();
}

// Choice selection re-renders the input from the SHARED emission (the DS `.ou-*`
// markup is class-driven `is-on`, not native input state), mirroring the web host —
// the same model the DnD adapters already use (rerenderCurrentQuestionInput).
function selectSingle(qId, idx) {
  var fq = state.flatQuestions[state.currentIndex];
  if (isAnswerLocked(fq)) return;
  reopenIfCommitted(fq);
  state.answers[qId] = idx;
  if (typeof rerenderCurrentQuestionInput === 'function') rerenderCurrentQuestionInput();
  refreshSubmitEnabled();
}

function toggleMultiple(qId, idx) {
  var fqM = state.flatQuestions[state.currentIndex];
  if (isAnswerLocked(fqM)) return;
  reopenIfCommitted(fqM);

  var current = Array.isArray(state.answers[qId]) ? state.answers[qId].slice() : [];
  var pos = current.indexOf(idx);
  if (pos === -1) current.push(idx);
  else current.splice(pos, 1);
  state.answers[qId] = current;

  if (typeof rerenderCurrentQuestionInput === 'function') rerenderCurrentQuestionInput();
  refreshSubmitEnabled();
}

/**
 * The question currently on screen (standard or adaptive) — for the delegated
 * choice/ranking click handler, which learns the question id from state, not markup.
 */
function __currentQuestionForInput() {
  if (TEST_DATA.mode === 'adaptive' && state.adaptiveState) {
    var qd = (typeof getCurrentAdaptiveQuestion === 'function') ? getCurrentAdaptiveQuestion() : null;
    return qd ? qd.question : null;
  }
  var fq = state.flatQuestions && state.flatQuestions[state.currentIndex];
  return fq ? fq.question : null;
}

var __qInputClicksBound = false;
/**
 * Delegates question-input clicks from the SHARED emission (bound once): a choice
 * card's `data-action="select:N"` toggles the answer (single/multiple by type), a
 * ranking control's `data-action="rank-up|rank-down:pos"` reorders via the shared
 * reorder path. Selection/drag no longer use inline `onclick` — this replaces it, so
 * both hosts stay on the same delegated `data-action` model.
 */
function bindQuestionInputClicksOnce() {
  if (__qInputClicksBound) return;
  __qInputClicksBound = true;
  if (typeof document === 'undefined') return;
  document.addEventListener('click', function (e) {
    var el = (e.target && e.target.closest) ? e.target.closest('[data-action]') : null;
    if (!el || el.disabled) return;
    var a = el.getAttribute('data-action') || '';
    if (a.indexOf('select:') === 0) {
      var idx = parseInt(a.slice(7), 10);
      if (isNaN(idx)) return;
      var q = __currentQuestionForInput();
      if (!q) return;
      if (q.type === 'multiple') toggleMultiple(q.id, idx);
      // A scale answer is one index, so it goes through the single-choice path.
      else if (typeof TBQType !== 'undefined' && TBQType.isSingleIndexChoice(q.type)) selectSingle(q.id, idx);
      else if (q.type === 'single') selectSingle(q.id, idx);
    } else if (a.indexOf('rank-up:') === 0 || a.indexOf('rank-down:') === 0) {
      var up = a.indexOf('rank-up:') === 0;
      var pos = parseInt(a.slice(a.indexOf(':') + 1), 10);
      if (isNaN(pos)) return;
      // Reuse the shared reorder path (from→to); it self-seeds and sets rankingTouched.
      if (typeof applyRankingDrop === 'function') applyRankingDrop(String(up ? pos - 1 : pos + 1), String(pos));
    }
  });

  // Keyboard on the PRD-26 scale (a radio group): arrows move AND select, Home/End
  // jump to a pole. The index maths comes from the SHARED helper so the package and
  // the web host answer the same keys. Space/Enter need nothing — a graduation is a
  // real <button> and its click is handled above.
  document.addEventListener('keydown', function (e) {
    var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
    if (!TB || !TB.nextScaleIndex) return;
    var group = (e.target && e.target.closest) ? e.target.closest('.ou-stepper--choice') : null;
    if (!group) return;
    var steps = group.querySelectorAll('.ou-stepper__step');
    if (!steps.length) return;
    var checked = -1;
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].getAttribute('aria-checked') === 'true') { checked = i; break; }
    }
    var next = TB.nextScaleIndex(e.key, checked === -1 ? null : checked, steps.length);
    if (next === null) return;
    e.preventDefault();
    var q = __currentQuestionForInput();
    if (!q) return;
    selectSingle(q.id, next);
    // The re-render replaces the nodes, so focus is restored by index afterwards.
    setTimeout(function () {
      var again = document.querySelectorAll('.ou-stepper--choice .ou-stepper__step');
      if (again[next] && again[next].focus) again[next].focus();
    }, 0);
  });
}

function setMatch(qId, leftIdx, rightVal) {
  var fqMatch = state.flatQuestions[state.currentIndex];
  if (isAnswerLocked(fqMatch)) return;
  reopenIfCommitted(fqMatch);

  var pairs = state.answers[qId] || {};

  if (rightVal === '' || rightVal === null || rightVal === undefined) {
    delete pairs[leftIdx];
  } else {
    var n = parseInt(rightVal, 10);
    if (Number.isNaN(n)) delete pairs[leftIdx];
    else pairs[leftIdx] = n;
  }

  state.answers[qId] = pairs;
  refreshSubmitEnabled();
}


// PRD-19 (Block B): the shared advance tail — moves to the next pageSequence
// item (content/router/question) or, in the legacy no-pageSequence path, the
// next flat question, saving the checkpoint first. Used by both next() (after
// an answer commit) and skipQuestion() so currentIndex / currentPageIndex never
// diverge. At the end of the sequence advancePageSequence() submits the test
// (Block D will intercept that with the обзор / finish-confirm screen).
function advanceAfterCommit() {
  if (state.pageSequence && state.pageSequence.length > 0 && typeof advancePageSequence === 'function') {
    saveSessionState();
    state.feedbackShown = false;
    advancePageSequence();
    return;
  }

  if (state.currentIndex < state.flatQuestions.length - 1) {
    saveSessionState();
    state.currentIndex++;
    state.feedbackShown = false;
    render();
  }
}

function next() {
  if (state.phase === 'content') {
    if (typeof advancePageSequence === 'function') advancePageSequence();
    return;
  }

  // PRD-19 (Block B / B2): strict-linear (allowReturnToUnanswered=false) and
  // flexible mode share the same advance — next() always requires an answer
  // (requireAnswerOrToast). Flexible mode adds skipQuestion() as the only way
  // past requireAnswerOrToast; «Далее» itself still demands a committed answer.
  if (!requireAnswerOrToast()) return;

  // PRD-19 (Block B): «Далее» IS a commit — mark the current question 'answered'.
  // This is the canonical fixation on the strict path (which has no separate
  // «Отправить ответ»); confirmAnswer marks it too, so this is idempotent in
  // flexible mode but keeps questionStatuses reliable everywhere.
  var fqNext = state.flatQuestions[state.currentIndex];
  if (fqNext && fqNext.question) state.questionStatuses[fqNext.question.id] = 'answered';

  advanceAfterCommit();
}

// PRD-19 (Block B / B3): «Пропустить» — flexible mode only. Marks the current
// question 'skipped' WITHOUT requiring an answer, then advances like next().
// The uncommitted draft IS cleared: the scoring engine has no notion of status,
// so a kept draft would be graded — clearing makes a final 'skipped' score as
// incorrect (FR-07). On return the learner re-answers from scratch.
function skipQuestion() {
  if (!TEST_DATA.allowReturnToUnanswered) return;
  var fq = state.flatQuestions[state.currentIndex];
  if (!fq) return;
  state.questionStatuses[fq.question.id] = 'skipped';
  delete state.answers[fq.question.id];
  state.feedbackShown = false;
  advanceAfterCommit();
}

// PRD-19 (Block B / B3): move the runtime to a specific flat-question index,
// keeping currentIndex and the pageSequence position in sync. The pageSequence
// mixes content/router/question items, so we locate the matching 'question'
// item (kind+questionIndex) rather than assume index parity — same lookup the
// session-restore path uses.
function goToQuestionIndex(qIndex) {
  if (qIndex < 0 || qIndex >= state.flatQuestions.length) return false;
  state.currentIndex = qIndex;
  state.feedbackShown = false;
  if (state.pageSequence && state.pageSequence.length && typeof goToPageSequenceIndex === 'function') {
    var itemIndex = -1;
    for (var i = 0; i < state.pageSequence.length; i++) {
      var it = state.pageSequence[i];
      if (it && it.kind === 'question' && it.questionIndex === qIndex) { itemIndex = i; break; }
    }
    if (itemIndex >= 0) {
      goToPageSequenceIndex(itemIndex);
      // goToPageSequenceIndex syncs phase but does not paint — render so the
      // returned-to question repaints with its (possibly locked) inputs.
      render();
      return true;
    }
  }
  render();
  return true;
}

// PRD-19 (Block B / B3): jump to the first not-yet-answered question (skipped or
// untouched), scanning the whole variant (return targets earlier skips too).
// Callers: the обзор screen «Перейти» (Block D) and the progress pills (Block
// C). Returns true if it moved. No-op when every question is answered.
function goToNextUnanswered() {
  if (!TEST_DATA.allowReturnToUnanswered) return false;
  // PRD-19 (Block B / B4): in sectional scope return stays inside the current
  // section (other sections freeze on exit); flat scope scans the whole test.
  var sectionScope = TEST_DATA.answerCommitScope === 'section';
  var curFq = state.flatQuestions[state.currentIndex];
  var curTopic = sectionScope && curFq ? curFq.topicId : null;
  for (var i = 0; i < state.flatQuestions.length; i++) {
    var fq = state.flatQuestions[i];
    if (!fq) continue;
    if (sectionScope && fq.topicId !== curTopic) continue;
    if (state.questionStatuses[fq.question.id] !== 'answered') {
      return goToQuestionIndex(i);
    }
  }
  return false;
}


// PRD-19 (Block B): the previous question the learner may return to, or -1.
// Mirrors the web host (take-test.tsx prevAccessibleIndex + section bound):
// «Назад» works only in flexible mode (allowReturnToUnanswered); in sectional
// scope (linear_by_topics / router_by_topics) the return stays inside the
// current section — earlier sections freeze on exit, so it never crosses the
// section boundary.
function prevAccessibleQuestionIndex() {
  if (!TEST_DATA.allowReturnToUnanswered) return -1;
  var cur = state.currentIndex || 0;
  if (cur <= 0) return -1;
  var prev = cur - 1;
  var prevFq = state.flatQuestions[prev];
  if (!prevFq) return -1;
  if (TEST_DATA.answerCommitScope === 'section') {
    var curFq = state.flatQuestions[cur];
    if (!curFq || prevFq.topicId !== curFq.topicId) return -1;
  }
  return prev;
}

// PRD-19 (Block B): «Назад» — return to the previous accessible question
// (bounded to the current section in sectional flows). Persists the back
// position like every forward move so a SCO reload resumes there. No-op when
// there is no accessible previous question (the button is disabled in that case).
function goBack() {
  var prev = prevAccessibleQuestionIndex();
  if (prev < 0) return;
  state.feedbackShown = false;
  if (goToQuestionIndex(prev)) saveSessionState();
}

function submit(force) {
  if (state.submitted) return;

  // если не форс — требуем ответ на текущий вопрос
  if (!force) {
    if (!requireAnswerOrToast()) return;
  }

  // ✅ НОВОЕ: Сохраняем финальное состояние перед завершением
  saveSessionState();

  state.submitted = true;

  stopTestTimer();

  state.currentIndex = state.flatQuestions.length;
  state.currentPageIndex = state.pageSequence ? state.pageSequence.length : state.currentPageIndex;
  // PRD-19 D5: clear any review/sectionResults phase so render() falls through to
  // the final results screen (the dispatcher checks those phases BEFORE the
  // current>=total results path — finishing from the обзор / section-results
  // would otherwise re-render that screen instead of the test results).
  state.phase = 'question';
  render();
}

function restart() {
  console.log('🔄 restart() вызван');
  if (!hasAttemptsLeft()) {
    showToast('Попытки закончились', 'warn');
    return;
  }

  // Попытка считается использованной только если тест был явно завершён через submit().
  // Прерванные (восстановленные) сессии не расходуют попытку.
  if (state.submitted) {
    console.log('💾 Сохраняем завершённую попытку перед перезапуском');
    var results = calculateResults();
    saveAttemptResult(results);

    var currentAttemptNum = Telemetry.getAttemptNumber();
    Telemetry.finish({
      percent: results.percent,
      passed: results.passed,
      earnedPoints: results.earnedPoints,
      possiblePoints: results.possiblePoints,
      totalQuestions: results.totalQuestions,
      correct: results.correct,
      achievedLevels: results.achievedLevels || null
    }, currentAttemptNum);
  }

  state.phase = 'start';
  state.currentIndex = 0;
  state.currentPageIndex = 0;
  state.answers = {};
  state.variant = null;
  state.flatQuestions = [];
  state.pageSequence = [];
  // PRD-19 (Block B): clear navigation statuses; generateVariant() re-seeds them.
  state.questionStatuses = {};
  state.sectionCommitted = {};
  state.submitted = false;
  state.feedbackShown = false;
  state.timeExpired = false;

  stopTestTimer();
  state.remainingSeconds = null;

  generateVariant();
  
  // Телеметрия: новая попытка
  console.log('🆕 Вызываем Telemetry.startNewAttempt()');
  Telemetry.startNewAttempt();
  
  render();
}

function saveSessionState() {
  saveCurrentSession();
}
