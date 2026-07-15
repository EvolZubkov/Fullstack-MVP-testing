var __rankClickBound = false;

function bindRankingClicksOnce() {
  if (__rankClickBound) return;
  __rankClickBound = true;

  document.addEventListener('click', function(e) {
    var el = e.target;

    // fallback если closest нет
    while (el && el !== document) {
      if (el.classList && el.classList.contains('rank-btn')) break;
      el = el.parentNode;
    }
    if (!el || el === document) return;

    if (el.disabled) return;

    var qId = el.getAttribute('data-qid');
    var pos = parseInt(el.getAttribute('data-pos'), 10);
    var dir = parseInt(el.getAttribute('data-dir'), 10);

    if (!qId || Number.isNaN(pos) || Number.isNaN(dir)) return;

    moveRank(qId, pos, dir);
  });
}

function __rankMoveInArray(arr, from, to) {
  if (from === to) return arr;
  var copy = arr.slice();
  var item = copy.splice(from, 1)[0];
  copy.splice(to, 0, item);
  return copy;
}

// The ranking question currently on screen (standard or adaptive).
function __rankCurrentQuestion() {
  if (TEST_DATA.mode === 'adaptive' && state.adaptiveState) {
    var qd = (typeof getCurrentAdaptiveQuestion === 'function') ? getCurrentAdaptiveQuestion() : null;
    return qd ? qd.question : null;
  }
  var fq = state.flatQuestions && state.flatQuestions[state.currentIndex];
  return fq ? fq.question : null;
}

/**
 * Ranking drop handler invoked by the SHARED pointer engine (mounted once in
 * dnd/matching.js). `dragId`/`dropId` are the source/target positions; reorders the
 * answer from→to. Ignores non-ranking questions and the feedback-locked state, so
 * it can be called unconditionally alongside the matching handler.
 */
function applyRankingDrop(dropId, dragId) {
  if (TEST_DATA.showCorrectAnswers && state.feedbackShown) return;
  var q = __rankCurrentQuestion();
  if (!q || q.type !== 'ranking') return;
  var from = parseInt(dragId, 10);
  var to = parseInt(dropId, 10);
  if (Number.isNaN(from) || Number.isNaN(to)) return;
  var current = state.answers[q.id];
  if (!Array.isArray(current)) return;
  state.answers[q.id] = __rankMoveInArray(current, from, to);
  // Mark the ranking as actually interacted with so «Отправить ответ» enables
  // (the delivered order is non-correct, so an untouched order must not count).
  if (!state.rankingTouched) state.rankingTouched = {};
  state.rankingTouched[q.id] = true;
  if (typeof rerenderCurrentQuestionInput === 'function') rerenderCurrentQuestionInput();
  if (typeof refreshSubmitEnabled === 'function') refreshSubmitEnabled();
}

// Ranking drag now runs on the shared pointer engine (TBTemplate.attachPointerDnd),
// mounted once by bindMatchingDnDOnce which routes drops here via applyRankingDrop.
// This hook is kept (bootstrap calls it) but no longer binds native HTML5 DnD.
function bindRankingDnDOnce() {}