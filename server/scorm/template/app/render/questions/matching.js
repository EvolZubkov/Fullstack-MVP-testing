/**
 * @module render/questions/matching
 * @description Renders the matching question interaction for the SCORM runtime.
 *
 * Emits the SHARED drag/drop markup contract (`data-drag` on chips,
 * `data-drop="pool:<slot>"` / `data-drop="r<rightIdx>"` on zones) consumed by the
 * shared pointer engine + rich pool model (`TBTemplate.attachPointerDnd` /
 * `TBTemplate.normalizePool`, see shared/template/dnd). This is the SAME engine
 * and the SAME markup the web host renders, so both hosts behave identically.
 *
 * Depends on globals: state, escapeHtml, window.TBTemplate.
 */

/** Drag marker — dots glyph (matches the web host / ui-kit `dots`). */
var MATCH_GRIP =
  '<svg width="18" height="18" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">' +
  '<circle cx="7" cy="5" r="1.4"></circle><circle cx="13" cy="5" r="1.4"></circle>' +
  '<circle cx="7" cy="10" r="1.4"></circle><circle cx="13" cy="10" r="1.4"></circle>' +
  '<circle cx="7" cy="15" r="1.4"></circle><circle cx="13" cy="15" r="1.4"></circle></svg>';

function renderMatchingQuestionInput(q, answer, locked, correct, shuffleMapping) {
  var pairs = (answer && typeof answer === 'object') ? answer : {};

  var mappingObj = shuffleMapping || {};
  var leftMapping = mappingObj.left ? mappingObj.left : q.data.left.map(function (_, i) { return i; });
  var rightMapping = mappingObj.right ? mappingObj.right : q.data.right.map(function (_, i) { return i; });

  // rightIdx -> leftIdx (matched rows)
  var rightToLeft = {};
  Object.keys(pairs).forEach(function (k) {
    var l = parseInt(k, 10);
    var r = pairs[k];
    if (typeof r === 'number') rightToLeft[r] = l;
  });

  // Ordered pool of unmatched left items — reconciled through the shared model so
  // the SCORM host and the web host keep the pool identically.
  if (!state.matchingPools) state.matchingPools = {};
  var prevPool = Array.isArray(state.matchingPools[q.id]) ? state.matchingPools[q.id] : [];
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  var pool = (TB && TB.normalizePool)
    ? TB.normalizePool(prevPool, pairs, leftMapping)
    : leftMapping.filter(function (li) { return !pairs.hasOwnProperty(li); });
  state.matchingPools[q.id] = pool;

  function chip(li) {
    return '<div class="match-chip"' + (locked ? '' : ' data-drag="' + li + '"') + '>'
      + '<span class="match-grip" aria-hidden="true">' + MATCH_GRIP + '</span>'
      + '<span class="match-chip-text">' + escapeHtml(q.data.left[li]) + '</span></div>';
  }

  // `is-locked` marks the board as committed so a submitted answer gets a neutral
  // «зафиксировано» accent (CSS) even when showCorrectAnswers is off — parity with
  // the persistent `.option.selected` on single/multiple. Driven by the committed
  // status (covers navigate-back to an editable committed answer too), not just the
  // draggability `locked`; confirmAnswer also adds it point-wise on submit.
  var committed = !!(state.questionStatuses && state.questionStatuses[q.id] === 'answered') || locked;
  var html = '<div class="matching-board' + (committed ? ' is-locked' : '') + '" data-qid="' + escapeHtml(q.id) + '" style="--matchRowH:auto;">';
  var poolSlot = 0;

  rightMapping.forEach(function (rightIdx) {
    var matchedLeft = rightToLeft.hasOwnProperty(rightIdx) ? rightToLeft[rightIdx] : null;
    var isJoined = (matchedLeft !== null);

    // data-qid/data-right are read by the feedback highlighter (feedback.js);
    // they are inert to the shared DnD engine (which keys only on data-drag/data-drop).
    html += '<div class="matching-line' + (isJoined ? ' is-joined' : '')
      + '" data-qid="' + escapeHtml(q.id) + '" data-right="' + rightIdx + '">';

    // LEFT slot. A matched row's left pairs to THIS right (drop another chip here
    // = displace); an unmatched row's left is a pool slot. poolSlot advances ONLY
    // on unmatched rows, since only they consume a pool position.
    if (isJoined) {
      html += '<div class="match-tile match-left-slot match-drop-left" data-drop="r' + rightIdx + '">' + chip(matchedLeft) + '</div>';
    } else {
      var poolLeft = (poolSlot < pool.length) ? pool[poolSlot] : null;
      if (poolLeft !== null && poolLeft !== undefined) {
        html += '<div class="match-tile match-left-slot match-drop-left" data-drop="pool:' + poolSlot + '">' + chip(poolLeft) + '</div>';
      } else {
        html += '<div class="match-empty match-left-slot match-drop-left" data-drop="pool:' + poolSlot + '"><span class="slot-placeholder">Перетащите вариант</span></div>';
      }
      poolSlot++;
    }

    html += '<div class="matching-gap"></div>';

    // RIGHT tile — the match drop zone.
    html += '<div class="match-tile match-right-tile match-drop-right" data-drop="r' + rightIdx + '">'
      + escapeHtml(q.data.right[rightIdx])
      + '</div>';

    html += '</div>';
  });

  html += '</div>';
  return html;
}
