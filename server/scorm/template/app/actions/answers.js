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

  // ranking: порядок всегда есть (дефолтный тоже), считаем ответом
  if (q.type === 'ranking') return true;

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

function selectSingle(qId, idx) {
  var fq = state.flatQuestions[state.currentIndex];
  if (isAnswerLocked(fq)) return;
  reopenIfCommitted(fq);
  state.answers[qId] = idx;
  
  // Убрать selected у всех опций этого вопроса
  var allOptions = document.querySelectorAll('input[name="q_' + qId + '"]');
  allOptions.forEach(function(radio) {
    radio.checked = false;
    radio.parentElement.classList.remove('selected');
  });
  
  // Добавить selected к выбранному
  var selectedOption = document.querySelector('.option[data-index="' + idx + '"]');
  if (selectedOption) {
    selectedOption.classList.add('selected');
    var radio = selectedOption.querySelector('input[type="radio"]');
    if (radio) radio.checked = true;
  }
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

  // точечное обновление DOM через data-index
  var opt = document.querySelector('.option[data-index="' + idx + '"]');
  if (opt) {
    var cb = opt.querySelector('input[type="checkbox"]');
    var checked = current.indexOf(idx) !== -1;
    if (cb) cb.checked = checked;
    opt.classList.toggle('selected', checked);
  }
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
