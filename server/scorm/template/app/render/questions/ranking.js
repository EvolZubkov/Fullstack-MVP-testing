function renderRankingQuestionInput(q, answer, locked, correct, shuffleMapping) {
  var items = (q.data && Array.isArray(q.data.items)) ? q.data.items : [];

  var userOrder = Array.isArray(answer) ? answer.slice() : null;
  if (!userOrder || userOrder.length !== items.length) {
    userOrder = items.map(function(_, i){ return i; });
    state.answers[q.id] = userOrder;
  }

  // `is-locked`: committed answer gets a neutral «зафиксировано» accent (CSS) even
  // when showCorrectAnswers is off — parity with `.option.selected`. Driven by the
  // committed status (not just draggability `locked`); confirmAnswer also adds it
  // point-wise on submit.
  var committed = !!(state.questionStatuses && state.questionStatuses[q.id] === 'answered') || locked;
  var html = '<div class="ranking-board' + (committed ? ' is-locked' : '') + '" data-qid="' + escapeHtml(q.id) + '">';

  userOrder.forEach(function(itemIdx, pos){
    var text = (items[itemIdx] != null) ? String(items[itemIdx]) : ('#' + itemIdx);

    // Shared DnD contract: data-drag/data-drop = position (the shared pointer engine
    // reorders by from→to). data-qid/data-item are kept for the feedback highlighter.
    html += ''
      + '<div class="rank-item rank-draggable"'
      + ' data-drag="' + pos + '"'
      + ' data-drop="' + pos + '"'
      + ' data-qid="' + escapeHtml(q.id) + '"'
      + ' data-item="' + itemIdx + '">'
      +   '<span class="rank-grip">' + burgerSvgInline() + '</span>'
      +   '<span class="rank-text">' + escapeHtml(text) + '</span>'
      + '</div>';
  });

  html += '</div>';
  return html;

  function burgerSvgInline(){
    return ''
      + '<svg width="18" height="18" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">'
      + '<path d="M2.5 4.99524H17.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
      + '<path d="M14.1667 9.9952H2.5" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
      + '<path d="M2.5 14.9951H10.8333" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"></path>'
      + '</svg>';
  }
}
