/**
 * @module dnd/matching
 * @description Matching drag-and-drop for the SCORM runtime.
 *
 * Thin adapter over the SHARED engine (PRD-12 DnD unification): the pointer
 * controller (`TBTemplate.attachPointerDnd`) and the rich pool model
 * (`TBTemplate.normalizePool` / `dropOnRight` / `dropOnPoolSlot` / `returnToPool`,
 * see shared/template/dnd). This replaces the previous native HTML5 DnD; the
 * web host mounts the exact same engine, so both hosts compute drops identically.
 *
 * This module owns only the host wiring: resolving the current matching question,
 * reading/writing `state.answers` + `state.matchingPools`, the feedback lock, and
 * re-rendering. The drag gesture and the pool semantics live in shared/.
 *
 * Depends on globals: state, TEST_DATA, window.TBTemplate, rerenderCurrentQuestionInput,
 * getCurrentAdaptiveQuestion.
 */

var __matchHeightRAF = 0;
function syncMatchingHeights() {
  try {
    if (__matchHeightRAF) cancelAnimationFrame(__matchHeightRAF);
  } catch (e) {}

  __matchHeightRAF = requestAnimationFrame(function () {
    var roots = document.querySelectorAll('.matching-board');
    for (var i = 0; i < roots.length; i++) {
      var root = roots[i];
      if (!root || !root.style) continue;

      // reset to auto for measurement
      root.style.setProperty('--matchRowH', 'auto');

      // measure after next frame so layout is updated
      (function (r) {
        requestAnimationFrame(function () {
          var nodes = r.querySelectorAll('.match-tile, .match-empty');
          var maxH = 0;
          for (var j = 0; j < nodes.length; j++) {
            var h = nodes[j].offsetHeight || 0;
            if (h > maxH) maxH = h;
          }
          if (maxH < 44) maxH = 56; // safety
          r.style.setProperty('--matchRowH', String(maxH) + 'px');
        });
      })(root);
    }
  });
}

var __matchDndBound = false;

function bindMatchingDnDOnce() {
  if (__matchDndBound) return;
  __matchDndBound = true;
  if (typeof document === 'undefined') return;

  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;

  function isLocked() {
    return !!(TEST_DATA.showCorrectAnswers && state.feedbackShown);
  }

  // The matching question currently on screen (standard or adaptive).
  function currentQuestion() {
    if (TEST_DATA.mode === 'adaptive' && state.adaptiveState) {
      var qd = (typeof getCurrentAdaptiveQuestion === 'function') ? getCurrentAdaptiveQuestion() : null;
      return qd ? qd.question : null;
    }
    var fq = state.flatQuestions && state.flatQuestions[state.currentIndex];
    return fq ? fq.question : null;
  }

  function leftMappingFor(q) {
    var sm = state.shuffleMappings && state.shuffleMappings[q.id];
    return (sm && sm.left) ? sm.left : q.data.left.map(function (_, i) { return i; });
  }

  // Resolves the live matching state {pairs, pool} for the current question,
  // reconciling the pool through the shared model.
  function readState(q) {
    var pairs = (state.answers[q.id] && typeof state.answers[q.id] === 'object') ? state.answers[q.id] : {};
    var prevPool = (state.matchingPools && Array.isArray(state.matchingPools[q.id])) ? state.matchingPools[q.id] : [];
    var pool = TB.normalizePool(prevPool, pairs, leftMappingFor(q));
    return { pairs: pairs, pool: pool };
  }

  function commit(q, next) {
    if (!state.matchingPools) state.matchingPools = {};
    state.answers[q.id] = next.pairs;
    state.matchingPools[q.id] = next.pool;
    if (typeof rerenderCurrentQuestionInput === 'function') rerenderCurrentQuestionInput();
    // The nav row is not re-rendered here — sync «Отправить ответ» explicitly so it
    // enables once every pair is matched (matching's hasAnswer needs all pairs).
    if (typeof refreshSubmitEnabled === 'function') refreshSubmitEnabled();
  }

  // Maps a completed drag to a model transition. `dropId` is the zone's
  // `data-drop` value, or '' when the chip was released away from every zone.
  function applyDrop(dropId, dragId) {
    if (isLocked() || !TB) return;
    var q = currentQuestion();
    if (!q || q.type !== 'matching') return;

    var leftIdx = parseInt(dragId, 10);
    if (Number.isNaN(leftIdx)) return;

    var st = readState(q);
    var from = st.pairs.hasOwnProperty(leftIdx) ? 'match' : 'pool';
    var payload = { leftIdx: leftIdx, from: from, poolIndex: from === 'pool' ? st.pool.indexOf(leftIdx) : undefined };

    var next;
    if (dropId === '') {
      // Released into the void: a matched chip detaches; a pooled chip stays put.
      if (from !== 'match') return;
      next = TB.returnToPool(st, leftIdx);
    } else if (dropId.charAt(0) === 'r') {
      var rightIdx = parseInt(dropId.slice(1), 10);
      if (Number.isNaN(rightIdx)) return;
      next = TB.dropOnRight(st, payload, rightIdx);
    } else if (dropId.indexOf('pool') === 0) {
      var ci = dropId.indexOf(':');
      var slot = ci >= 0 ? parseInt(dropId.slice(ci + 1), 10) : st.pool.length;
      next = TB.dropOnPoolSlot(st, payload, Number.isNaN(slot) ? st.pool.length : slot);
    } else {
      return;
    }

    commit(q, next);
  }

  // Single mount of the shared pointer engine for the whole runtime. The drop is
  // routed to both the matching and ranking handlers; each ignores drags that are
  // not for its own question type, so only one acts.
  if (TB && TB.attachPointerDnd) {
    TB.attachPointerDnd(document, {
      onDrop: function (d) {
        applyDrop(d.dropId, d.dragId);
        if (typeof applyRankingDrop === 'function') applyRankingDrop(d.dropId, d.dragId);
      }
    });
  }

  // dblclick a matched chip → return it to the pool (kept for parity / a11y).
  document.addEventListener('dblclick', function (e) {
    if (isLocked() || !TB) return;
    var chip = (e.target && e.target.closest) ? e.target.closest('.match-chip[data-drag]') : null;
    if (!chip) return;
    var q = currentQuestion();
    if (!q || q.type !== 'matching') return;
    var leftIdx = parseInt(chip.getAttribute('data-drag'), 10);
    if (Number.isNaN(leftIdx)) return;
    var st = readState(q);
    if (!st.pairs.hasOwnProperty(leftIdx)) return; // only matched chips return
    commit(q, TB.returnToPool(st, leftIdx));
  });
}
