/**
 * @module render/questions/ranking
 * @description Ranking input for the SCORM runtime. Delegates to the SHARED emission
 * (`TBTemplate.renderRanking`) so the `.ou-rank` markup matches the web host. Rows are
 * reordered by drag (`data-drag`/`data-drop` position → the shared pointer engine) and
 * by keyboard up/down (`data-action="rank-up|rank-down:pos"`), both routed to the shared
 * reorder path (dnd/ranking). The order is NOT seeded here: the pure render shows the
 * shuffle order via fallback, and the first reorder seeds the answer — parity with the
 * web, where an untouched ranking stays "not answered" until the learner reorders.
 *
 * Depends on globals: window.TBTemplate.
 */
function renderRankingQuestionInput(q, answer, locked, correct, shuffleMapping) {
  var TB = (typeof window !== 'undefined') ? window.TBTemplate : null;
  if (!TB || !TB.renderRanking) return '';
  return TB.renderRanking({ type: 'ranking', dataJson: q.data }, answer, shuffleMapping, locked ? correct : undefined);
}
